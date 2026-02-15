/**
 * Mention Ack Reliability Rail
 *
 * Tracks @mention → acknowledgment lifecycle:
 * 1. When a message @mentions an agent → creates a pending ack entry
 * 2. When that agent posts in the same channel → resolves the ack, records latency
 * 3. If ack timeout exceeded → marks as timed out for escalation
 *
 * Exposes ack-latency metrics for health/compliance reporting.
 */

export interface MentionAckEntry {
  id: string
  mentionedAgent: string
  mentionedBy: string
  messageId: string
  channel: string
  content: string
  createdAt: number
  ackedAt: number | null
  latencyMs: number | null
  status: 'pending' | 'acked' | 'timeout'
}

export interface MentionAckMetrics {
  totalMentions: number
  totalAcked: number
  totalTimeout: number
  totalPending: number
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  byAgent: Record<string, {
    mentions: number
    acked: number
    timeout: number
    pending: number
    avgLatencyMs: number | null
  }>
}

const ACK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const MAX_ENTRIES = 500 // rolling window
const MENTION_REGEX = /@(\w+)/g

class MentionAckTracker {
  private entries: MentionAckEntry[] = []
  private pendingByAgent = new Map<string, MentionAckEntry[]>()

  /**
   * Record a new message and track any @mentions in it.
   * Returns list of agents who were mentioned.
   */
  recordMessage(msg: {
    id: string
    from: string
    content: string
    channel: string
    timestamp?: number
  }): string[] {
    const mentions = this.extractMentions(msg.content)
    const sender = msg.from.toLowerCase()
    const now = msg.timestamp || Date.now()

    // If the sender has pending mentions in this channel, ack them
    this.ackAgent(sender, msg.channel, now)

    // Track new mentions (don't track self-mentions)
    const newMentions: string[] = []
    for (const agent of mentions) {
      if (agent === sender) continue // skip self-mentions

      const entry: MentionAckEntry = {
        id: `mack-${now}-${agent}-${Math.random().toString(36).slice(2, 8)}`,
        mentionedAgent: agent,
        mentionedBy: sender,
        messageId: msg.id,
        channel: msg.channel,
        content: msg.content.slice(0, 200),
        createdAt: now,
        ackedAt: null,
        latencyMs: null,
        status: 'pending',
      }

      this.entries.push(entry)

      const pending = this.pendingByAgent.get(agent) || []
      pending.push(entry)
      this.pendingByAgent.set(agent, pending)

      newMentions.push(agent)
    }

    // Trim old entries
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES)
    }

    return newMentions
  }

  /**
   * Mark all pending mentions for an agent in a channel as acknowledged.
   */
  ackAgent(agent: string, channel: string, now = Date.now()): number {
    const pending = this.pendingByAgent.get(agent)
    if (!pending || pending.length === 0) return 0

    let ackedCount = 0
    const remaining: MentionAckEntry[] = []

    for (const entry of pending) {
      if (entry.channel === channel && entry.status === 'pending') {
        entry.status = 'acked'
        entry.ackedAt = now
        entry.latencyMs = now - entry.createdAt
        ackedCount++
      } else {
        remaining.push(entry)
      }
    }

    if (remaining.length === 0) {
      this.pendingByAgent.delete(agent)
    } else {
      this.pendingByAgent.set(agent, remaining)
    }

    return ackedCount
  }

  /**
   * Check for timed-out mentions and mark them.
   * Returns agents with timed-out mentions for escalation.
   */
  checkTimeouts(now = Date.now()): Array<{ agent: string; entry: MentionAckEntry }> {
    const timedOut: Array<{ agent: string; entry: MentionAckEntry }> = []

    for (const [agent, pending] of this.pendingByAgent.entries()) {
      const remaining: MentionAckEntry[] = []
      for (const entry of pending) {
        if (entry.status === 'pending' && now - entry.createdAt > ACK_TIMEOUT_MS) {
          entry.status = 'timeout'
          timedOut.push({ agent, entry })
        } else {
          remaining.push(entry)
        }
      }
      if (remaining.length === 0) {
        this.pendingByAgent.delete(agent)
      } else {
        this.pendingByAgent.set(agent, remaining)
      }
    }

    return timedOut
  }

  /**
   * Get pending mentions for a specific agent.
   */
  getPending(agent: string): MentionAckEntry[] {
    return (this.pendingByAgent.get(agent) || []).filter(e => e.status === 'pending')
  }

  /**
   * Get ack-latency metrics for health/compliance reporting.
   */
  getMetrics(): MentionAckMetrics {
    const byAgent: MentionAckMetrics['byAgent'] = {}
    const latencies: number[] = []

    for (const entry of this.entries) {
      const agent = entry.mentionedAgent
      if (!byAgent[agent]) {
        byAgent[agent] = { mentions: 0, acked: 0, timeout: 0, pending: 0, avgLatencyMs: null }
      }

      byAgent[agent].mentions++

      if (entry.status === 'acked') {
        byAgent[agent].acked++
        if (entry.latencyMs !== null) {
          latencies.push(entry.latencyMs)
        }
      } else if (entry.status === 'timeout') {
        byAgent[agent].timeout++
      } else {
        byAgent[agent].pending++
      }
    }

    // Compute per-agent avg latency
    for (const agent of Object.keys(byAgent)) {
      const agentLatencies = this.entries
        .filter(e => e.mentionedAgent === agent && e.latencyMs !== null)
        .map(e => e.latencyMs!)
      if (agentLatencies.length > 0) {
        byAgent[agent].avgLatencyMs = Math.round(
          agentLatencies.reduce((a, b) => a + b, 0) / agentLatencies.length
        )
      }
    }

    // Global stats
    const totalMentions = this.entries.length
    const totalAcked = this.entries.filter(e => e.status === 'acked').length
    const totalTimeout = this.entries.filter(e => e.status === 'timeout').length
    const totalPending = this.entries.filter(e => e.status === 'pending').length

    const avgLatencyMs = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null

    const p95LatencyMs = latencies.length > 0
      ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)]
      : null

    return {
      totalMentions,
      totalAcked,
      totalTimeout,
      totalPending,
      avgLatencyMs,
      p95LatencyMs,
      byAgent,
    }
  }

  /**
   * Get recent entries (for debugging/inspection).
   */
  getRecent(limit = 20): MentionAckEntry[] {
    return this.entries.slice(-limit)
  }

  private extractMentions(content: string): string[] {
    const matches = [...content.matchAll(MENTION_REGEX)]
    return [...new Set(matches.map(m => m[1].toLowerCase()))]
  }
}

export const mentionAckTracker = new MentionAckTracker()
