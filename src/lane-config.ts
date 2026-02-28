// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Lane configuration for ready-queue engine v1
 *
 * Lanes group agents into work streams with:
 *   readyFloor — minimum unblocked todo tasks per agent
 *   wipLimit   — max simultaneous doing tasks per agent
 *
 * Config is loaded from TEAM-ROLES.yaml `lanes:` section.
 * Falls back to hardcoded defaults if not configured.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { REFLECTT_HOME } from './config.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface LaneConfig {
  name: string
  agents: string[]
  readyFloor: number
  wipLimit: number
}

// ── Hardcoded defaults ─────────────────────────────────────────────────────
// Matches the hardcoded lanes in server.ts /health/backlog.
// These are the fallback when TEAM-ROLES.yaml has no `lanes:` section.

export const DEFAULT_LANES: LaneConfig[] = [
  { name: 'engineering', agents: ['link', 'pixel'], readyFloor: 2, wipLimit: 2 },
  { name: 'content',     agents: ['echo'],          readyFloor: 2, wipLimit: 2 },
  { name: 'operations',  agents: ['kai', 'sage'],   readyFloor: 1, wipLimit: 2 },
  { name: 'research',    agents: ['scout'],         readyFloor: 1, wipLimit: 2 },
  { name: 'rhythm',      agents: ['rhythm'],        readyFloor: 1, wipLimit: 2 },
]

// ── Config paths ────────────────────────────────────────────────────────────

const CONFIG_PATHS = [
  join(REFLECTT_HOME, 'TEAM-ROLES.yaml'),
  join(REFLECTT_HOME, 'TEAM-ROLES.yml'),
]

// ── YAML parsing ────────────────────────────────────────────────────────────

function parseLanesFromYaml(content: string): LaneConfig[] | null {
  try {
    const data = parseYaml(content)
    if (!data?.lanes || !Array.isArray(data.lanes)) return null

    const parsed = data.lanes.map((l: any) => ({
      name: String(l.name || ''),
      agents: Array.isArray(l.agents) ? l.agents.map(String) : [],
      readyFloor: typeof l.readyFloor === 'number' ? l.readyFloor : 1,
      wipLimit: typeof l.wipLimit === 'number' ? l.wipLimit : 2,
    })).filter((l: LaneConfig) => l.name && l.agents.length > 0)

    return parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load lanes config. Reads TEAM-ROLES.yaml `lanes:` section if available;
 * falls back to DEFAULT_LANES.
 */
export function getLanesConfig(): LaneConfig[] {
  const isTest = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test'

  if (!isTest) {
    // Try user config files
    for (const configPath of CONFIG_PATHS) {
      if (!existsSync(configPath)) continue
      try {
        const content = readFileSync(configPath, 'utf-8')
        const lanes = parseLanesFromYaml(content)
        if (lanes) return lanes
      } catch { /* fall through */ }
    }

    // Try defaults shipped with repo
    try {
      const defaultsPath = new URL('../defaults/TEAM-ROLES.yaml', import.meta.url)
      const content = readFileSync(defaultsPath, 'utf-8')
      const lanes = parseLanesFromYaml(content)
      if (lanes) return lanes
    } catch { /* fall through */ }
  }

  return DEFAULT_LANES
}

/** Find the lane an agent belongs to. Returns null if not in any lane. */
export function getAgentLane(agent: string): LaneConfig | null {
  const agentLower = agent.toLowerCase()
  return getLanesConfig().find(l => l.agents.some(a => a.toLowerCase() === agentLower)) ?? null
}

/**
 * Check if an agent has reached their WIP limit.
 * Returns null if agent is not in any lane (no limit applies).
 */
export function checkWipLimit(
  agent: string,
  doingCount: number,
): { blocked: boolean; wipLimit: number; doing: number; message: string } | null {
  const lane = getAgentLane(agent)
  if (!lane) return null

  const blocked = doingCount >= lane.wipLimit
  return {
    blocked,
    wipLimit: lane.wipLimit,
    doing: doingCount,
    message: blocked
      ? `WIP limit reached (${doingCount}/${lane.wipLimit} doing). Complete or park a task first.`
      : `WIP ok (${doingCount}/${lane.wipLimit} doing).`,
  }
}
