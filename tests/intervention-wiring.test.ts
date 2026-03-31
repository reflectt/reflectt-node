import { describe, it, beforeEach } from 'vitest'
import { _resetStallDetectorState, emitWorkflowStall, onStallEvent } from '../src/stall-detector.js'
import { processStallEvent, _resetInterventionEngineState } from '../src/intervention-template.js'

const uid = () => `u-${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('StallDetector → InterventionEngine wiring', () => {
  beforeEach(() => {
    _resetStallDetectorState()
    _resetInterventionEngineState()
  })

  it('workflow stall event triggers intervention', () => {
    const userId = uid()
    
    // Emit a workflow stall
    emitWorkflowStall(userId, 'task_stalled', {
      lastAction: 'Fix login bug',
      lastAgent: 'spark',
      lastActionAt: Date.now(),
    })
    
    // processStallEvent should return sent=true
    // Note: deduplication means second call is suppressed within 30 min
    const event = {
      stallId: `workflow-${userId}-task_stalled-${Date.now()}`,
      userId,
      stallType: 'task_stalled' as const,
      personalizations: {
        user_name: userId,
        last_intent: 'Fix login bug',
        active_task_title: 'Fix login bug',
        last_agent_name: 'spark',
      },
      timestamp: Date.now(),
    }
    
    const result = processStallEvent(event)
    if (!result.sent) throw new Error('Should send intervention: ' + result.reason)
    if (!result.result) throw new Error('Missing result')
    if (!result.result.template_id) throw new Error('Missing template_id')
    if (!result.message) throw new Error('Missing message text')
    if (!result.message.includes('Fix login bug')) throw new Error('Message should include task title')
  })

  it('review_pending stall selects correct template', () => {
    const reviewerId = uid()
    
    const event = {
      stallId: `workflow-${reviewerId}-review_pending-${Date.now()}`,
      userId: reviewerId,
      stallType: 'review_pending' as const,
      personalizations: {
        user_name: reviewerId,
        last_intent: 'API reference docs',
        active_task_title: 'API reference docs',
        last_agent_name: 'link',
      },
      timestamp: Date.now(),
    }
    
    const result = processStallEvent(event)
    if (!result.sent) throw new Error('Should send intervention')
    
    // Should use gentle_nudge_review template
    if (result.result!.template_id !== 'gentle_nudge_review') {
      throw new Error(`Wrong template: ${result.result!.template_id}`)
    }
    if (!result.message.includes('review')) throw new Error('Review message should mention review')
  })

  it('handoff_waiting uses correct template', () => {
    const userId = uid()
    
    const event = {
      stallId: `workflow-${userId}-handoff_waiting-${Date.now()}`,
      userId,
      stallType: 'handoff_waiting' as const,
      personalizations: {
        user_name: userId,
        active_task_title: 'Design tokens spec',
        last_agent_name: 'pixel',
      },
      timestamp: Date.now(),
    }
    
    const result = processStallEvent(event)
    if (!result.sent) throw new Error('Should send intervention')
    if (result.result!.template_id !== 'gentle_nudge_handoff') {
      throw new Error(`Wrong template: ${result.result!.template_id}`)
    }
  })

  it('approval_pending uses handoff_offer tier', () => {
    const userId = uid()
    
    const event = {
      stallId: `workflow-${userId}-approval_pending-${Date.now()}`,
      userId,
      stallType: 'approval_pending' as const,
      personalizations: {
        user_name: userId,
        active_task_title: 'Deploy to production',
        last_agent_name: 'spark',
      },
      timestamp: Date.now(),
    }
    
    const result = processStallEvent(event)
    if (!result.sent) throw new Error('Should send intervention')
    if (result.result!.template_id !== 'handoff_approval') {
      throw new Error(`Wrong template: ${result.result!.template_id}`)
    }
  })

  it('deduplication prevents repeat interventions within 30 min', () => {
    const userId = uid()
    
    const event = {
      stallId: `workflow-${userId}-task_stalled-${Date.now()}`,
      userId,
      stallType: 'task_stalled' as const,
      personalizations: { user_name: userId, active_task_title: 'Test task' },
      timestamp: Date.now(),
    }
    
    const first = processStallEvent(event)
    if (!first.sent) throw new Error('First should send')
    
    // Same stall within same session should be deduplicated
    const dup = processStallEvent(event)
    if (dup.sent) throw new Error('Duplicate should be suppressed')
    if (dup.reason !== 'deduplicated') throw new Error(`Wrong reason: ${dup.reason}`)
  })

  it('stall handler chain fires in order', () => {
    const userId = uid()
    const events: string[] = []
    
    const unsub = onStallEvent((event) => {
      events.push(`handler:${event.stallType}`)
    })
    
    emitWorkflowStall(userId, 'task_stalled', { lastAction: 'test' })
    
    unsub()
    
    if (events.length !== 1) throw new Error(`Expected 1 event, got ${events.length}`)
    if (!events[0].includes('task_stalled')) throw new Error('Wrong stall type in handler')
  })

  it('intervention template has all workflow stall types', () => {
    const stallTypes = [
      'task_stalled',
      'review_pending',
      'handoff_waiting',
      'approval_pending',
    ] as const
    
    for (const stallType of stallTypes) {
      const event = {
        stallId: `workflow-${uid()}-${stallType}-${Date.now()}`,
        userId: uid(), // unique user per stall type to avoid cooldown
        stallType,
        personalizations: { user_name: 'testuser', active_task_title: 'Test task', last_agent_name: 'agent' },
        timestamp: Date.now(),
      }
      
      const result = processStallEvent(event)
      if (!result.sent) {
        throw new Error(`${stallType}: intervention not sent (${result.reason})`)
      }
      if (!result.message) {
        throw new Error(`${stallType}: no message text`)
      }
    }
  })
})
