// SPDX-License-Identifier: Apache-2.0
// Shared workspace read API — safe, read-only access to shared artifacts.
//
// Security invariants:
// - Only repo-relative paths (no absolute, no drive letters)
// - Normalize + reject any '..' segments
// - Allowlist prefixes: process/ (extensible)
// - realpath containment: resolved real path must be under shared root (defeats symlink escape)
// - Extension allowlist: .md, .txt, .json, .log, .yml, .yaml
// - Size cap: 400KB
// - Listing uses lstat to detect symlinks; symlinks pointing outside root are skipped
//
// Note: we do NOT try to model host-credential scoped access here. Access is gated
// at the API route layer (localhost only for reflectt-node).

import { promises as fs } from 'fs'
import { resolve, sep, extname, normalize, relative, isAbsolute } from 'path'
import { SHARED_WORKSPACE, WORKSPACE_ROOT } from './artifact-mirror.js'

const ALLOWED_PREFIXES = ['process/']
export const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.log', '.yml', '.yaml'])
const MAX_FILE_SIZE = 400 * 1024 // 400KB
const MAX_PREVIEW_CHARS = 2000
const MAX_LIST_ENTRIES = 500

export interface SharedFileEntry {
  name: string
  path: string       // relative to shared workspace root
  type: 'file' | 'directory'
  size?: number
  extension?: string
}

export interface SharedFileContent {
  path: string
  content: string
  size: number
  truncated: boolean
  source: 'shared-workspace'
}

export interface SharedListResult {
  success: boolean
  root: string
  path: string
  entries: SharedFileEntry[]
  error?: string
}

export interface SharedReadResult {
  success: boolean
  file?: SharedFileContent
  error?: string
}

/**
 * Validate a relative path against security invariants.
 * Returns the resolved absolute path or throws.
 *
 * This is a synchronous pre-check. For full security (symlink containment),
 * use validatePathWithRealpath() which also resolves symlinks.
 */
export function validatePath(relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('Path is required')
  }

  // Reject absolute paths / drive letters
  if (isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) {
    throw new Error('Absolute paths are not allowed')
  }

  // Reject .. segments (before normalization to prevent bypass)
  if (relPath.includes('..')) {
    throw new Error('Path traversal (..) is not allowed')
  }

  // Check prefix allowlist
  const normalized = normalize(relPath).replace(/\\/g, '/')
  if (!ALLOWED_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    throw new Error(`Path must start with one of: ${ALLOWED_PREFIXES.join(', ')}`)
  }

  // Resolve against shared workspace root
  const sharedRoot = SHARED_WORKSPACE()
  const resolved = resolve(sharedRoot, relPath)

  // Containment check via path.relative (not string prefix — avoids /root vs /root-evil confusion)
  const rel = relative(sharedRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path escapes shared workspace root')
  }

  return resolved
}

/**
 * Validate path AND resolve symlinks for full containment check.
 * Prevents symlink escape attacks (e.g., a symlinked dir inside process/ pointing outside root).
 *
 * On macOS, realpath handles APFS case-insensitivity and /var→/private/var canonicalization.
 */
export async function validatePathWithRealpath(relPath: string): Promise<string> {
  // Run synchronous checks first
  const resolved = validatePath(relPath)

  // Get real paths (resolves symlinks)
  const sharedRoot = SHARED_WORKSPACE()
  let rootReal: string
  try {
    rootReal = await fs.realpath(sharedRoot)
  } catch {
    throw new Error('Shared workspace root does not exist or is inaccessible')
  }

  let candidateReal: string
  try {
    candidateReal = await fs.realpath(resolved)
  } catch {
    // File doesn't exist yet — the synchronous check already validated structure
    throw new Error('Path does not exist')
  }

  // Containment via path.relative on real paths
  const rel = relative(rootReal, candidateReal)
  if (rel === '') return candidateReal // candidate IS root (for listing)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path escapes shared workspace root (symlink escape detected)')
  }

  return candidateReal
}

/**
 * Validate file extension against allowlist.
 */
export function validateExtension(filePath: string): void {
  const ext = extname(filePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension '${ext}' is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`)
  }
}

/**
 * List files in a shared workspace directory.
 * Uses lstat to detect symlinks; verifies symlink targets stay within root.
 */
export async function listSharedFiles(relPath: string = 'process/', limit: number = 200): Promise<SharedListResult> {
  try {
    const realResolved = await validatePathWithRealpath(relPath)
    const sharedRoot = SHARED_WORKSPACE()

    let rootReal: string
    try {
      rootReal = await fs.realpath(sharedRoot)
    } catch {
      return { success: false, root: sharedRoot, path: relPath, entries: [], error: 'Shared workspace root inaccessible' }
    }

    const stat = await fs.lstat(realResolved)
    if (!stat.isDirectory()) {
      return { success: false, root: sharedRoot, path: relPath, entries: [], error: 'Path is not a directory' }
    }

    const rawEntries = await fs.readdir(realResolved, { withFileTypes: true })
    const entries: SharedFileEntry[] = []
    const effectiveLimit = Math.min(limit, MAX_LIST_ENTRIES)

    for (const entry of rawEntries) {
      if (entries.length >= effectiveLimit) break

      const entryFullPath = resolve(realResolved, entry.name)
      const entryRelPath = `${relPath.replace(/\/$/, '')}/${entry.name}`

      // Use lstat to detect symlinks
      let entryStat
      try {
        entryStat = await fs.lstat(entryFullPath)
      } catch {
        continue // skip inaccessible
      }

      // For symlinks: resolve and check containment
      if (entryStat.isSymbolicLink()) {
        try {
          const realTarget = await fs.realpath(entryFullPath)
          const rel = relative(rootReal, realTarget)
          if (rel.startsWith('..') || isAbsolute(rel)) {
            continue // symlink escapes root — skip silently
          }
          entryStat = await fs.stat(realTarget)
        } catch {
          continue // broken symlink — skip
        }
      }

      if (entryStat.isDirectory()) {
        entries.push({ name: entry.name, path: entryRelPath, type: 'directory' })
      } else if (entryStat.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (!ALLOWED_EXTENSIONS.has(ext)) continue // skip disallowed extensions

        entries.push({
          name: entry.name,
          path: entryRelPath,
          type: 'file',
          size: entryStat.size,
          extension: ext,
        })
      }
    }

    // Sort: directories first, then by name
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return { success: true, root: sharedRoot, path: relPath, entries }
  } catch (err) {
    return { success: false, root: SHARED_WORKSPACE(), path: relPath, entries: [], error: (err as Error).message }
  }
}

/**
 * Read a file from the shared workspace.
 * Returns content (truncated to MAX_FILE_SIZE) or preview (first N chars).
 * Uses realpath containment to defeat symlink escape attacks.
 */
export async function readSharedFile(
  relPath: string,
  opts?: { preview?: boolean; maxChars?: number },
): Promise<SharedReadResult> {
  try {
    const realResolved = await validatePathWithRealpath(relPath)
    validateExtension(realResolved)

    const stat = await fs.stat(realResolved)
    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a file' }
    }

    if (stat.size > MAX_FILE_SIZE) {
      return { success: false, error: `File exceeds size limit (${stat.size} bytes > ${MAX_FILE_SIZE} bytes)` }
    }

    const raw = await fs.readFile(realResolved, 'utf-8')
    const maxChars = opts?.preview ? (opts.maxChars || MAX_PREVIEW_CHARS) : raw.length
    const content = raw.slice(0, maxChars)

    return {
      success: true,
      file: {
        path: relPath,
        content,
        size: stat.size,
        truncated: content.length < raw.length,
        source: 'shared-workspace',
      },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

/**
 * Resolve a task artifact path: try workspace root first, then shared workspace fallback.
 * Uses realpath containment for shared workspace paths.
 * Returns metadata about accessibility.
 */
export async function resolveTaskArtifact(
  artifactPath: string,
  workspaceRoot: string,
): Promise<{
  type: 'file' | 'directory' | 'missing'
  accessible: boolean
  source: 'workspace' | 'shared-workspace' | null
  resolvedPath: string | null
  preview?: string
}> {
  if (!artifactPath) {
    return { type: 'missing', accessible: false, source: null, resolvedPath: null }
  }

  // Reject obviously unsafe paths early
  if (isAbsolute(artifactPath) || artifactPath.includes('..')) {
    return { type: 'missing', accessible: false, source: null, resolvedPath: null }
  }

  // Try workspace root first
  const wsPath = resolve(workspaceRoot, artifactPath)
  // Containment check for workspace root too
  const wsRel = relative(workspaceRoot, wsPath)
  if (!wsRel.startsWith('..') && !isAbsolute(wsRel)) {
    const wsStat = await fs.stat(wsPath).catch(() => null)
    if (wsStat) {
      const type = wsStat.isDirectory() ? 'directory' : 'file'
      let preview: string | undefined
      if (type === 'file' && wsStat.size <= MAX_FILE_SIZE) {
        const ext = extname(wsPath).toLowerCase()
        if (ALLOWED_EXTENSIONS.has(ext)) {
          const raw = await fs.readFile(wsPath, 'utf-8').catch(() => '')
          preview = raw.slice(0, MAX_PREVIEW_CHARS)
        }
      }
      return { type, accessible: true, source: 'workspace', resolvedPath: wsPath, preview }
    }
  }

  // Fallback to shared workspace — use realpath containment
  const sharedRoot = SHARED_WORKSPACE()
  let rootReal: string
  try {
    rootReal = await fs.realpath(sharedRoot)
  } catch {
    return { type: 'missing', accessible: false, source: null, resolvedPath: null }
  }

  const sharedPath = resolve(sharedRoot, artifactPath)
  let sharedReal: string
  try {
    sharedReal = await fs.realpath(sharedPath)
  } catch {
    return { type: 'missing', accessible: false, source: null, resolvedPath: null }
  }

  // Containment via path.relative on real paths
  const rel = relative(rootReal, sharedReal)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { type: 'missing', accessible: false, source: null, resolvedPath: null }
  }

  const sharedStat = await fs.stat(sharedReal).catch(() => null)
  if (sharedStat) {
    const type = sharedStat.isDirectory() ? 'directory' : 'file'
    let preview: string | undefined
    if (type === 'file' && sharedStat.size <= MAX_FILE_SIZE) {
      const ext = extname(sharedReal).toLowerCase()
      if (ALLOWED_EXTENSIONS.has(ext)) {
        const raw = await fs.readFile(sharedReal, 'utf-8').catch(() => '')
        preview = raw.slice(0, MAX_PREVIEW_CHARS)
      }
    }
    return { type, accessible: true, source: 'shared-workspace', resolvedPath: sharedReal, preview }
  }

  return { type: 'missing', accessible: false, source: null, resolvedPath: null }
}
