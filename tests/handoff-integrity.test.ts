// Regression tests: handoff integrity validation + reflection schema guidance
import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

describe('Handoff Integrity + Schema Guidance', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  // ── Stale handoff mismatch ──

  it('rejects validating transition with mismatched task_id in review_handoff', async () => {
    // Create a task
    const createRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: `Handoff test ${Date.now()}`,
        description: 'Testing stale handoff rejection',
        assignee: 'link',
        reviewer: 'sage',
        createdBy: 'test',
        priority: 'P2',
        done_criteria: ['Test passes'],
        eta: '1h',
      },
    })
    const body = JSON.parse(createRes.body)
    const taskId = body.task?.id
    if (!taskId) {
      console.error('Task creation failed:', body)
      throw new Error('Task creation failed')
    }

    // Move to doing
    await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })

    // Try validating with wrong task_id — should fail at review_handoff gate
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: {
        status: 'validating',
        metadata: {
          artifact_path: `process/${taskId}`,
          review_handoff: {
            task_id: 'task-WRONG-ID',
            artifact_path: `process/${taskId}`,
            test_proof: 'vitest pass',
            known_caveats: 'none',
            doc_only: true,
          },
          qa_bundle: {
            lane: 'engineering',
            summary: 'test',
            changed_files: ['test.ts'],
            artifact_links: ['test.ts'],
            checks: ['vitest pass'],
            screenshot_proof: ['N/A'],
            review_packet: {
              task_id: taskId,
              pr_url: 'https://github.com/test/test/pull/1',
              commit: 'abc1234',
              changed_files: ['test.ts'],
              artifact_path: `process/${taskId}`,
              caveats: 'none',
              summary: 'test',
              artifact_links: ['test.ts'],
              checks: 'pass',
            },
          },
        },
      },
    })

    expect(res.statusCode).toBe(400)
    const resBody = JSON.parse(res.body)
    // Should be caught by either qa_bundle or review_handoff gate
    expect(resBody.success).toBe(false)
    expect(resBody.error).toBeTruthy()
  })

  // ── Reflection schema guidance ──

  it('GET /reflections/schema includes template and quality tips', async () => {
    const res = await app.inject({ method: 'GET', url: '/reflections/schema' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // Required fields listed
    expect(body.required).toContain('pain')
    expect(body.required).toContain('evidence')
    expect(body.required).toContain('confidence')

    // Template present
    expect(body.template).toBeDefined()
    expect(body.template.body).toBeDefined()
    expect(body.template.body.pain).toBeTruthy()
    expect(body.template.body.evidence).toBeInstanceOf(Array)
    expect(body.template.body.author).toBeTruthy()

    // Quality tips present
    expect(body.quality_tips).toBeInstanceOf(Array)
    expect(body.quality_tips.length).toBeGreaterThanOrEqual(3)

    // Tags guide present
    expect(body.tags_guide).toBeDefined()
    expect(body.tags_guide.prefixed_tags).toBeDefined()
  })

  it('GET /reflections/schema template covers all required fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/reflections/schema' })
    const body = JSON.parse(res.body)
    const templateFields = Object.keys(body.template.body)

    for (const required of body.required) {
      expect(templateFields).toContain(required)
    }
  })

  it('quality tips mention evidence, confidence, and proposed_fix', async () => {
    const res = await app.inject({ method: 'GET', url: '/reflections/schema' })
    const body = JSON.parse(res.body)
    const tipsText = body.quality_tips.join(' ').toLowerCase()

    expect(tipsText).toContain('evidence')
    expect(tipsText).toContain('confidence')
    expect(tipsText).toContain('proposed_fix')
  })
})
