import { describe, it, expect, beforeEach } from 'vitest'
import {
  calendarManager,
  type CreateBlockInput,
} from '../src/calendar.js'

// Helper to clean up blocks between tests
function clearAllBlocks() {
  const blocks = calendarManager.listBlocks()
  for (const block of blocks) {
    calendarManager.deleteBlock(block.id)
  }
}

describe('Calendar', () => {
  beforeEach(() => {
    clearAllBlocks()
  })

  describe('CRUD', () => {
    it('creates a one-off block', () => {
      const now = Date.now()
      const block = calendarManager.createBlock({
        agent: 'link',
        type: 'focus',
        title: 'Deep work',
        start: now,
        end: now + 2 * 60 * 60 * 1000, // 2 hours
      })

      expect(block.id).toMatch(/^cal-/)
      expect(block.agent).toBe('link')
      expect(block.type).toBe('focus')
      expect(block.title).toBe('Deep work')
      expect(block.recurring).toBeNull()
    })

    it('creates a recurring block', () => {
      const block = calendarManager.createBlock({
        agent: 'ryan',
        type: 'busy',
        title: 'Standup',
        start: 540, // 9:00 AM
        end: 570,   // 9:30 AM
        recurring: 'mon,tue,wed,thu,fri',
        timezone: 'America/Vancouver',
      })

      expect(block.recurring).toBe('mon,tue,wed,thu,fri')
      expect(block.timezone).toBe('America/Vancouver')
      expect(block.start).toBe(540)
      expect(block.end).toBe(570)
    })

    it('lists blocks filtered by agent', () => {
      calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'A', start: 100, end: 200, recurring: 'mon' })
      calendarManager.createBlock({ agent: 'pixel', type: 'busy', title: 'B', start: 100, end: 200, recurring: 'mon' })
      calendarManager.createBlock({ agent: 'link', type: 'ooo', title: 'C', start: 100, end: 200, recurring: 'tue' })

      const linkBlocks = calendarManager.listBlocks({ agent: 'link' })
      expect(linkBlocks).toHaveLength(2)
      expect(linkBlocks.every(b => b.agent === 'link')).toBe(true)
    })

    it('lists blocks filtered by type', () => {
      calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'A', start: 100, end: 200, recurring: 'mon' })
      calendarManager.createBlock({ agent: 'link', type: 'busy', title: 'B', start: 300, end: 400, recurring: 'tue' })

      const focusBlocks = calendarManager.listBlocks({ type: 'focus' })
      expect(focusBlocks).toHaveLength(1)
      expect(focusBlocks[0].type).toBe('focus')
    })

    it('updates a block', () => {
      const block = calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'Old', start: 100, end: 200, recurring: 'mon' })
      const updated = calendarManager.updateBlock(block.id, { title: 'New title', type: 'busy' })

      expect(updated).not.toBeNull()
      expect(updated!.title).toBe('New title')
      expect(updated!.type).toBe('busy')
      expect(updated!.updated_at).toBeGreaterThanOrEqual(block.updated_at)
    })

    it('returns null when updating non-existent block', () => {
      const result = calendarManager.updateBlock('cal-nonexistent', { title: 'Nope' })
      expect(result).toBeNull()
    })

    it('deletes a block', () => {
      const block = calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'Delete me', start: 100, end: 200, recurring: 'mon' })
      expect(calendarManager.deleteBlock(block.id)).toBe(true)
      expect(calendarManager.getBlock(block.id)).toBeNull()
    })

    it('returns false when deleting non-existent block', () => {
      expect(calendarManager.deleteBlock('cal-nonexistent')).toBe(false)
    })
  })

  describe('Validation', () => {
    it('rejects missing agent', () => {
      expect(() => calendarManager.createBlock({
        agent: '',
        type: 'focus',
        title: 'Bad',
        start: 100,
        end: 200,
      })).toThrow('agent is required')
    })

    it('rejects invalid block type', () => {
      expect(() => calendarManager.createBlock({
        agent: 'link',
        type: 'invalid' as any,
        title: 'Bad',
        start: 100,
        end: 200,
      })).toThrow('type must be one of')
    })

    it('rejects one-off block where end <= start', () => {
      expect(() => calendarManager.createBlock({
        agent: 'link',
        type: 'focus',
        title: 'Bad',
        start: 200,
        end: 100,
      })).toThrow('end must be after start')
    })

    it('rejects invalid recurring day', () => {
      expect(() => calendarManager.createBlock({
        agent: 'link',
        type: 'focus',
        title: 'Bad',
        start: 100,
        end: 200,
        recurring: 'mon,funday',
      })).toThrow('Invalid recurring day')
    })

    it('rejects recurring block with out-of-range minutes', () => {
      expect(() => calendarManager.createBlock({
        agent: 'link',
        type: 'focus',
        title: 'Bad',
        start: 1500, // > 1439
        end: 200,
        recurring: 'mon',
      })).toThrow('minutes from midnight')
    })
  })

  describe('Availability', () => {
    it('returns free when no blocks exist', () => {
      const status = calendarManager.getAgentAvailability('link')
      expect(status.status).toBe('free')
      expect(status.current_block).toBeNull()
    })

    it('detects active one-off block', () => {
      const now = Date.now()
      calendarManager.createBlock({
        agent: 'link',
        type: 'focus',
        title: 'Deep work',
        start: now - 1000,
        end: now + 60 * 60 * 1000,
      })

      const status = calendarManager.getAgentAvailability('link', now)
      expect(status.status).toBe('focus')
      expect(status.current_block).not.toBeNull()
      expect(status.current_block!.title).toBe('Deep work')
    })

    it('returns free when one-off block has ended', () => {
      const now = Date.now()
      calendarManager.createBlock({
        agent: 'link',
        type: 'focus',
        title: 'Past block',
        start: now - 2 * 60 * 60 * 1000,
        end: now - 1000,
      })

      const status = calendarManager.getAgentAvailability('link', now)
      expect(status.status).toBe('free')
    })

    it('team availability includes all agents with blocks', () => {
      const now = Date.now()
      calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'Work', start: now - 1000, end: now + 60000 })
      calendarManager.createBlock({ agent: 'pixel', type: 'ooo', title: 'Vacation', start: now - 1000, end: now + 60000 })

      const team = calendarManager.getTeamAvailability(now)
      expect(team).toHaveLength(2)
      const linkStatus = team.find(a => a.agent === 'link')
      const pixelStatus = team.find(a => a.agent === 'pixel')
      expect(linkStatus?.status).toBe('focus')
      expect(pixelStatus?.status).toBe('ooo')
    })
  })

  describe('Ping gating', () => {
    it('high urgency always pings', () => {
      const now = Date.now()
      calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'Focus', start: now - 1000, end: now + 60000 })

      const decision = calendarManager.shouldPing('link', 'high')
      expect(decision.should_ping).toBe(true)
      expect(decision.reason).toContain('High urgency')
    })

    it('normal urgency blocked by focus', () => {
      const now = Date.now()
      calendarManager.createBlock({ agent: 'link', type: 'focus', title: 'Deep work', start: now - 1000, end: now + 60000 })

      const decision = calendarManager.shouldPing('link', 'normal')
      expect(decision.should_ping).toBe(false)
      expect(decision.delay_until).toBeGreaterThan(now)
    })

    it('normal urgency allowed when busy (not focus)', () => {
      const now = Date.now()
      calendarManager.createBlock({ agent: 'link', type: 'busy', title: 'Meeting', start: now - 1000, end: now + 60000 })

      const decision = calendarManager.shouldPing('link', 'normal')
      expect(decision.should_ping).toBe(true)
    })

    it('low urgency blocked by busy', () => {
      const now = Date.now()
      calendarManager.createBlock({ agent: 'link', type: 'busy', title: 'Meeting', start: now - 1000, end: now + 60000 })

      const decision = calendarManager.shouldPing('link', 'low')
      expect(decision.should_ping).toBe(false)
    })

    it('ooo blocks all non-high pings', () => {
      const now = Date.now()
      calendarManager.createBlock({ agent: 'link', type: 'ooo', title: 'Vacation', start: now - 1000, end: now + 60000 })

      expect(calendarManager.shouldPing('link', 'normal').should_ping).toBe(false)
      expect(calendarManager.shouldPing('link', 'low').should_ping).toBe(false)
      expect(calendarManager.shouldPing('link', 'high').should_ping).toBe(true)
    })

    it('pings freely when no blocks', () => {
      const decision = calendarManager.shouldPing('link', 'low')
      expect(decision.should_ping).toBe(true)
      expect(decision.reason).toContain('free')
    })
  })
})
