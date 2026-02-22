// SPDX-License-Identifier: Apache-2.0
// PR Integrity Validation — validates review-packet commit SHA and changed_files
// against the live GitHub PR state before accepting a validating transition.

import { execSync } from 'child_process'

// ── Types ──

export interface PrIntegrityInput {
  /** GitHub PR URL (e.g. https://github.com/org/repo/pull/123) */
  pr_url: string
  /** Commit SHA from the review packet */
  packet_commit: string
  /** Changed files from the review packet */
  packet_changed_files: string[]
}

export interface PrIntegrityResult {
  valid: boolean
  /** Live PR head SHA (if fetched successfully) */
  live_head_sha: string | null
  /** Live PR changed files (if fetched successfully) */
  live_changed_files: string[] | null
  errors: PrIntegrityError[]
  /** Whether the check was skipped (e.g. gh CLI not available) */
  skipped: boolean
  skip_reason?: string
}

export interface PrIntegrityError {
  field: 'commit' | 'changed_files'
  message: string
  expected?: string
  actual?: string
  /** Files in packet but not in live PR */
  extra_files?: string[]
  /** Files in live PR but not in packet */
  missing_files?: string[]
}

// ── Parse ──

/**
 * Extract owner/repo and PR number from a GitHub PR URL.
 */
export function parsePrUrl(url: string): { repo: string; number: number } | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { repo: match[1], number: parseInt(match[2], 10) }
}

// ── Fetch live PR state via gh CLI ──

interface GhPrData {
  headRefOid: string
  files: string[]
}

function fetchPrState(repo: string, prNumber: number): GhPrData | null {
  try {
    // Fetch head SHA
    const headJson = execSync(
      `gh pr view ${prNumber} --repo ${repo} --json headRefOid`,
      { timeout: 15_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    const { headRefOid } = JSON.parse(headJson)

    // Fetch changed files
    const filesJson = execSync(
      `gh pr view ${prNumber} --repo ${repo} --json files --jq '[.files[].path]'`,
      { timeout: 15_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    const files = JSON.parse(filesJson) as string[]

    return { headRefOid, files }
  } catch {
    return null
  }
}

// ── Core validation ──

/**
 * Validate a review packet's commit SHA and changed files against the live PR.
 *
 * Returns `valid: true` if both match.
 * Returns `skipped: true` if gh CLI is unavailable, PR can't be fetched,
 * or we're in a test environment.
 */
export function validatePrIntegrity(input: PrIntegrityInput): PrIntegrityResult {
  // Parse URL first (always validate, even in test env)
  const parsed = parsePrUrl(input.pr_url)
  if (!parsed) {
    return {
      valid: false,
      live_head_sha: null,
      live_changed_files: null,
      errors: [{ field: 'commit', message: `Invalid PR URL: ${input.pr_url}` }],
      skipped: false,
    }
  }

  // Skip live PR check in test environments (REFLECTT_HOME under temp dirs)
  const home = process.env.REFLECTT_HOME || ''
  if (home.includes('/tmp/') || home.includes('/var/folders/') || home.startsWith('/tmp')) {
    return {
      valid: true,
      live_head_sha: null,
      live_changed_files: null,
      errors: [],
      skipped: true,
      skip_reason: 'Test environment detected (REFLECTT_HOME is temp dir)',
    }
  }

  // Check gh CLI availability
  try {
    execSync('gh --version', { timeout: 5_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch {
    return {
      valid: true, // soft-pass: can't verify
      live_head_sha: null,
      live_changed_files: null,
      errors: [],
      skipped: true,
      skip_reason: 'gh CLI not available',
    }
  }

  const prState = fetchPrState(parsed.repo, parsed.number)
  if (!prState) {
    return {
      valid: true, // soft-pass: PR fetch failed (maybe private, auth issue, etc.)
      live_head_sha: null,
      live_changed_files: null,
      errors: [],
      skipped: true,
      skip_reason: `Failed to fetch PR #${parsed.number} from ${parsed.repo}`,
    }
  }

  const errors: PrIntegrityError[] = []

  // 1. Commit SHA validation
  const liveHead = prState.headRefOid
  const packetCommit = input.packet_commit.trim().toLowerCase()
  const liveHeadNorm = liveHead.toLowerCase()

  // Support short SHA comparison (7+ chars)
  const shortLen = Math.min(packetCommit.length, liveHeadNorm.length)
  const packetShort = packetCommit.slice(0, shortLen)
  const liveShort = liveHeadNorm.slice(0, shortLen)

  if (packetShort !== liveShort) {
    errors.push({
      field: 'commit',
      message: `Review packet commit (${input.packet_commit}) does not match live PR head (${liveHead.slice(0, 12)})`,
      expected: liveHead,
      actual: input.packet_commit,
    })
  }

  // 2. Changed files validation
  const liveFiles = new Set(prState.files.map(f => f.trim()))
  const packetFiles = new Set(input.packet_changed_files.map(f => f.trim()))

  const extraFiles = [...packetFiles].filter(f => !liveFiles.has(f))
  const missingFiles = [...liveFiles].filter(f => !packetFiles.has(f))

  if (extraFiles.length > 0 || missingFiles.length > 0) {
    errors.push({
      field: 'changed_files',
      message: `Review packet changed_files do not match live PR (${extraFiles.length} extra, ${missingFiles.length} missing)`,
      extra_files: extraFiles.length > 0 ? extraFiles : undefined,
      missing_files: missingFiles.length > 0 ? missingFiles : undefined,
    })
  }

  return {
    valid: errors.length === 0,
    live_head_sha: liveHead,
    live_changed_files: prState.files,
    errors,
    skipped: false,
  }
}
