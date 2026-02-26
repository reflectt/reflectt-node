import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock chatManager and taskManager before importing routeMessage
vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage: vi.fn().mockResolvedValue({ id: 'mock-msg-1' }),
  },
}))

vi.mock('../src/tasks.js', () => ({
  taskManager: {
    addTaskComment: vi.fn().mockResolvedValue({ id: 'mock-comment-1' }),
  },
}))

// Import after mocks are set up
const { chatManager } = await import('../src/chat.js')
const { taskManager } = await import('../src/tasks.js')
const { routeMessage } = await import('../src/messageRouter.js')

describe('messageRouter phantom task-comment suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips chat when status-update-to-task-comment and addTaskComment throws not-found', async () => {
    ;(taskManager.addTaskComment as any).mockRejectedValueOnce(new Error('Task not found'))

    const result = await routeMessage({
      from: 'system',
      content: 'status update for task',
      severity: 'info',
      category: 'status-update',
      taskId: 'task-nonexistent-999',
    })

    // addTaskComment was called
    expect(taskManager.addTaskComment).toHaveBeenCalledOnce()
    // sendMessage should NOT be called — task doesn't exist, no phantom chat line
    expect(chatManager.sendMessage).not.toHaveBeenCalled()
  })

  it('still emits chat when addTaskComment throws non-404 error', async () => {
    ;(taskManager.addTaskComment as any).mockRejectedValueOnce(new Error('Validation error: content too long'))

    const result = await routeMessage({
      from: 'system',
      content: 'status update for task',
      severity: 'info',
      category: 'status-update',
      taskId: 'task-existing-456',
    })

    expect(taskManager.addTaskComment).toHaveBeenCalledOnce()
    // sendMessage SHOULD be called — non-404 errors don't suppress chat
    expect(chatManager.sendMessage).toHaveBeenCalledOnce()
  })

  it('emits chat normally when task comment succeeds', async () => {
    ;(taskManager.addTaskComment as any).mockResolvedValueOnce({ id: 'comment-ok' })

    const result = await routeMessage({
      from: 'system',
      content: 'status update for task',
      severity: 'info',
      category: 'status-update',
      taskId: 'task-existing-789',
    })

    expect(taskManager.addTaskComment).toHaveBeenCalledOnce()
    expect(chatManager.sendMessage).toHaveBeenCalledOnce()
  })

  it('emits chat for non-task-comment routes even when task is missing', async () => {
    ;(taskManager.addTaskComment as any).mockRejectedValueOnce(new Error('Task not found'))

    // Critical messages route to #general, not task-comments
    const result = await routeMessage({
      from: 'system',
      content: 'CRITICAL: something is on fire',
      severity: 'critical',
      category: 'escalation',
      taskId: 'task-nonexistent-999',
    })

    // Chat should be sent regardless for non-task-comment routes
    expect(chatManager.sendMessage).toHaveBeenCalledOnce()
  })
})
