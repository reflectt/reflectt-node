// SPDX-License-Identifier: Apache-2.0
// Artifact mirror: auto-copies process/ artifacts to workspace-shared/process/
// so reviewers in other workspaces can access them without manual copying.
//
// Triggered on task transition to validating or done.

import { promises as fs } from 'fs'
import { join, resolve, basename, dirname } from 'path'
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
  return process.env.REFLECTT_WORKSPACE || resolve(process.cwd())
}

function getOpenClawStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR
    || resolve(homedir(), '.openclaw')
}

function sanitizeAgentName(name: string): string {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

async function listWorkspaceCandidates(assignee?: string): Promise<string[]> {
  const roots: string[] = []

  // 1) Explicit override (used by tests/CI)
  roots.push(getWorkspaceRoot())

  // 2) OpenClaw state workspaces (best-effort)
  const stateDir = getOpenClawStateDir()
  const safe = assignee ? sanitizeAgentName(assignee) : ''
  if (safe) roots.push(resolve(stateDir, `workspace-${safe}`))
  roots.push(resolve(stateDir, 'workspace'))

  // 3) Scan for any workspace-* (covers local multi-agent setups)
  try {
    const entries = await fs.readdir(stateDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (!e.name.startsWith('workspace-')) continue
      const full = resolve(stateDir, e.name)
      roots.push(full)
    }
  } catch {
    // ignore
  }

  // Dedupe while preserving order
  const seen = new Set<string>()
  return roots.filter(r => {
    const key = r
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

/**
 * Mirror a task's process artifacts to the shared workspace.
 *
 * Supports both directory-style artifacts (process/task-xxx/) and
 * single-file artifacts (process/task-xxx-proof.md).
 */
export async function mirrorArtifacts(
  artifactPath: string,
  opts?: { assignee?: string },
): Promise<MirrorResult> {
  if (!artifactPath || !artifactPath.startsWith('process/')) {
    return { mirrored: false, source: artifactPath, destination: '', filesCopied: 0, error: 'Not a process/ artifact path' }
  }

  const destPath = resolve(getSharedWorkspace(), artifactPath)

  // Try to locate the source artifact across likely OpenClaw workspaces.
  const candidates = await listWorkspaceCandidates(opts?.assignee)
  let sourcePath: string | null = null
  for (const root of candidates) {
    const candidate = resolve(root, artifactPath)
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat) {
      sourcePath = candidate
      break
    }
  }

  if (!sourcePath) {
    return {
      mirrored: false,
      source: artifactPath,
      destination: destPath,
      filesCopied: 0,
      error: `Source artifact not found in any candidate workspace (${candidates.length} checked)`
        + (opts?.assignee ? ` (assignee=${opts.assignee})` : ''),
    }
  }

  try {
    // Check source exists
    const stat = await fs.stat(sourcePath).catch(() => null)
    if (!stat) {
      return { mirrored: false, source: sourcePath, destination: destPath, filesCopied: 0, error: 'Source artifact not found' }
    }

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
export async function onTaskReadyForReview(task: {
  assignee?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<MirrorResult | null> {
  const meta = (task.metadata || {}) as Record<string, unknown>
  const artifactPath = typeof meta.artifact_path === 'string' ? meta.artifact_path : null
  if (!artifactPath) return null
  return mirrorArtifacts(artifactPath, { assignee: task.assignee || undefined })
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
