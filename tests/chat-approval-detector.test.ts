import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { detectApproval, applyApproval, type ApprovalSignal, type DetectionResult } from '../src/chat-approval-detector.js'
import { taskManager } from '../src/tasks.js'
import type { Task } from '../src/types.js'

// ── Test helpers ──

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test task',
    description: 'Test description',
    status: 'validating',
    assignee: 'echo',
    reviewer: 'sage',
    done_criteria: [],
    createdBy: 'system',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    priority: 'P1',
    metadata: {},
    tags: [],
    ...overrides,
  } as Task
}

// ── Tests ──

describe('Chat Approval Detector', () => {
  let listTasksSpy: ReturnType<typeof vi.spyOn>
  let getTaskSpy: ReturnType<typeof vi.spyOn>
  let updateTaskSpy: ReturnType<typeof vi.spyOn>
  let addCommentSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    listTasksSpy = vi.spyOn(taskManager, 'listTasks')
    getTaskSpy = vi.spyOn(taskManager, 'getTask')
    updateTaskSpy = vi.spyOn(taskManager, 'updateTask')
    addCommentSpy = vi.spyOn(taskManager, 'addTaskComment')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('detectApproval', () => {
    describe('approval signal patterns', () => {
      const validatingTask = makeTask({ reviewer: 'sage', status: 'validating' })

      const approvalMessages = [
        'LGTM',
        'lgtm!',
        'Approved',
        'This is approved.',
        'Ship it',
        'ship it!',
        'Looks good to me',
        'looks great',
        'Good to go',
        'Good to merge',
        'All good',
        'Looks solid',
        'Nice work',
        '✅',
        '👍',
        '✅ approved',
        '👍 lgtm',
      ]

      for (const msg of approvalMessages) {
        it(`detects approval in "${msg}"`, () => {
          listTasksSpy.mockReturnValue([validatingTask])
          const result = detectApproval('sage', msg)
          expect(result.detected).toBe(true)
        })
      }
    })

    describe('rejection signal overrides', () => {
      const validatingTask = makeTask({ reviewer: 'sage', status: 'validating' })

      // Messages that contain approval patterns BUT also rejection patterns → rejection_signal
      const approvalWithRejection = [
        'Not approved — needs changes',
        'LGTM but needs work on X',
        'Approved but fix before merge',
      ]

      for (const msg of approvalWithRejection) {
        it(`detects rejection override in "${msg}"`, () => {
          listTasksSpy.mockReturnValue([validatingTask])
          const result = detectApproval('sage', msg)
          expect(result.detected).toBe(false)
          expect(result.skipped?.reason).toBe('rejection_signal')
        })
      }

      // Messages that don't even match approval patterns → no_approval_signal
      const noApprovalSignal = [
        'Rejected',
        'Blocking on test coverage',
        'Requested changes',
        'Don\'t ship this yet',
        'Looks good but needs fixes',
      ]

      for (const msg of noApprovalSignal) {
        it(`does NOT detect approval in "${msg}"`, () => {
          listTasksSpy.mockReturnValue([validatingTask])
          const result = detectApproval('sage', msg)
          expect(result.detected).toBe(false)
        })
      }
    })

    describe('no approval signal', () => {
      it('returns no_approval_signal for regular messages', () => {
        const result = detectApproval('sage', 'Hey, how is the task going?')
        expect(result.detected).toBe(false)
        expect(result.skipped?.reason).toBe('no_approval_signal')
      })

      it('returns no_approval_signal for empty content', () => {
        const result = detectApproval('sage', '')
        expect(result.detected).toBe(false)
        expect(result.skipped?.reason).toBe('no_approval_signal')
      })
    })

    describe('reviewer matching', () => {
      it('only detects for the assigned reviewer', () => {
        const task = makeTask({ reviewer: 'sage', status: 'validating' })
        listTasksSpy.mockReturnValue([task])

        const result = detectApproval('echo', 'LGTM')
        expect(result.detected).toBe(false)
        expect(result.skipped?.reason).toBe('no_validating_tasks')
      })

      it('matches reviewer case-insensitively', () => {
        const task = makeTask({ reviewer: 'Sage', status: 'validating' })
        listTasksSpy.mockReturnValue([task])

        const result = detectApproval('sage', 'LGTM')
        expect(result.detected).toBe(true)
      })
    })

    describe('task resolution', () => {
      it('targets explicitly referenced task ID', () => {
        const task1 = makeTask({ id: 'task-1111111111111-aaaa', reviewer: 'sage', status: 'validating' })
        const task2 = makeTask({ id: 'task-2222222222222-bbbb', reviewer: 'sage', status: 'validating' })
        listTasksSpy.mockReturnValue([task1, task2])

        const result = detectApproval('sage', 'LGTM on task-1111111111111-aaaa')
        expect(result.detected).toBe(true)
        expect(result.signal?.taskId).toBe('task-1111111111111-aaaa')
        expect(result.signal?.source).toBe('explicit_reference')
      })

      it('resolves sole validating task when no task referenced', () => {
        const task = makeTask({ id: 'task-3333333333333-cccc', reviewer: 'sage', status: 'validating' })
        listTasksSpy.mockReturnValue([task])

        const result = detectApproval('sage', 'LGTM')
        expect(result.detected).toBe(true)
        expect(result.signal?.taskId).toBe('task-3333333333333-cccc')
        expect(result.signal?.source).toBe('sole_validating')
      })

      it('skips when multiple validating tasks and no reference', () => {
        const task1 = makeTask({ id: 'task-4444444444444-dddd', reviewer: 'sage', status: 'validating' })
        const task2 = makeTask({ id: 'task-5555555555555-eeee', reviewer: 'sage', status: 'validating' })
        listTasksSpy.mockReturnValue([task1, task2])

        const result = detectApproval('sage', 'LGTM')
        expect(result.detected).toBe(false)
        expect(result.skipped?.reason).toBe('ambiguous_tasks')
      })

      it('skips when referenced task is not in validating', () => {
        const doingTask = makeTask({ id: 'task-6666666666666-ffff', reviewer: 'sage', status: 'doing' })
        listTasksSpy.mockReturnValue([]) // no validating tasks for reviewer
        // Mock the general listTasks for the fallback check
        listTasksSpy.mockImplementation((opts: any) => {
          if (opts?.status === 'validating') return []
          return [doingTask]
        })

        const result = detectApproval('sage', 'LGTM on task-6666666666666-ffff')
        expect(result.detected).toBe(false)
      })

      it('skips when referenced task has different reviewer', () => {
        const task = makeTask({ id: 'task-7777777777777-gggg', reviewer: 'kai', status: 'validating' })
        // listTasks for reviewer 'sage' returns nothing, general returns the task
        listTasksSpy.mockImplementation((opts: any) => {
          if (opts?.status === 'validating') return []
          return [task]
        })

        const result = detectApproval('sage', 'LGTM on task-7777777777777-gggg')
        expect(result.detected).toBe(false)
      })

      it('skips already-approved tasks', () => {
        const task = makeTask({
          reviewer: 'sage',
          status: 'validating',
          metadata: { reviewer_approved: true },
        })
        listTasksSpy.mockReturnValue([]) // already approved is filtered out

        const result = detectApproval('sage', 'LGTM')
        expect(result.detected).toBe(false)
        expect(result.skipped?.reason).toBe('no_validating_tasks')
      })

      it('skips when multiple task IDs are referenced', () => {
        const task1 = makeTask({ id: 'task-8888888888888-hhhh', reviewer: 'sage', status: 'validating' })
        const task2 = makeTask({ id: 'task-9999999999999-iiii', reviewer: 'sage', status: 'validating' })
        listTasksSpy.mockReturnValue([task1, task2])

        const result = detectApproval('sage', 'LGTM on task-8888888888888-hhhh and task-9999999999999-iiii')
        expect(result.detected).toBe(false)
        expect(result.skipped?.reason).toBe('ambiguous_tasks')
      })
    })
  })

  describe('applyApproval', () => {
    it('updates task metadata with reviewer_approved', async () => {
      const task = makeTask({
        id: 'task-1234567890123-test',
        reviewer: 'sage',
        status: 'validating',
        metadata: {},
      })

      getTaskSpy.mockReturnValue(task)
      updateTaskSpy.mockResolvedValue({ ...task, metadata: { reviewer_approved: true } })
      addCommentSpy.mockResolvedValue(undefined)

      const signal: ApprovalSignal = {
        taskId: task.id,
        reviewer: 'sage',
        source: 'sole_validating',
        matchedPattern: '\\blgtm\\b',
        comment: 'LGTM',
      }

      const result = await applyApproval(signal)
      expect(result).toBeDefined()

      expect(updateTaskSpy).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({
          metadata: expect.objectContaining({
            reviewer_approved: true,
            review_state: 'approved',
            actor: 'sage',
          }),
        }),
      )
    })

    it('adds audit comment documenting the detection', async () => {
      const task = makeTask({
        id: 'task-1234567890123-audit',
        reviewer: 'sage',
        status: 'validating',
        metadata: {},
      })

      getTaskSpy.mockReturnValue(task)
      updateTaskSpy.mockResolvedValue({ ...task, metadata: { reviewer_approved: true } })
      addCommentSpy.mockResolvedValue(undefined)

      const signal: ApprovalSignal = {
        taskId: task.id,
        reviewer: 'sage',
        source: 'explicit_reference',
        matchedPattern: '\\bapproved?\\b',
        comment: `Approved ${task.id}`,
      }

      await applyApproval(signal)

      expect(addCommentSpy).toHaveBeenCalledWith(
        task.id,
        'system',
        expect.stringContaining('[review] auto-approved'),
      )
    })

    it('is idempotent — does not double-approve', async () => {
      const task = makeTask({
        id: 'task-1234567890123-idem',
        reviewer: 'sage',
        status: 'validating',
        metadata: { reviewer_approved: true },
      })

      getTaskSpy.mockReturnValue(task)

      const signal: ApprovalSignal = {
        taskId: task.id,
        reviewer: 'sage',
        source: 'sole_validating',
        matchedPattern: '\\blgtm\\b',
        comment: 'LGTM',
      }

      const result = await applyApproval(signal)
      expect(result).toBe(task) // returns existing, no update
      expect(updateTaskSpy).not.toHaveBeenCalled()
    })

    it('returns undefined for missing task', async () => {
      getTaskSpy.mockReturnValue(undefined)

      const signal: ApprovalSignal = {
        taskId: 'task-nonexistent-xxx',
        reviewer: 'sage',
        source: 'sole_validating',
        matchedPattern: '\\blgtm\\b',
        comment: 'LGTM',
      }

      const result = await applyApproval(signal)
      expect(result).toBeUndefined()
    })

    it('includes chat-approval-detector source in reviewer_decision', async () => {
      const task = makeTask({
        id: 'task-1234567890123-src',
        reviewer: 'sage',
        status: 'validating',
        metadata: {},
      })

      getTaskSpy.mockReturnValue(task)
      updateTaskSpy.mockResolvedValue({ ...task, metadata: { reviewer_approved: true } })
      addCommentSpy.mockResolvedValue(undefined)

      const signal: ApprovalSignal = {
        taskId: task.id,
        reviewer: 'sage',
        source: 'sole_validating',
        matchedPattern: '\\blgtm\\b',
        comment: 'LGTM',
      }

      await applyApproval(signal)

      const updateCall = updateTaskSpy.mock.calls[0]
      const meta = updateCall[1].metadata
      expect(meta.reviewer_decision.source).toBe('chat-approval-detector')
      expect(meta.reviewer_decision.resolution).toBe('sole_validating')
    })
  })
})
