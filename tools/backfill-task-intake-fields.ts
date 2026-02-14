import { promises as fs } from 'node:fs'
import path from 'node:path'

type TaskStatus = 'todo' | 'doing' | 'blocked' | 'validating' | 'done'

type Task = {
  id: string
  title: string
  status: TaskStatus
  assignee?: string
  reviewer?: string
  done_criteria?: string[]
  createdBy: string
  metadata?: Record<string, unknown>
  updatedAt: number
}

const TASKS_FILE = path.resolve(process.cwd(), 'data/tasks.jsonl')
const ACTIVE: TaskStatus[] = ['todo', 'doing', 'blocked', 'validating']

function hasEta(task: Task): boolean {
  const eta = task.metadata && typeof task.metadata === 'object'
    ? (task.metadata as any).eta
    : undefined
  return typeof eta === 'string' && eta.trim().length > 0
}

async function main() {
  const raw = await fs.readFile(TASKS_FILE, 'utf8')
  const lines = raw.split('\n').filter(Boolean)
  const tasks: Task[] = lines.map((line) => JSON.parse(line))

  let touched = 0
  let touchedActive = 0
  const now = Date.now()

  const next = tasks.map((task) => {
    if (!ACTIVE.includes(task.status)) return task

    const updated: Task = {
      ...task,
      assignee: task.assignee && task.assignee.trim().length > 0 ? task.assignee : task.createdBy,
      reviewer: task.reviewer && task.reviewer.trim().length > 0 ? task.reviewer : 'kai',
      done_criteria: Array.isArray(task.done_criteria) && task.done_criteria.length > 0
        ? task.done_criteria
        : [
            'Attach artifact path proving the change',
            'Post expected vs observed evidence for acceptance checks',
          ],
      metadata: {
        ...(task.metadata || {}),
        eta: hasEta(task)
          ? (task.metadata as any).eta
          : 'next heartbeat',
      },
    }

    const changed = (
      updated.assignee !== task.assignee
      || updated.reviewer !== task.reviewer
      || JSON.stringify(updated.done_criteria) !== JSON.stringify(task.done_criteria)
      || JSON.stringify(updated.metadata) !== JSON.stringify(task.metadata)
    )

    if (changed) {
      touched += 1
      touchedActive += 1
      updated.updatedAt = now
    }

    return updated
  })

  await fs.writeFile(TASKS_FILE, `${next.map((task) => JSON.stringify(task)).join('\n')}\n`, 'utf8')

  const active = next.filter((task) => ACTIVE.includes(task.status))
  const vague = active.filter((task) => {
    const missingDone = !Array.isArray(task.done_criteria) || task.done_criteria.length === 0
    const missingOwner = !task.assignee || task.assignee.trim().length === 0
    const missingReviewer = !task.reviewer || task.reviewer.trim().length === 0
    const missingEta = !hasEta(task)
    return missingDone || missingOwner || missingReviewer || missingEta
  })

  console.log(JSON.stringify({
    success: true,
    file: TASKS_FILE,
    total: tasks.length,
    active: active.length,
    touched,
    touchedActive,
    vagueActiveAfter: vague.length,
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
