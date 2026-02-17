import { describe, it, expect, beforeEach } from 'vitest'
import { validateSlotEvent, processRender, logRejection, getRecentRejections, subscribeCanvas } from '../src/canvas-multiplexer.js'
import { slotManager } from '../src/canvas-slots.js'
import type { SlotEvent } from '../src/canvas-types.js'

function makeValidEvent(overrides?: Partial<SlotEvent>): SlotEvent {
  return {
    slot: 'agent_lane:link',
    content_type: 'text.brief',
    priority: 'normal',
    payload: {
      id: `test-${Date.now()}`,
      priority: 'p1',
      updated_at: new Date().toISOString(),
      decision_signal: {
        kind: 'status',
        why_now: 'Agent is active and working',
      },
      evidence: [],
      body: 'Building canvas primitives',
    },
    ...overrides,
  }
}

describe('Canvas Contract Validation', () => {
  it('accepts a valid render event', () => {
    const result = validateSlotEvent(makeValidEvent())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects invalid slot type', () => {
    const result = validateSlotEvent(makeValidEvent({ slot: 'invalid_slot' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid slot')
  })

  it('accepts agent_lane:<id> slots', () => {
    const result = validateSlotEvent(makeValidEvent({ slot: 'agent_lane:pixel' }))
    expect(result.valid).toBe(true)
  })

  it('accepts all allowed slot types', () => {
    for (const slot of ['objective', 'narrative', 'risk', 'action', 'evidence', 'input', 'status']) {
      const result = validateSlotEvent(makeValidEvent({ slot: slot as any }))
      expect(result.valid).toBe(true)
    }
  })

  it('rejects invalid content type', () => {
    const result = validateSlotEvent(makeValidEvent({ content_type: 'video.full' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Invalid content_type')
  })

  it('rejects missing decision_signal', () => {
    const event = makeValidEvent()
    delete (event.payload as any).decision_signal
    const result = validateSlotEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('decision_signal'))).toBe(true)
  })

  it('rejects empty why_now', () => {
    const event = makeValidEvent()
    event.payload.decision_signal.why_now = ''
    const result = validateSlotEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('why_now'))).toBe(true)
  })

  it('warns on claims without evidence', () => {
    const event = makeValidEvent({ content_type: 'metric.single' })
    const result = validateSlotEvent(event)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.includes('evidence'))).toBe(true)
  })

  it('rejects malformed evidence entries', () => {
    const event = makeValidEvent()
    event.payload.evidence = [{ label: 'test', href: '', kind: 'pr' }]
    const result = validateSlotEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('evidence entry'))).toBe(true)
  })

  it('rejects missing payload.id', () => {
    const event = makeValidEvent()
    delete (event.payload as any).id
    const result = validateSlotEvent(event)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('id'))).toBe(true)
  })

  it('rejects invalid priority', () => {
    const result = validateSlotEvent(makeValidEvent({ priority: 'urgent' as any }))
    expect(result.valid).toBe(false)
  })
})

describe('SlotManager', () => {
  beforeEach(() => {
    // Clean up slots between tests
    for (const slot of slotManager.getAll()) {
      slotManager.remove(slot.slot)
    }
  })

  it('upserts and retrieves slots', () => {
    const event = makeValidEvent({ slot: 'agent_lane:link' })
    slotManager.upsert(event)
    const active = slotManager.getActive()
    expect(active.length).toBeGreaterThanOrEqual(1)
    expect(active.some(s => s.slot === 'agent_lane:link')).toBe(true)
  })

  it('increments version on update', () => {
    const event = makeValidEvent({ slot: 'agent_lane:test' })
    slotManager.upsert(event)
    const v1 = slotManager.get('agent_lane:test')
    expect(v1?.version).toBe(1)

    slotManager.upsert(event)
    const v2 = slotManager.get('agent_lane:test')
    expect(v2?.version).toBe(2)
  })

  it('sorts by priority then recency', () => {
    slotManager.upsert(makeValidEvent({ slot: 'agent_lane:a', priority: 'background' }))
    slotManager.upsert(makeValidEvent({ slot: 'agent_lane:b', priority: 'dominant' }))
    slotManager.upsert(makeValidEvent({ slot: 'agent_lane:c', priority: 'normal' }))

    const active = slotManager.getActive()
    expect(active[0]?.priority).toBe('dominant')
  })

  it('removes slots', () => {
    slotManager.upsert(makeValidEvent({ slot: 'agent_lane:remove-me' }))
    expect(slotManager.get('agent_lane:remove-me')).toBeDefined()
    slotManager.remove('agent_lane:remove-me')
    expect(slotManager.get('agent_lane:remove-me')).toBeUndefined()
  })

  it('records history', () => {
    const event = makeValidEvent({ slot: 'agent_lane:hist' })
    slotManager.upsert(event)
    const history = slotManager.getHistory('agent_lane:hist')
    expect(history.length).toBe(1)
  })

  it('returns stats', () => {
    slotManager.upsert(makeValidEvent({ slot: 'agent_lane:stats' }))
    const stats = slotManager.getStats()
    expect(stats.active).toBeGreaterThanOrEqual(1)
    expect(stats.total).toBeGreaterThanOrEqual(1)
  })
})

describe('StreamMultiplexer', () => {
  it('processes valid events and stores in slot manager', () => {
    const event = makeValidEvent({ slot: 'agent_lane:mux-test' })
    const result = processRender(event)
    expect(result.valid).toBe(true)
    expect(result.slot).toBeDefined()
  })

  it('rejects invalid events without storing', () => {
    const event = makeValidEvent({ slot: 'bogus' as any })
    const result = processRender(event)
    expect(result.valid).toBe(false)
    expect(result.slot).toBeUndefined()
  })

  it('broadcasts to subscribers', () => {
    let received: SlotEvent | null = null
    const unsub = subscribeCanvas((event) => { received = event })

    const event = makeValidEvent({ slot: 'agent_lane:broadcast' })
    processRender(event)
    expect(received).not.toBeNull()
    expect(received?.slot).toBe('agent_lane:broadcast')

    unsub()
  })

  it('logs rejections', () => {
    logRejection({ slot: 'bad' as any }, ['test error'])
    const recent = getRecentRejections()
    expect(recent.length).toBeGreaterThanOrEqual(1)
    expect(recent[recent.length - 1]?.errors[0]).toBe('test error')
  })
})
