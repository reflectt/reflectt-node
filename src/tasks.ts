/**
 * Task management system
 */
import type { Task } from './types.js'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = join(__dirname, '../data')
const TASKS_FILE = join(DATA_DIR, 'tasks.jsonl')

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
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        // File doesn't exist yet, that's fine
        console.log('[Tasks] No existing tasks file, starting fresh')
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
    const task: Task = {
      ...data,
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.tasks.set(task.id, task)
    await this.persistTasks()
    this.notifySubscribers(task, 'created')
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
  }): Task[] {
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

    return tasks.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'createdBy'>>): Promise<Task | undefined> {
    const task = this.tasks.get(id)
    if (!task) return undefined

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    }

    this.tasks.set(id, updated)
    await this.persistTasks()
    this.notifySubscribers(updated, 'updated')
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

  getNextTask(agent?: string): Task | undefined {
    // Priority order: P0 > P1 > P2 > P3
    const priorityOrder: Record<string, number> = {
      'P0': 0,
      'P1': 1,
      'P2': 2,
      'P3': 3,
    }

    let tasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'todo') // Only todo tasks
      .filter(t => !t.assignee) // Unassigned only

    // If agent specified, can also include tasks assigned to that agent
    if (agent) {
      const agentTasks = Array.from(this.tasks.values())
        .filter(t => t.status === 'todo')
        .filter(t => t.assignee === agent)
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
