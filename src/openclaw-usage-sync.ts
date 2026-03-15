/**
 * openclaw-usage-sync.ts
 *
 * Periodic sync job that reads OpenClaw agent session files and ingests
 * token/cost data into the reflectt-node model_usage table via recordUsage().
 *
 * Problem: 16+ agents running via OpenClaw report $0 in the cloud usage
 * dashboard because they never call POST /usage/report. Their token/cost
 * data IS stored in ~/.openclaw/agents/{agent}/sessions/sessions.json.
 *
 * Solution: Walk that directory tree, read sessions.json for every agent,
 * extract per-session token counts + model, and ingest any sessions not
 * yet recorded (dedup via api_source = "openclaw:{sessionId}").
 *
 * Wired up in server.ts: startOpenClawUsageSync() / stopOpenClawUsageSync().
 */

import { join } from 'path'
import { homedir } from 'os'
import { promises as fs, existsSync } from 'fs'
import { recordUsage } from './usage-tracking.js'
import { getDb } from './db.js'

// ── Config ────────────────────────────────────────────────────────────────

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw')
const AGENTS_DIR = join(OPENCLAW_HOME, 'agents')
const SYNC_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes

// ── Types ─────────────────────────────────────────────────────────────────

interface SessionEntry {
  sessionId?: string
  updatedAt?: number
  model?: string
  modelProvider?: string
  inputTokens?: number
  outputTokens?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
}

interface SyncResult {
  agentsScanned: number
  sessionsFound: number
  sessionsIngested: number
  sessionsSkipped: number
  errors: string[]
}

// ── Dedup check ───────────────────────────────────────────────────────────

/**
 * Returns the set of sessionIds already present in model_usage as
 * api_source = "openclaw:{sessionId}".
 */
function getIngestedSessionIds(): Set<string> {
  const db = getDb()
  const rows = db.prepare(
    `SELECT api_source FROM model_usage WHERE api_source LIKE 'openclaw:%'`
  ).all() as { api_source: string }[]

  const ids = new Set<string>()
  for (const row of rows) {
    const id = row.api_source.replace('openclaw:', '')
    if (id) ids.add(id)
  }
  return ids
}

// ── Core sync ─────────────────────────────────────────────────────────────

export async function syncOpenClawUsage(): Promise<SyncResult> {
  const result: SyncResult = {
    agentsScanned: 0,
    sessionsFound: 0,
    sessionsIngested: 0,
    sessionsSkipped: 0,
    errors: [],
  }

  if (!existsSync(AGENTS_DIR)) {
    return result // OpenClaw not installed or wrong path
  }

  let agentDirs: string[]
  try {
    agentDirs = await fs.readdir(AGENTS_DIR)
  } catch (err) {
    result.errors.push(`Failed to read agents dir: ${(err as Error).message}`)
    return result
  }

  // Snapshot ingested session IDs once upfront to avoid per-row queries
  const ingestedIds = getIngestedSessionIds()

  for (const agentName of agentDirs) {
    const sessionsJsonPath = join(AGENTS_DIR, agentName, 'sessions', 'sessions.json')
    if (!existsSync(sessionsJsonPath)) continue

    result.agentsScanned++

    let sessionsData: Record<string, SessionEntry>
    try {
      const raw = await fs.readFile(sessionsJsonPath, 'utf8')
      sessionsData = JSON.parse(raw) as Record<string, SessionEntry>
    } catch (err) {
      result.errors.push(`${agentName}: failed to parse sessions.json — ${(err as Error).message}`)
      continue
    }

    for (const [, session] of Object.entries(sessionsData)) {
      const sessionId = session.sessionId
      if (!sessionId) continue
      if (!session.model) continue

      // Skip sessions with no tokens (e.g. freshly created, not yet used)
      const inputTokens = session.inputTokens ?? 0
      const outputTokens = session.outputTokens ?? 0
      if (inputTokens === 0 && outputTokens === 0) continue

      result.sessionsFound++

      // Dedup: skip if already ingested
      if (ingestedIds.has(sessionId)) {
        result.sessionsSkipped++
        continue
      }

      try {
        recordUsage({
          agent: agentName,
          model: session.model,
          provider: session.modelProvider ?? 'openclaw',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          // cost_usd not stored in sessions.json aggregate — estimateCost() fills this
          category: 'other',
          timestamp: session.updatedAt ?? Date.now(),
          api_source: `openclaw:${sessionId}`,
          metadata: {
            session_id: sessionId,
            cache_read_tokens: session.cacheRead ?? 0,
            cache_write_tokens: session.cacheWrite ?? 0,
            total_tokens: session.totalTokens ?? (inputTokens + outputTokens),
            sync_source: 'openclaw-usage-sync',
          },
        })

        ingestedIds.add(sessionId) // prevent double-ingest within same run
        result.sessionsIngested++
      } catch (err) {
        result.errors.push(`${agentName}/${sessionId}: record failed — ${(err as Error).message}`)
      }
    }
  }

  return result
}

// ── Periodic timer ────────────────────────────────────────────────────────

let _syncTimer: ReturnType<typeof setInterval> | null = null

export function startOpenClawUsageSync(): void {
  if (_syncTimer) return // already running

  // Run once at startup (deferred 10s to let DB settle)
  const startupDelay = setTimeout(() => {
    syncOpenClawUsage().then(result => {
      if (result.sessionsIngested > 0 || result.errors.length > 0) {
        console.log(
          `[openclaw-usage-sync] startup: agents=${result.agentsScanned} ` +
          `ingested=${result.sessionsIngested} skipped=${result.sessionsSkipped}` +
          (result.errors.length > 0 ? ` errors=${result.errors.length}` : '')
        )
      }
    }).catch(err => {
      console.warn('[openclaw-usage-sync] startup sync failed:', (err as Error).message)
    })
  }, 10_000)
  startupDelay.unref()

  // Periodic sync every 5 minutes
  _syncTimer = setInterval(() => {
    syncOpenClawUsage().then(result => {
      if (result.sessionsIngested > 0) {
        console.log(
          `[openclaw-usage-sync] periodic: agents=${result.agentsScanned} ` +
          `ingested=${result.sessionsIngested} skipped=${result.sessionsSkipped}`
        )
      }
    }).catch(err => {
      console.warn('[openclaw-usage-sync] periodic sync failed:', (err as Error).message)
    })
  }, SYNC_INTERVAL_MS)
  _syncTimer.unref()
}

export function stopOpenClawUsageSync(): void {
  if (_syncTimer) {
    clearInterval(_syncTimer)
    _syncTimer = null
  }
}
