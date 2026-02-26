// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Bootstrap context budget inspection
 *
 * OpenClaw injects a small set of workspace bootstrap files into every model turn.
 * When these files bloat (especially MEMORY.md / memory.md), token usage can spike.
 *
 * This module reports per-workspace sizes so we can detect and prevent regression.
 */

import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const DEFAULT_BOOTSTRAP_BASENAMES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
  'memory.md',
] as const

export type BootstrapBasename = typeof DEFAULT_BOOTSTRAP_BASENAMES[number]

export interface BootstrapFileStat {
  name: BootstrapBasename
  path: string
  exists: boolean
  bytes: number
  chars: number
  modifiedAtMs: number | null
}

export interface WorkspaceBootstrapStats {
  agent: string
  workspaceDir: string
  files: BootstrapFileStat[]
  totalBytes: number
  totalChars: number
  estimatedTokens: number
  flags: string[]
}

export interface BootstrapContextReport {
  stateDir: string
  workspaces: WorkspaceBootstrapStats[]
  totals: {
    workspaceCount: number
    totalBytes: number
    totalChars: number
    estimatedTokens: number
    flaggedWorkspaceCount: number
  }
  budgets: {
    warnTotalChars: number
    failTotalChars: number
    warnSingleFileChars: number
    failSingleFileChars: number
  }
}

function defaultStateDir(): string {
  // OPENCLAW_STATE_DIR is used by OpenClaw profiles; keep compatible.
  return process.env.OPENCLAW_STATE_DIR || join(homedir(), '.openclaw')
}

function approxTokens(chars: number): number {
  // Rough heuristic: 1 token ~= 4 chars for English-ish text.
  // Good enough to catch order-of-magnitude regressions.
  return Math.ceil(chars / 4)
}

async function safeStat(path: string): Promise<{ exists: boolean; bytes: number; modifiedAtMs: number | null }> {
  try {
    const st = await fs.stat(path)
    if (!st.isFile()) return { exists: false, bytes: 0, modifiedAtMs: null }
    return { exists: true, bytes: st.size, modifiedAtMs: st.mtimeMs }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { exists: false, bytes: 0, modifiedAtMs: null }
    throw err
  }
}

async function safeReadChars(path: string): Promise<number> {
  try {
    const content = await fs.readFile(path, 'utf-8')
    return content.length
  } catch (err: any) {
    if (err?.code === 'ENOENT') return 0
    throw err
  }
}

function agentNameFromWorkspaceDir(dirName: string): string {
  if (dirName === 'workspace') return 'main'
  if (dirName.startsWith('workspace-')) return dirName.slice('workspace-'.length)
  return dirName
}

export async function getBootstrapContextReport(options?: {
  stateDir?: string
  basenames?: readonly BootstrapBasename[]
  // Budgets (chars). These are conservative and intended to nudge trimming.
  warnTotalChars?: number
  failTotalChars?: number
  warnSingleFileChars?: number
  failSingleFileChars?: number
}): Promise<BootstrapContextReport> {
  const stateDir = options?.stateDir || defaultStateDir()
  const basenames = options?.basenames || DEFAULT_BOOTSTRAP_BASENAMES

  const budgets = {
    warnTotalChars: options?.warnTotalChars ?? 12_000,
    failTotalChars: options?.failTotalChars ?? 25_000,
    warnSingleFileChars: options?.warnSingleFileChars ?? 8_000,
    failSingleFileChars: options?.failSingleFileChars ?? 20_000,
  }

  const entries = await fs.readdir(stateDir, { withFileTypes: true }).catch((err: any) => {
    if (err?.code === 'ENOENT') return [] as any[]
    throw err
  })

  const workspaceDirs = entries
    .filter((e) => e.isDirectory() && (e.name === 'workspace' || e.name.startsWith('workspace-')))
    .map((e) => join(stateDir, e.name))
    .sort((a, b) => a.localeCompare(b))

  const workspaces: WorkspaceBootstrapStats[] = []

  for (const workspaceDir of workspaceDirs) {
    const dirName = workspaceDir.split('/').pop() || workspaceDir
    const agent = agentNameFromWorkspaceDir(dirName)

    const files: BootstrapFileStat[] = []
    for (const name of basenames) {
      const path = join(workspaceDir, name)
      const st = await safeStat(path)
      const chars = st.exists ? await safeReadChars(path) : 0
      files.push({
        name,
        path,
        exists: st.exists,
        bytes: st.bytes,
        chars,
        modifiedAtMs: st.modifiedAtMs,
      })
    }

    const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0)
    const totalChars = files.reduce((sum, f) => sum + f.chars, 0)

    const flags: string[] = []
    if (totalChars >= budgets.failTotalChars) flags.push(`total_chars>=${budgets.failTotalChars}`)
    else if (totalChars >= budgets.warnTotalChars) flags.push(`total_chars>=${budgets.warnTotalChars}`)

    const maxFile = files.reduce((best, f) => (f.chars > best.chars ? f : best), files[0] || null)
    if (maxFile) {
      if (maxFile.chars >= budgets.failSingleFileChars) flags.push(`file_too_large:${maxFile.name}>=${budgets.failSingleFileChars}`)
      else if (maxFile.chars >= budgets.warnSingleFileChars) flags.push(`file_large:${maxFile.name}>=${budgets.warnSingleFileChars}`)
    }

    // Specific foot-gun: MEMORY.md / memory.md are injected every turn.
    const memoryFootguns = files
      .filter((f) => (f.name === 'MEMORY.md' || f.name === 'memory.md') && f.chars >= 4_000)
      .map((f) => `${f.name}>=4000`)
    if (memoryFootguns.length > 0) flags.push(`memory_injected_large:${memoryFootguns.join(',')}`)

    workspaces.push({
      agent,
      workspaceDir,
      files,
      totalBytes,
      totalChars,
      estimatedTokens: approxTokens(totalChars),
      flags,
    })
  }

  const totals = {
    workspaceCount: workspaces.length,
    totalBytes: workspaces.reduce((sum, w) => sum + w.totalBytes, 0),
    totalChars: workspaces.reduce((sum, w) => sum + w.totalChars, 0),
    estimatedTokens: workspaces.reduce((sum, w) => sum + w.estimatedTokens, 0),
    flaggedWorkspaceCount: workspaces.filter((w) => w.flags.length > 0).length,
  }

  return { stateDir, workspaces, totals, budgets }
}
