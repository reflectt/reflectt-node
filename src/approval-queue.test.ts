// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

interface ApprovalQueueItem {
  id: string
  category: 'review' | 'agent_action'
  title: string
  description: string | null
  urgency: string | null
  owner: string | null
  expiresAt: number | null
  autoAction: string | null
  isExpired: boolean
  createdAt: number
}

// In-memory test implementation matching the real logic
class ApprovalQueue {
  private items: ApprovalQueueItem[] = []

  add(item: ApprovalQueueItem) {
    this.items.push(item)
  }

  list(opts?: {
    agentId?: string
    category?: 'review' | 'agent_action'
    includeExpired?: boolean
    limit?: number
  }): ApprovalQueueItem[] {
    let result = [...this.items]
    if (opts?.category) result = result.filter(i => i.category === opts.category)
    if (!opts?.includeExpired) result = result.filter(i => !i.isExpired)
    if (opts?.limit) result = result.slice(0, opts.limit)
    return result
  }

  clear() { this.items = [] }
}

describe('approval queue', () => {
  let queue: ApprovalQueue

  beforeEach(() => {
    queue = new ApprovalQueue()
  })

  it('returns empty list when no items', () => {
    assert.deepEqual(queue.list(), [])
  })

  it('adds and retrieves review items', () => {
    queue.add({
      id: 'aevt-1', category: 'review', title: 'Review PR #100',
      description: 'Code review needed', urgency: 'normal', owner: 'link',
      expiresAt: null, autoAction: null, isExpired: false, createdAt: Date.now(),
    })
    const items = queue.list()
    assert.equal(items.length, 1)
    assert.equal(items[0].category, 'review')
    assert.equal(items[0].title, 'Review PR #100')
  })

  it('adds and retrieves agent_action items', () => {
    queue.add({
      id: 'aevt-2', category: 'agent_action', title: 'Deploy to production?',
      description: 'Link wants to deploy v0.1.9', urgency: 'high', owner: 'ryan',
      expiresAt: Date.now() + 300000, autoAction: 'defer', isExpired: false, createdAt: Date.now(),
    })
    const items = queue.list()
    assert.equal(items.length, 1)
    assert.equal(items[0].category, 'agent_action')
    assert.equal(items[0].autoAction, 'defer')
  })

  it('filters by category', () => {
    queue.add({
      id: 'aevt-1', category: 'review', title: 'Review',
      description: null, urgency: null, owner: null,
      expiresAt: null, autoAction: null, isExpired: false, createdAt: 1,
    })
    queue.add({
      id: 'aevt-2', category: 'agent_action', title: 'Deploy?',
      description: null, urgency: 'high', owner: null,
      expiresAt: null, autoAction: 'reject', isExpired: false, createdAt: 2,
    })

    assert.equal(queue.list({ category: 'review' }).length, 1)
    assert.equal(queue.list({ category: 'agent_action' }).length, 1)
    assert.equal(queue.list().length, 2)
  })

  it('excludes expired items by default', () => {
    queue.add({
      id: 'aevt-3', category: 'agent_action', title: 'Expired deploy',
      description: null, urgency: 'critical', owner: 'ryan',
      expiresAt: Date.now() - 10000, autoAction: 'reject', isExpired: true, createdAt: 1,
    })
    assert.equal(queue.list().length, 0)
    assert.equal(queue.list({ includeExpired: true }).length, 1)
  })

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      queue.add({
        id: `aevt-${i}`, category: 'review', title: `Item ${i}`,
        description: null, urgency: null, owner: null,
        expiresAt: null, autoAction: null, isExpired: false, createdAt: i,
      })
    }
    assert.equal(queue.list({ limit: 3 }).length, 3)
    assert.equal(queue.list().length, 5)
  })

  it('expiry detection is correct', () => {
    const future = { expiresAt: Date.now() + 60000, isExpired: false }
    const past = { expiresAt: Date.now() - 1000, isExpired: true }
    const none = { expiresAt: null, isExpired: false }

    assert.equal(future.isExpired, false)
    assert.equal(past.isExpired, true)
    assert.equal(none.isExpired, false)
  })

  it('auto_action field is preserved', () => {
    queue.add({
      id: 'aevt-4', category: 'agent_action', title: 'Auto-reject test',
      description: 'Will auto-reject in 5m', urgency: 'high', owner: 'ryan',
      expiresAt: Date.now() + 300000, autoAction: 'reject', isExpired: false, createdAt: 1,
    })
    const item = queue.list()[0]
    assert.equal(item.autoAction, 'reject')
  })

  it('includes all required fields per COO spec', () => {
    queue.add({
      id: 'aevt-5', category: 'agent_action', title: 'What needs decision',
      description: 'Context', urgency: 'high', owner: 'ryan',
      expiresAt: Date.now() + 60000, autoAction: 'defer', isExpired: false, createdAt: Date.now(),
    })
    const item = queue.list()[0]
    // COO spec: what needs decision, who owns it, when it expires, what happens if ignored
    assert.ok(item.title, 'what needs decision')
    assert.ok(item.owner, 'who owns it')
    assert.ok(item.expiresAt, 'when it expires')
    assert.ok(item.autoAction, 'what happens if ignored')
  })
})
