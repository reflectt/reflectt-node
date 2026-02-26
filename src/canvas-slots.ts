// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * SlotManager — tracks active slots, ownership, priority, staleness.
 *
 * Each slot has an owner (agent), content, and a last-update timestamp.
 * Stale slots (no update in STALE_THRESHOLD_MS) are auto-faded from
 * the active set but preserved for history/drilldown.
 */

import type { SlotType, ContentType, RenderPayload, SlotEvent } from './canvas-types.js'

const STALE_THRESHOLD_MS = 60_000  // 60s — slots fade after this

export interface ActiveSlot {
  slot: SlotType
  content_type: ContentType
  payload: RenderPayload
  priority: 'background' | 'normal' | 'dominant'
  agent_id: string
  updated_at: number
  created_at: number
  version: number       // increments on each update
}

type SlotSubscriber = (slot: ActiveSlot) => void

class SlotManager {
  private slots = new Map<string, ActiveSlot>()
  private history: Array<{ event: SlotEvent; timestamp: number }> = []
  private maxHistory = 200
  private subscribers = new Set<SlotSubscriber>()

  /**
   * Update or create a slot with new content.
   */
  upsert(event: SlotEvent): ActiveSlot {
    const key = event.slot
    const existing = this.slots.get(key)
    const now = Date.now()

    const slot: ActiveSlot = {
      slot: event.slot,
      content_type: event.content_type,
      payload: event.payload,
      priority: event.priority,
      agent_id: event.payload.agent_id || 'unknown',
      updated_at: now,
      created_at: existing?.created_at || now,
      version: (existing?.version || 0) + 1,
    }

    this.slots.set(key, slot)

    // Record history
    this.history.push({ event, timestamp: now })
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory)
    }

    // Notify subscribers
    this.notifySubscribers(slot)

    return slot
  }

  /**
   * Subscribe to slot updates (same pattern as chatManager/taskManager).
   * Returns an unsubscribe function.
   */
  subscribe(callback: SlotSubscriber): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notifySubscribers(slot: ActiveSlot) {
    this.subscribers.forEach(callback => {
      try {
        callback(slot)
      } catch (err) {
        console.error('[SlotManager] Subscriber error:', err)
      }
    })
  }

  /**
   * Get all currently active (non-stale) slots.
   * Sorted by priority (dominant first) then recency.
   */
  getActive(): ActiveSlot[] {
    const now = Date.now()
    const active: ActiveSlot[] = []

    for (const [key, slot] of this.slots) {
      if (now - slot.updated_at > STALE_THRESHOLD_MS) {
        continue // skip stale
      }
      active.push(slot)
    }

    // Sort: dominant > normal > background, then by recency
    const priorityOrder = { dominant: 0, normal: 1, background: 2 }
    active.sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pd !== 0) return pd
      return b.updated_at - a.updated_at // newest first
    })

    return active
  }

  /**
   * Get a specific slot by key.
   */
  get(slotKey: string): ActiveSlot | undefined {
    return this.slots.get(slotKey)
  }

  /**
   * Remove a slot entirely.
   */
  remove(slotKey: string): boolean {
    return this.slots.delete(slotKey)
  }

  /**
   * Get all slots (including stale) for debug/audit.
   */
  getAll(): ActiveSlot[] {
    return Array.from(this.slots.values())
  }

  /**
   * Get recent history for a slot or all slots.
   */
  getHistory(slotKey?: string, limit = 20): Array<{ event: SlotEvent; timestamp: number }> {
    let entries = this.history
    if (slotKey) {
      entries = entries.filter(h => h.event.slot === slotKey)
    }
    return entries.slice(-limit)
  }

  /**
   * Get stats for ops/debug.
   */
  getStats() {
    const now = Date.now()
    const all = Array.from(this.slots.values())
    const active = all.filter(s => now - s.updated_at <= STALE_THRESHOLD_MS)
    const stale = all.filter(s => now - s.updated_at > STALE_THRESHOLD_MS)

    return {
      total: all.length,
      active: active.length,
      stale: stale.length,
      historySize: this.history.length,
      slots: active.map(s => ({
        slot: s.slot,
        agent: s.agent_id,
        content_type: s.content_type,
        priority: s.priority,
        age_ms: now - s.updated_at,
        version: s.version,
      })),
    }
  }

  /**
   * Clean up stale slots older than maxAge.
   */
  prune(maxAgeMs = 5 * 60_000): number {
    const now = Date.now()
    let pruned = 0
    for (const [key, slot] of this.slots) {
      if (now - slot.updated_at > maxAgeMs) {
        this.slots.delete(key)
        pruned++
      }
    }
    return pruned
  }
}

export const slotManager = new SlotManager()
