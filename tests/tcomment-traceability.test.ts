import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock taskManager and chatManager before importing routeMessage
const mockAddTaskComment = vi.fn()
const mockSendMessage = vi.fn()

vi.mock('../src/tasks.js', () => ({
  taskManager: {
    addTaskComment: (...args: any[]) => mockAddTaskComment(...args),
  },
}))

vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage: (...args: any[]) => mockSendMessage(...args),
  },
}))

describe('tcomment traceability in chat emissions', () => {
  beforeEach(() => {
    mockAddTaskComment.mockReset()
    mockSendMessage.mockReset()
  })

  it('includes tcomment id in chat message when comment succeeds', async () => {
    const { routeMessage } = await import('../src/messageRouter.js')

    mockAddTaskComment.mockResolvedValue({ id: 'tcomment-abc123' })
    mockSendMessage.mockResolvedValue({ id: 'msg-xyz' })

    const result = await routeMessage({
      from: 'link',
      content: 'Status update on task',
      category: 'status-update',
      severity: 'info',
      taskId: 'task-123',
    })

    // Chat message should include the tcomment id
    const sentContent = mockSendMessage.mock.calls[0]?.[0]?.content || ''
    expect(sentContent).toContain('[tcomment:tcomment-abc123]')
    expect(result.commentId).toBe('tcomment-abc123')
  })

  it('does not include tcomment tag when no comment created', async () => {
    const { routeMessage } = await import('../src/messageRouter.js')

    mockSendMessage.mockResolvedValue({ id: 'msg-xyz' })

    const result = await routeMessage({
      from: 'link',
      content: 'General message no task',
      category: 'system-info',
      severity: 'info',
    })

    const sentContent = mockSendMessage.mock.calls[0]?.[0]?.content || ''
    expect(sentContent).not.toContain('[tcomment:')
  })
})
