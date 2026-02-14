#!/usr/bin/env -S npx tsx
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const now = Date.now()
const runId = `fixture-run-${now}`
const outDir = join(process.cwd(), 'artifacts', 'idle-nudge', runId)

process.env.PORT = process.env.PORT || '4460'
process.env.HOST = process.env.HOST || '127.0.0.1'
process.env.REFLECTT_HOME = process.env.REFLECTT_HOME || `/tmp/reflectt-idle-proof-${now}`
process.env.IDLE_NUDGE_ENABLED = 'true'
process.env.IDLE_NUDGE_WARN_MIN = '45'
process.env.IDLE_NUDGE_ESCALATE_MIN = '60'
process.env.IDLE_NUDGE_COOLDOWN_MIN = '30'
process.env.IDLE_NUDGE_SUPPRESS_RECENT_MIN = '10'
process.env.IDLE_NUDGE_EXCLUDE = 'ryan,system,diag'

const { createServer } = await import('../src/server.js')
const { presenceManager } = await import('../src/presence.js')
const { taskManager } = await import('../src/tasks.js')
const { chatManager } = await import('../src/chat.js')

await mkdir(outDir, { recursive: true })

const app = await createServer()
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT) })

const base = `http://127.0.0.1:${process.env.PORT}`
const fixtureWarn = 'fixture-warn'
const fixtureEsc = 'fixture-escalate'

try {
  await taskManager.createTask({
    title: 'Fixture warn proof task',
    description: 'Idle nudge warn proof',
    status: 'doing',
    assignee: fixtureWarn,
    reviewer: 'pixel',
    done_criteria: ['fixture only'],
    createdBy: 'link',
    priority: 'P1',
  })

  await taskManager.createTask({
    title: 'Fixture escalate proof task',
    description: 'Idle nudge escalate proof',
    status: 'doing',
    assignee: fixtureEsc,
    reviewer: 'pixel',
    done_criteria: ['fixture only'],
    createdBy: 'link',
    priority: 'P1',
  })

  // Seed presence as working and then force last_active stale to hit thresholds.
  presenceManager.updatePresence(fixtureWarn, 'working')
  presenceManager.updatePresence(fixtureEsc, 'working')

  const pMap: Map<string, any> = (presenceManager as any).presence
  const warnPresence = pMap.get(fixtureWarn)
  const escPresence = pMap.get(fixtureEsc)
  if (!warnPresence || !escPresence) {
    throw new Error('Failed to seed fixture presences')
  }

  warnPresence.last_active = now - (46 * 60 * 1000) // >=45m => warn
  warnPresence.lastUpdate = now
  escPresence.last_active = now - (61 * 60 * 1000) // >=60m => escalate
  escPresence.lastUpdate = now

  pMap.set(fixtureWarn, warnPresence)
  pMap.set(fixtureEsc, escPresence)

  const debugBefore = await fetch(`${base}/health/idle-nudge/debug`).then(r => r.json())
  const dryRun = await fetch(`${base}/health/idle-nudge/tick?dryRun=true`, { method: 'POST' }).then(r => r.json())
  const realRun = await fetch(`${base}/health/idle-nudge/tick`, { method: 'POST' }).then(r => r.json())

  // Second eligible tick quickly: should be suppressed by cooldown.
  const secondTick = await fetch(`${base}/health/idle-nudge/tick`, { method: 'POST' }).then(r => r.json())

  const messagesAfter = chatManager.getMessages({ limit: 200, since: now - 5 * 60 * 1000 })
  const warnMsg = messagesAfter.find((m: any) => m.from === 'system' && /@fixture-warn\b/.test(m.content || ''))
  const escMsg = messagesAfter.find((m: any) => m.from === 'system' && /@fixture-escalate\b/.test(m.content || ''))

  const summary = {
    runId,
    base,
    timestamp: Date.now(),
    fixtureAgents: [fixtureWarn, fixtureEsc],
    debugBefore,
    dryRun,
    realRun,
    secondTick,
    messageIds: {
      warnMessageId: warnMsg?.id || null,
      escalateMessageId: escMsg?.id || null,
    },
    expectations: {
      warn: 'fixture-warn decision=warn and warning message id present',
      escalate: 'fixture-escalate decision=escalate and escalation message id present',
      cooldown: 'second tick decision reason=cooldown-active with no new message id',
    },
  }

  await writeFile(join(outDir, 'debug-before.json'), JSON.stringify(debugBefore, null, 2))
  await writeFile(join(outDir, 'tick-dryrun.json'), JSON.stringify(dryRun, null, 2))
  await writeFile(join(outDir, 'tick-real.json'), JSON.stringify(realRun, null, 2))
  await writeFile(join(outDir, 'tick-second.json'), JSON.stringify(secondTick, null, 2))
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))

  const commands = [
    '# 1) Run deterministic fixture proof',
    `cd ${process.cwd()}`,
    'npx tsx tools/idle-nudge-fixture-proof.ts',
    '',
    '# 2) Inspect outputs',
    `cat ${join(outDir, 'summary.json')}`,
    `cat ${join(outDir, 'tick-real.json')}`,
    `cat ${join(outDir, 'tick-second.json')}`,
  ].join('\n')

  await writeFile(join(outDir, 'commands.txt'), commands)
  console.log(JSON.stringify({ success: true, outDir, runId, messageIds: summary.messageIds }, null, 2))
} finally {
  await app.close()
}
