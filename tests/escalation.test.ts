// Tests for P0/P1 escalation automation
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createEscalation,
  acknowledgeEscalation,
  resolveEscalation,
  tickEscalations,
  getEscalation,
  getEscalationByFeedback,
  listEscalations,
  setAlertSink,
  _clearEscalationStore,
  ACK_WINDOW_MS,
  ESCALATION_INTERVAL_MS,
  type EscalationAlert,
  type EscalationRecord,
} from '../src/escalation.js'
import {
  submitFeedback,
  _clearFeedbackStore,
} from '../src/feedback.js'

beforeEach(() => {
  _clearEscalationStore()
  _clearFeedbackStore()
})

describe('createEscalation', () => {
  it('creates escalation for P0 ticket', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Production is completely down',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })

    const esc = createEscalation(fb.id, 'P0', 'team', 'on-call-eng')
    expect(esc).not.toBeNull()
    expect(esc!.feedbackId).toBe(fb.id)
    expect(esc!.priority).toBe('P0')
    expect(esc!.tier).toBe('team')
    expect(esc!.status).toBe('active')
    expect(esc!.level).toBe('owner_alert')
    expect(esc!.owner).toBe('on-call-eng')
    expect(esc!.alerts).toHaveLength(1)
    expect(esc!.alerts[0].level).toBe('owner_alert')
  })

  it('creates escalation for P1 ticket', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Dashboard loading very slowly now',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P1', 'pro')
    expect(esc).not.toBeNull()
    expect(esc!.priority).toBe('P1')
    expect(esc!.ackDeadlineAt).toBe(esc!.createdAt + ACK_WINDOW_MS.P1)
  })

  it('rejects P2/P3 tickets', () => {
    expect(createEscalation('fb-1', 'P2', 'free')).toBeNull()
    expect(createEscalation('fb-2', 'P3', 'free')).toBeNull()
  })

  it('prevents duplicate escalations', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Duplicate escalation test entry here',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const first = createEscalation(fb.id, 'P0', 'team')
    const second = createEscalation(fb.id, 'P0', 'team')
    expect(first!.id).toBe(second!.id)
  })

  it('fires initial owner alert', () => {
    const alerts: EscalationAlert[] = []
    setAlertSink((alert) => alerts.push(alert))

    const fb = submitFeedback({
      category: 'bug',
      message: 'Alert sink test for P0 incident',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    createEscalation(fb.id, 'P0', 'team')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].level).toBe('owner_alert')
    expect(alerts[0].message).toContain('P0')
    expect(alerts[0].message).toContain('team')
  })
})

describe('acknowledgeEscalation', () => {
  it('stops the ack timer', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Ack test incident for escalation',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P1', 'pro')!
    const acked = acknowledgeEscalation(esc.id)
    expect(acked!.status).toBe('acknowledged')
    expect(acked!.acknowledgedAt).toBeDefined()
  })

  it('returns record unchanged if already acknowledged', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Double ack test for escalation flow',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    acknowledgeEscalation(esc.id)
    const second = acknowledgeEscalation(esc.id)
    expect(second!.status).toBe('acknowledged')
  })
})

describe('tickEscalations', () => {
  it('escalates to ack_missed when deadline passes', () => {
    const alerts: EscalationAlert[] = []
    setAlertSink((alert) => alerts.push(alert))

    const fb = submitFeedback({
      category: 'bug',
      message: 'Tick test P0 incident for deadlines',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    alerts.length = 0 // clear initial alert

    // Tick past ack deadline (5 min for P0)
    const result = tickEscalations(esc.createdAt + 6 * 60_000)
    expect(result.escalated).toBe(1)
    expect(result.alerts[0].level).toBe('ack_missed')

    const updated = getEscalation(esc.id)!
    expect(updated.level).toBe('ack_missed')
  })

  it('does not escalate if acknowledged', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Ack prevents escalation in this test',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P1', 'pro')!
    acknowledgeEscalation(esc.id)

    // Tick past deadline — should not escalate
    const result = tickEscalations(esc.createdAt + 20 * 60_000)
    expect(result.escalated).toBe(0)
  })

  it('escalates through chain: owner → ack_missed → manager → exec', () => {
    const alerts: EscalationAlert[] = []
    setAlertSink((alert) => alerts.push(alert))

    const fb = submitFeedback({
      category: 'bug',
      message: 'Full chain escalation test incident',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    alerts.length = 0

    // Step 1: ack_missed (after 6 min for P0)
    tickEscalations(esc.createdAt + 6 * 60_000)
    expect(getEscalation(esc.id)!.level).toBe('ack_missed')

    // Step 2: manager_escalation (after interval = 10 min for P0)
    tickEscalations(esc.createdAt + 6 * 60_000 + ESCALATION_INTERVAL_MS.P0)
    expect(getEscalation(esc.id)!.level).toBe('manager_escalation')

    // Step 3: exec_escalation
    tickEscalations(esc.createdAt + 6 * 60_000 + 2 * ESCALATION_INTERVAL_MS.P0)
    expect(getEscalation(esc.id)!.level).toBe('exec_escalation')
    expect(getEscalation(esc.id)!.status).toBe('escalated')
  })

  it('re-escalates acknowledged incidents on SLA breach', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'SLA breach re-escalation test case',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team', // 4h response SLA
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    acknowledgeEscalation(esc.id)

    expect(getEscalation(esc.id)!.status).toBe('acknowledged')

    // Tick at 5 hours — team SLA (4h) breached
    const result = tickEscalations(fb.createdAt + 5 * 3_600_000)
    expect(result.escalated).toBe(1)
    expect(result.alerts[0].message).toContain('SLA BREACHED')
    expect(getEscalation(esc.id)!.status).toBe('escalated')
  })

  it('does not duplicate SLA breach alerts', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'No duplicate breach alerts please here',
      siteToken: 'test',
      timestamp: Date.now(),
      tier: 'team',
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    acknowledgeEscalation(esc.id)

    // First tick — fires breach alert
    tickEscalations(fb.createdAt + 5 * 3_600_000)
    const alertCount1 = getEscalation(esc.id)!.alerts.length

    // Second tick — should not fire again
    tickEscalations(fb.createdAt + 6 * 3_600_000)
    expect(getEscalation(esc.id)!.alerts.length).toBe(alertCount1)
  })

  it('skips resolved escalations', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Resolved escalation should be skipped',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    resolveEscalation(esc.id)

    const result = tickEscalations(esc.createdAt + 60 * 60_000)
    expect(result.checked).toBe(0)
  })
})

describe('listEscalations', () => {
  it('returns summary counts', () => {
    const fb1 = submitFeedback({ category: 'bug', message: 'Escalation list test item number one', siteToken: 'test', timestamp: Date.now() })
    const fb2 = submitFeedback({ category: 'bug', message: 'Escalation list test item number two', siteToken: 'test', timestamp: Date.now() })
    const fb3 = submitFeedback({ category: 'bug', message: 'Escalation list test item number three', siteToken: 'test', timestamp: Date.now() })

    const e1 = createEscalation(fb1.id, 'P0', 'team')!
    createEscalation(fb2.id, 'P1', 'pro')!
    const e3 = createEscalation(fb3.id, 'P0', 'free')!

    acknowledgeEscalation(e1.id)
    resolveEscalation(e3.id)

    const summary = listEscalations()
    expect(summary.active).toBe(1)
    expect(summary.acknowledged).toBe(1)
    expect(summary.resolved).toBe(1)
    expect(summary.items).toHaveLength(3)
  })

  it('filters by status', () => {
    const fb1 = submitFeedback({ category: 'bug', message: 'Status filter test active item here', siteToken: 'test', timestamp: Date.now() })
    const fb2 = submitFeedback({ category: 'bug', message: 'Status filter test resolved item here', siteToken: 'test', timestamp: Date.now() })

    createEscalation(fb1.id, 'P0', 'team')!
    const e2 = createEscalation(fb2.id, 'P1', 'pro')!
    resolveEscalation(e2.id)

    const active = listEscalations('active')
    expect(active.items).toHaveLength(1)
    expect(active.items[0].status).toBe('active')
  })
})

describe('getEscalationByFeedback', () => {
  it('finds escalation by feedback id', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'Feedback lookup test for escalation link',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    const found = getEscalationByFeedback(fb.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(esc.id)
  })

  it('returns undefined for unknown feedback', () => {
    expect(getEscalationByFeedback('fb-nonexistent')).toBeUndefined()
  })
})

describe('P0 vs P1 timing', () => {
  it('P0 has shorter ack window than P1', () => {
    expect(ACK_WINDOW_MS.P0).toBeLessThan(ACK_WINDOW_MS.P1)
  })

  it('P0 has shorter escalation interval than P1', () => {
    expect(ESCALATION_INTERVAL_MS.P0).toBeLessThan(ESCALATION_INTERVAL_MS.P1)
  })

  it('P0 ack window is 5 minutes', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'P0 five minute ack window verification',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P0', 'team')!
    expect(esc.ackDeadlineAt - esc.createdAt).toBe(5 * 60_000)
  })

  it('P1 ack window is 15 minutes', () => {
    const fb = submitFeedback({
      category: 'bug',
      message: 'P1 fifteen minute ack window check',
      siteToken: 'test',
      timestamp: Date.now(),
    })

    const esc = createEscalation(fb.id, 'P1', 'pro')!
    expect(esc.ackDeadlineAt - esc.createdAt).toBe(15 * 60_000)
  })
})
