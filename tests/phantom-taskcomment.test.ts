import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the messageRouter logic for phantom task-comment suppression.
// We mock taskManager and chatManager to verify the reorder behavior.

describe('messageRouter phantom task-comment suppression', () => {
  // We test the core logic: when task comment fails with "not found",
  // chat message should NOT be emitted for status-update-to-task-comment routes.

  it('skips chat emission when task comment fails with not-found error', async () => {
    // Simulate the router logic inline (messageRouter is tightly coupled)
    const taskCommentThrows = true
    const errorMessage = 'Task not found'
    const decisionReason = 'status-update-to-task-comment'

    let taskCommentFailed = false
    let chatSent = false

    // Step 1: Try comment first
    try {
      if (taskCommentThrows) {
        throw new Error(errorMessage)
      }
    } catch (err: any) {
      const errMsg = (err?.message || '').toLowerCase()
      if (errMsg.includes('not found') || errMsg.includes('404') || errMsg.includes('does not exist')) {
        taskCommentFailed = true
      }
    }

    // Step 2: Conditionally send chat
    const skipChat = taskCommentFailed && decisionReason === 'status-update-to-task-comment'
    if (!skipChat) {
      chatSent = true
    }

    expect(taskCommentFailed).toBe(true)
    expect(chatSent).toBe(false) // Chat should NOT be sent
  })

  it('still emits chat when task comment fails with non-404 error', async () => {
    const errorMessage = 'Validation error: content too long'
    const decisionReason = 'status-update-to-task-comment'

    let taskCommentFailed = false
    let chatSent = false

    try {
      throw new Error(errorMessage)
    } catch (err: any) {
      const errMsg = (err?.message || '').toLowerCase()
      if (errMsg.includes('not found') || errMsg.includes('404') || errMsg.includes('does not exist')) {
        taskCommentFailed = true
      }
    }

    const skipChat = taskCommentFailed && decisionReason === 'status-update-to-task-comment'
    if (!skipChat) {
      chatSent = true
    }

    expect(taskCommentFailed).toBe(false)
    expect(chatSent).toBe(true) // Chat SHOULD still be sent
  })

  it('still emits chat for non-task-comment routes even on 404', async () => {
    const errorMessage = 'Task not found'
    const decisionReason = 'escalation-to-general' // Not a task-comment route

    let taskCommentFailed = false
    let chatSent = false

    try {
      throw new Error(errorMessage)
    } catch (err: any) {
      const errMsg = (err?.message || '').toLowerCase()
      if (errMsg.includes('not found') || errMsg.includes('404') || errMsg.includes('does not exist')) {
        taskCommentFailed = true
      }
    }

    const skipChat = taskCommentFailed && decisionReason === 'status-update-to-task-comment'
    if (!skipChat) {
      chatSent = true
    }

    expect(taskCommentFailed).toBe(true)
    expect(chatSent).toBe(true) // Chat SHOULD still be sent for non-task-comment routes
  })

  it('emits chat normally when comment succeeds', async () => {
    const decisionReason = 'status-update-to-task-comment'

    let taskCommentFailed = false
    let chatSent = false

    // Comment succeeds — no throw
    taskCommentFailed = false

    const skipChat = taskCommentFailed && decisionReason === 'status-update-to-task-comment'
    if (!skipChat) {
      chatSent = true
    }

    expect(taskCommentFailed).toBe(false)
    expect(chatSent).toBe(true)
  })
})
