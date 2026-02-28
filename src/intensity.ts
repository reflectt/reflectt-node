// SPDX-License-Identifier: Apache-2.0
// Team pacing / intensity controls
//
// Maps a human-friendly intensity preset (low/normal/high) to concrete limits:
//   wipLimit        – max simultaneous doing tasks per agent
//   maxPullsPerHour – rate-limit on /tasks/next pulls per agent
//   batchIntervalMs – message batching window (0 = immediate)
//
// Persisted in SQLite (survives restarts). Exposed via GET/PUT /policy/intensity.

import { getDb } from './db.js'

// ── Types ──

export type IntensityPreset = 'low' | 'normal' | 'high'

export interface IntensityLimits {
  wipLimit: number
  maxPullsPerHour: number
  batchIntervalMs: number
}

export interface IntensityState {
  preset: IntensityPreset
  limits: IntensityLimits
  updatedAt: number
  updatedBy: string
}

// ── Preset definitions ──

const PRESETS: Record<IntensityPreset, IntensityLimits> = {
  low:    { wipLimit: 1, maxPullsPerHour: 2,  batchIntervalMs: 10 * 60_000 },
  normal: { wipLimit: 2, maxPullsPerHour: 10, batchIntervalMs: 0 },
  high:   { wipLimit: 3, maxPullsPerHour: 30, batchIntervalMs: 0 },
}

export function getPresetLimits(preset: IntensityPreset): IntensityLimits {
  return { ...PRESETS[preset] }
}

export function isValidPreset(v: unknown): v is IntensityPreset {
  return typeof v === 'string' && (v === 'low' || v === 'normal' || v === 'high')
}

// ── DB persistence ──

function ensureTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS intensity (
      key       TEXT PRIMARY KEY DEFAULT 'global',
      preset    TEXT NOT NULL DEFAULT 'normal',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'system'
    )
  `)
}

/** Read current intensity. Returns 'normal' if never set. */
export function getIntensity(): IntensityState {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT preset, updated_at, updated_by FROM intensity WHERE key = ?').get('global') as
    { preset: string; updated_at: number; updated_by: string } | undefined

  const preset: IntensityPreset = row && isValidPreset(row.preset) ? row.preset : 'normal'
  return {
    preset,
    limits: getPresetLimits(preset),
    updatedAt: row?.updated_at ?? 0,
    updatedBy: row?.updated_by ?? 'default',
  }
}

/** Set intensity preset. Returns new state. */
export function setIntensity(preset: IntensityPreset, updatedBy: string): IntensityState {
  ensureTable()
  const db = getDb()
  const now = Date.now()
  db.prepare(`
    INSERT INTO intensity (key, preset, updated_at, updated_by)
    VALUES ('global', ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET preset = excluded.preset, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(preset, now, updatedBy)

  return {
    preset,
    limits: getPresetLimits(preset),
    updatedAt: now,
    updatedBy,
  }
}

// ── Pull rate limiting ──

// In-memory sliding window per agent (resets on restart — acceptable since
// restarts are infrequent and the limit is soft/UX-oriented, not security).
const pullLog: Map<string, number[]> = new Map()

/** Record a task pull for an agent. Returns { allowed, remaining, resetsInMs }. */
export function recordPull(agent: string): { allowed: boolean; remaining: number; resetsInMs: number } {
  const { limits } = getIntensity()
  const now = Date.now()
  const windowMs = 60 * 60_000 // 1 hour

  const log = pullLog.get(agent) ?? []
  // Prune entries older than window
  const recent = log.filter(ts => now - ts < windowMs)

  if (recent.length >= limits.maxPullsPerHour) {
    const oldest = recent[0]!
    return { allowed: false, remaining: 0, resetsInMs: windowMs - (now - oldest) }
  }

  recent.push(now)
  pullLog.set(agent, recent)
  return { allowed: true, remaining: limits.maxPullsPerHour - recent.length, resetsInMs: 0 }
}

/** Check pull budget without recording. */
export function checkPullBudget(agent: string): { remaining: number; limit: number; windowMs: number } {
  const { limits } = getIntensity()
  const now = Date.now()
  const windowMs = 60 * 60_000
  const log = pullLog.get(agent) ?? []
  const recent = log.filter(ts => now - ts < windowMs)
  return { remaining: limits.maxPullsPerHour - recent.length, limit: limits.maxPullsPerHour, windowMs }
}
