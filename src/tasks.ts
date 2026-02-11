/**
 * Task management system
 */
import type { Task } from './types.js'
import { promises as fs } from 'fs'
import { join } from 'path'
import { eventBus } from './events.js'
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js'

const TASKS_FILE = join(DATA_DIR, 'tasks.jsonl')
const LEGACY_TASKS_FILE = join(LEGACY_DATA_DIR, 'tasks.jsonl')

class TaskManager {
  private tasks = new Map<string, Task>()
  private subscribers = new Set<(task: Task, action: 'created' | 'updated' | 'deleted') => void>()
  private initialized = false

  constructor() {
    this.loadTasks().catch(err => {
      console.error('[Tasks] Failed to load tasks:', err)
    })
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
