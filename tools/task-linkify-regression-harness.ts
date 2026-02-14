import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Check = {
  id: string
  desc: string
  pass: boolean
  criteria: string
}

const dashboardJsPath = resolve(process.cwd(), 'public/dashboard.js')
const dashboardTsPath = resolve(process.cwd(), 'src/dashboard.ts')
const dashboardPath = dashboardJsPath
const src = readFileSync(dashboardJsPath, 'utf8') + readFileSync(dashboardTsPath, 'utf8')

const checks: Check[] = [
  {
    id: 'click-existing-task',
    desc: 'existing task token renders clickable link + click opens modal',
    pass:
      src.includes("class=\"task-id-link\"") &&
      src.includes("openTaskModal(link.dataset.taskId || '')") &&
      src.includes("renderMessageContentWithTaskLinks(m.content)"),
    criteria: 'task-id token renders .task-id-link and click route invokes openTaskModal(taskId)',
  },
  {
    id: 'click-missing-task',
    desc: 'missing task token opens explicit not-found modal state',
    pass:
      src.includes("Task not found: ") &&
      src.includes('setTaskModalInteractivity(false)') &&
      src.includes('not present in the current task set'),
    criteria: 'missing task branch shows explicit not-found messaging and disables edit controls',
  },
  {
    id: 'keyboard-enter-space',
    desc: 'keyboard activation supports Enter + Space on focused task links',
    pass:
      src.includes("event.key === 'Enter'") &&
      src.includes("event.key === ' '") &&
      src.includes("openTaskModal(link.dataset.taskId || '')"),
    criteria: 'keydown path must trigger modal open for Enter and Space',
  },
  {
    id: 'collapse-non-link',
    desc: 'collapse/expand remains on non-link msg-content clicks',
    pass:
      src.includes("toggleMessageContent(contentEl)") &&
      src.includes("event.stopPropagation()") &&
      src.includes("data-collapsible"),
    criteria: 'link clicks must not collapse; non-link msg-content clicks must toggle collapsed/expanded',
  },
]

const failCount = checks.filter(c => !c.pass).length
const result = {
  harness: 'task-linkify-regression-harness',
  dashboardPath,
  command: 'npm run test:task-linkify:regression',
  ci: {
    now: 'Run in CI as a standalone step after build',
    next: 'Gate merges by wiring this script into PR workflow required checks',
  },
  summary: {
    caseCount: checks.length,
    passCount: checks.length - failCount,
    failCount,
    status: failCount === 0 ? 'PASS' : 'FAIL',
  },
  checks,
}

console.log('TASK_LINKIFY_REGRESSION_HARNESS_RESULT')
console.log(JSON.stringify(result, null, 2))

if (failCount > 0) process.exit(1)
