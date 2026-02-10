/**
 * Task management system
 */
import type { Task } from './types.js'

class TaskManager {
  private tasks = new Map<string, Task>()
  private subscribers = new Set<(task: Task, action: 'created' | 'updated' | 'deleted') => void>()

  createTask(data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const task: Task = {
      ...data,
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.tasks.set(task.id, task)
    this.notifySubscribers(task, 'created')
    return task
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  listTasks(options?: {
    status?: Task['status']
    assignedTo?: string
    createdBy?: string
    tags?: string[]
  }): Task[] {
    let tasks = Array.from(this.tasks.values())

    if (options?.status) {
      tasks = tasks.filter(t => t.status === options.status)
    }

    if (options?.assignedTo) {
      tasks = tasks.filter(t => t.assignedTo === options.assignedTo)
    }

    if (options?.createdBy) {
      tasks = tasks.filter(t => t.createdBy === options.createdBy)
    }

    if (options?.tags && options.tags.length > 0) {
      tasks = tasks.filter(t => 
        t.tags && options.tags!.some(tag => t.tags!.includes(tag))
      )
    }

    return tasks.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'createdBy'>>): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    }

    this.tasks.set(id, updated)
    this.notifySubscribers(updated, 'updated')
    return updated
  }

  deleteTask(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false

    this.tasks.delete(id)
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

  getStats() {
    const tasks = Array.from(this.tasks.values())
    return {
      total: tasks.length,
      byStatus: {
        todo: tasks.filter(t => t.status === 'todo').length,
        'in-progress': tasks.filter(t => t.status === 'in-progress').length,
        done: tasks.filter(t => t.status === 'done').length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
      },
    }
  }
}

export const taskManager = new TaskManager()
