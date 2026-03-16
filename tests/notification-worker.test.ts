import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NotificationDeliveryWorker } from '../src/notification-worker.js'
import type Database from 'better-sqlite3'

// Mock DB that stores notifications in memory
function createMockDb() {
  const notifications: Array<Record<string, unknown>> = []

  const mockStmt = (sql: string) => {
    return {
      run: (...args: unknown[]) => {
        if (sql.includes('UPDATE') && sql.includes("status = 'expired'")) {
          let changes = 0
          for (const n of notifications) {
            if (n.status === 'pending') {
              if (sql.includes('expires_at IS NOT NULL') && n.expires_at && (n.expires_at as number) < (args[0] as number)) {
                n.status = 'expired'; changes++
              } else if (sql.includes('expires_at IS NULL') && !n.expires_at && (n.created_at as number) < (args[0] as number)) {
                n.status = 'expired'; changes++
              }
            }
          }
          return { changes }
        }
        if (sql.includes('UPDATE') && sql.includes("status = 'delivered'")) {
          const id = args[1] as string
          const n = notifications.find(x => x.id === id)
          if (n) { n.status = 'delivered'; n.ack_at = args[0] }
          return { changes: n ? 1 : 0 }
        }
        if (sql.includes('UPDATE') && sql.includes("status = 'failed'")) {
          const id = args[1] as string
          const n = notifications.find(x => x.id === id)
          if (n) n.status = 'failed'
          return { changes: n ? 1 : 0 }
        }
        return { changes: 0 }
      },
      all: (..._args: unknown[]) => {
        if (sql.includes('SELECT')) {
          return notifications.filter(n => n.status === 'pending').slice(0, 20)
        }
        return []
      },
    }
  }

  const db = {
    prepare: (sql: string) => mockStmt(sql),
    _notifications: notifications,
  } as unknown as Database.Database & { _notifications: typeof notifications }

  return db
}

// Mock presence manager
function createMockPresence(statuses: Record<string, string> = {}) {
  return {
    getPresence: (agent: string) => {
      const status = statuses[agent]
      if (!status) return null
      return { agent, status, since: Date.now(), lastUpdate: Date.now() }
    },
  } as any
}

describe('NotificationDeliveryWorker', () => {
  let db: ReturnType<typeof createMockDb>
  let sendMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = createMockDb()
    sendMessage = vi.fn().mockResolvedValue({})
  })

  it('delivers pending notifications to active agents', async () => {
    db._notifications.push({
      id: 'notif-1', target_agent: 'link', source_agent: 'kai',
      type: 'task', title: 'Review PR', body: null,
      priority: 'medium', status: 'pending', ack_decision: null, ack_at: null,
      task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
    })

    const presence = createMockPresence({ link: 'idle' }) // open budget
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    const results = await worker.tick()
    expect(results).toHaveLength(1)
    expect(results[0].delivered).toBe(true)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(db._notifications[0].status).toBe('delivered')
  })

  it('skips offline agents (closed budget)', async () => {
    db._notifications.push({
      id: 'notif-2', target_agent: 'pixel', source_agent: null,
      type: 'info', title: 'Low priority', body: null,
      priority: 'low', status: 'pending', ack_decision: null, ack_at: null,
      task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
    })

    const presence = createMockPresence({ pixel: 'offline' }) // closed budget
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    const results = await worker.tick()
    expect(results).toHaveLength(1)
    expect(results[0].delivered).toBe(false)
    expect(results[0].reason).toContain('budget=closed')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('delivers critical notifications even to offline agents', async () => {
    db._notifications.push({
      id: 'notif-3', target_agent: 'sage', source_agent: null,
      type: 'alert', title: 'Production down', body: null,
      priority: 'critical', status: 'pending', ack_decision: null, ack_at: null,
      task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
    })

    const presence = createMockPresence({ sage: 'offline' })
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    const results = await worker.tick()
    expect(results).toHaveLength(1)
    expect(results[0].delivered).toBe(true)
  })

  it('respects focused budget — allows high but not medium', async () => {
    db._notifications.push(
      {
        id: 'notif-high', target_agent: 'link', source_agent: null,
        type: 'alert', title: 'High priority', body: null,
        priority: 'high', status: 'pending', ack_decision: null, ack_at: null,
        task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
      },
      {
        id: 'notif-med', target_agent: 'link', source_agent: null,
        type: 'info', title: 'Medium priority', body: null,
        priority: 'medium', status: 'pending', ack_decision: null, ack_at: null,
        task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
      },
    )

    const presence = createMockPresence({ link: 'working' }) // focused budget
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    const results = await worker.tick()
    expect(results).toHaveLength(2)
    expect(results.find(r => r.notificationId === 'notif-high')?.delivered).toBe(true)
    expect(results.find(r => r.notificationId === 'notif-med')?.delivered).toBe(false)
  })

  it('returns empty results when no pending notifications', async () => {
    const presence = createMockPresence({})
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    const results = await worker.tick()
    expect(results).toHaveLength(0)
  })

  it('retries on first failure then marks failed', async () => {
    db._notifications.push({
      id: 'notif-fail', target_agent: 'link', source_agent: null,
      type: 'info', title: 'Will fail', body: null,
      priority: 'medium', status: 'pending', ack_decision: null, ack_at: null,
      task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
    })

    const presence = createMockPresence({ link: 'idle' })
    sendMessage.mockRejectedValue(new Error('delivery failed'))
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    const results = await worker.tick()
    expect(results).toHaveLength(1)
    expect(results[0].delivered).toBe(false)
    expect(sendMessage).toHaveBeenCalledTimes(2) // original + 1 retry
    expect(db._notifications[0].status).toBe('failed')
  })

  it('tracks stats correctly', async () => {
    db._notifications.push({
      id: 'notif-stat', target_agent: 'link', source_agent: null,
      type: 'info', title: 'Stats test', body: null,
      priority: 'medium', status: 'pending', ack_decision: null, ack_at: null,
      task_id: null, metadata: null, created_at: Date.now(), expires_at: null,
    })

    const presence = createMockPresence({ link: 'idle' })
    const worker = new NotificationDeliveryWorker(() => db, presence, sendMessage)

    await worker.tick()
    const stats = worker.getStats()
    expect(stats.ticks).toBe(1)
    expect(stats.delivered).toBe(1)
    expect(stats.running).toBe(false) // not started
  })
})
