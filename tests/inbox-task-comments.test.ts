import { describe, it, beforeEach, expect } from 'vitest'
import { createServer } from '../src/server.js'

describe('GET /inbox/:agent — task comments merge', () => {
  let app: Awaited<ReturnType<typeof createServer>>

  beforeEach(async () => {
    app = await createServer({ logger: false })
    await app.ready()
  })

  it('returns 200 with messages + count shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox/link' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('messages')
    expect(body).toHaveProperty('count')
    expect(Array.isArray(body.messages)).toBe(true)
    expect(typeof body.count).toBe('number')
  })

  it('includes task_id and comment_id on task comment items', async () => {
    // Create a task assigned to link
    const createTask = await app.inject({
      method: 'POST', url: '/tasks',
      payload: { title: 'inbox test task', assignee: 'link', actor: 'kai' },
    })
    expect([200, 201]).toContain(createTask.statusCode)
    const task = JSON.parse(createTask.body).task

    // Add a comment from someone else
    const addComment = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/comments`,
      payload: { content: 'review this please', author: 'kai' },
    })
    expect([200, 201]).toContain(addComment.statusCode)
    const comment = JSON.parse(addComment.body).comment

    // Fetch inbox
    const res = await app.inject({ method: 'GET', url: '/inbox/link' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    const taskCommentItem = body.messages.find(
      (m: any) => m.type === 'task_comment' && m.task_id === task.id
    )
    expect(taskCommentItem).toBeDefined()
    expect(taskCommentItem.task_id).toBe(task.id)
    expect(taskCommentItem.comment_id).toBe(comment.id)
    expect(taskCommentItem.from).toBe('kai')
    expect(taskCommentItem.content).toContain('review this please')
    expect(typeof taskCommentItem.timestamp).toBe('number')
  })

  it('excludes own comments from inbox', async () => {
    const createTask = await app.inject({
      method: 'POST', url: '/tasks',
      payload: { title: 'own comment exclusion test', assignee: 'link', actor: 'link' },
    })
    const task = JSON.parse(createTask.body).task

    // link posts their own comment
    await app.inject({
      method: 'POST', url: `/tasks/${task.id}/comments`,
      payload: { content: 'my own comment', author: 'link' },
    })

    const res = await app.inject({ method: 'GET', url: '/inbox/link' })
    const body = JSON.parse(res.body)
    const ownItems = body.messages.filter(
      (m: any) => m.type === 'task_comment' && m.task_id === task.id && m.from === 'link'
    )
    expect(ownItems).toHaveLength(0)
  })

  it('supports ?mark_read=true without error', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox/link?mark_read=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('messages')
  })

  it('rejects invalid mark_read value with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/inbox/link?mark_read=yes' })
    expect(res.statusCode).toBe(400)
  })

  it('compact mode includes task_id when present', async () => {
    const createTask = await app.inject({
      method: 'POST', url: '/tasks',
      payload: { title: 'compact inbox test', assignee: 'link', actor: 'pixel' },
    })
    const task = JSON.parse(createTask.body).task

    await app.inject({
      method: 'POST', url: `/tasks/${task.id}/comments`,
      payload: { content: 'compact check', author: 'pixel' },
    })

    const res = await app.inject({ method: 'GET', url: '/inbox/link?compact=true' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const item = body.messages.find((m: any) => m.task_id === task.id)
    expect(item).toBeDefined()
    expect(item.task_id).toBe(task.id)
    expect(item.comment_id).toBeDefined()
  })
})
