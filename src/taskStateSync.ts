import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Task } from './types.js'

const TASKS_TABLE = process.env.REFLECTT_TASKS_TABLE || 'tasks'

export interface TaskStateAdapter {
  pullTasks(): Promise<Task[]>
  upsertTask(task: Task): Promise<void>
  deleteTask(taskId: string): Promise<void>
}

class SupabaseTaskStateAdapter implements TaskStateAdapter {
  constructor(private readonly client: SupabaseClient) {}

  async pullTasks(): Promise<Task[]> {
    const { data, error } = await this.client
      .from(TASKS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) throw error

    return (data || []).map(mapRowToTask)
  }

  async upsertTask(task: Task): Promise<void> {
    const row = mapTaskToRow(task)
    const { error } = await this.client.from(TASKS_TABLE).upsert(row, { onConflict: 'id' })
    if (error) throw error
  }

  async deleteTask(taskId: string): Promise<void> {
    const { error } = await this.client.from(TASKS_TABLE).delete().eq('id', taskId)
    if (error) throw error
  }
}

export function createTaskStateAdapterFromEnv(): TaskStateAdapter | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return new SupabaseTaskStateAdapter(client)
}

function mapTaskToRow(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    assignee: task.assignee ?? null,
    reviewer: task.reviewer ?? null,
    done_criteria: task.done_criteria ?? null,
    created_by: task.createdBy,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    priority: task.priority ?? null,
    blocked_by: task.blocked_by ?? null,
    epic_id: task.epic_id ?? null,
    tags: task.tags ?? null,
    metadata: task.metadata ?? null,
    raw: task,
  }
}

function mapRowToTask(row: any): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description ?? undefined,
    status: row.status,
    assignee: row.assignee ?? undefined,
    reviewer: row.reviewer ?? undefined,
    done_criteria: Array.isArray(row.done_criteria) ? row.done_criteria : undefined,
    createdBy: String(row.created_by),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    priority: row.priority ?? undefined,
    blocked_by: Array.isArray(row.blocked_by) ? row.blocked_by : undefined,
    epic_id: row.epic_id ?? undefined,
    tags: Array.isArray(row.tags) ? row.tags : undefined,
    metadata: typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : undefined,
  }
}
