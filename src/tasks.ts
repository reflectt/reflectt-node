/**
 * Task management system
 */
import type { Task, RecurringTask, RecurringTaskSchedule, TaskHistoryEvent, TaskComment } from './types.js'
import { promises as fs } from 'fs'
import { join } from 'path'
import { eventBus } from './events.js'
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js'

const TASKS_FILE = join(DATA_DIR, 'tasks.jsonl')
const LEGACY_TASKS_FILE = join(LEGACY_DATA_DIR, 'tasks.jsonl')
const RECURRING_TASKS_FILE = join(DATA_DIR, 'tasks.recurring.jsonl')
const TASK_HISTORY_FILE = join(DATA_DIR, 'tasks.history.jsonl')
const TASK_COMMENTS_FILE = join(DATA_DIR, 'tasks.comments.jsonl')

class TaskManager {
  private tasks = new Map<string, Task>()
  private subscribers = new Set<(task: Task, action: 'created' | 'updated' | 'deleted') => void>()
  private recurringTasks = new Map<string, RecurringTask>()
  private taskHistory = new Map<string, TaskHistoryEvent[]>()
  private taskComments = new Map<string, TaskComment[]>()
  private initialized = false
  private recurringInitialized = false
  private recurringTicker: NodeJS.Timeout

  private validateLifecycleGates(task: Pick<Task, 'status' | 'reviewer' | 'done_criteria' | 'metadata'>): void {
    if (task.status === 'todo') return

    const hasReviewer = Boolean(task.reviewer && task.reviewer.trim().length > 0)
    const hasDoneCriteria = Boolean(task.done_criteria && task.done_criteria.length > 0)
    const eta = (task.metadata as any)?.eta
    const hasEta = typeof eta === 'string' && eta.trim().length > 0
    const artifactPath = (task.metadata as any)?.artifact_path
    const hasArtifactPath = typeof artifactPath === 'string' && artifactPath.trim().length > 0

    if (!hasDoneCriteria) {
      throw new Error('Lifecycle gate: done_criteria is required before starting task work')
    }

    if (!hasReviewer) {
      throw new Error('Lifecycle gate: reviewer is required before starting task work')
    }

    if (task.status === 'doing' && !hasEta) {
      throw new Error('Status contract: doing requires metadata.eta')
    }

    if (task.status === 'validating' && !hasArtifactPath) {
      throw new Error('Status contract: validating requires metadata.artifact_path')
    }
  }

  constructor() {
    this.loadTasks()
      .then(() => this.loadTaskHistory())
      .then(() => this.loadTaskComments())
      .then(() => this.loadRecurringTasks())
      .then(() => this.materializeDueRecurringTasks())
      .catch(err => {
        console.error('[Tasks] Failed to load tasks:', err)
      })

    this.recurringTicker = setInterval(() => {
      this.materializeDueRecurringTasks().catch(err => {
        console.error('[Tasks] Recurring materialization failed:', err)
      })
    }, 60_000)
    this.recurringTicker.unref()
  }

  private async loadTasks(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(DATA_DIR, { recursive: true })

      // Try to read existing tasks
      let tasksLoaded = false
      try {
        const content = await fs.readFile(TASKS_FILE, 'utf-8')
        const lines = content.trim().split('\n').filter(line => line.length > 0)
        
        for (const line of lines) {
          try {
            const task = JSON.parse(line) as Task
            this.tasks.set(task.id, task)
          } catch (err) {
            console.error('[Tasks] Failed to parse task line:', err)
          }
        }
        
        console.log(`[Tasks] Loaded ${this.tasks.size} tasks from disk`)
        tasksLoaded = true
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        // File doesn't exist yet - try legacy location
      }

      // Migration: Check legacy data directory
      if (!tasksLoaded) {
        try {
          const legacyContent = await fs.readFile(LEGACY_TASKS_FILE, 'utf-8')
          const lines = legacyContent.trim().split('\n').filter(line => line.length > 0)
          
          for (const line of lines) {
            try {
              const task = JSON.parse(line) as Task
              this.tasks.set(task.id, task)
            } catch (err) {
              console.error('[Tasks] Failed to parse legacy task line:', err)
            }
          }
          
          console.log(`[Tasks] Migrated ${this.tasks.size} tasks from legacy location`)
          
          // Write to new location
          if (this.tasks.size > 0) {
            const lines = Array.from(this.tasks.values()).map(task => JSON.stringify(task))
            await fs.writeFile(TASKS_FILE, lines.join('\n') + '\n', 'utf-8')
            console.log('[Tasks] Migration complete - tasks saved to new location')
          }
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.error('[Tasks] Failed to migrate from legacy location:', err)
          }
          // No legacy file either - starting fresh
          console.log('[Tasks] No existing tasks file, starting fresh')
        }
      }
    } finally {
      this.initialized = true
    }
  }

  private async loadRecurringTasks(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      try {
        const content = await fs.readFile(RECURRING_TASKS_FILE, 'utf-8')
        const lines = content.trim().split('\n').filter(line => line.length > 0)

        for (const line of lines) {
          try {
            const recurring = JSON.parse(line) as RecurringTask
            this.recurringTasks.set(recurring.id, recurring)
          } catch (err) {
            console.error('[Tasks] Failed to parse recurring task line:', err)
          }
        }

        console.log(`[Tasks] Loaded ${this.recurringTasks.size} recurring task definitions`)
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        console.log('[Tasks] No recurring task definitions yet')
      }
    } finally {
      this.recurringInitialized = true
    }
  }

  private async loadTaskHistory(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      try {
        const content = await fs.readFile(TASK_HISTORY_FILE, 'utf-8')
        const lines = content.trim().split('\n').filter(line => line.length > 0)

        for (const line of lines) {
          try {
            const event = JSON.parse(line) as TaskHistoryEvent
            const existing = this.taskHistory.get(event.taskId) || []
            existing.push(event)
            this.taskHistory.set(event.taskId, existing)
          } catch (err) {
            console.error('[Tasks] Failed to parse task history line:', err)
          }
        }

        for (const [taskId, events] of this.taskHistory.entries()) {
          events.sort((a, b) => a.timestamp - b.timestamp)
          this.taskHistory.set(taskId, events)
        }

        const loadedCount = Array.from(this.taskHistory.values()).reduce((sum, events) => sum + events.length, 0)
        console.log(`[Tasks] Loaded ${loadedCount} task history events`)
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        console.log('[Tasks] No task history yet')
      }
    } catch (err) {
      console.error('[Tasks] Failed to load task history:', err)
    }
  }

  private async loadTaskComments(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      try {
        const content = await fs.readFile(TASK_COMMENTS_FILE, 'utf-8')
        const lines = content.trim().split('\n').filter(line => line.length > 0)

        for (const line of lines) {
          try {
            const comment = JSON.parse(line) as TaskComment
            const existing = this.taskComments.get(comment.taskId) || []
            existing.push(comment)
            this.taskComments.set(comment.taskId, existing)
          } catch (err) {
            console.error('[Tasks] Failed to parse task comment line:', err)
          }
        }

        for (const [taskId, comments] of this.taskComments.entries()) {
          comments.sort((a, b) => a.timestamp - b.timestamp)
          this.taskComments.set(taskId, comments)
        }

        const loadedCount = Array.from(this.taskComments.values()).reduce((sum, comments) => sum + comments.length, 0)
        console.log(`[Tasks] Loaded ${loadedCount} task comments`)
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        console.log('[Tasks] No task comments yet')
      }
    } catch (err) {
      console.error('[Tasks] Failed to load task comments:', err)
    }
  }

  private async appendTaskHistory(event: TaskHistoryEvent): Promise<void> {
    const existing = this.taskHistory.get(event.taskId) || []
    existing.push(event)
    existing.sort((a, b) => a.timestamp - b.timestamp)
    this.taskHistory.set(event.taskId, existing)

    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.appendFile(TASK_HISTORY_FILE, `${JSON.stringify(event)}\n`, 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to append task history:', err)
    }
  }

  private async recordTaskHistoryEvent(
    taskId: string,
    type: TaskHistoryEvent['type'],
    actor: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const event: TaskHistoryEvent = {
      id: `thevt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      type,
      actor,
      timestamp: Date.now(),
      data,
    }

    await this.appendTaskHistory(event)
  }

  private async appendTaskComment(comment: TaskComment): Promise<void> {
    const existing = this.taskComments.get(comment.taskId) || []
    existing.push(comment)
    existing.sort((a, b) => a.timestamp - b.timestamp)
    this.taskComments.set(comment.taskId, existing)

    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.appendFile(TASK_COMMENTS_FILE, `${JSON.stringify(comment)}\n`, 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to append task comment:', err)
    }
  }

  private async persistRecurringTasks(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      const lines = Array.from(this.recurringTasks.values()).map(task => JSON.stringify(task))
      await fs.writeFile(RECURRING_TASKS_FILE, lines.join('\n') + '\n', 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to persist recurring tasks:', err)
    }
  }

  private computeNextRunAt(
    schedule: RecurringTaskSchedule,
    fromMs: number,
    createdAt: number,
  ): number {
    if (schedule.kind === 'interval') {
      const everyMs = Math.max(60_000, schedule.everyMs)
      const anchor = schedule.anchorAt ?? createdAt
      if (fromMs < anchor) return anchor
      const periods = Math.floor((fromMs - anchor) / everyMs) + 1
      return anchor + periods * everyMs
    }

    const hour = schedule.hour ?? 9
    const minute = schedule.minute ?? 0
    const candidate = new Date(fromMs)
    candidate.setSeconds(0, 0)
    candidate.setHours(hour, minute, 0, 0)

    let dayDelta = schedule.dayOfWeek - candidate.getDay()
    if (dayDelta < 0 || (dayDelta === 0 && candidate.getTime() <= fromMs)) {
      dayDelta += 7
    }

    candidate.setDate(candidate.getDate() + dayDelta)

    if (candidate.getTime() <= fromMs) {
      candidate.setDate(candidate.getDate() + 7)
    }

    return candidate.getTime()
  }

  private hasMaterializedRun(recurringId: string, scheduledFor: number): boolean {
    for (const task of this.tasks.values()) {
      const recurringMeta = (task.metadata as any)?.recurring
      if (recurringMeta?.id === recurringId && recurringMeta?.scheduledFor === scheduledFor) {
        return true
      }
    }
    return false
  }

  private getLatestRecurringInstance(recurringId: string): Task | undefined {
    const instances = Array.from(this.tasks.values())
      .filter(task => (task.metadata as any)?.recurring?.id === recurringId)
      .sort((a, b) => b.createdAt - a.createdAt)

    return instances[0]
  }

  async materializeDueRecurringTasks(now = Date.now(), options?: { force?: boolean }): Promise<{ created: number; skipped: number }> {
    let created = 0
    let skipped = 0
    let recurringChanged = false

    for (const recurring of this.recurringTasks.values()) {
      if (!recurring.enabled) continue

      let safetyCounter = 0
      while (recurring.nextRunAt <= now && safetyCounter < 16) {
        const scheduledFor = recurring.nextRunAt

        const previousInstance = this.getLatestRecurringInstance(recurring.id)
        const shouldSkipForOpenPredecessor =
          !options?.force &&
          previousInstance !== undefined &&
          previousInstance.status !== 'done'

        if (shouldSkipForOpenPredecessor) {
          const reason = `skip: previous recurring instance still open (${previousInstance!.id}, status=${previousInstance!.status})`
          recurring.lastSkipAt = Date.now()
          recurring.lastSkipReason = reason
          console.log(`[Tasks] Recurring materialization skipped for ${recurring.id}: ${reason}`)
          skipped += 1
        } else if (!this.hasMaterializedRun(recurring.id, scheduledFor)) {
          await this.createTask({
            title: recurring.title,
            description: recurring.description,
            status: recurring.status ?? 'todo',
            assignee: recurring.assignee,
            reviewer: recurring.reviewer,
            done_criteria: recurring.done_criteria,
            createdBy: recurring.createdBy,
            priority: recurring.priority,
            blocked_by: recurring.blocked_by,
            epic_id: recurring.epic_id,
            tags: recurring.tags,
            metadata: {
              ...(recurring.metadata || {}),
              recurring: {
                id: recurring.id,
                scheduledFor,
              },
            },
          })
          created += 1
        }

        recurring.lastRunAt = scheduledFor
        recurring.nextRunAt = this.computeNextRunAt(recurring.schedule, scheduledFor, recurring.createdAt)
        recurring.updatedAt = Date.now()
        recurringChanged = true
        safetyCounter += 1
      }
    }

    if (recurringChanged) {
      await this.persistRecurringTasks()
    }

    return { created, skipped }
  }

  private async persistTasks(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(DATA_DIR, { recursive: true })
      
      // Write all tasks as JSONL
      const lines = Array.from(this.tasks.values()).map(task => JSON.stringify(task))
      await fs.writeFile(TASKS_FILE, lines.join('\n') + '\n', 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to persist tasks:', err)
    }
  }

  async createTask(data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    this.validateLifecycleGates(data)

    // Validate blocked_by references
    if (data.blocked_by && data.blocked_by.length > 0) {
      for (const blockerId of data.blocked_by) {
        if (!this.tasks.has(blockerId)) {
          throw new Error(`Invalid blocked_by reference: task ${blockerId} does not exist`)
        }
      }
    }

    const task: Task = {
      ...data,
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.tasks.set(task.id, task)
    await this.persistTasks()
    await this.recordTaskHistoryEvent(task.id, 'created', task.createdBy, {
      status: task.status,
      assignee: task.assignee ?? null,
    })
    if (task.assignee) {
      await this.recordTaskHistoryEvent(task.id, 'assigned', task.createdBy, {
        from: null,
        to: task.assignee,
      })
    }

    this.notifySubscribers(task, 'created')
    
    // Emit events to event bus
    eventBus.emitTaskCreated(task)
    if (task.assignee) {
      eventBus.emitTaskAssigned(task)
    }
    
    return task
  }

  async createRecurringTask(data: {
    title: string
    description?: string
    assignee?: string
    reviewer?: string
    done_criteria?: string[]
    createdBy: string
    priority?: Task['priority']
    blocked_by?: string[]
    epic_id?: string
    tags?: string[]
    metadata?: Record<string, unknown>
    schedule: RecurringTaskSchedule
    enabled?: boolean
    status?: Task['status']
  }): Promise<RecurringTask> {
    if (data.blocked_by && data.blocked_by.length > 0) {
      for (const blockerId of data.blocked_by) {
        if (!this.tasks.has(blockerId)) {
          throw new Error(`Invalid blocked_by reference: task ${blockerId} does not exist`)
        }
      }
    }

    const now = Date.now()
    const recurring: RecurringTask = {
      id: `rtask-${now}-${Math.random().toString(36).substr(2, 9)}`,
      title: data.title,
      description: data.description,
      assignee: data.assignee,
      reviewer: data.reviewer,
      done_criteria: data.done_criteria,
      createdBy: data.createdBy,
      priority: data.priority,
      blocked_by: data.blocked_by,
      epic_id: data.epic_id,
      tags: data.tags,
      metadata: data.metadata,
      schedule: data.schedule,
      enabled: data.enabled ?? true,
      status: data.status ?? 'todo',
      nextRunAt: this.computeNextRunAt(data.schedule, now, now),
      createdAt: now,
      updatedAt: now,
    }

    this.recurringTasks.set(recurring.id, recurring)
    await this.persistRecurringTasks()
    await this.materializeDueRecurringTasks()

    return recurring
  }

  listRecurringTasks(options?: { enabled?: boolean }): RecurringTask[] {
    let tasks = Array.from(this.recurringTasks.values())
    if (typeof options?.enabled === 'boolean') {
      tasks = tasks.filter(task => task.enabled === options.enabled)
    }
    return tasks.sort((a, b) => a.nextRunAt - b.nextRunAt)
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  resolveTaskId(inputId: string): {
    task?: Task
    resolvedId?: string
    matchType: 'exact' | 'prefix' | 'ambiguous' | 'not_found'
    suggestions: string[]
  } {
    const raw = String(inputId || '').trim()
    if (!raw) {
      return { matchType: 'not_found', suggestions: [] }
    }

    const exact = this.tasks.get(raw)
    if (exact) {
      return { task: exact, resolvedId: raw, matchType: 'exact', suggestions: [] }
    }

    const lowerRaw = raw.toLowerCase()
    const ids = Array.from(this.tasks.keys())
    const prefixMatches = ids.filter(id => id.toLowerCase().startsWith(lowerRaw))

    if (prefixMatches.length === 1) {
      const resolvedId = prefixMatches[0]
      return {
        task: this.tasks.get(resolvedId),
        resolvedId,
        matchType: 'prefix',
        suggestions: [],
      }
    }

    if (prefixMatches.length > 1) {
      return {
        matchType: 'ambiguous',
        suggestions: prefixMatches.slice(0, 8),
      }
    }

    const containsMatches = ids.filter(id => id.toLowerCase().includes(lowerRaw)).slice(0, 8)
    return {
      matchType: 'not_found',
      suggestions: containsMatches,
    }
  }

  getTaskHistory(id: string): TaskHistoryEvent[] {
    const events = this.taskHistory.get(id) || []
    return [...events].sort((a, b) => a.timestamp - b.timestamp)
  }

  getTaskComments(id: string): TaskComment[] {
    const comments = this.taskComments.get(id) || []
    return [...comments].sort((a, b) => a.timestamp - b.timestamp)
  }

  getTaskCommentCount(id: string): number {
    return this.taskComments.get(id)?.length || 0
  }

  async addTaskComment(taskId: string, author: string, content: string): Promise<TaskComment> {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error('Task not found')
    }

    const now = Date.now()
    const comment: TaskComment = {
      id: `tcomment-${now}-${Math.random().toString(36).substr(2, 9)}`,
      taskId,
      author,
      content,
      timestamp: now,
    }

    await this.appendTaskComment(comment)
    await this.recordTaskHistoryEvent(taskId, 'commented', author, {
      commentId: comment.id,
      content,
    })

    return comment
  }

  listTasks(options?: {
    status?: Task['status']
    assignee?: string
    assignedTo?: string // Backward compatibility
    createdBy?: string
    priority?: Task['priority']
    tags?: string[]
    includeBlocked?: boolean // If false, filter out blocked tasks (default: true)
  }): Task[] {
    void this.materializeDueRecurringTasks().catch(() => {})

    // Helper: check if a task is blocked by incomplete dependencies
    const isBlocked = (task: Task): boolean => {
      if (!task.blocked_by || task.blocked_by.length === 0) return false
      
      return task.blocked_by.some(blockerId => {
        const blocker = this.tasks.get(blockerId)
        return blocker && blocker.status !== 'done'
      })
    }

    let tasks = Array.from(this.tasks.values())

    if (options?.status) {
      tasks = tasks.filter(t => t.status === options.status)
    }

    // Support both assignee and assignedTo for backward compatibility
    const assigneeFilter = options?.assignee || options?.assignedTo
    if (assigneeFilter) {
      tasks = tasks.filter(t => t.assignee === assigneeFilter)
    }

    if (options?.createdBy) {
      tasks = tasks.filter(t => t.createdBy === options.createdBy)
    }

    if (options?.priority) {
      tasks = tasks.filter(t => t.priority === options.priority)
    }

    if (options?.tags && options.tags.length > 0) {
      tasks = tasks.filter(t => 
        t.tags && options.tags!.some(tag => t.tags!.includes(tag))
      )
    }

    // Filter blocked tasks if requested
    if (options?.includeBlocked === false) {
      tasks = tasks.filter(t => !isBlocked(t))
    }

    return tasks.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  searchTasks(query: string): Task[] {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return []

    return Array.from(this.tasks.values())
      .filter(task => {
        const title = task.title.toLowerCase()
        const description = (task.description || '').toLowerCase()
        return title.includes(normalized) || description.includes(normalized)
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private resolveHistoryActor(task: Task, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'createdBy'>>): string {
    const metadataActor = (updates.metadata as any)?.actor
    if (typeof metadataActor === 'string' && metadataActor.trim().length > 0) {
      return metadataActor.trim()
    }

    if (typeof updates.assignee === 'string' && updates.assignee.trim().length > 0) {
      return updates.assignee.trim()
    }

    if (task.assignee && task.assignee.trim().length > 0) {
      return task.assignee.trim()
    }

    return task.createdBy
  }

  private parseLaneTransition(updates: Partial<Omit<Task, 'id' | 'createdAt' | 'createdBy'>>): Record<string, unknown> | undefined {
    const transition = (updates.metadata as any)?.transition
    if (!transition || typeof transition !== 'object' || Array.isArray(transition)) return undefined
    return transition as Record<string, unknown>
  }

  private applyLaneStateLock(
    task: Task,
    updates: Partial<Omit<Task, 'id' | 'createdAt' | 'createdBy'>>,
    actor: string,
  ): { transitionEvent?: Record<string, unknown> } {
    const transition = this.parseLaneTransition(updates)
    const nextStatus = updates.status ?? task.status
    const nextAssignee = updates.assignee ?? task.assignee
    const statusChanged = nextStatus !== task.status
    const assigneeChanged = updates.assignee !== undefined && updates.assignee !== task.assignee

    const requireTransition = (
      expectedType: 'pause' | 'resume' | 'handoff',
      requiredFields: string[],
      contextLabel: string,
    ): Record<string, unknown> => {
      if (!transition) {
        throw new Error(`Lane-state lock: ${contextLabel} requires metadata.transition`)
      }
      const type = transition.type
      if (type !== expectedType) {
        throw new Error(`Lane-state lock: ${contextLabel} requires metadata.transition.type="${expectedType}"`)
      }
      for (const field of requiredFields) {
        const value = transition[field]
        if (typeof value !== 'string' || value.trim().length === 0) {
          throw new Error(`Lane-state lock: ${contextLabel} requires metadata.transition.${field}`)
        }
      }
      return transition
    }

    let transitionEvent: Record<string, unknown> | undefined

    if (task.status === 'doing' && nextStatus === 'blocked') {
      const parsed = requireTransition('pause', ['reason'], 'doing->blocked transition')
      transitionEvent = {
        type: 'pause',
        reason: parsed.reason,
      }
    } else if (task.status === 'blocked' && nextStatus === 'doing') {
      const parsed = requireTransition('resume', ['reason'], 'blocked->doing transition')
      transitionEvent = {
        type: 'resume',
        reason: parsed.reason,
      }
    } else if (task.status === 'doing' && nextStatus === 'doing' && assigneeChanged) {
      const parsed = requireTransition('handoff', ['handoff_to', 'reason'], 'doing handoff transition')
      if (typeof nextAssignee !== 'string' || nextAssignee.trim().length === 0) {
        throw new Error('Lane-state lock: handoff requires assignee to be set')
      }
      if (String(parsed.handoff_to).trim() !== nextAssignee.trim()) {
        throw new Error('Lane-state lock: metadata.transition.handoff_to must match new assignee')
      }
      transitionEvent = {
        type: 'handoff',
        reason: parsed.reason,
        handoff_to: parsed.handoff_to,
      }
    }

    if (!transitionEvent) {
      return {}
    }

    const timestamp = Date.now()
    const metadata = {
      ...((updates.metadata || {}) as Record<string, unknown>),
      lane_state: nextStatus === 'blocked' ? 'paused' : 'active',
      last_transition: {
        type: transitionEvent.type,
        actor,
        timestamp,
        from_status: task.status,
        to_status: nextStatus,
        from_assignee: task.assignee ?? null,
        to_assignee: nextAssignee ?? null,
        reason: transitionEvent.reason ?? null,
        handoff_to: transitionEvent.handoff_to ?? null,
      },
    }

    updates.metadata = metadata

    return {
      transitionEvent: {
        ...transitionEvent,
        actor,
        timestamp,
        from_status: task.status,
        to_status: nextStatus,
        from_assignee: task.assignee ?? null,
        to_assignee: nextAssignee ?? null,
      },
    }
  }

  async updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'createdBy'>>): Promise<Task | undefined> {
    const task = this.tasks.get(id)
    if (!task) return undefined

    // Validate blocked_by references if being updated
    if (updates.blocked_by && updates.blocked_by.length > 0) {
      for (const blockerId of updates.blocked_by) {
        if (blockerId === id) {
          throw new Error('Task cannot be blocked by itself')
        }
        if (!this.tasks.has(blockerId)) {
          throw new Error(`Invalid blocked_by reference: task ${blockerId} does not exist`)
        }
      }
      
      // Check for circular dependencies
      // We need to verify that none of the new blockers (or their dependencies) point back to this task
      const checkCircular = (taskId: string, visited = new Set<string>()): boolean => {
        // If we've reached the original task, there's a cycle
        if (taskId === id) return true
        
        // If we've already visited this node in this path, no cycle (but avoid infinite loops)
        if (visited.has(taskId)) return false
        
        visited.add(taskId)
        
        // Get the task and check its dependencies
        const t = this.tasks.get(taskId)
        if (!t || !t.blocked_by) return false
        
        // Recursively check each dependency
        for (const bid of t.blocked_by) {
          if (checkCircular(bid, new Set(visited))) return true
        }
        
        return false
      }
      
      for (const blockerId of updates.blocked_by) {
        if (checkCircular(blockerId)) {
          throw new Error('Circular dependency detected in blocked_by chain')
        }
      }
    }

    const actor = this.resolveHistoryActor(task, updates)
    const { transitionEvent } = this.applyLaneStateLock(task, updates, actor)

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    }

    this.validateLifecycleGates(updated)

    this.tasks.set(id, updated)
    await this.persistTasks()

    if (updates.assignee !== undefined && updates.assignee !== task.assignee) {
      await this.recordTaskHistoryEvent(id, 'assigned', actor, {
        from: task.assignee ?? null,
        to: updates.assignee ?? null,
      })
    }

    if (updates.status !== undefined && updates.status !== task.status) {
      await this.recordTaskHistoryEvent(id, 'status_changed', actor, {
        from: task.status,
        to: updates.status,
      })
    }

    if (transitionEvent) {
      await this.recordTaskHistoryEvent(id, 'lane_transition', actor, transitionEvent)
    }

    this.notifySubscribers(updated, 'updated')
    
    // Emit events to event bus
    eventBus.emitTaskUpdated(updated, updates)
    
    // If assignee changed, emit task_assigned
    if (updates.assignee && updates.assignee !== task.assignee) {
      eventBus.emitTaskAssigned(updated)
    }
    
    // If task completed, check for unblocked tasks
    if (updates.status === 'done' && task.status !== 'done') {
      this.checkUnblockedTasks(id)
    }
    
    return updated
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id)
    if (!task) return false

    this.tasks.delete(id)
    await this.persistTasks()
    this.notifySubscribers(task, 'deleted')
    return true
  }

  subscribe(callback: (task: Task, action: 'created' | 'updated' | 'deleted') => void) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notifySubscribers(task: Task, action: 'created' | 'updated' | 'deleted') {
    this.subscribers.forEach(callback => {
      try {
        callback(task, action)
      } catch (err) {
        console.error('[Tasks] Subscriber error:', err)
      }
    })
  }

  private checkUnblockedTasks(completedTaskId: string): void {
    // Find all tasks that were blocked by this completed task
    const unblockedTasks: Task[] = []
    
    for (const task of this.tasks.values()) {
      if (task.blocked_by && task.blocked_by.includes(completedTaskId)) {
        // Check if all blocking tasks are done
        const stillBlocked = task.blocked_by.some(blockerId => {
          const blocker = this.tasks.get(blockerId)
          return blocker && blocker.status !== 'done'
        })
        
        if (!stillBlocked) {
          unblockedTasks.push(task)
        }
      }
    }
    
    if (unblockedTasks.length > 0) {
      console.log(`[Tasks] Task ${completedTaskId} completion unblocked ${unblockedTasks.length} task(s):`, 
        unblockedTasks.map(t => t.id).join(', '))
      
      // Emit event for each unblocked task
      for (const task of unblockedTasks) {
        eventBus.emit({
          id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'task_updated',
          timestamp: Date.now(),
          data: {
            ...task,
            unblocked: true,
            unblockedBy: completedTaskId
          }
        })
      }
    }
  }

  getNextTask(agent?: string): Task | undefined {
    void this.materializeDueRecurringTasks().catch(() => {})

    // Priority order: P0 > P1 > P2 > P3
    const priorityOrder: Record<string, number> = {
      'P0': 0,
      'P1': 1,
      'P2': 2,
      'P3': 3,
    }

    // Helper: check if a task is blocked by incomplete dependencies
    const isBlocked = (task: Task): boolean => {
      if (!task.blocked_by || task.blocked_by.length === 0) return false
      
      return task.blocked_by.some(blockerId => {
        const blocker = this.tasks.get(blockerId)
        return blocker && blocker.status !== 'done'
      })
    }

    const sortByPriority = (a: Task, b: Task): number => {
      const aPriority = priorityOrder[a.priority || 'P3'] ?? 999
      const bPriority = priorityOrder[b.priority || 'P3'] ?? 999
      if (aPriority !== bPriority) return aPriority - bPriority
      return a.createdAt - b.createdAt
    }

    // If agent specified, first return their highest-priority doing task
    // This ensures agents resume in-progress work before picking up new tasks
    if (agent) {
      const doingTasks = Array.from(this.tasks.values())
        .filter(t => t.status === 'doing')
        .filter(t => t.assignee === agent)
        .filter(t => !isBlocked(t))
        .sort(sortByPriority)

      if (doingTasks.length > 0) {
        return doingTasks[0]
      }
    }

    // Then check todo tasks: unassigned or assigned to this agent
    let tasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'todo')
      .filter(t => !t.assignee)
      .filter(t => !isBlocked(t))

    if (agent) {
      const agentTodoTasks = Array.from(this.tasks.values())
        .filter(t => t.status === 'todo')
        .filter(t => t.assignee === agent)
        .filter(t => !isBlocked(t))
      tasks = [...tasks, ...agentTodoTasks]
    }

    if (tasks.length === 0) return undefined

    tasks.sort(sortByPriority)

    return tasks[0]
  }

  getLifecycleInstrumentation() {
    const tasks = Array.from(this.tasks.values())
    const active = tasks.filter(t => t.status !== 'todo' && t.status !== 'done')
    const missingReviewer = active.filter(t => !t.reviewer || t.reviewer.trim().length === 0)
    const missingDoneCriteria = active.filter(t => !t.done_criteria || t.done_criteria.length === 0)
    const missingEtaOnDoing = active.filter(t => {
      if (t.status !== 'doing') return false
      const eta = (t.metadata as any)?.eta
      return typeof eta !== 'string' || eta.trim().length === 0
    })
    const missingArtifactPathOnValidating = active.filter(t => {
      if (t.status !== 'validating') return false
      const artifactPath = (t.metadata as any)?.artifact_path
      return typeof artifactPath !== 'string' || artifactPath.trim().length === 0
    })

    return {
      activeCount: active.length,
      gateViolations: {
        missingReviewer: missingReviewer.length,
        missingDoneCriteria: missingDoneCriteria.length,
      },
      statusContractViolations: {
        missingEtaOnDoing: missingEtaOnDoing.length,
        missingArtifactPathOnValidating: missingArtifactPathOnValidating.length,
      },
      violatingTaskIds: {
        missingReviewer: missingReviewer.map(t => t.id),
        missingDoneCriteria: missingDoneCriteria.map(t => t.id),
        missingEtaOnDoing: missingEtaOnDoing.map(t => t.id),
        missingArtifactPathOnValidating: missingArtifactPathOnValidating.map(t => t.id),
      },
    }
  }

  getStats() {
    const tasks = Array.from(this.tasks.values())
    return {
      total: tasks.length,
      byStatus: {
        todo: tasks.filter(t => t.status === 'todo').length,
        doing: tasks.filter(t => t.status === 'doing').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        validating: tasks.filter(t => t.status === 'validating').length,
        done: tasks.filter(t => t.status === 'done').length,
        // Backward compatibility
        'in-progress': tasks.filter(t => t.status === 'doing').length,
      },
    }
  }
}

export const taskManager = new TaskManager()
