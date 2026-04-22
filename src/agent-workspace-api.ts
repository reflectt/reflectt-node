// SPDX-License-Identifier: Apache-2.0
// Per-agent workspace read API — safe, read-only access to agent-scoped files.
//
// Security invariants (mirrors shared-workspace-api.ts):
// - Agent name validated against /^[a-z][a-z0-9_-]*$/ — prevents traversal via name
// - Date validated against /^\d{4}-\d{2}-\d{2}$/ — prevents traversal via date
// - Filename allowlist (top-level files): MEMORY.md, SOUL.md, HEARTBEAT.md, AGENTS.md
// - Memory daily files only — under memory/<date>.md
// - realpath containment: resolved real path must be under the agent's workspace root
// - Extension allowlist: shared with shared-workspace-api.ts (.md/.txt/.json/.log/.yml/.yaml)
// - Size cap: shared with shared-workspace-api.ts (400KB)
//
// Workspace layout (authoritative — see memory.ts):
//   $OPENCLAW_HOME/workspace-<agent>/
//     MEMORY.md
//     SOUL.md
//     HEARTBEAT.md
//     AGENTS.md
//     memory/
//       YYYY-MM-DD.md
//
// Access is gated at the API route layer (loopback only for reflectt-node);
// cloud proxies inject auth before forwarding.

import { promises as fs } from 'fs'
import { resolve, join, relative, isAbsolute, extname } from 'path'
import { homedir } from 'os'
import { ALLOWED_EXTENSIONS } from './shared-workspace-api.js'

// Mirrors memory.ts WORKSPACE_BASE — kept inline so the truth surface always reads
// the same root that memory.ts writes to. If memory.ts ever moves, update both.
function workspaceBase(): string {
  return process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
}

const MAX_FILE_SIZE = 400 * 1024
const MAX_LIST_ENTRIES = 500

export const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const ALLOWED_TOP_LEVEL_FILES = new Set([
  'MEMORY.md',
  'SOUL.md',
  'HEARTBEAT.md',
  'AGENTS.md',
])

export interface AgentFilePointer {
  path: string         // absolute path on disk (caller can choose to expose only mtime/size)
  relPath: string      // relative to agent workspace root (e.g. 'SOUL.md', 'memory/2026-04-21.md')
  exists: boolean
  size?: number
  mtime?: string       // ISO
}

export interface AgentFileBody extends AgentFilePointer {
  content: string
  truncated: boolean
}

export interface AgentMemoryDay {
  date: string         // YYYY-MM-DD
  relPath: string      // 'memory/YYYY-MM-DD.md'
  size: number
  mtime: string        // ISO
}

// ── helpers ───────────────────────────────────────────────────────────────────

function assertValidAgent(name: string): void {
  if (!name || typeof name !== 'string' || !AGENT_NAME_RE.test(name)) {
    throw new Error('Invalid agent name')
  }
}

function assertValidDate(date: string): void {
  if (!date || typeof date !== 'string' || !DATE_RE.test(date)) {
    throw new Error('Invalid date (expected YYYY-MM-DD)')
  }
}

export function getAgentWorkspaceRoot(name: string): string {
  assertValidAgent(name)
  return join(workspaceBase(), `workspace-${name}`)
}

/**
 * Resolve an agent-relative path with realpath containment.
 * Throws if the path escapes the agent workspace root (symlink defense).
 * Returns null if the file doesn't exist on disk yet.
 */
async function resolveWithin(name: string, relPath: string): Promise<string | null> {
  const root = getAgentWorkspaceRoot(name)
  if (relPath.includes('..') || relPath.includes('\0') || isAbsolute(relPath)) {
    throw new Error('Invalid path')
  }
  const candidate = resolve(root, relPath)
  const rel = relative(root, candidate)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path escapes agent workspace root')
  }

  let rootReal: string
  try {
    rootReal = await fs.realpath(root)
  } catch {
    return null // workspace doesn't exist yet
  }
  let candidateReal: string
  try {
    candidateReal = await fs.realpath(candidate)
  } catch {
    return null // file doesn't exist yet — caller decides whether to surface that
  }
  const realRel = relative(rootReal, candidateReal)
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new Error('Path escapes agent workspace root (symlink escape)')
  }
  return candidateReal
}

async function statPointer(name: string, relPath: string): Promise<AgentFilePointer> {
  const real = await resolveWithin(name, relPath)
  if (!real) return { path: '', relPath, exists: false }
  const st = await fs.stat(real).catch(() => null)
  if (!st || !st.isFile()) return { path: real, relPath, exists: false }
  return {
    path: real,
    relPath,
    exists: true,
    size: st.size,
    mtime: new Date(st.mtimeMs).toISOString(),
  }
}

async function readBody(ptr: AgentFilePointer): Promise<AgentFileBody> {
  if (!ptr.exists) {
    return { ...ptr, content: '', truncated: false }
  }
  const ext = extname(ptr.relPath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension '${ext}' is not allowed`)
  }
  if (ptr.size !== undefined && ptr.size > MAX_FILE_SIZE) {
    throw new Error(`File exceeds size limit (${ptr.size} bytes > ${MAX_FILE_SIZE} bytes)`)
  }
  const raw = await fs.readFile(ptr.path, 'utf-8')
  return { ...ptr, content: raw, truncated: false }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * List all per-day memory files for an agent, sorted by date desc.
 * Returns pointers only (no content) for lazy-load.
 */
export async function listAgentMemoryDays(
  name: string,
  limit: number = 100,
): Promise<AgentMemoryDay[]> {
  const root = getAgentWorkspaceRoot(name)
  const dir = join(root, 'memory')

  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err: any) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }

  const days: AgentMemoryDay[] = []
  const effectiveLimit = Math.min(limit, MAX_LIST_ENTRIES)

  for (const file of entries) {
    if (!file.endsWith('.md')) continue
    const date = file.slice(0, -3)
    if (!DATE_RE.test(date)) continue
    const full = join(dir, file)
    const lst = await fs.lstat(full).catch(() => null)
    if (!lst || lst.isSymbolicLink() || !lst.isFile()) continue
    days.push({
      date,
      relPath: `memory/${file}`,
      size: lst.size,
      mtime: new Date(lst.mtimeMs).toISOString(),
    })
  }

  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return days.slice(0, effectiveLimit)
}

/**
 * Read a single per-day memory file. Lazy-load body for the requested date.
 */
export async function readAgentMemoryDay(name: string, date: string): Promise<AgentFileBody> {
  assertValidAgent(name)
  assertValidDate(date)
  const ptr = await statPointer(name, `memory/${date}.md`)
  return readBody(ptr)
}

/**
 * Get a pointer (no body) for a top-level workspace file.
 * Use this to surface freshness/size in the detail pane without loading full content.
 */
export async function getAgentFilePointer(
  name: string,
  filename: string,
): Promise<AgentFilePointer> {
  assertValidAgent(name)
  if (!ALLOWED_TOP_LEVEL_FILES.has(filename)) {
    throw new Error(`Filename '${filename}' is not in the allowlist`)
  }
  return statPointer(name, filename)
}

/**
 * Read body of a top-level workspace file (SOUL.md, MEMORY.md, etc).
 * Size-capped + extension-checked.
 */
export async function readAgentFile(name: string, filename: string): Promise<AgentFileBody> {
  const ptr = await getAgentFilePointer(name, filename)
  return readBody(ptr)
}
