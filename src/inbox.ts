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
import { INBOX_DIR } from './config.js'
import { eventBus } from './events.js'
import { DEFAULT_INBOX_SUBSCRIPTIONS } from './channels.js'

class InboxManager {
  private states = new Map<string, InboxState>()
  private initialized = false

  constructor() {
    this.loadStates().catch(err => {
      console.error('[Inbox] Failed to load inbox states:', err)
    })
  }

  /**
   * Load all inbox states from disk
   */
  private async loadStates(): Promise<void> {
    try {
      await fs.mkdir(INBOX_DIR, { recursive: true })

      const files = await fs.readdir(INBOX_DIR)
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(join(INBOX_DIR, file), 'utf-8')
            const state = JSON.parse(content) as InboxState
            this.states.set(state.agent, state)
          } catch (err) {
            console.error(`[Inbox] Failed to load state for ${file}:`, err)
          }
        }
      }
      
      console.log(`[Inbox] Loaded ${this.states.size} inbox states from disk`)
    } finally {
      this.initialized = true
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
   * Persist a single inbox state to disk
   */
  private async persistState(state: InboxState): Promise<void> {
    try {
      await fs.mkdir(INBOX_DIR, { recursive: true })
      const path = join(INBOX_DIR, `${state.agent}.json`)
      await fs.writeFile(path, JSON.stringify(state, null, 2), 'utf-8')
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
