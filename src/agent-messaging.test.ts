// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

interface Message { id: string; from: string; to: string; channel: string; content: string; readAt: number | null }

class InMemoryMessageStore {
  private messages: Message[] = []
  private counter = 0

  send(from: string, to: string, content: string, channel = 'direct'): Message {
    const msg: Message = { id: `amsg-${++this.counter}`, from, to, channel, content, readAt: null }
    this.messages.push(msg)
    return msg
  }

  inbox(agentId: string, opts?: { unreadOnly?: boolean; channel?: string }): Message[] {
    let result = this.messages.filter(m => m.to === agentId)
    if (opts?.unreadOnly) result = result.filter(m => m.readAt === null)
    if (opts?.channel) result = result.filter(m => m.channel === opts.channel)
    return result
  }

  sent(agentId: string): Message[] {
    return this.messages.filter(m => m.from === agentId)
  }

  markRead(agentId: string, ids?: string[]): number {
    let count = 0
    for (const m of this.messages) {
      if (m.to !== agentId || m.readAt !== null) continue
      if (!ids || ids.includes(m.id)) { m.readAt = Date.now(); count++ }
    }
    return count
  }

  unreadCount(agentId: string): number {
    return this.messages.filter(m => m.to === agentId && m.readAt === null).length
  }

  channel(ch: string): Message[] {
    return this.messages.filter(m => m.channel === ch)
  }

  clear() { this.messages = []; this.counter = 0 }
}

describe('agent messaging', () => {
  let store: InMemoryMessageStore

  beforeEach(() => { store = new InMemoryMessageStore() })

  it('sends a direct message', () => {
    const msg = store.send('link', 'kai', 'PR #879 ready for review')
    assert.equal(msg.from, 'link')
    assert.equal(msg.to, 'kai')
    assert.equal(msg.channel, 'direct')
    assert.equal(msg.readAt, null)
  })

  it('shows in recipient inbox', () => {
    store.send('link', 'kai', 'Hello')
    const inbox = store.inbox('kai')
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].content, 'Hello')
  })

  it('does not show in sender inbox', () => {
    store.send('link', 'kai', 'Hello')
    assert.equal(store.inbox('link').length, 0)
  })

  it('shows in sender sent', () => {
    store.send('link', 'kai', 'Hello')
    assert.equal(store.sent('link').length, 1)
  })

  it('tracks unread count', () => {
    store.send('link', 'kai', 'msg1')
    store.send('pixel', 'kai', 'msg2')
    assert.equal(store.unreadCount('kai'), 2)
  })

  it('marks specific messages read', () => {
    const m1 = store.send('link', 'kai', 'msg1')
    store.send('pixel', 'kai', 'msg2')
    store.markRead('kai', [m1.id])
    assert.equal(store.unreadCount('kai'), 1)
  })

  it('marks all messages read', () => {
    store.send('link', 'kai', 'msg1')
    store.send('pixel', 'kai', 'msg2')
    store.markRead('kai')
    assert.equal(store.unreadCount('kai'), 0)
  })

  it('filters unread only', () => {
    store.send('link', 'kai', 'msg1')
    const m2 = store.send('pixel', 'kai', 'msg2')
    store.markRead('kai', [m2.id])
    const unread = store.inbox('kai', { unreadOnly: true })
    assert.equal(unread.length, 1)
  })

  it('supports channel messages', () => {
    store.send('link', 'team', 'broadcast', 'shipping')
    store.send('pixel', 'team', 'design update', 'shipping')
    store.send('kai', 'team', 'ops note', 'general')
    assert.equal(store.channel('shipping').length, 2)
    assert.equal(store.channel('general').length, 1)
  })

  it('filters inbox by channel', () => {
    store.send('link', 'kai', 'direct msg')
    store.send('link', 'kai', 'channel msg', 'reviews')
    assert.equal(store.inbox('kai', { channel: 'reviews' }).length, 1)
    assert.equal(store.inbox('kai', { channel: 'direct' }).length, 1)
  })
})
