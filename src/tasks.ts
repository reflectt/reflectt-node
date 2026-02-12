/**
 * Task management system
 */
import type { Task, RecurringTask, RecurringTaskSchedule } from './types.js'
import { promises as fs } from 'fs'
import { join } from 'path'
import { eventBus } from './events.js'
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js'

const TASKS_FILE = join(DATA_DIR, 'tasks.jsonl')
const LEGACY_TASKS_FILE = join(LEGACY_DATA_DIR, 'tasks.jsonl')
const RECURRING_TASKS_FILE = join(DATA_DIR, 'tasks.recurring.jsonl')

class TaskManager {
  private tasks = new Map<string, Task>()
  private subscribers = new Set<(task: Task, action: 'created' | 'updated' | 'deleted') => void>()
  private recurringTasks = new Map<string, RecurringTask>()
  private initialized = false
  private recurringInitialized = false
  private recurringTicker: NodeJS.Timeout

  constructor() {
    this.loadTasks()
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

  async materializeDueRecurringTasks(now = Date.now()): Promise<{ created: number }> {
    let created = 0
    let recurringChanged = false

    for (const recurring of this.recurringTasks.values()) {
      if (!recurring.enabled) continue

      let safetyCounter = 0
      while (recurring.nextRunAt <= now && safetyCounter < 16) {
        const scheduledFor = recurring.nextRunAt

        if (!this.hasMaterializedRun(recurring.id, scheduledFor)) {
          await this.createTask({
            title: recurring.title,
            description: recurring.description,
            status: recurring.status ?? 'todo',
            assignee: recurring.assignee,
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

    return { created }
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

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    }

    this.tasks.set(id, updated)
    await this.persistTasks()
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

    let tasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'todo') // Only todo tasks
      .filter(t => !t.assignee) // Unassigned only
      .filter(t => !isBlocked(t)) // Not blocked by incomplete tasks

    // If agent specified, can also include tasks assigned to that agent
    if (agent) {
      const agentTasks = Array.from(this.tasks.values())
        .filter(t => t.status === 'todo')
        .filter(t => t.assignee === agent)
        .filter(t => !isBlocked(t))
      tasks = [...tasks, ...agentTasks]
    }

    if (tasks.length === 0) return undefined

    // Sort by priority (P0 first), then by creation date (oldest first)
    tasks.sort((a, b) => {
      const aPriority = priorityOrder[a.priority || 'P3'] ?? 999
      const bPriority = priorityOrder[b.priority || 'P3'] ?? 999
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }
      
      return a.createdAt - b.createdAt
    })

    return tasks[0]
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
