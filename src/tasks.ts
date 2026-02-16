// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Task management system
 */
import type { Task, RecurringTask, RecurringTaskSchedule, TaskHistoryEvent, TaskComment } from './types.js'
import { promises as fs } from 'fs'
import { join } from 'path'
import { eventBus } from './events.js'
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js'
import { createTaskStateAdapterFromEnv, type TaskStateAdapter } from './taskStateSync.js'
import { getDb, importJsonlIfNeeded, safeJsonStringify, safeJsonParse } from './db.js'
import type Database from 'better-sqlite3'

const TASKS_FILE = join(DATA_DIR, 'tasks.jsonl')
const LEGACY_TASKS_FILE = join(LEGACY_DATA_DIR, 'tasks.jsonl')
const RECURRING_TASKS_FILE = join(DATA_DIR, 'tasks.recurring.jsonl')
const TASK_HISTORY_FILE = join(DATA_DIR, 'tasks.history.jsonl')
const TASK_COMMENTS_FILE = join(DATA_DIR, 'tasks.comments.jsonl')

/**
 * Import functions for one-time JSONL → SQLite migration
 */

function importTasks(db: Database.Database, records: unknown[]): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      id, title, description, status, assignee, reviewer, done_criteria,
      created_by, created_at, updated_at, priority, blocked_by, epic_id,
      tags, metadata, comment_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((tasks: unknown[]) => {
    for (const record of tasks) {
      const task = record as Task
      insert.run(
        task.id,
        task.title,
        task.description ?? null,
        task.status,
        task.assignee ?? null,
        task.reviewer ?? null,
        safeJsonStringify(task.done_criteria),
        task.createdBy,
        task.createdAt,
        task.updatedAt,
        task.priority ?? null,
        safeJsonStringify(task.blocked_by),
        task.epic_id ?? null,
        safeJsonStringify(task.tags),
        safeJsonStringify(task.metadata),
        0 // comment_count will be recalculated when comments are imported
      )
    }
  })

  insertMany(records)
  return records.length
}

function importRecurringTasks(db: Database.Database, records: unknown[]): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO recurring_tasks (
      id, title, description, assignee, reviewer, done_criteria, created_by,
      priority, blocked_by, epic_id, tags, metadata, schedule, enabled,
      status, last_run_at, last_skip_at, last_skip_reason, next_run_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((tasks: unknown[]) => {
    for (const record of tasks) {
      const rt = record as RecurringTask
      insert.run(
        rt.id,
        rt.title,
        rt.description ?? null,
        rt.assignee ?? null,
        rt.reviewer ?? null,
        safeJsonStringify(rt.done_criteria),
        rt.createdBy,
        rt.priority ?? null,
        safeJsonStringify(rt.blocked_by),
        rt.epic_id ?? null,
        safeJsonStringify(rt.tags),
        safeJsonStringify(rt.metadata),
        safeJsonStringify(rt.schedule),
        rt.enabled ? 1 : 0,
        rt.status ?? 'todo',
        rt.lastRunAt ?? null,
        rt.lastSkipAt ?? null,
        rt.lastSkipReason ?? null,
        rt.nextRunAt,
        rt.createdAt,
        rt.updatedAt
      )
    }
  })

  insertMany(records)
  return records.length
}

function importTaskHistory(db: Database.Database, records: unknown[]): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO task_history (
      id, task_id, type, actor, timestamp, data
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((events: unknown[]) => {
    for (const record of events) {
      const event = record as TaskHistoryEvent
      insert.run(
        event.id,
        event.taskId,
        event.type,
        event.actor,
        event.timestamp,
        safeJsonStringify(event.data)
      )
    }
  })

  insertMany(records)
  return records.length
}

function importTaskComments(db: Database.Database, records: unknown[]): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO task_comments (
      id, task_id, author, content, timestamp
    ) VALUES (?, ?, ?, ?, ?)
  `)

  const updateCommentCount = db.prepare(`
    UPDATE tasks
    SET comment_count = (SELECT COUNT(*) FROM task_comments WHERE task_id = ?)
    WHERE id = ?
  `)

  const insertMany = db.transaction((comments: unknown[]) => {
    const taskIds = new Set<string>()
    
    for (const record of comments) {
      const comment = record as TaskComment
      insert.run(
        comment.id,
        comment.taskId,
        comment.author,
        comment.content,
        comment.timestamp
      )
      taskIds.add(comment.taskId)
    }

    // Update comment counts for all affected tasks
    for (const taskId of taskIds) {
      updateCommentCount.run(taskId, taskId)
    }
  })

  insertMany(records)
  return records.length
}

class TaskManager {
  private tasks = new Map<string, Task>()
  private subscribers = new Set<(task: Task, action: 'created' | 'updated' | 'deleted') => void>()
  private recurringTasks = new Map<string, RecurringTask>()
  private taskHistory = new Map<string, TaskHistoryEvent[]>()
  private taskComments = new Map<string, TaskComment[]>()
  private initialized = false
  private recurringInitialized = false
  private recurringTicker: NodeJS.Timeout
  private taskStateAdapter: TaskStateAdapter | null = createTaskStateAdapterFromEnv()

  private isCanonicalArtifactPath(path: string): boolean {
    const normalized = path.trim()
    if (normalized.length === 0) return false
    if (normalized.startsWith('/') || normalized.startsWith('~')) return false
    if (normalized.includes('\\')) return false
    if (normalized.includes('..')) return false
    return normalized.startsWith('process/')
  }

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

    if (task.status === 'validating' && hasArtifactPath && !this.isCanonicalArtifactPath(artifactPath)) {
      throw new Error('Status contract: validating requires metadata.artifact_path under process/ (repo-relative, workspace-agnostic)')
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

      const db = getDb()

      // Import JSONL → SQLite if needed (one-time migration)
      importJsonlIfNeeded(db, TASKS_FILE, 'tasks', importTasks)

      // Also check legacy location for migration
      importJsonlIfNeeded(db, LEGACY_TASKS_FILE, 'tasks', importTasks)

      // Load tasks from SQLite into in-memory Map
      const rows = db.prepare('SELECT * FROM tasks').all() as Array<{
        id: string
        title: string
        description: string | null
        status: Task['status']
        assignee: string | null
        reviewer: string | null
        done_criteria: string | null
        created_by: string
        created_at: number
        updated_at: number
        priority: string | null
        blocked_by: string | null
        epic_id: string | null
        tags: string | null
        metadata: string | null
        comment_count: number
      }>

      for (const row of rows) {
        const task: Task = {
          id: row.id,
          title: row.title,
          description: row.description ?? undefined,
          status: row.status,
          assignee: row.assignee ?? undefined,
          reviewer: row.reviewer ?? undefined,
          done_criteria: safeJsonParse<string[]>(row.done_criteria),
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          priority: (row.priority as Task['priority']) ?? undefined,
          blocked_by: safeJsonParse<string[]>(row.blocked_by),
          epic_id: row.epic_id ?? undefined,
          tags: safeJsonParse<string[]>(row.tags),
          metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
        }
        this.tasks.set(task.id, task)
      }

      console.log(`[Tasks] Loaded ${this.tasks.size} tasks from SQLite`)

      // Cloud hydration if empty
      if (this.tasks.size === 0 && this.taskStateAdapter) {
        try {
          const remoteTasks = await this.taskStateAdapter.pullTasks()
          for (const task of remoteTasks) {
            this.tasks.set(task.id, task)
          }

          if (remoteTasks.length > 0) {
            await this.persistTasks()
            console.log(`[Tasks] Hydrated ${remoteTasks.length} tasks from cloud state`)
          }
        } catch (err) {
          console.error('[Tasks] Failed to hydrate tasks from cloud state:', err)
        }
      }
    } finally {
      this.initialized = true
    }
  }

  private normalizeRecurringTask(recurring: RecurringTask): RecurringTask {
    return {
      ...recurring,
      enabled: typeof recurring.enabled === 'boolean' ? recurring.enabled : true,
    }
  }

  private async loadRecurringTasks(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      const db = getDb()

      // Import JSONL → SQLite if needed
      importJsonlIfNeeded(db, RECURRING_TASKS_FILE, 'recurring_tasks', importRecurringTasks)

      // Load from SQLite into in-memory Map
      const rows = db.prepare('SELECT * FROM recurring_tasks').all() as Array<{
        id: string
        title: string
        description: string | null
        assignee: string | null
        reviewer: string | null
        done_criteria: string | null
        created_by: string
        priority: string | null
        blocked_by: string | null
        epic_id: string | null
        tags: string | null
        metadata: string | null
        schedule: string
        enabled: number
        status: string | null
        last_run_at: number | null
        last_skip_at: number | null
        last_skip_reason: string | null
        next_run_at: number
        created_at: number
        updated_at: number
      }>

      for (const row of rows) {
        const recurring: RecurringTask = {
          id: row.id,
          title: row.title,
          description: row.description ?? undefined,
          assignee: row.assignee ?? undefined,
          reviewer: row.reviewer ?? undefined,
          done_criteria: safeJsonParse<string[]>(row.done_criteria),
          createdBy: row.created_by,
          priority: (row.priority as Task['priority']) ?? undefined,
          blocked_by: safeJsonParse<string[]>(row.blocked_by),
          epic_id: row.epic_id ?? undefined,
          tags: safeJsonParse<string[]>(row.tags),
          metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
          schedule: safeJsonParse<RecurringTaskSchedule>(row.schedule)!,
          enabled: Boolean(row.enabled),
          status: (row.status as Task['status']) ?? undefined,
          lastRunAt: row.last_run_at ?? undefined,
          lastSkipAt: row.last_skip_at ?? undefined,
          lastSkipReason: row.last_skip_reason ?? undefined,
          nextRunAt: row.next_run_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
        this.recurringTasks.set(recurring.id, this.normalizeRecurringTask(recurring))
      }

      console.log(`[Tasks] Loaded ${this.recurringTasks.size} recurring task definitions from SQLite`)
    } finally {
      this.recurringInitialized = true
    }
  }

  private async loadTaskHistory(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      const db = getDb()

      // Import JSONL → SQLite if needed
      importJsonlIfNeeded(db, TASK_HISTORY_FILE, 'task_history', importTaskHistory)

      // Load from SQLite into in-memory Map
      const rows = db.prepare('SELECT * FROM task_history ORDER BY timestamp ASC').all() as Array<{
        id: string
        task_id: string
        type: TaskHistoryEvent['type']
        actor: string
        timestamp: number
        data: string | null
      }>

      for (const row of rows) {
        const event: TaskHistoryEvent = {
          id: row.id,
          taskId: row.task_id,
          type: row.type,
          actor: row.actor,
          timestamp: row.timestamp,
          data: safeJsonParse<Record<string, unknown>>(row.data),
        }

        const existing = this.taskHistory.get(event.taskId) || []
        existing.push(event)
        this.taskHistory.set(event.taskId, existing)
      }

      const loadedCount = Array.from(this.taskHistory.values()).reduce((sum, events) => sum + events.length, 0)
      console.log(`[Tasks] Loaded ${loadedCount} task history events from SQLite`)
    } catch (err) {
      console.error('[Tasks] Failed to load task history:', err)
    }
  }

  private async loadTaskComments(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      const db = getDb()

      // Import JSONL → SQLite if needed
      importJsonlIfNeeded(db, TASK_COMMENTS_FILE, 'task_comments', importTaskComments)

      // Load from SQLite into in-memory Map
      const rows = db.prepare('SELECT * FROM task_comments ORDER BY timestamp ASC').all() as Array<{
        id: string
        task_id: string
        author: string
        content: string
        timestamp: number
      }>

      for (const row of rows) {
        const comment: TaskComment = {
          id: row.id,
          taskId: row.task_id,
          author: row.author,
          content: row.content,
          timestamp: row.timestamp,
        }

        const existing = this.taskComments.get(comment.taskId) || []
        existing.push(comment)
        this.taskComments.set(comment.taskId, existing)
      }

      const loadedCount = Array.from(this.taskComments.values()).reduce((sum, comments) => sum + comments.length, 0)
      console.log(`[Tasks] Loaded ${loadedCount} task comments from SQLite`)
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
      const db = getDb()

      // Write to SQLite (primary)
      const insert = db.prepare(`
        INSERT INTO task_history (id, task_id, type, actor, timestamp, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      insert.run(
        event.id,
        event.taskId,
        event.type,
        event.actor,
        event.timestamp,
        safeJsonStringify(event.data)
      )

      // Append to JSONL (audit log)
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
      const db = getDb()

      // Write to SQLite (primary)
      const insert = db.prepare(`
        INSERT INTO task_comments (id, task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `)
      insert.run(
        comment.id,
        comment.taskId,
        comment.author,
        comment.content,
        comment.timestamp
      )

      // Update comment count for the task
      const updateCount = db.prepare(`
        UPDATE tasks
        SET comment_count = (SELECT COUNT(*) FROM task_comments WHERE task_id = ?)
        WHERE id = ?
      `)
      updateCount.run(comment.taskId, comment.taskId)

      // Append to JSONL (audit log)
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.appendFile(TASK_COMMENTS_FILE, `${JSON.stringify(comment)}\n`, 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to append task comment:', err)
    }
  }

  private async persistRecurringTasks(): Promise<void> {
    try {
      const db = getDb()
      const upsert = db.prepare(`
        INSERT OR REPLACE INTO recurring_tasks (
          id, title, description, assignee, reviewer, done_criteria, created_by,
          priority, blocked_by, epic_id, tags, metadata, schedule, enabled,
          status, last_run_at, last_skip_at, last_skip_reason, next_run_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const upsertAll = db.transaction(() => {
        for (const rt of this.recurringTasks.values()) {
          upsert.run(
            rt.id, rt.title, rt.description ?? null,
            rt.assignee ?? null, rt.reviewer ?? null,
            safeJsonStringify(rt.done_criteria), rt.createdBy,
            rt.priority ?? null, safeJsonStringify(rt.blocked_by),
            rt.epic_id ?? null, safeJsonStringify(rt.tags),
            safeJsonStringify(rt.metadata), safeJsonStringify(rt.schedule),
            rt.enabled ? 1 : 0, rt.status ?? 'todo',
            rt.lastRunAt ?? null, rt.lastSkipAt ?? null,
            rt.lastSkipReason ?? null, rt.nextRunAt,
            rt.createdAt, rt.updatedAt
          )
        }
      })

      upsertAll()
    } catch (err) {
      console.error('[Tasks] Failed to persist recurring tasks to SQLite:', err)
    }

    // JSONL audit log
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      const lines = Array.from(this.recurringTasks.values()).map(task => JSON.stringify({
        ...task,
        enabled: Boolean(task.enabled),
      }))
      await fs.writeFile(RECURRING_TASKS_FILE, lines.join('\n') + '\n', 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to write recurring tasks JSONL audit log:', err)
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
      const db = getDb()
      const upsert = db.prepare(`
        INSERT OR REPLACE INTO tasks (
          id, title, description, status, assignee, reviewer, done_criteria,
          created_by, created_at, updated_at, priority, blocked_by, epic_id,
          tags, metadata, comment_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const upsertAll = db.transaction(() => {
        for (const task of this.tasks.values()) {
          const commentCount = (this.taskComments.get(task.id) || []).length
          upsert.run(
            task.id,
            task.title,
            task.description ?? null,
            task.status,
            task.assignee ?? null,
            task.reviewer ?? null,
            safeJsonStringify(task.done_criteria),
            task.createdBy,
            task.createdAt,
            task.updatedAt,
            task.priority ?? null,
            safeJsonStringify(task.blocked_by),
            task.epic_id ?? null,
            safeJsonStringify(task.tags),
            safeJsonStringify(task.metadata),
            commentCount
          )
        }
      })

      upsertAll()
    } catch (err) {
      console.error('[Tasks] Failed to persist tasks to SQLite:', err)
    }

    // JSONL audit log (append-only, best-effort)
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      const lines = Array.from(this.tasks.values()).map(task => JSON.stringify(task))
      await fs.writeFile(TASKS_FILE, lines.join('\n') + '\n', 'utf-8')
    } catch (err) {
      console.error('[Tasks] Failed to write JSONL audit log:', err)
    }
  }

  private async syncTaskToCloud(task: Task): Promise<void> {
    if (!this.taskStateAdapter) return

    try {
      await this.taskStateAdapter.upsertTask(task)
    } catch (err) {
      console.error('[Tasks] Cloud sync upsert failed, continuing with local JSON fallback:', err)
    }
  }

  private async syncTaskDeleteToCloud(taskId: string): Promise<void> {
    if (!this.taskStateAdapter) return

    try {
      await this.taskStateAdapter.deleteTask(taskId)
    } catch (err) {
      console.error('[Tasks] Cloud sync delete failed, continuing with local JSON fallback:', err)
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
    await this.syncTaskToCloud(task)
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

  async updateRecurringTask(
    id: string,
    updates: Partial<Pick<RecurringTask, 'enabled' | 'schedule'>>,
  ): Promise<RecurringTask | undefined> {
    const recurring = this.recurringTasks.get(id)
    if (!recurring) return undefined

    const next: RecurringTask = {
      ...recurring,
      ...updates,
      updatedAt: Date.now(),
    }

    if (typeof updates.enabled === 'boolean') {
      next.enabled = updates.enabled
    }

    if (updates.schedule) {
      next.nextRunAt = this.computeNextRunAt(updates.schedule, Date.now(), recurring.createdAt)
    }

    this.recurringTasks.set(id, next)
    await this.persistRecurringTasks()
    return next
  }

  async deleteRecurringTask(id: string): Promise<boolean> {
    const existed = this.recurringTasks.delete(id)
    if (!existed) return false
    await this.persistRecurringTasks()
    return true
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
    await this.syncTaskToCloud(updated)

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
    
    // If task completed, emit completion event and check for unblocked tasks
    if (updates.status === 'done' && task.status !== 'done') {
      eventBus.emitTaskCompleted(updated)
      this.checkUnblockedTasks(id)
    }
    
    return updated
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id)
    if (!task) return false

    this.tasks.delete(id)
    await this.persistTasks()
    await this.syncTaskDeleteToCloud(id)
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
