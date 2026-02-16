// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Agent Inbox/Mailbox System
 * 
 * Provides personalized message routing and filtering for each agent.
 * Messages are prioritized and routed based on:
 * - @mentions (high priority)
 * - Direct messages (high priority)
 * - Subscribed channels (medium priority)
 * - General channels (low priority)
 */

import type { AgentMessage, InboxState, InboxMessage } from './types.js'
import { promises as fs } from 'fs'
import { join } from 'path'
import { INBOX_DIR, DATA_DIR, LEGACY_DATA_DIR } from './config.js'
import { eventBus } from './events.js'
import { DEFAULT_INBOX_SUBSCRIPTIONS } from './channels.js'
import { getDb, importJsonlIfNeeded, safeJsonParse, safeJsonStringify } from './db.js'
import type Database from 'better-sqlite3'

const INBOX_STATES_AUDIT_FILE = join(DATA_DIR, 'inbox.states.jsonl')
const LEGACY_INBOX_STATES_AUDIT_FILE = join(LEGACY_DATA_DIR, 'inbox.states.jsonl')
const LEGACY_INBOX_DIR = join(LEGACY_DATA_DIR, 'inbox')

function normalizeInboxState(input: Partial<InboxState> & { agent: string }): InboxState {
  return {
    agent: input.agent,
    subscriptions: Array.isArray(input.subscriptions) && input.subscriptions.length > 0
      ? [...new Set(input.subscriptions)]
      : [...DEFAULT_INBOX_SUBSCRIPTIONS],
    ackedMessageIds: Array.isArray(input.ackedMessageIds)
      ? [...new Set(input.ackedMessageIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : [],
    lastReadTimestamp: typeof input.lastReadTimestamp === 'number' ? input.lastReadTimestamp : 0,
    lastUpdated: typeof input.lastUpdated === 'number' ? input.lastUpdated : Date.now(),
  }
}

function importInboxStateRecords(db: Database.Database, records: unknown[]): number {
  const latestByAgent = new Map<string, InboxState>()

  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const raw = record as Partial<InboxState>
    if (typeof raw.agent !== 'string' || raw.agent.length === 0) continue

    const normalized = normalizeInboxState({ ...raw, agent: raw.agent })
    const existing = latestByAgent.get(normalized.agent)
    if (!existing || normalized.lastUpdated >= existing.lastUpdated) {
      latestByAgent.set(normalized.agent, normalized)
    }
  }

  if (latestByAgent.size === 0) return 0

  const upsertState = db.prepare(`
    INSERT OR REPLACE INTO inbox_states (agent, subscriptions, last_read_timestamp, last_updated)
    VALUES (?, ?, ?, ?)
  `)
  const clearAcks = db.prepare('DELETE FROM inbox_acks WHERE agent = ?')
  const insertAck = db.prepare('INSERT OR REPLACE INTO inbox_acks (agent, message_id, acked_at) VALUES (?, ?, ?)')

  const tx = db.transaction((states: InboxState[]) => {
    for (const state of states) {
      upsertState.run(
        state.agent,
        safeJsonStringify(state.subscriptions) ?? '[]',
        state.lastReadTimestamp ?? 0,
        state.lastUpdated,
      )
      clearAcks.run(state.agent)
      for (const messageId of state.ackedMessageIds) {
        insertAck.run(state.agent, messageId, state.lastUpdated)
      }
    }
  })

  tx(Array.from(latestByAgent.values()))
  return latestByAgent.size
}

class InboxManager {
  private states = new Map<string, InboxState>()
  private initialized = false

  constructor() {
    this.loadStates().catch(err => {
      console.error('[Inbox] Failed to load inbox states:', err)
    })
  }

  /**
   * Load all inbox states from SQLite (primary), with one-time file import.
   */
  private async loadStates(): Promise<void> {
    try {
      await fs.mkdir(INBOX_DIR, { recursive: true })
      await fs.mkdir(DATA_DIR, { recursive: true })

      const db = getDb()

      // One-time JSONL import (current + legacy audit files)
      importJsonlIfNeeded(db, INBOX_STATES_AUDIT_FILE, 'inbox_states', importInboxStateRecords)
      importJsonlIfNeeded(db, LEGACY_INBOX_STATES_AUDIT_FILE, 'inbox_states', importInboxStateRecords)

      await this.importLegacyInboxFilesIfNeeded(db, INBOX_DIR)
      await this.importLegacyInboxFilesIfNeeded(db, LEGACY_INBOX_DIR)

      this.loadStatesFromDb(db)

      console.log(`[Inbox] Loaded ${this.states.size} inbox states from SQLite`)
    } finally {
      this.initialized = true
    }
  }

  private loadStatesFromDb(db: Database.Database): void {
    this.states.clear()

    const rows = db.prepare('SELECT * FROM inbox_states').all() as Array<{
      agent: string
      subscriptions: string | null
      last_read_timestamp: number
      last_updated: number
    }>

    const selectAcks = db.prepare('SELECT message_id FROM inbox_acks WHERE agent = ? ORDER BY acked_at ASC')

    for (const row of rows) {
      const ackRows = selectAcks.all(row.agent) as Array<{ message_id: string }>
      const state: InboxState = {
        agent: row.agent,
        subscriptions: safeJsonParse<string[]>(row.subscriptions) || [...DEFAULT_INBOX_SUBSCRIPTIONS],
        ackedMessageIds: ackRows.map((entry) => entry.message_id),
        lastReadTimestamp: row.last_read_timestamp ?? 0,
        lastUpdated: row.last_updated,
      }
      this.states.set(state.agent, state)
    }
  }

  private async importLegacyInboxFilesIfNeeded(db: Database.Database, dirPath: string): Promise<void> {
    const count = db.prepare('SELECT COUNT(*) as c FROM inbox_states').get() as { c: number }
    if (count.c > 0) return

    let files: string[] = []
    try {
      files = await fs.readdir(dirPath)
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.error('[Inbox] Failed to read legacy inbox directory:', err)
      }
      return
    }

    const records: InboxState[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const content = await fs.readFile(join(dirPath, file), 'utf-8')
        const parsed = JSON.parse(content) as Partial<InboxState>
        if (!parsed.agent) continue
        records.push(normalizeInboxState({ ...parsed, agent: parsed.agent }))
      } catch (err) {
        console.error(`[Inbox] Failed to parse legacy inbox state ${file}:`, err)
      }
    }

    if (records.length === 0) return

    const imported = importInboxStateRecords(db, records)
    if (imported > 0) {
      console.log(`[Inbox] Imported ${imported} legacy inbox state files from ${dirPath}`)
    }
  }

  /**
   * Get or create inbox state for an agent
   */
  private getState(agent: string): InboxState {
    let state = this.states.get(agent)
    if (!state) {
      state = {
        agent,
        subscriptions: [...DEFAULT_INBOX_SUBSCRIPTIONS],
        ackedMessageIds: [],
        lastReadTimestamp: 0, // Initialize to 0 so first check gets all messages
        lastUpdated: Date.now(),
      }
      this.states.set(agent, state)
      this.persistState(state).catch(err => {
        console.error(`[Inbox] Failed to persist state for ${agent}:`, err)
      })
    }
    return state
  }

  /**
   * Persist a single inbox state to SQLite (primary) + JSONL audit.
   */
  private async persistState(state: InboxState): Promise<void> {
    const normalized = normalizeInboxState(state)

    try {
      const db = getDb()
      const upsertState = db.prepare(`
        INSERT OR REPLACE INTO inbox_states (agent, subscriptions, last_read_timestamp, last_updated)
        VALUES (?, ?, ?, ?)
      `)
      const clearAcks = db.prepare('DELETE FROM inbox_acks WHERE agent = ?')
      const insertAck = db.prepare('INSERT OR REPLACE INTO inbox_acks (agent, message_id, acked_at) VALUES (?, ?, ?)')

      const tx = db.transaction(() => {
        upsertState.run(
          normalized.agent,
          safeJsonStringify(normalized.subscriptions) ?? '[]',
          normalized.lastReadTimestamp ?? 0,
          normalized.lastUpdated,
        )

        clearAcks.run(normalized.agent)
        for (const messageId of normalized.ackedMessageIds) {
          insertAck.run(normalized.agent, messageId, normalized.lastUpdated)
        }
      })

      tx()

      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.appendFile(INBOX_STATES_AUDIT_FILE, JSON.stringify(normalized) + '\n', 'utf-8')
    } catch (err) {
      console.error(`[Inbox] Failed to persist state for ${state.agent}:`, err)
    }
  }

  /**
   * Check if a message mentions an agent
   */
  private isMentioned(message: AgentMessage, agent: string): boolean {
    const mentionPattern = new RegExp(`@${agent}\\b`, 'i')
    return mentionPattern.test(message.content)
  }

  /**
   * Route a message to relevant agent inboxes
   * This is called automatically when a message is posted
   */
  routeMessage(message: AgentMessage, allAgents: string[]): void {
    // For each agent, determine if they should receive this message
    for (const agent of allAgents) {
      const state = this.getState(agent)
      
      // Don't route to sender
      if (message.from === agent) {
        continue
      }
      
      // Skip if already acked
      if (state.ackedMessageIds.includes(message.id)) {
        continue
      }
      
      // Check if this agent should receive this message
      const priority = this.calculatePriority(message, agent, state)
      if (priority) {
        // Message is relevant - it will appear in inbox
        // (We don't need to store separately; we filter from all messages)
      }
    }
  }

  /**
   * Calculate priority for a message/agent combination
   * Returns null if message is not relevant to this agent
   */
  private calculatePriority(
    message: AgentMessage, 
    agent: string, 
    state: InboxState
  ): { priority: 'high' | 'medium' | 'low'; reason: string } | null {
    // High priority: DM
    if (message.to === agent) {
      return { priority: 'high', reason: 'dm' }
    }
    
    // High priority: @mention
    if (this.isMentioned(message, agent)) {
      return { priority: 'high', reason: 'mention' }
    }
    
    // Medium priority: subscribed channel
    const channel = message.channel || 'general'
    if (state.subscriptions.includes(channel)) {
      return { priority: 'medium', reason: 'subscribed' }
    }
    
    // Low priority: general (not subscribed, but might still be relevant)
    // For now, we only show subscribed channels + mentions/DMs
    return null
  }

  /**
   * Get inbox messages for an agent
   */
  getInbox(
    agent: string,
    allMessages: AgentMessage[],
    options?: {
      priority?: 'high' | 'medium' | 'low'
      limit?: number
      since?: number
    }
  ): InboxMessage[] {
    const state = this.getState(agent)
    
    // Determine the cutoff timestamp: use provided 'since' or lastReadTimestamp
    const cutoffTimestamp = options?.since ?? state.lastReadTimestamp ?? 0
    
    // Filter messages
    let inbox: InboxMessage[] = []
    
    for (const message of allMessages) {
      // Skip sender's own messages
      if (message.from === agent) {
        continue
      }
      
      // Skip acked messages
      if (state.ackedMessageIds.includes(message.id)) {
        continue
      }
      
      // Skip if older than cutoff timestamp
      if (message.timestamp <= cutoffTimestamp) {
        continue
      }
      
      // Calculate priority
      const result = this.calculatePriority(message, agent, state)
      if (!result) {
        continue
      }
      
      // Filter by priority if specified
      if (options?.priority && result.priority !== options.priority) {
        continue
      }
      
      // Add to inbox
      inbox.push({
        ...message,
        priority: result.priority,
        reason: result.reason as any,
      })
    }
    
    // Sort by priority (high first), then timestamp (newest first)
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    inbox.sort((a, b) => {
      if (a.priority !== b.priority) {
        return priorityOrder[a.priority] - priorityOrder[b.priority]
      }
      return b.timestamp - a.timestamp
    })
    
    // Apply limit
    if (options?.limit) {
      inbox = inbox.slice(0, options.limit)
    }
    
    // Auto-update lastReadTimestamp to now
    state.lastReadTimestamp = Date.now()
    state.lastUpdated = Date.now()
    this.persistState(state).catch(err => {
      console.error(`[Inbox] Failed to persist state for ${agent}:`, err)
    })
    
    return inbox
  }

  /**
   * Acknowledge messages (mark as read)
   * Can optionally update lastReadTimestamp
   */
  async ackMessages(agent: string, messageIds?: string[], timestamp?: number): Promise<void> {
    const state = this.getState(agent)
    
    // Add to acked list (avoid duplicates)
    if (messageIds) {
      for (const id of messageIds) {
        if (!state.ackedMessageIds.includes(id)) {
          state.ackedMessageIds.push(id)
        }
      }
    }
    
    // Update lastReadTimestamp if provided
    if (timestamp !== undefined) {
      state.lastReadTimestamp = timestamp
    }
    
    state.lastUpdated = Date.now()
    await this.persistState(state)
  }

  /**
   * Acknowledge all messages
   */
  async ackAll(agent: string, allMessages: AgentMessage[]): Promise<void> {
    const state = this.getState(agent)
    
    // Add all message IDs
    for (const message of allMessages) {
      if (!state.ackedMessageIds.includes(message.id)) {
        state.ackedMessageIds.push(message.id)
      }
    }
    
    state.lastUpdated = Date.now()
    await this.persistState(state)
  }

  /**
   * Update channel subscriptions for an agent
   */
  async updateSubscriptions(agent: string, channels: string[]): Promise<string[]> {
    const state = this.getState(agent)
    state.subscriptions = [...new Set(channels)] // Remove duplicates
    state.lastUpdated = Date.now()
    await this.persistState(state)
    return state.subscriptions
  }

  /**
   * Get channel subscriptions for an agent
   */
  getSubscriptions(agent: string): string[] {
    const state = this.getState(agent)
    return [...state.subscriptions]
  }

  /**
   * Get count of unread mentions for an agent
   */
  getUnreadMentionsCount(agent: string, allMessages: AgentMessage[]): number {
    const state = this.getState(agent)
    let count = 0
    
    for (const message of allMessages) {
      // Skip sender's own messages
      if (message.from === agent) {
        continue
      }
      
      // Skip acked messages
      if (state.ackedMessageIds.includes(message.id)) {
        continue
      }
      
      // Only count mentions (high priority)
      if (this.isMentioned(message, agent)) {
        count++
      }
    }
    
    return count
  }
  
  /**
   * Get unread mentions for an agent
   */
  getUnreadMentions(agent: string, allMessages: AgentMessage[]): InboxMessage[] {
    const state = this.getState(agent)
    const mentions: InboxMessage[] = []
    
    for (const message of allMessages) {
      // Skip sender's own messages
      if (message.from === agent) {
        continue
      }
      
      // Skip acked messages
      if (state.ackedMessageIds.includes(message.id)) {
        continue
      }
      
      // Only include mentions
      if (this.isMentioned(message, agent)) {
        mentions.push({
          ...message,
          priority: 'high',
          reason: 'mention',
        })
      }
    }
    
    // Sort by newest first
    mentions.sort((a, b) => b.timestamp - a.timestamp)
    
    return mentions
  }

  /**
   * Get inbox statistics
   */
  getStats() {
    return {
      agents: this.states.size,
      defaultSubscriptions: DEFAULT_INBOX_SUBSCRIPTIONS,
    }
  }
}

export const inboxManager = new InboxManager()
