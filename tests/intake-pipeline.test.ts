// Tests for automated Reflection→Insight→Task intake pipeline
import { describe, it, expect, beforeEach } from 'vitest'
import { runIntake, batchIntake, getPipelineStats, _resetPipelineStats } from '../src/intake-pipeline.js'
import { _clearReflectionStore } from '../src/reflections.js'
import { _clearInsightStore, getInsight, listInsights } from '../src/insights.js'
import { taskManager } from '../src/tasks.js'

// ── Helpers ──

function makeReflection(overrides: Record<string, unknown> = {}) {
  return {
    pain: 'Deployment pipeline fails silently on staging',
    impact: 'Engineers waste 30min debugging false positives',
    evidence: ['deploy log 2026-02-20', 'slack thread #infra-alerts'],
    went_well: 'Local builds are reliable',
    suspected_why: 'Staging env vars drift from production',
    proposed_fix: 'Add env var validation step to deploy pipeline',
    confidence: 7,
    role_type: 'agent',
    author: 'deploy-bot',
    severity: 'medium',
    tags: ['stage:deploy', 'family:silent-failure', 'unit:staging-pipeline'],
    ...overrides,
  }
}

function makeContract() {
  return {
    owner: 'link',
    reviewer: 'kai',
    eta: '2026-02-25',
    acceptance_check: 'Deploy pipeline validates env vars before deploy',
    artifact_proof_requirement: 'PR with env validation + CI proof',
    next_checkpoint_eta: '2026-02-23',
  }
}

beforeEach(() => {
  _clearReflectionStore()
  _clearInsightStore()
  _resetPipelineStats()
})

// ── Unit tests ──

describe('runIntake', () => {
  it('should create reflection and cluster into insight', async () => {
    const result = await await runIntake({ reflection: makeReflection() })

    expect(result.success).toBe(true)
    expect(result.reflection).toBeDefined()
    expect(result.reflection!.id).toBeTruthy()
    expect(result.insight).toBeDefined()
    expect(result.insight!.id).toBeTruthy()
    expect(result.cluster_key).toBeTruthy()
    expect(result.auto_promote_attempted).toBe(false)
  })

  it('should fail on invalid reflection', async () => {
    const result = await await runIntake({ reflection: { pain: 'only pain' } })

    expect(result.success).toBe(false)
    expect(result.error_stage).toBe('validation')
    expect(result.errors).toBeDefined()
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('should inject team_id into reflection', async () => {
    const result = await await runIntake({
      reflection: makeReflection(),
      team_id: 'team-acme',
    })

    expect(result.success).toBe(true)
    expect(result.reflection!.team_id).toBe('team-acme')
  })

  it('should cluster multiple reflections into same insight', async () => {
    const r1 = await await runIntake({ reflection: makeReflection({ author: 'alice' }) })
    const r2 = await await runIntake({ reflection: makeReflection({ author: 'bob' }) })

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    expect(r1.insight!.id).toBe(r2.insight!.id)
    // After second ingestion, independent count should be 2
    expect(r2.insight!.independent_count).toBe(2)
  })

  it('should detect promotion readiness after enough independent authors', async () => {
    await runIntake({ reflection: makeReflection({ author: 'alice' }) })
    const r2 = await await runIntake({ reflection: makeReflection({ author: 'bob' }) })

    // The insight engine auto-promotes when canPromote() is true (2 independent authors)
    expect(r2.insight!.promotion_readiness).toBe('promoted')
    expect(r2.insight!.independent_count).toBe(2)
  })

  it('should not auto-promote when auto_promote is false', async () => {
    await runIntake({ reflection: makeReflection({ author: 'alice' }) })
    const r2 = await await runIntake({
      reflection: makeReflection({ author: 'bob' }),
      auto_promote: false,
    })

    expect(r2.auto_promote_attempted).toBe(false)
    expect(r2.promotion).toBeUndefined()
  })

  it('should auto-promote when gates met and auto_promote is true', async () => {
    // First reflection to seed the insight
    await runIntake({ reflection: makeReflection({ author: 'alice' }) })

    // Second reflection triggers promotion readiness
    const r2 = await await runIntake({
      reflection: makeReflection({ author: 'bob' }),
      auto_promote: true,
      promotion_contract: makeContract(),
    })

    expect(r2.success).toBe(true)
    expect(r2.auto_promote_attempted).toBe(true)
    expect(r2.promotion).toBeDefined()
    expect(r2.promotion!.success).toBe(true)
    expect(r2.promotion!.task_id).toBeTruthy()
  })

  it('should error when auto_promote is true but no contract', async () => {
    await runIntake({ reflection: makeReflection({ author: 'alice' }) })
    const r2 = await await runIntake({
      reflection: makeReflection({ author: 'bob' }),
      auto_promote: true,
      // no promotion_contract
    })

    expect(r2.success).toBe(true) // reflection + insight still created
    expect(r2.auto_promote_attempted).toBe(true)
    expect(r2.error).toContain('no promotion_contract')
  })

  it('should not auto-promote when only one author (gates not met)', async () => {
    const r1 = await await runIntake({
      reflection: makeReflection({ author: 'alice' }),
      auto_promote: true,
      promotion_contract: makeContract(),
    })

    expect(r1.success).toBe(true)
    expect(r1.auto_promote_attempted).toBe(false) // gates not met
  })

  it('should auto-promote single high-severity reflection', async () => {
    const result = await await runIntake({
      reflection: makeReflection({
        author: 'alice',
        severity: 'critical',
        evidence: ['incident report IR-2026-042', 'customer escalation ticket'],
      }),
      auto_promote: true,
      promotion_contract: makeContract(),
    })

    // High severity with evidence should meet promotion gate (1 high/critical)
    if (result.insight!.promotion_readiness === 'ready') {
      expect(result.auto_promote_attempted).toBe(true)
      expect(result.promotion?.success).toBe(true)
    }
    expect(result.success).toBe(true)
  })

  it('should track pipeline stats', async () => {
    await runIntake({ reflection: makeReflection({ author: 'alice' }) })
    await runIntake({ reflection: makeReflection({ author: 'bob' }) })
    await runIntake({ reflection: { pain: 'invalid' } }) // error

    const stats = getPipelineStats()
    expect(stats.total_intakes).toBe(2)
    expect(stats.errors).toBe(1)
    expect(stats.last_intake_at).toBeTruthy()
  })
})

// ── Batch tests ──

describe('batchIntake', () => {
  it('should process multiple reflections', async () => {
    const result = await batchIntake([
      { reflection: makeReflection({ author: 'alice' }) },
      { reflection: makeReflection({ author: 'bob' }) },
      { reflection: makeReflection({ author: 'charlie', tags: ['stage:review', 'family:missed-bug', 'unit:qa'] }) },
    ])

    expect(result.summary.total).toBe(3)
    expect(result.summary.succeeded).toBe(3)
    expect(result.summary.failed).toBe(0)
    expect(result.results).toHaveLength(3)
  })

  it('should handle partial failures gracefully', async () => {
    const result = await batchIntake([
      { reflection: makeReflection({ author: 'alice' }) },
      { reflection: { pain: 'invalid' } as any }, // will fail validation
      { reflection: makeReflection({ author: 'charlie' }) },
    ])

    expect(result.summary.total).toBe(3)
    expect(result.summary.succeeded).toBe(2)
    expect(result.summary.failed).toBe(1)
  })

  it('should auto-promote in batch when gates met', async () => {
    const contract = makeContract()
    const result = await batchIntake([
      { reflection: makeReflection({ author: 'alice' }), auto_promote: true, promotion_contract: contract },
      { reflection: makeReflection({ author: 'bob' }), auto_promote: true, promotion_contract: contract },
    ])

    expect(result.summary.total).toBe(2)
    expect(result.summary.succeeded).toBe(2)
    // Second reflection should trigger auto-promotion
    expect(result.summary.auto_promoted).toBeGreaterThanOrEqual(1)
  })
})

// ── E2E: Non-internal team scenario ──

describe('End-to-end: Customer team intake', () => {
  it('should handle full reflection→insight→task flow for external team', async () => {
    const teamId = 'team-customer-acme'

    // Customer team submits reflections from different team members
    // about recurring deployment issues

    // Reflection 1: DevOps engineer reports staging failures
    // Note: severity=medium so single reflection doesn't auto-promote (needs 2 authors)
    const r1 = await await runIntake({
      reflection: {
        pain: 'Staging deployments fail 3 out of 5 times',
        impact: 'Team loses 2 hours per week debugging staging',
        evidence: ['deploy-log-2026-02-18.txt', 'jira ACME-1234'],
        went_well: 'Production deploys are stable',
        suspected_why: 'Staging config drifts from production over time',
        proposed_fix: 'Implement config sync between staging and prod',
        confidence: 8,
        role_type: 'human',
        author: 'sarah@acme.com',
        severity: 'medium',
        tags: ['stage:deploy', 'family:config-drift', 'unit:staging'],
      },
      team_id: teamId,
    })

    expect(r1.success).toBe(true)
    expect(r1.reflection!.team_id).toBe(teamId)
    expect(r1.reflection!.role_type).toBe('human')
    expect(r1.insight!.status).toBe('candidate')

    // Reflection 2: QA engineer independently reports same pattern
    const r2 = await await runIntake({
      reflection: {
        pain: 'Test environments are unreliable due to config mismatches',
        impact: 'QA cycles take 50% longer than necessary',
        evidence: ['test-report-2026-02-19.pdf', 'slack #qa-team 2026-02-19'],
        went_well: 'Test coverage itself is comprehensive',
        suspected_why: 'No automated config validation between environments',
        proposed_fix: 'Add pre-deploy config diff check',
        confidence: 7,
        role_type: 'human',
        author: 'mike@acme.com',
        severity: 'medium',
        tags: ['stage:deploy', 'family:config-drift', 'unit:staging'],
      },
      team_id: teamId,
      auto_promote: true,
      promotion_contract: {
        owner: 'sarah@acme.com',
        reviewer: 'tech-lead@acme.com',
        eta: '2026-03-01',
        acceptance_check: 'Config diff check runs in CI and blocks deploys with drift',
        artifact_proof_requirement: 'PR with config validation script + CI integration',
        next_checkpoint_eta: '2026-02-25',
      },
    })

    expect(r2.success).toBe(true)
    // Same cluster as r1
    expect(r2.insight!.id).toBe(r1.insight!.id)
    // Two independent authors meet promotion gate
    expect(r2.insight!.independent_count).toBe(2)
    // Insight engine auto-promotes when canPromote() is true
    expect(r2.insight!.promotion_readiness).toBe('promoted')
    // Auto-promoted
    expect(r2.auto_promote_attempted).toBe(true)
    expect(r2.promotion).toBeDefined()
    expect(r2.promotion!.success).toBe(true)
    expect(r2.promotion!.task_id).toBeTruthy()

    // Verify the created task has correct contract
    const taskId = r2.promotion!.task_id!
    const task = taskManager.getTask(taskId)
    expect(task).toBeDefined()
    expect(task!.assignee).toBe('sarah@acme.com')
    expect(task!.reviewer).toBe('tech-lead@acme.com')
    expect(task!.done_criteria).toBeDefined()
    expect(task!.done_criteria!.length).toBeGreaterThan(0)

    // Verify insight is now promoted
    const insight = getInsight(r2.insight!.id)
    expect(insight!.status).toBe('promoted')

    // Pipeline stats
    const stats = getPipelineStats()
    expect(stats.total_intakes).toBe(2)
    expect(stats.auto_promoted).toBe(1)
    expect(stats.promotion_gates_met).toBe(1)
  })

  it('should support batch intake for team retrospectives', async () => {
    const teamId = 'team-customer-beta'
    const contract = {
      owner: 'team-lead@beta.io',
      reviewer: 'cto@beta.io',
      eta: '2026-03-15',
      acceptance_check: 'Review process covers all critical paths',
      artifact_proof_requirement: 'Updated review checklist + CI check',
      next_checkpoint_eta: '2026-03-08',
    }

    // Team submits batch of retro reflections
    const result = await batchIntake([
      {
        reflection: {
          pain: 'Code reviews take too long',
          impact: 'PRs sit for 3+ days',
          evidence: ['github PR stats Q1'],
          went_well: 'Review quality is high when done',
          suspected_why: 'No SLA or rotation for reviews',
          proposed_fix: 'Implement review SLA with rotation',
          confidence: 8,
          role_type: 'human',
          author: 'dev1@beta.io',
          severity: 'medium',
          tags: ['stage:review', 'family:latency', 'unit:engineering'],
        },
        team_id: teamId,
        auto_promote: true,
        promotion_contract: contract,
      },
      {
        reflection: {
          pain: 'Reviews are slow and block releases',
          impact: 'Release cadence dropped from weekly to biweekly',
          evidence: ['release log 2026-Q1', 'team survey results'],
          went_well: 'When reviews happen they catch real bugs',
          suspected_why: 'Lack of reviewer assignment and accountability',
          proposed_fix: 'Auto-assign reviewers with time SLA',
          confidence: 9,
          role_type: 'human',
          author: 'dev2@beta.io',
          severity: 'medium',
          tags: ['stage:review', 'family:latency', 'unit:engineering'],
        },
        team_id: teamId,
        auto_promote: true,
        promotion_contract: contract,
      },
    ])

    expect(result.summary.total).toBe(2)
    expect(result.summary.succeeded).toBe(2)
    // Should auto-promote after second reflection (2 independent authors)
    expect(result.summary.auto_promoted).toBeGreaterThanOrEqual(1)

    // Verify insight exists with both authors
    const { insights } = listInsights({})
    const reviewInsight = insights.find(i =>
      i.failure_family === 'latency' && i.impacted_unit === 'engineering'
    )
    expect(reviewInsight).toBeDefined()
    expect(reviewInsight!.authors).toContain('dev1@beta.io')
    expect(reviewInsight!.authors).toContain('dev2@beta.io')
  })

  it('should enforce dedupe — same author does not double-count', async () => {
    const teamId = 'team-dedup-test'

    // Same author submits twice — should only count as 1 independent
    await runIntake({
      reflection: makeReflection({ author: 'repeat@test.com' }),
      team_id: teamId,
    })
    const r2 = await await runIntake({
      reflection: makeReflection({ author: 'repeat@test.com' }),
      team_id: teamId,
    })

    expect(r2.insight!.independent_count).toBe(1)
    expect(r2.insight!.promotion_readiness).not.toBe('ready')
  })
})
