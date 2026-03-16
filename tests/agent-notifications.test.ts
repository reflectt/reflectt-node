// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  createNotification,
  ackNotification,
  getNotifications,
  getNotificationById,
  generateNotificationId,
} from '../src/agent-notifications.js'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE agent_notifications (
      id            TEXT PRIMARY KEY,
      target_agent  TEXT NOT NULL,
      source_agent  TEXT,
      type          TEXT NOT NULL DEFAULT 'info',
      title         TEXT NOT NULL,
      body          TEXT,
      priority      TEXT NOT NULL DEFAULT 'medium',
      status        TEXT NOT NULL DEFAULT 'pending',
      ack_decision  TEXT,
      ack_at        INTEGER,
      task_id       TEXT,
      metadata      TEXT,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER
    );
    CREATE INDEX idx_agent_notif_target ON agent_notifications(target_agent, status);
  `)
  return db
}

describe('agent-notifications', () => {
  let db: Database.Database

  beforeEach(() => {
    db = setupDb()
  })

  describe('generateNotificationId', () => {
    it('produces unique prefixed IDs', () => {
      const a = generateNotificationId()
      const b = generateNotificationId()
      expect(a).toMatch(/^notif-\d+-[a-z0-9]+$/)
      expect(a).not.toBe(b)
    })
  })

  describe('createNotification', () => {
    it('creates a notification with required fields', () => {
      const notif = createNotification(db, {
        target_agent: 'link',
        title: 'Review PR #100',
      })

      expect(notif.id).toMatch(/^notif-/)
      expect(notif.target_agent).toBe('link')
      expect(notif.title).toBe('Review PR #100')
      expect(notif.status).toBe('pending')
      expect(notif.type).toBe('info')
      expect(notif.priority).toBe('medium')
      expect(notif.ack_decision).toBeNull()
    })

    it('creates with all optional fields', () => {
      const notif = createNotification(db, {
        target_agent: 'link',
        source_agent: 'kai',
        type: 'review',
        title: 'Review needed',
        body: 'Please review PR #200',
        priority: 'high',
        task_id: 'task-123',
        metadata: { pr: 200 },
        expires_at: Date.now() + 86400000,
      })

      expect(notif.source_agent).toBe('kai')
      expect(notif.type).toBe('review')
      expect(notif.body).toBe('Please review PR #200')
      expect(notif.priority).toBe('high')
      expect(notif.task_id).toBe('task-123')
      expect(notif.metadata).toEqual({ pr: 200 })
      expect(notif.expires_at).toBeGreaterThan(Date.now())
    })

    it('persists to database', () => {
      const notif = createNotification(db, {
        target_agent: 'link',
        title: 'Test',
      })

      const fetched = getNotificationById(db, notif.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.title).toBe('Test')
    })
  })

  describe('ackNotification', () => {
    it('acks a pending notification', () => {
      const notif = createNotification(db, {
        target_agent: 'link',
        title: 'Ack me',
      })

      const acked = ackNotification(db, notif.id, 'accept')
      expect(acked).not.toBeNull()
      expect(acked!.status).toBe('acked')
      expect(acked!.ack_decision).toBe('accept')
      expect(acked!.ack_at).toBeGreaterThan(0)
    })

    it('returns null for already-acked notification', () => {
      const notif = createNotification(db, {
        target_agent: 'link',
        title: 'Ack me once',
      })

      ackNotification(db, notif.id, 'seen')
      const result = ackNotification(db, notif.id, 'dismiss')
      expect(result).toBeNull()
    })

    it('returns null for non-existent notification', () => {
      const result = ackNotification(db, 'notif-doesnotexist', 'seen')
      expect(result).toBeNull()
    })
  })

  describe('getNotifications', () => {
    it('returns pending notifications for an agent', () => {
      createNotification(db, { target_agent: 'link', title: 'A' })
      createNotification(db, { target_agent: 'link', title: 'B' })
      createNotification(db, { target_agent: 'kai', title: 'C' })

      const result = getNotifications(db, 'link')
      expect(result.total).toBe(2)
      expect(result.notifications).toHaveLength(2)
      expect(result.notifications.every(n => n.target_agent === 'link')).toBe(true)
    })

    it('filters by status', () => {
      const notif = createNotification(db, { target_agent: 'link', title: 'Will ack' })
      createNotification(db, { target_agent: 'link', title: 'Still pending' })
      ackNotification(db, notif.id, 'seen')

      const pending = getNotifications(db, 'link', { status: 'pending' })
      expect(pending.total).toBe(1)
      expect(pending.notifications[0].title).toBe('Still pending')

      const acked = getNotifications(db, 'link', { status: 'acked' })
      expect(acked.total).toBe(1)
      expect(acked.notifications[0].title).toBe('Will ack')
    })

    it('orders by priority then created_at', () => {
      createNotification(db, { target_agent: 'link', title: 'Low', priority: 'low' })
      createNotification(db, { target_agent: 'link', title: 'Critical', priority: 'critical' })
      createNotification(db, { target_agent: 'link', title: 'High', priority: 'high' })

      const result = getNotifications(db, 'link')
      expect(result.notifications[0].title).toBe('Critical')
      expect(result.notifications[1].title).toBe('High')
      expect(result.notifications[2].title).toBe('Low')
    })

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        createNotification(db, { target_agent: 'link', title: `N${i}` })
      }

      const result = getNotifications(db, 'link', { limit: 3 })
      expect(result.notifications).toHaveLength(3)
      expect(result.total).toBe(10)
    })
  })
})
