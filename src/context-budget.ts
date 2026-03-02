// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Context budget enforcement + persisted memo summaries.
 *
 * V1 goals:
 * - Hard caps per layer (session_local / agent_persistent / team_shared)
 * - When over cap: optionally auto-summarize overflow into a persisted memo and reuse it
 * - Emit attribution metadata: per-layer/per-item token estimates + memo usage
 */

import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getDb, safeJsonParse, safeJsonStringify } from './db.js'
import type { AgentMessage } from './types.js'
import { memoryManager } from './memory.js'

export type ContextLayer = 'session_local' | 'agent_persistent' | 'team_shared'

export interface ContextBudgets {
  totalTokens?: number
  layers: Record<ContextLayer, number>
}

export interface ContextItem {
  source: 'chat' | 'file' | 'memo'
  id: string
  title?: string
  content: string
  tokens_est: number
  meta?: Record<string, unknown>
}

export interface ContextMemo {
  scope_id: string
  layer: ContextLayer
  memo_version: number
  content: string
  source_window?: Record<string, unknown>
  source_hash?: string
  updated_at: number
  created_at: number
}

export interface LayerContextResult {
  layer: ContextLayer
  scope_id: string
  budget_tokens: number
  used_tokens: number
  memo_used: boolean
  memo_updated: boolean
  memo_version?: number
  warnings: string[]
  items: ContextItem[]
  suppressed_tokens: number
}

export interface ContextInjectionResult {
  agent: string
  computed_at: number
  budgets: ContextBudgets
  autosummary_enabled: boolean
  layers: Record<ContextLayer, LayerContextResult>
  context_budget: {
    total: { budget?: number; used: number }
    layers: Record<ContextLayer, { budget: number; used: number; memo_used?: boolean; memo_version?: number; warnings?: string[] }>
    warnings: string[]
    top_contributors: Array<{ layer: ContextLayer; source: string; id: string; tokens: number }>
  }
}

const DEFAULT_BUDGETS: ContextBudgets = {
  totalTokens: 12_000,
  layers: {
    session_local: 6_000,
    agent_persistent: 4_000, // Increased from 2k: workspace files (SOUL/TOOLS/AGENTS/HEARTBEAT/MEMORY) typically exceed 2k
    team_shared: 2_000,
  },
}

export function getContextBudgets(): ContextBudgets {
  const env = process.env
  const parseIntSafe = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
  }

  const sessionLocal = parseIntSafe(env.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS) ?? DEFAULT_BUDGETS.layers.session_local
  const agentPersistent = parseIntSafe(env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS) ?? DEFAULT_BUDGETS.layers.agent_persistent
  const teamShared = parseIntSafe(env.REFLECTT_CONTEXT_BUDGET_TEAM_SHARED_TOKENS) ?? DEFAULT_BUDGETS.layers.team_shared
  const total = parseIntSafe(env.REFLECTT_CONTEXT_BUDGET_TOTAL_TOKENS) ?? DEFAULT_BUDGETS.totalTokens

  return {
    totalTokens: total,
    layers: {
      session_local: sessionLocal,
      agent_persistent: agentPersistent,
      team_shared: teamShared,
    },
  }
}

export function isAutoSummaryEnabled(): boolean {
  const v = String(process.env.REFLECTT_CONTEXT_AUTOSUMMARY || '').trim().toLowerCase()
  // Autosummary uses a local heuristic summarizer (no LLM), so it is safe to enable by default.
  // Opt-out explicitly with REFLECTT_CONTEXT_AUTOSUMMARY=false (or 0/no).
  if (v === '0' || v === 'false' || v === 'no') return false
  return true // enabled by default
}

/**
 * Token estimation (v1): deterministic heuristic.
 * Roughly: 1 token ~= 4 chars in English.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const chars = text.length
  return Math.max(1, Math.ceil(chars / 4))
}

function hashItems(items: Array<{ id: string; content: string }>): string {
  const h = createHash('sha256')
  for (const it of items) {
    h.update(it.id)
    h.update('\n')
    // include prefix only to avoid large hashes being expensive
    h.update(it.content.slice(0, 4000))
    h.update('\n---\n')
  }
  return h.digest('hex')
}

function clampTextToTokens(text: string, budgetTokens: number): string {
  const maxChars = Math.max(0, budgetTokens * 4)
  if (text.length <= maxChars) return text

  // IMPORTANT: ensure the final string stays within the char budget.
  // (We add a suffix, so we must reserve space for it.)
  const suffix = '\n\n…(truncated)'
  const budgetForBody = Math.max(0, maxChars - suffix.length)

  const body = text
    .slice(0, budgetForBody)
    .replace(/\s+\S*$/, '')

  return body + suffix
}

function heuristicSummarize(items: ContextItem[], opts: { layer: ContextLayer; scope_id: string; budgetTokens: number }): string {
  const { layer, scope_id, budgetTokens } = opts

  const lines: string[] = []
  lines.push(`# Context memo (${layer})\n`)
  lines.push(`Scope: \`${scope_id}\``)
  lines.push('')
  lines.push('Heuristic summary (no LLM):')
  lines.push('')

  // Prefer bullet list of compact item snippets.
  const maxBullets = 80
  for (const it of items.slice(0, maxBullets)) {
    const title = it.title ? `${it.title}: ` : ''
    const snippet = String(it.content || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    lines.push(`- **${it.source}** ${title}${snippet}${snippet.length >= 240 ? '…' : ''}`)
  }

  const summary = lines.join('\n')
  return clampTextToTokens(summary, budgetTokens)
}

// ── Persistence: context_memos ─────────────────────────────────────────────

export function getContextMemo(scope_id: string, layer: ContextLayer): ContextMemo | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT scope_id, layer, memo_version, content, source_window, source_hash, updated_at, created_at
    FROM context_memos
    WHERE scope_id = ? AND layer = ?
  `).get(scope_id, layer) as any

  if (!row) return null
  return {
    scope_id: row.scope_id,
    layer: row.layer,
    memo_version: Number(row.memo_version) || 0,
    content: String(row.content || ''),
    source_window: safeJsonParse<Record<string, unknown>>(row.source_window) || undefined,
    source_hash: typeof row.source_hash === 'string' ? row.source_hash : undefined,
    updated_at: Number(row.updated_at) || 0,
    created_at: Number(row.created_at) || 0,
  }
}

export function upsertContextMemo(input: {
  scope_id: string
  layer: ContextLayer
  content: string
  source_window?: Record<string, unknown>
  source_hash?: string
}): ContextMemo {
  const db = getDb()
  const now = Date.now()
  const existing = getContextMemo(input.scope_id, input.layer)
  const nextVersion = existing ? existing.memo_version + 1 : 1

  db.prepare(`
    INSERT INTO context_memos (scope_id, layer, memo_version, content, source_window, source_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_id, layer) DO UPDATE SET
      memo_version = excluded.memo_version,
      content = excluded.content,
      source_window = excluded.source_window,
      source_hash = excluded.source_hash,
      updated_at = excluded.updated_at
  `).run(
    input.scope_id,
    input.layer,
    nextVersion,
    input.content,
    safeJsonStringify(input.source_window),
    input.source_hash || null,
    now,
    now,
  )

  return getContextMemo(input.scope_id, input.layer)!
}

// ── Layer builders ─────────────────────────────────────────────────────────

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(filePath, 'utf-8')
    return buf
  } catch {
    return null
  }
}

function findAgentWorkspace(agent: string): string {
  // Keep consistent with memory.ts; env override supported for CI.
  const base = process.env.OPENCLAW_STATE_DIR
    ? join(process.env.OPENCLAW_STATE_DIR, '')
    : (process.env.OPENCLAW_HOME || join(homedir(), '.openclaw'))
  return join(base, `workspace-${agent}`)
}

async function buildAgentPersistentItems(agent: string): Promise<ContextItem[]> {
  const root = findAgentWorkspace(agent)

  // Preference: keep core identity/config files over long memory tails.
  // Budget enforcement keeps the most recent items, so we append core files LAST.
  const candidates: Array<{ id: string; title: string; path: string; maxChars?: number }> = [
    { id: 'SOUL.md', title: 'SOUL.md', path: join(root, 'SOUL.md'), maxChars: 16_000 },
    { id: 'TOOLS.md', title: 'TOOLS.md', path: join(root, 'TOOLS.md'), maxChars: 16_000 },
    { id: 'USER.md', title: 'USER.md', path: join(root, 'USER.md'), maxChars: 16_000 },
    { id: 'AGENTS.md', title: 'AGENTS.md', path: join(root, 'AGENTS.md'), maxChars: 16_000 },
    { id: 'HEARTBEAT.md', title: 'HEARTBEAT.md', path: join(root, 'HEARTBEAT.md'), maxChars: 16_000 },
  ]

  const memoryItems: ContextItem[] = []
  const coreItems: ContextItem[] = []

  // Include most recent memory files (bounded upstream by budget enforcement).
  try {
    const memories = await memoryManager.getMemories(agent)
    const picked = memories
      .sort((a, b) => (b.modified || 0) - (a.modified || 0))
      .slice(0, 4) // MEMORY.md + last 3 daily is typical

    for (const mem of picked) {
      const content = mem.content.length > 20_000 ? mem.content.slice(0, 20_000) + '\n\n…(memory clipped)' : mem.content
      memoryItems.push({
        source: 'file',
        id: `memory:${mem.filename}`,
        title: `memory/${mem.filename}`,
        content,
        tokens_est: estimateTokens(content),
        meta: { path: mem.path, modified: mem.modified, size: mem.size },
      })
    }
  } catch {
    // best-effort; memory not required
  }

  for (const c of candidates) {
    const content = await readIfExists(c.path)
    if (!content) continue
    const clipped = typeof c.maxChars === 'number' && content.length > c.maxChars
      ? content.slice(0, c.maxChars) + '\n\n…(file clipped)'
      : content
    coreItems.push({
      source: 'file',
      id: c.id,
      title: c.title,
      content: clipped,
      tokens_est: estimateTokens(clipped),
      meta: { path: c.path },
    })
  }

  // Important: core files appended last so they survive keepMostRecentWithinBudget.
  return [...memoryItems, ...coreItems]
}

function buildSessionLocalItems(messages: AgentMessage[], agent: string): ContextItem[] {
  const items: ContextItem[] = []
  for (const m of messages) {
    const content = `${m.from}: ${m.content}`
    items.push({
      source: 'chat',
      id: m.id,
      title: m.channel ? `#${m.channel}` : undefined,
      content,
      tokens_est: estimateTokens(content),
      meta: { ts: m.timestamp, ch: m.channel, from: m.from },
    })
  }
  return items
}

// ── Enforcement ────────────────────────────────────────────────────────────

function sumTokens(items: ContextItem[]): number {
  return items.reduce((acc, it) => acc + (Number(it.tokens_est) || 0), 0)
}

function keepMostRecentWithinBudget(items: ContextItem[], budgetTokens: number): { kept: ContextItem[]; suppressedTokens: number } {
  const kept: ContextItem[] = []
  let used = 0

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const t = Number(it.tokens_est) || 0
    if (kept.length === 0 && t > budgetTokens) {
      // Single huge item: clamp.
      const clamped = clampTextToTokens(it.content, budgetTokens)
      const clampedItem: ContextItem = { ...it, content: clamped, tokens_est: estimateTokens(clamped), meta: { ...(it.meta || {}), clamped: true } }
      kept.unshift(clampedItem)
      used = clampedItem.tokens_est
      break
    }
    if (used + t > budgetTokens) continue
    kept.unshift(it)
    used += t
  }

  const suppressedTokens = Math.max(0, sumTokens(items) - used)
  return { kept, suppressedTokens }
}

async function enforceLayerBudget(opts: {
  layer: ContextLayer
  scope_id: string
  budgetTokens: number
  items: ContextItem[]
  autosummaryEnabled: boolean
}): Promise<LayerContextResult> {
  const warnings: string[] = []
  const totalTokens = sumTokens(opts.items)

  if (totalTokens <= opts.budgetTokens) {
    return {
      layer: opts.layer,
      scope_id: opts.scope_id,
      budget_tokens: opts.budgetTokens,
      used_tokens: totalTokens,
      memo_used: false,
      memo_updated: false,
      warnings,
      items: opts.items,
      suppressed_tokens: 0,
    }
  }

  // Over budget: decide truncate-only vs autosummary.
  if (!opts.autosummaryEnabled) {
    warnings.push('autosummary_disabled_truncated')
    const { kept, suppressedTokens } = keepMostRecentWithinBudget(opts.items, opts.budgetTokens)
    return {
      layer: opts.layer,
      scope_id: opts.scope_id,
      budget_tokens: opts.budgetTokens,
      used_tokens: sumTokens(kept),
      memo_used: false,
      memo_updated: false,
      warnings,
      items: kept,
      suppressed_tokens: suppressedTokens,
    }
  }

  // Autosummary enabled.
  // Strategy (v1): summarize the items we are dropping (oldest) into a memo,
  // and keep a recent tail. Memo must always be included.
  // Split the layer budget into memo + tail. Must always sum <= layer budget.
  // (Earlier versions used hard minimums that broke tiny budgets in tests.)
  const tailBudget = Math.max(0, Math.floor(opts.budgetTokens * 0.45))
  const memoBudget = Math.max(0, opts.budgetTokens - tailBudget)

  const { kept: tail } = keepMostRecentWithinBudget(opts.items, tailBudget)
  const tailIds = new Set(tail.map(i => i.id))
  const overflow = opts.items.filter(i => !tailIds.has(i.id))

  const overflowHash = hashItems(overflow.map(o => ({ id: o.id, content: o.content })))
  const existing = getContextMemo(opts.scope_id, opts.layer)

  let memo = existing
  let memoUpdated = false

  if (!existing || existing.source_hash !== overflowHash) {
    const summary = heuristicSummarize(overflow, { layer: opts.layer, scope_id: opts.scope_id, budgetTokens: memoBudget })
    memo = upsertContextMemo({
      scope_id: opts.scope_id,
      layer: opts.layer,
      content: summary,
      source_hash: overflowHash,
      source_window: {
        kind: 'overflow',
        item_count: overflow.length,
        tail_count: tail.length,
        updated_at: Date.now(),
        first_item_id: overflow[0]?.id,
        last_item_id: overflow[overflow.length - 1]?.id,
      },
    })
    memoUpdated = true
  }

  const memoUsed = Boolean(memo && memo.content)

  // Clamp memo to its reserved sub-budget (and never exceed full layer budget).
  const memoClampBudget = Math.min(memoBudget, opts.budgetTokens)
  const memoContent = clampTextToTokens(memo?.content || '', memoClampBudget)
  const memoItem: ContextItem = {
    source: 'memo',
    id: `memo:${opts.scope_id}:${opts.layer}:v${memo?.memo_version || 0}`,
    title: `Context memo (${opts.layer})`,
    content: memoContent,
    tokens_est: estimateTokens(memoContent),
    meta: {
      scope_id: opts.scope_id,
      layer: opts.layer,
      memo_version: memo?.memo_version || 0,
      memo_updated: memoUpdated,
      clamped: memoContent !== (memo?.content || ''),
    },
  }

  // Fill remaining budget with the most recent tail. Ensure memo is never dropped.
  const remaining = Math.max(0, opts.budgetTokens - memoItem.tokens_est)
  let tailKept = tail
  if (remaining === 0) {
    warnings.push('memo_exhausted_layer_budget_tail_dropped')
    tailKept = []
  } else {
    const before = sumTokens(tail)
    const { kept } = keepMostRecentWithinBudget(tail, remaining)
    tailKept = kept
    const after = sumTokens(tailKept)
    if (after < before) warnings.push('tail_truncated_to_fit_memo')
  }

  const finalItems = [memoItem, ...tailKept]
  const finalUsed = sumTokens(finalItems)

  // suppressed_tokens = raw tokens removed from the layer (memo not counted as raw)
  const rawIncluded = sumTokens(tailKept)
  const suppressed = Math.max(0, totalTokens - rawIncluded)

  return {
    layer: opts.layer,
    scope_id: opts.scope_id,
    budget_tokens: opts.budgetTokens,
    used_tokens: finalUsed,
    memo_used: memoUsed,
    memo_updated: memoUpdated,
    memo_version: memo?.memo_version,
    warnings,
    items: finalItems,
    suppressed_tokens: suppressed,
  }
}

export async function buildContextInjection(opts: {
  agent: string
  sessionMessages: AgentMessage[]
  /** Scope for session_local layer + its overflow memo bucketing */
  sessionScopeId?: string
  /** Scope for team_shared layer */
  teamScopeId?: string
}): Promise<ContextInjectionResult> {
  const budgets = getContextBudgets()
  const autosummaryEnabled = isAutoSummaryEnabled()

  const agentScope = `agent:${opts.agent}`
  const sessionScope = (opts.sessionScopeId && opts.sessionScopeId.trim().length > 0) ? opts.sessionScopeId.trim() : agentScope
  const teamScope = (opts.teamScopeId && opts.teamScopeId.trim().length > 0) ? opts.teamScopeId.trim() : 'team:default'

  const rawSession = buildSessionLocalItems(opts.sessionMessages, opts.agent)
  const rawPersistent = await buildAgentPersistentItems(opts.agent)

  // team_shared raw items: (v1) memo only (plus optional future sources)
  const teamMemo = getContextMemo(teamScope, 'team_shared')
  const rawTeam: ContextItem[] = teamMemo
    ? [{
        source: 'memo',
        id: `memo:${teamScope}:team_shared:v${teamMemo.memo_version}`,
        title: 'Team shared memo',
        content: teamMemo.content,
        tokens_est: estimateTokens(teamMemo.content),
        meta: { scope_id: teamScope, layer: 'team_shared', memo_version: teamMemo.memo_version },
      }]
    : []

  const layerResults = {
    session_local: await enforceLayerBudget({
      layer: 'session_local',
      scope_id: sessionScope,
      budgetTokens: budgets.layers.session_local,
      items: rawSession,
      autosummaryEnabled,
    }),
    agent_persistent: await enforceLayerBudget({
      layer: 'agent_persistent',
      scope_id: agentScope,
      budgetTokens: budgets.layers.agent_persistent,
      items: rawPersistent,
      autosummaryEnabled,
    }),
    team_shared: await enforceLayerBudget({
      layer: 'team_shared',
      scope_id: teamScope,
      budgetTokens: budgets.layers.team_shared,
      items: rawTeam,
      autosummaryEnabled,
    }),
  } satisfies Record<ContextLayer, LayerContextResult>

  // Total usage and top contributors.
  const allItems: Array<{ layer: ContextLayer; item: ContextItem }> = []
  for (const layer of Object.keys(layerResults) as ContextLayer[]) {
    for (const it of layerResults[layer].items) {
      allItems.push({ layer, item: it })
    }
  }

  const usedTotal = allItems.reduce((acc, x) => acc + (Number(x.item.tokens_est) || 0), 0)
  const top = allItems
    .slice()
    .sort((a, b) => (Number(b.item.tokens_est) || 0) - (Number(a.item.tokens_est) || 0))
    .slice(0, 20)
    .map(x => ({ layer: x.layer, source: x.item.source, id: x.item.id, tokens: x.item.tokens_est }))

  const warnings: string[] = []
  if (budgets.totalTokens && usedTotal > budgets.totalTokens) warnings.push('total_budget_exceeded')

  return {
    agent: opts.agent,
    computed_at: Date.now(),
    budgets,
    autosummary_enabled: autosummaryEnabled,
    layers: layerResults,
    context_budget: {
      total: { budget: budgets.totalTokens, used: usedTotal },
      layers: {
        session_local: {
          budget: layerResults.session_local.budget_tokens,
          used: layerResults.session_local.used_tokens,
          memo_used: layerResults.session_local.memo_used,
          memo_version: layerResults.session_local.memo_version,
          warnings: layerResults.session_local.warnings,
        },
        agent_persistent: {
          budget: layerResults.agent_persistent.budget_tokens,
          used: layerResults.agent_persistent.used_tokens,
          memo_used: layerResults.agent_persistent.memo_used,
          memo_version: layerResults.agent_persistent.memo_version,
          warnings: layerResults.agent_persistent.warnings,
        },
        team_shared: {
          budget: layerResults.team_shared.budget_tokens,
          used: layerResults.team_shared.used_tokens,
          memo_used: layerResults.team_shared.memo_used,
          memo_version: layerResults.team_shared.memo_version,
          warnings: layerResults.team_shared.warnings,
        },
      },
      warnings,
      top_contributors: top,
    },
  }
}
