import 'dotenv/config'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DATA_DIR } from '../src/config.js'
import type { Task } from '../src/types.js'
import { createTaskStateAdapterFromEnv } from '../src/taskStateSync.js'

const TASKS_FILE = join(DATA_DIR, 'tasks.jsonl')

async function main() {
  const adapter = createTaskStateAdapterFromEnv()
  if (!adapter) {
    throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const content = await fs.readFile(TASKS_FILE, 'utf-8')
  const lines = content.trim().split('\n').filter(Boolean)

  let migrated = 0
  for (const line of lines) {
    const task = JSON.parse(line) as Task
    await adapter.upsertTask(task)
    migrated += 1
  }

  console.log(`[tasks:migrate:supabase] migrated ${migrated} tasks from ${TASKS_FILE}`)
}

main().catch((err) => {
  console.error('[tasks:migrate:supabase] failed:', err)
  process.exitCode = 1
})
