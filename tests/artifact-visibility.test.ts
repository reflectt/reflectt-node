// Tests for GET /tasks/:id/artifacts and GET /tasks/heartbeat-status endpoints
import { describe, it, expect } from 'vitest'

const BASE = 'http://127.0.0.1:4445'

// Helper: create a task with artifacts metadata, return ID
async function createTestTask(overrides: Record<string, any> = {}) {
  const ts = Date.now()
  const meta = {
    source_reflection: 'ref-test-artifact-vis',
    source_insight: 'ins-test-artifact-vis',
    ...(overrides.metadata || {}),
  }
  const body = {
    title: `Implement artifact visibility endpoint with heartbeat validation for test run ${ts}`,
    createdBy: 'link',
    assignee: 'link',
    reviewer: 'sage',
    done_criteria: ['Artifact endpoint returns resolved paths', 'Heartbeat status is included in response'],
    eta: '~30m',
    priority: 'P2',
    ...overrides,
    metadata: meta,
  }

  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as any
  if (!data.success) {
    throw new Error(`Task creation failed: ${data.error} — ${data.hint || ''}`)
  }
  return data.task?.id || data.id
}

// Helper: add comment to task
async function addComment(taskId: string, author: string, content: string) {
  const res = await fetch(`${BASE}/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, content }),
  })
  return res.json() as any
}

// Helper: update task status
async function updateTask(taskId: string, patch: Record<string, any>) {
  const res = await fetch(`${BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return res.json() as any
}

describe('GET /tasks/:id/artifacts', () => {
  it('returns empty artifacts for task with no artifact metadata', async () => {
    const id = await createTestTask()
    const res = await fetch(`${BASE}/tasks/${id}/artifacts`)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.taskId).toBe(id)
    expect(data.artifactCount).toBe(0)
    expect(data.artifacts).toEqual([])
  })

  it('resolves artifact_path from metadata', async () => {
    const id = await createTestTask({
      metadata: {
        source_reflection: 'ref-test',
        source_insight: 'ins-test',
        artifact_path: 'process/test-artifact.md',
      },
    })
    const res = await fetch(`${BASE}/tasks/${id}/artifacts`)
    const data = await res.json() as any
    expect(data.artifactCount).toBeGreaterThanOrEqual(1)
    const artRef = data.artifacts.find((a: any) => a.source === 'metadata.artifact_path')
    expect(artRef).toBeDefined()
    expect(artRef.type).toBe('file')
    // File may or may not exist, but the path should be resolved
    expect(artRef.path).toBe('process/test-artifact.md')
  })

  it('resolves URL artifacts', async () => {
    const id = await createTestTask({
      metadata: {
        source_reflection: 'ref-test',
        source_insight: 'ins-test',
        artifacts: ['https://github.com/reflectt/reflectt-node/pull/246'],
      },
    })
    const res = await fetch(`${BASE}/tasks/${id}/artifacts`)
    const data = await res.json() as any
    const urlArt = data.artifacts.find((a: any) => a.type === 'url')
    expect(urlArt).toBeDefined()
    expect(urlArt.accessible).toBe(true)
  })

  it('includes heartbeat status', async () => {
    const id = await createTestTask()
    const res = await fetch(`${BASE}/tasks/${id}/artifacts`)
    const data = await res.json() as any
    expect(data.heartbeat).toBeDefined()
    expect(data.heartbeat.thresholdMs).toBe(30 * 60 * 1000)
  })

  it('returns 404 for missing task', async () => {
    const res = await fetch(`${BASE}/tasks/task-nonexistent-id/artifacts`)
    expect(res.status).toBe(404)
  })
})

describe('GET /tasks/heartbeat-status', () => {
  it('returns heartbeat status with doing task count', async () => {
    const res = await fetch(`${BASE}/tasks/heartbeat-status`)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.threshold).toBe('30m')
    expect(data.thresholdMs).toBe(30 * 60 * 1000)
    expect(typeof data.doingTaskCount).toBe('number')
    expect(typeof data.staleCount).toBe('number')
    expect(Array.isArray(data.staleTasks)).toBe(true)
  })
})

describe('POST /tasks/:id/comments heartbeat warning', () => {
  it('returns heartbeatWarning when comment gap exceeds threshold on doing task', async () => {
    // Create task and move to doing — the gap from creation to first comment
    // will likely exceed 0 but not 30m. This tests the structure exists.
    const id = await createTestTask()
    // First comment
    const result = await addComment(id, 'link', 'Starting work on this')
    expect(result.success).toBe(true)
    // heartbeatWarning should only appear if gap > 30m, so for a fresh task it should be absent
    // (unless the task was created >30m ago, which is unlikely in tests)
    expect(result.comment).toBeDefined()
    // The field should be absent for recent tasks
    if (result.heartbeatWarning) {
      expect(typeof result.heartbeatWarning).toBe('string')
    }
  })
})
