// SPDX-License-Identifier: Apache-2.0
/**
 * insight-auto-tagger.ts
 *
 * Keyword-rule-based auto-tagger for insights whose `failure_family` is
 * still `'uncategorized'`. Rules are configurable at runtime via the
 * PATCH /insights/auto-tag-rules endpoint or REFLECTT_AUTO_TAG_RULES env var.
 *
 * Each rule: { family, patterns: string[] }
 * Rules are matched against the insight title (lower-cased).
 * First match wins; if no match, family stays 'uncategorized'.
 */

import { getDb as getDatabase } from './db.js'

export interface AutoTagRule {
  family: string
  /** Array of regex pattern strings (case-insensitive, applied to title) */
  patterns: string[]
}

/**
 * Default rule set derived from sage's triage on 2026-03-15
 * (50 P0 candidates reviewed, 19 uncategorized re-classified).
 *
 * Order matters: first matching rule wins.
 * More specific patterns should come before broader ones.
 */
export const DEFAULT_AUTO_TAG_RULES: AutoTagRule[] = [
  {
    // Most specific first: restart/cold-start beats runtime-error
    family: 'restart-continuity',
    patterns: [
      'cold.?start',
      'loses.+state',
      'restart.+state',
      'state.+restart',
      'loses.+context',
      'context.+lost.+restart',
      'boot.+lose',
      'reboot',
    ],
  },
  {
    // Config/identity issues with "env" patterns — before runtime-error so "env variable" doesn't hit runtime-error
    family: 'config',
    patterns: [
      '\\bconfig\\b',
      '\\bsetting\\b',
      'env.+variable',
      'env.+var\\b',
      'missing.+env',
      '\\benvironment.+variable',
      'mismatch.+agent',
      'agent.+mismatch',
      'identity.+mismatch',
    ],
  },
  {
    family: 'runtime-error',
    patterns: [
      'crash',
      'exception',
      '\\bfail(ed|s|ure)?\\b',
      '\\berror\\b',
      'throws?\\b',
      'async.+sync',
      'race.?condition',
      'null.?pointer',
      'undefined.+method',
      'is.+async.+treating.+sync',
    ],
  },
  {
    family: 'performance',
    patterns: [
      '\\bslow\\b',
      '\\btimeout\\b',
      '\\blatency\\b',
      'performance',
      'bottleneck',
    ],
  },
  {
    family: 'access',
    patterns: [
      '\\bauth(entication|orization)?\\b',
      '\\bpermission\\b',
      '\\bdenied\\b',
      '\\bforbidden\\b',
      'credentials?',
      'token.+expir',
    ],
  },
  {
    family: 'ui',
    patterns: [
      '\\bui\\b',
      '\\bdisplay\\b',
      '\\brender\\b',
      '\\blayout\\b',
      '\\bstyle\\b',
      '\\bvisual\\b',
      'text.?wall',
      'screenshot',
      'dark.?mode',
      'mobile.+crash',
      'rendering',
      'serves.+raw.+markdown',
      'bootstrap.+serves',
    ],
  },
  {
    // Testing before deployment: "flaky test causing CI failures" is a testing issue
    family: 'testing',
    patterns: [
      '\\btest(s|ing)?\\b',
      '\\bcoverage\\b',
      '\\bflak(y|iness)?\\b',
    ],
  },
  {
    family: 'deployment',
    patterns: [
      '\\bdeploy(ment|ed)?\\b',
      '\\brelease\\b',
      '\\bbuild\\b',
      '\\bci\\b',
      'pr.+stall',
      'stall.+pr',
      'distribution.+pr',
      'merged.+pr',
      '\\bpipeline\\b',
    ],
  },
  {
    family: 'data-loss',
    patterns: [
      'truncat',
      'cut.?off',
      'missing.?text',
      'incomplete.+data',
      'lost.+data',
    ],
  },
  {
    family: 'process',
    patterns: [
      // Coordination / workflow failures
      'coordinat',
      'theater',
      'process.+noise',
      'noise.+process',
      'review.+loop',
      'loop.+review',
      '\\bapproval\\b',
      '\\bhandoff\\b',
      '\\brouting\\b',
      'misrout',
      '\\bstall(ed|ing)?\\b',
      '\\bmomentum\\b',
      'enforcement',
      '\\bidle\\b',
      'sitting.+idle',
      'idle.+day',
      'no.+code.+shipped',
      'communication',
      'comms',
      'duplicate.+task',
      'task.+duplicate',
      'already.+shipped',
      'already.+solved',
      'phantom',
      'trust.+erosion',
      'drift',
      'status.+update',
      'update.+status',
      'economic.+control',
      'spend.+revenue',
      'revenue.+spend',
      'model.+cost',
      'no.+revenue',
      'token.+patience',
      'agents.+don.?t.+read',
    ],
  },
]

// ── Runtime-configurable rule store ─────────────────────────────────────────

let _rules: AutoTagRule[] = loadRulesFromEnv() ?? [...DEFAULT_AUTO_TAG_RULES]

function loadRulesFromEnv(): AutoTagRule[] | null {
  const raw = process.env.REFLECTT_AUTO_TAG_RULES
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as AutoTagRule[]
  } catch {
    return null
  }
}

export function getAutoTagRules(): AutoTagRule[] {
  return [..._rules]
}

export function setAutoTagRules(rules: AutoTagRule[]): void {
  _rules = rules
}

export function resetAutoTagRules(): void {
  _rules = [...DEFAULT_AUTO_TAG_RULES]
}

// ── Core inference ────────────────────────────────────────────────────────────

/**
 * Infer the failure_family for an insight title using the current rule set.
 * Returns `null` if no rule matches (keep 'uncategorized').
 */
export function inferFamilyFromTitle(title: string, rules?: AutoTagRule[]): string | null {
  const lower = title.toLowerCase()
  const activeRules = rules ?? _rules

  for (const rule of activeRules) {
    for (const pattern of rule.patterns) {
      try {
        if (new RegExp(pattern, 'i').test(lower)) {
          return rule.family
        }
      } catch {
        // Skip malformed regex patterns
      }
    }
  }
  return null
}

// ── Backfill ──────────────────────────────────────────────────────────────────

export interface AutoTagResult {
  id: string
  title: string
  old_family: string
  new_family: string
  matched_rule?: string
}

export interface AutoTagSummary {
  scanned: number
  reclassified: number
  unchanged: number
  results: AutoTagResult[]
}

/**
 * Backfill all insights with failure_family = 'uncategorized'.
 * Updates DB directly, appends an audit note to metadata.
 * Returns summary of changes.
 */
export function backfillUncategorizedInsights(dryRun = false): AutoTagSummary {
  const db = getDatabase()

  const rows = db.prepare(
    `SELECT id, title, failure_family, cluster_key, workflow_stage, impacted_unit, metadata
     FROM insights
     WHERE failure_family = 'uncategorized' AND status != 'closed'
     ORDER BY created_at DESC`,
  ).all() as Array<{
    id: string
    title: string
    failure_family: string
    cluster_key: string
    workflow_stage: string
    impacted_unit: string
    metadata: string | null
  }>

  const summary: AutoTagSummary = {
    scanned: rows.length,
    reclassified: 0,
    unchanged: 0,
    results: [],
  }

  const updateStmt = dryRun ? null : db.prepare(
    `UPDATE insights
     SET failure_family = ?,
         cluster_key = ?,
         metadata = ?
     WHERE id = ?`,
  )

  for (const row of rows) {
    const newFamily = inferFamilyFromTitle(row.title)
    if (!newFamily || newFamily === 'uncategorized') {
      summary.unchanged++
      summary.results.push({
        id: row.id,
        title: row.title.slice(0, 80),
        old_family: row.failure_family,
        new_family: 'uncategorized',
      })
      continue
    }

    // Rebuild cluster_key with the new family
    const parts = row.cluster_key.split('::')
    const newClusterKey = `${parts[0] ?? row.workflow_stage}::${newFamily}::${parts[2] ?? row.impacted_unit}`

    // Preserve existing metadata, add auto-tag audit note
    let meta: Record<string, unknown> = {}
    try {
      meta = row.metadata ? JSON.parse(row.metadata) : {}
    } catch { /* ignore */ }
    meta.auto_tag = {
      applied_at: Date.now(),
      old_family: row.failure_family,
      new_family: newFamily,
      method: 'keyword-rules-v1',
    }

    if (!dryRun && updateStmt) {
      updateStmt.run(newFamily, newClusterKey, JSON.stringify(meta), row.id)
    }

    summary.reclassified++
    summary.results.push({
      id: row.id,
      title: row.title.slice(0, 80),
      old_family: row.failure_family,
      new_family: newFamily,
    })
  }

  return summary
}

// ── Auto-tag on insert ────────────────────────────────────────────────────────

/**
 * Called immediately after a new insight is written with failure_family='uncategorized'.
 * If a rule matches the title, updates the insight row in-place.
 * Non-throwing: errors are logged but do not fail the insert.
 */
export function autoTagInsightIfUncategorized(insightId: string, title: string, clusterKey: string): void {
  const newFamily = inferFamilyFromTitle(title)
  if (!newFamily || newFamily === 'uncategorized') return

  try {
    const db = getDatabase()
    const row = db.prepare('SELECT cluster_key FROM insights WHERE id = ?').get(insightId) as { cluster_key: string } | undefined
    if (!row) return

    const parts = (row.cluster_key || clusterKey).split('::')
    const newClusterKey = `${parts[0] ?? 'unknown'}::${newFamily}::${parts[2] ?? 'unknown'}`

    db.prepare(
      `UPDATE insights SET failure_family = ?, cluster_key = ? WHERE id = ? AND failure_family = 'uncategorized'`,
    ).run(newFamily, newClusterKey, insightId)
  } catch (err) {
    console.error('[auto-tag] Failed to auto-tag insight', insightId, err)
  }
}
