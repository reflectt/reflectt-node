import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function runHealthcheck(args: string[], input?: string) {
  const script = join(process.cwd(), 'scripts', 'healthcheck.sh')
  return spawnSync('bash', [script, ...args], {
    input,
    encoding: 'utf-8',
  })
}

describe('scripts/healthcheck.sh', () => {
  test('returns ok=true for a healthy payload (stdin mode)', () => {
    const payload = JSON.stringify({
      status: 'ok',
      chat: { totalMessages: 1, rooms: 1, subscribers: 0 },
      tasks: { total: 3, byStatus: { todo: 1, doing: 1, done: 1 } },
      inbox: { agents: 1 },
      timestamp: 123,
    })

    const res = runHealthcheck(['--json', '--stdin'], payload)
    expect(res.status).toBe(0)

    const out = JSON.parse((res.stdout || '').trim())
    expect(out.ok).toBe(true)
    expect(out.status).toBe('ok')
    expect(out.tasks_total).toBe(3)
  })

  test('returns ok=false (exit 1) when status is not ok (stdin mode)', () => {
    const payload = JSON.stringify({ status: 'nope' })
    const res = runHealthcheck(['--json', '--stdin'], payload)

    expect(res.status).toBe(1)
    const out = JSON.parse((res.stdout || '').trim())
    expect(out.ok).toBe(false)
    expect(String(out.error || '')).toContain('status=nope')
  })
})
