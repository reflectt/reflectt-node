// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { DATA_DIR } from './config.js'

export type StoredLogLevel = 'error' | 'warn' | 'info'

export type StoredLogEntry = {
  id: string
  level: StoredLogLevel
  timestamp: number
  message: string
  status?: number
  code?: string
  hint?: string
  gate?: string
  method?: string
  url?: string
  details?: unknown
}

const LOG_PATH = join(DATA_DIR, 'logs', 'errors.jsonl')
const DEFAULT_TAIL_BYTES = 512 * 1024 // 512KB

function safeId(now = Date.now()): string {
  return `log-${now}-${Math.random().toString(36).slice(2, 10)}`
}

export async function appendStoredLog(entry: Omit<StoredLogEntry, 'id'> & { id?: string }): Promise<void> {
  const record: StoredLogEntry = {
    id: entry.id || safeId(entry.timestamp),
    level: entry.level,
    timestamp: entry.timestamp,
    message: entry.message,
    status: entry.status,
    code: entry.code,
    hint: entry.hint,
    gate: entry.gate,
    method: entry.method,
    url: entry.url,
    details: entry.details,
  }

  await fs.mkdir(dirname(LOG_PATH), { recursive: true })
  await fs.appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8')
}

async function readTailText(path: string, maxBytes: number): Promise<string> {
  try {
    const stat = await fs.stat(path)
    const size = stat.size
    const start = Math.max(0, size - Math.max(1, maxBytes))
    const length = size - start

    const fh = await fs.open(path, 'r')
    try {
      const buf = Buffer.alloc(length)
      await fh.read(buf, 0, length, start)
      return buf.toString('utf8')
    } finally {
      await fh.close()
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return ''
    throw err
  }
}

export async function readStoredLogs(options?: {
  since?: number
  level?: string
  limit?: number
  tailBytes?: number
}): Promise<StoredLogEntry[]> {
  const since = options?.since
  const wantLevel = (options?.level || '').trim().toLowerCase()
  const limit = typeof options?.limit === 'number' && options.limit > 0
    ? Math.min(options.limit, 500)
    : 200
  const tailBytes = typeof options?.tailBytes === 'number' && options.tailBytes > 0
    ? Math.min(options.tailBytes, 2 * 1024 * 1024)
    : DEFAULT_TAIL_BYTES

  const text = await readTailText(LOG_PATH, tailBytes)
  if (!text.trim()) return []

  const lines = text.split('\n').filter(Boolean)
  const out: StoredLogEntry[] = []

  for (const line of lines) {
    try {
      const row = JSON.parse(line) as StoredLogEntry
      if (since && typeof row.timestamp === 'number' && row.timestamp < since) continue
      if (wantLevel && String(row.level || '').toLowerCase() !== wantLevel) continue
      out.push(row)
    } catch {
      // ignore malformed lines (partial writes)
    }
  }

  out.sort((a, b) => a.timestamp - b.timestamp)
  return out.slice(-limit)
}

export function getStoredLogPath(): string {
  return LOG_PATH
}
