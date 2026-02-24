#!/usr/bin/env node
/**
 * Content lane compliance reporter (Echo)
 * - Posts compliance snapshot to task-1771427184904-mu356v5md
 * - Checks: WIP<=1, ready floor>=2 (ready = todo tasks w/ reviewer + ready_v0_artifact_path + review_ask)
 */

const API = process.env.REFLECTT_NODE_URL ?? 'http://127.0.0.1:4445'
const ASSIGNEE = process.env.ASSIGNEE ?? 'echo'
const CONTROL_TASK_ID = process.env.CONTROL_TASK_ID ?? 'task-1771427184904-mu356v5md'

function fmtLocal(d = new Date()) {
  // relies on TZ env var from launchd (or system timezone)
  return d.toLocaleString('en-CA', { hour12: false })
}

function isActiveHours(d = new Date()) {
  const day = d.getDay() // 0=Sun
  const hour = d.getHours()
  const weekday = day >= 1 && day <= 5
  return weekday && hour >= 9 && hour < 17
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return await res.json()
}

async function postComment(taskId, content) {
  const res = await fetch(`${API}/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'echo', content }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST comment -> ${res.status} ${text}`)
  }
  return await res.json()
}

function isReadyTask(t) {
  const m = t?.metadata ?? {}
  return (
    t?.status === 'todo' &&
    t?.assignee === ASSIGNEE &&
    Boolean(t?.reviewer) &&
    Boolean(m.ready_v0_artifact_path) &&
    Boolean(m.review_ask)
  )
}

function recoveryPlan({ wip, readyCount }) {
  const parts = []
  if (wip > 1) parts.push('reduce WIP to 1: pause/return lowest-priority doing task(s) to todo')
  if (readyCount < 2) parts.push('seed ready floor: add ready_v0_artifact_path + review_ask to next todo tasks (keep 2+ ready)')
  if (!parts.length) return 'none'
  return parts.join('; ')
}

async function main() {
  const now = new Date()
  const doing = await getJson(`/tasks?assignee=${encodeURIComponent(ASSIGNEE)}&status=doing&limit=50`)
  const todo = await getJson(`/tasks?assignee=${encodeURIComponent(ASSIGNEE)}&status=todo&limit=50`)

  const doingTasks = (doing?.tasks ?? []).map((t) => t.id)
  const readyTasks = (todo?.tasks ?? []).filter(isReadyTask).map((t) => t.id)

  const wip = doingTasks.length
  const readyCount = readyTasks.length
  const active = isActiveHours(now)

  const breach = active && (wip > 1 || readyCount < 2)

  const lines = [
    `compliance snapshot @ ${CONTROL_TASK_ID} (${fmtLocal(now)}; active_hours=${active ? 'Y' : 'N'})`,
    `- Ready floor: ${readyCount}/2 → ${readyTasks.slice(0, 6).join(', ') || '(none)'}`,
    `- WIP: ${wip} → ${doingTasks.slice(0, 6).join(', ') || '(none)'}`,
    `- Breach: ${breach ? 'Y' : 'N'}`,
  ]

  if (breach) {
    lines.push(`- Recovery: ${recoveryPlan({ wip, readyCount })}`)
    lines.push(`- Escalation: @kai ${CONTROL_TASK_ID} breach during active hours; needs recovery within 30m`)
  }

  await postComment(CONTROL_TASK_ID, lines.join('\n'))
}

main().catch((err) => {
  console.error(`[content-lane-compliance-report] ${err?.stack || err}`)
  process.exit(1)
})
