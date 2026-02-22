// SPDX-License-Identifier: Apache-2.0
// Artifact mirror: auto-copies process/ artifacts to workspace-shared/process/
// so reviewers in other workspaces can access them without manual copying.
//
// Triggered on task transition to validating or done.

import { promises as fs } from 'fs'
import { join, resolve, basename, dirname } from 'path'

// ── Config (lazy for testability — env is read at call time) ──

function getWorkspaceRoot(): string {
  return process.env.REFLECTT_WORKSPACE || resolve(process.cwd())
}

function getSharedWorkspace(): string {
  return process.env.REFLECTT_SHARED_WORKSPACE
    || resolve(getWorkspaceRoot(), '..', 'workspace-shared')
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
export async function mirrorArtifacts(artifactPath: string): Promise<MirrorResult> {
  if (!artifactPath || !artifactPath.startsWith('process/')) {
    return { mirrored: false, source: artifactPath, destination: '', filesCopied: 0, error: 'Not a process/ artifact path' }
  }

  const sourcePath = resolve(getWorkspaceRoot(), artifactPath)
  const destPath = resolve(getSharedWorkspace(), artifactPath)

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
