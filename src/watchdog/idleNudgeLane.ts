export type IdleNudgeLaneReason =
  | 'no-active-lane'
  | 'stale-lane'
  | 'ambiguous-lane'
  | 'presence-task-mismatch'
  | 'ok'

export type IdleNudgeLaneTask = {
  id: string
  assignee?: string
  status?: string
  createdAt?: number
  updatedAt?: number
}

export type IdleNudgeLaneState = {
  presenceTaskId: string | null
  doingTaskIds: string[]
  freshDoingTaskIds: string[]
  staleDoingTaskIds: string[]
  selectedTaskId: string | null
  selectedTaskAgeMin: number | null
  laneReason: IdleNudgeLaneReason
}

export function normalizeTaskId(value: unknown): string | null {
  const taskId = typeof value === 'string' ? value.trim() : ''
  if (!taskId) return null
  return /^task-[a-z0-9-]+$/i.test(taskId) ? taskId : null
}

export function resolveIdleNudgeLane(
  agent: string,
  presenceTaskRaw: unknown,
  tasks: IdleNudgeLaneTask[],
  now: number,
  activeTaskMaxAgeMin: number,
): IdleNudgeLaneState {
  const presenceTaskId = normalizeTaskId(presenceTaskRaw)
  const doingTasks = tasks
    .filter((t) => (t.assignee || '').toLowerCase() === agent && t.status === 'doing')
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))

  const doingTaskIds = doingTasks
    .map(t => normalizeTaskId(t.id))
    .filter((id): id is string => Boolean(id))

  const staleDoingTaskIds: string[] = []
  const freshDoingTaskIds: string[] = []

  for (const task of doingTasks) {
    const taskId = normalizeTaskId(task.id)
    if (!taskId) continue
    const taskUpdatedAt = Number(task.updatedAt || task.createdAt || 0)
    const taskAgeMin = taskUpdatedAt > 0 ? Math.floor((now - taskUpdatedAt) / 60_000) : Number.MAX_SAFE_INTEGER
    if (taskAgeMin > activeTaskMaxAgeMin) {
      staleDoingTaskIds.push(taskId)
    } else {
      freshDoingTaskIds.push(taskId)
    }
  }

  const selectedTaskId = freshDoingTaskIds[0] || null
  const selectedTask = selectedTaskId
    ? doingTasks.find((task) => task.id === selectedTaskId)
    : null
  const selectedTaskUpdatedAt = Number(selectedTask?.updatedAt || selectedTask?.createdAt || 0)
  const selectedTaskAgeMin = selectedTaskUpdatedAt > 0
    ? Math.floor((now - selectedTaskUpdatedAt) / 60_000)
    : null

  if (freshDoingTaskIds.length === 0) {
    if (doingTaskIds.length === 0) {
      return {
        presenceTaskId,
        doingTaskIds,
        freshDoingTaskIds,
        staleDoingTaskIds,
        selectedTaskId: null,
        selectedTaskAgeMin: null,
        laneReason: 'no-active-lane',
      }
    }

    return {
      presenceTaskId,
      doingTaskIds,
      freshDoingTaskIds,
      staleDoingTaskIds,
      selectedTaskId: null,
      selectedTaskAgeMin: null,
      laneReason: 'stale-lane',
    }
  }

  if (freshDoingTaskIds.length > 1) {
    return {
      presenceTaskId,
      doingTaskIds,
      freshDoingTaskIds,
      staleDoingTaskIds,
      selectedTaskId,
      selectedTaskAgeMin,
      laneReason: 'ambiguous-lane',
    }
  }

  if (presenceTaskId && selectedTaskId && presenceTaskId !== selectedTaskId) {
    return {
      presenceTaskId,
      doingTaskIds,
      freshDoingTaskIds,
      staleDoingTaskIds,
      selectedTaskId,
      selectedTaskAgeMin,
      laneReason: 'presence-task-mismatch',
    }
  }

  return {
    presenceTaskId,
    doingTaskIds,
    freshDoingTaskIds,
    staleDoingTaskIds,
    selectedTaskId,
    selectedTaskAgeMin,
    laneReason: 'ok',
  }
}
