/**
 * Artifact path normalization + GitHub blob fallback.
 *
 * Solves: reviewers can't access artifacts because paths are workspace-dependent
 * (absolute, or prefixed with workspace-<agent>/).
 *
 * Strategy:
 * 1) Normalize: strip workspace prefixes → repo-relative process/...
 * 2) Reject: absolute paths that don't contain a recognizable workspace/repo pattern
 * 3) GitHub fallback: if local file missing but PR is known, build GitHub blob URL
 */

import { isAbsolute, basename, relative, resolve } from 'node:path'

// ── Known workspace prefix patterns ──────────────────────────────────

const WORKSPACE_PATTERNS = [
  // OpenClaw workspace paths
  /^.*?\/\.openclaw\/workspace[^/]*\//,
  // Reflectt home paths
  /^.*?\/\.reflectt\//,
  // Generic Users/*/projects/reflectt-node/ pattern
  /^.*?\/projects\/reflectt-node\//,
  // Generic Users/*/reflectt-node/ pattern
  /^.*?\/reflectt-node\//,
]

/**
 * Normalize an artifact path to repo-relative.
 * Returns { normalized, wasAbsolute, wasNormalized }.
 *
 * Examples:
 *   "/Users/ryan/.openclaw/workspace-link/process/QA.md" → "process/QA.md"
 *   "workspace-shared/process/QA.md" → "process/QA.md"
 *   "process/QA.md" → "process/QA.md" (unchanged)
 *   "/etc/passwd" → null (rejected)
 */
export function normalizeArtifactPath(raw: string): {
  normalized: string | null
  wasAbsolute: boolean
  wasNormalized: boolean
  rejected: boolean
  rejectReason?: string
} {
  if (!raw || typeof raw !== 'string') {
    return { normalized: null, wasAbsolute: false, wasNormalized: false, rejected: true, rejectReason: 'Empty path' }
  }

  const trimmed = raw.trim()

  // Reject null bytes
  if (trimmed.includes('\0')) {
    return { normalized: null, wasAbsolute: false, wasNormalized: false, rejected: true, rejectReason: 'Null byte in path' }
  }

  // URLs pass through unchanged
  if (/^https?:\/\//i.test(trimmed)) {
    return { normalized: trimmed, wasAbsolute: false, wasNormalized: false, rejected: false }
  }

  const wasAbsolute = isAbsolute(trimmed)

  // If absolute, try to strip known workspace prefixes
  if (wasAbsolute) {
    for (const pattern of WORKSPACE_PATTERNS) {
      const match = trimmed.match(pattern)
      if (match) {
        const stripped = trimmed.slice(match[0].length)
        if (stripped && !stripped.includes('..') && !isAbsolute(stripped)) {
          return { normalized: stripped, wasAbsolute: true, wasNormalized: true, rejected: false }
        }
      }
    }
    // Absolute path with no recognizable prefix → reject
    return {
      normalized: null,
      wasAbsolute: true,
      wasNormalized: false,
      rejected: true,
      rejectReason: `Absolute path does not match any known workspace pattern: ${trimmed.slice(0, 80)}...`,
    }
  }

  // Strip common relative workspace prefixes
  let result = trimmed
  const RELATIVE_PREFIXES = ['workspace-shared/', 'workspace-link/', 'workspace-echo/', 'workspace-kai/', 'workspace-sage/', 'workspace-pixel/', 'workspace-spark/', 'workspace-harmony/', 'workspace-scout/', 'workspace-rhythm/', 'shared/']
  for (const prefix of RELATIVE_PREFIXES) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length)
      break
    }
  }

  // Reject traversal
  if (result.includes('..')) {
    return { normalized: null, wasAbsolute: false, wasNormalized: false, rejected: true, rejectReason: 'Path contains ..' }
  }

  const wasNormalized = result !== trimmed
  return { normalized: result, wasAbsolute, wasNormalized, rejected: false }
}

/**
 * Normalize all artifact paths in task metadata.
 * Returns { patches, warnings } where patches is a metadata merge object
 * and warnings lists any normalization events.
 */
export function normalizeTaskArtifactPaths(metadata: Record<string, unknown>): {
  patches: Record<string, unknown>
  warnings: string[]
  rejected: string[]
} {
  const patches: Record<string, unknown> = {}
  const warnings: string[] = []
  const rejected: string[] = []

  // Normalize metadata.artifact_path
  if (typeof metadata.artifact_path === 'string') {
    const result = normalizeArtifactPath(metadata.artifact_path)
    if (result.rejected) {
      rejected.push(`artifact_path: ${result.rejectReason}`)
    } else if (result.wasNormalized && result.normalized) {
      patches.artifact_path = result.normalized
      warnings.push(`artifact_path normalized: "${metadata.artifact_path}" → "${result.normalized}"`)
    }
  }

  // Normalize qa_bundle.review_packet.artifact_path
  const qaBundle = metadata.qa_bundle as Record<string, unknown> | undefined
  const reviewPacket = qaBundle?.review_packet as Record<string, unknown> | undefined
  if (typeof reviewPacket?.artifact_path === 'string') {
    const result = normalizeArtifactPath(reviewPacket.artifact_path)
    if (result.rejected) {
      rejected.push(`qa_bundle.review_packet.artifact_path: ${result.rejectReason}`)
    } else if (result.wasNormalized && result.normalized) {
      // Deep merge
      patches.qa_bundle = {
        ...(patches.qa_bundle as Record<string, unknown> || {}),
        ...qaBundle,
        review_packet: { ...reviewPacket, artifact_path: result.normalized },
      }
      warnings.push(`qa_bundle.review_packet.artifact_path normalized: "${reviewPacket.artifact_path}" → "${result.normalized}"`)
    }
  }

  // Normalize review_handoff.artifact_path
  const reviewHandoff = metadata.review_handoff as Record<string, unknown> | undefined
  if (typeof reviewHandoff?.artifact_path === 'string') {
    const result = normalizeArtifactPath(reviewHandoff.artifact_path)
    if (result.rejected) {
      rejected.push(`review_handoff.artifact_path: ${result.rejectReason}`)
    } else if (result.wasNormalized && result.normalized) {
      patches.review_handoff = { ...reviewHandoff, artifact_path: result.normalized }
      warnings.push(`review_handoff.artifact_path normalized: "${reviewHandoff.artifact_path}" → "${result.normalized}"`)
    }
  }

  return { patches, warnings, rejected }
}

/**
 * Build a GitHub blob URL for an artifact when the local file is missing.
 * Uses the PR's repo + head SHA + file path.
 */
export function buildGitHubBlobUrl(
  prUrl: string,
  commitSha: string,
  filePath: string,
): string | null {
  // Extract owner/repo from PR URL
  const prMatch = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/)
  if (!prMatch) return null

  const ownerRepo = prMatch[1]
  const sha = commitSha.length >= 7 ? commitSha : null
  if (!sha) return null

  return `https://github.com/${ownerRepo}/blob/${sha}/${filePath}`
}

/**
 * Build a GitHub raw URL for downloading artifact content.
 */
export function buildGitHubRawUrl(
  prUrl: string,
  commitSha: string,
  filePath: string,
): string | null {
  const prMatch = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/)
  if (!prMatch) return null

  const ownerRepo = prMatch[1]
  const sha = commitSha.length >= 7 ? commitSha : null
  if (!sha) return null

  return `https://raw.githubusercontent.com/${ownerRepo}/${sha}/${filePath}`
}
