// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * GitHub Webhook Agent Attribution
 *
 * Maps GitHub webhook sender usernames (e.g. @itskaidev) to the actual
 * agent who owns the PR, using branch naming convention (agent/...).
 *
 * This enriches webhook payloads with `_reflectt_agent` metadata so
 * downstream consumers know which agent to @mention.
 */

import { getAgentRoles } from './assignment.js'

/** Extract agent name from a branch ref like "link/c8-coverage" or "spark/fix-tests" */
export function extractAgentFromBranch(branchName: string): string | null {
  if (!branchName || typeof branchName !== 'string') return null
  // Branch format: <agent>/<anything>
  const slash = branchName.indexOf('/')
  if (slash <= 0) return null
  const candidate = branchName.slice(0, slash).toLowerCase()
  // Validate against known agent names
  const roles = getAgentRoles()
  const match = roles.find(r => r.name.toLowerCase() === candidate)
  return match ? match.name : null
}

/** Known shared GitHub usernames that should be remapped */
const SHARED_GITHUB_USERNAMES = new Set([
  'itskaidev',
  // Add more shared accounts here if needed
])

export interface GitHubWebhookAttribution {
  /** The resolved agent name (e.g. "link") or null if not determinable */
  agent: string | null
  /** The GitHub username from the event */
  githubUser: string | null
  /** Whether the GitHub user is a shared account that was remapped */
  remapped: boolean
  /** Source of the attribution: 'branch', 'fallback', or 'direct' */
  source: 'branch' | 'fallback' | 'direct' | 'none'
}

const FALLBACK_AGENT = 'kai'

/**
 * Resolve agent attribution from a GitHub webhook payload.
 *
 * Priority:
 * 1. PR branch name (most reliable — agent/task-xxx convention)
 * 2. Fallback to configured default (kai)
 * 3. null if can't determine
 */
export function resolveWebhookAttribution(payload: Record<string, unknown>): GitHubWebhookAttribution {
  const sender = extractNestedString(payload, 'sender', 'login')
  const isSharedAccount = sender ? SHARED_GITHUB_USERNAMES.has(sender.toLowerCase()) : false

  // Try PR branch name first (works for pull_request, pull_request_review, etc.)
  const prBranch =
    extractNestedString(payload, 'pull_request', 'head', 'ref') ||
    // For push events
    extractBranchFromRef(payload.ref as string | undefined)

  if (prBranch) {
    const agent = extractAgentFromBranch(prBranch)
    if (agent) {
      return { agent, githubUser: sender, remapped: isSharedAccount, source: 'branch' }
    }
  }

  // If sender is a shared account and we can't determine from branch, fallback
  if (isSharedAccount) {
    return { agent: FALLBACK_AGENT, githubUser: sender, remapped: true, source: 'fallback' }
  }

  // If sender is a known agent name, use it directly
  if (sender) {
    const roles = getAgentRoles()
    const match = roles.find(r => r.name.toLowerCase() === sender.toLowerCase())
    if (match) {
      return { agent: match.name, githubUser: sender, remapped: false, source: 'direct' }
    }
  }

  return { agent: null, githubUser: sender, remapped: false, source: 'none' }
}

/**
 * Remap shared GitHub @mentions in a pre-formatted message string.
 *
 * Used for cloud-relayed GitHub event messages where the cloud has already
 * formatted the message content (e.g. "@itskaidev\n✅ **PR merged** #828...")
 * but used the raw GitHub sender login instead of the real agent name.
 *
 * Replaces any `@<sharedUsername>` occurrences with `@<fallbackAgent>`.
 * Does NOT perform branch-based lookup (branch info is unavailable at this stage).
 */
export function remapGitHubMentions(text: string): string {
  if (!text || typeof text !== 'string') return text
  let result = text
  for (const username of SHARED_GITHUB_USERNAMES) {
    // Match @username at word boundary (avoid partial matches like @itskaidev123)
    result = result.replace(new RegExp(`@${username}\\b`, 'gi'), `@${FALLBACK_AGENT}`)
  }
  return result
}

/**
 * Enrich a GitHub webhook payload with agent attribution metadata.
 * Adds `_reflectt_attribution` to the payload (non-destructive).
 */
export function enrichWebhookPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const attribution = resolveWebhookAttribution(payload)
  return {
    ...payload,
    _reflectt_attribution: {
      agent: attribution.agent,
      githubUser: attribution.githubUser,
      remapped: attribution.remapped,
      source: attribution.source,
    },
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function extractNestedString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  let current: unknown = obj
  for (const key of keys) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null
}

function extractBranchFromRef(ref: string | undefined): string | null {
  if (!ref || typeof ref !== 'string') return null
  // refs/heads/link/c8-coverage → link/c8-coverage
  const prefix = 'refs/heads/'
  if (ref.startsWith(prefix)) return ref.slice(prefix.length)
  return null
}
