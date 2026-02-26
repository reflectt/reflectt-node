// SPDX-License-Identifier: Apache-2.0
// Artifact mirror: auto-copies process/ artifacts to workspace-shared/process/
// so reviewers in other workspaces can access them without manual copying.
//
// Triggered on task transition to validating or done.

import { promises as fs } from 'fs'
import { join, resolve, dirname } from 'path'
import { homedir } from 'os'

// ── Config (lazy for testability — env is read at call time) ──

/**
 * Canonical shared workspace: ~/.openclaw/workspace-shared
 *
 * Override with REFLECTT_SHARED_WORKSPACE env var.
 * The previous default (../workspace-shared relative to project root)
 * was wrong when running from a nested project directory.
 */

function getWorkspaceRoot(): string {
  const explicit = process.env.REFLECTT_WORKSPACE
  if (explicit) return resolve(explicit)

  // reflectt-node commonly runs with CWD inside a nested project directory:
  //   ~/.openclaw/workspace/projects/reflectt-node
  // In that case, the actual workspace root is the parent *before* /projects/reflectt-node.
  const cwd = resolve(process.cwd())
  const normalized = cwd.replace(/\\/g, '/')
  const marker = '/projects/reflectt-node'
  const idx = normalized.lastIndexOf(marker)

  if (idx !== -1) {
    const root = normalized.slice(0, idx)
    if (root) return root
  }

  return cwd
}

function getSharedWorkspace(): string {
  return process.env.REFLECTT_SHARED_WORKSPACE
    || resolve(homedir(), '.openclaw', 'workspace-shared')
}

export function WORKSPACE_ROOT(): string { return getWorkspaceRoot() }
export function SHARED_WORKSPACE(): string { return getSharedWorkspace() }

// ── Core ──

export interface MirrorResult {
  mirrored: boolean
  source: string
  destination: string
  filesCopied: number
  error?: string
}

async function listCandidateWorkspaceRoots(): Promise<string[]> {
  const roots: string[] = []
  const seen = new Set<string>()

  const add = (p: string) => {
    if (!p) return
    const r = resolve(p)
    if (seen.has(r)) return
    seen.add(r)
    roots.push(r)
  }

  // Prefer the inferred runtime workspace root first (fast path).
  add(getWorkspaceRoot())

  // Then search all known OpenClaw workspaces so artifacts produced by other
  // agents can still be mirrored on review transition.
  const base = resolve(homedir(), '.openclaw')
  try {
    const entries = await fs.readdir(base, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (!e.name.startsWith('workspace')) continue
      if (e.name === 'workspace-shared') continue
      add(resolve(base, e.name))
    }
  } catch {
    // Non-fatal: in some deployments we may not have directory read access.
  }

  return roots
}

async function findArtifactSource(artifactPath: string): Promise<{
  sourcePath: string
  stat: any
  checked: string[]
} | null> {
  const candidates = await listCandidateWorkspaceRoots()
  const checked: string[] = []

  for (const root of candidates) {
    const candidate = resolve(root, artifactPath)
    checked.push(candidate)
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat) return { sourcePath: candidate, stat, checked }
  }

  return null
}

/**
 * Mirror a task's process artifacts to the shared workspace.
 *
 * Supports both directory-style artifacts (process/task-xxx/) and
 * single-file artifacts (process/task-xxx-proof.md).
 */
export async function mirrorArtifacts(artifactPath: string): Promise<MirrorResult> {
  if (!artifactPath || !artifactPath.startsWith('process/')) {
    return { mirrored: false, source: artifactPath, destination: '', filesCopied: 0, error: 'Not a process/ artifact path' }
  }

  const destPath = resolve(getSharedWorkspace(), artifactPath)

  let sourcePath = resolve(getWorkspaceRoot(), artifactPath)

  try {
    const lookup = await findArtifactSource(artifactPath)
    if (!lookup) {
      return {
        mirrored: false,
        source: sourcePath,
        destination: destPath,
        filesCopied: 0,
        error: 'Source artifact not found (checked all ~/.openclaw/workspace* roots)',
      }
    }

    sourcePath = lookup.sourcePath
    const stat = lookup.stat

    // Ensure destination directory exists
    await fs.mkdir(dirname(destPath), { recursive: true })

    let filesCopied = 0

    if (stat.isDirectory()) {
      // Mirror entire directory
      await fs.mkdir(destPath, { recursive: true })
      const files = await fs.readdir(sourcePath, { recursive: true }) as string[]
      for (const file of files) {
        const srcFile = join(sourcePath, file)
        const dstFile = join(destPath, file)
        const fileStat = await fs.stat(srcFile).catch(() => null)
        if (fileStat?.isFile()) {
          await fs.mkdir(dirname(dstFile), { recursive: true })
          await fs.copyFile(srcFile, dstFile)
          filesCopied++
        }
      }
    } else {
      // Mirror single file
      await fs.copyFile(sourcePath, destPath)
      filesCopied = 1
    }

    return { mirrored: true, source: sourcePath, destination: destPath, filesCopied }
  } catch (err) {
    return {
      mirrored: false,
      source: sourcePath,
      destination: destPath,
      filesCopied: 0,
      error: `Mirror failed: ${(err as Error).message}`,
    }
  }
}

/**
 * Called on task status transition to validating or done.
 * Extracts artifact_path from task metadata and mirrors it.
 */
export async function onTaskReadyForReview(taskMeta: Record<string, unknown>): Promise<MirrorResult | null> {
  const artifactPath = typeof taskMeta.artifact_path === 'string' ? taskMeta.artifact_path : null
  if (!artifactPath) return null
  return mirrorArtifacts(artifactPath)
}

/**
 * Check if shared workspace is accessible.
 */
export async function isSharedWorkspaceReady(): Promise<boolean> {
  try {
    await fs.access(getSharedWorkspace())
    return true
  } catch {
    return false
  }
}

// WORKSPACE_ROOT and SHARED_WORKSPACE exported as functions above
