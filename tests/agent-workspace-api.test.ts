// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  AGENT_NAME_RE,
  DATE_RE,
  getAgentWorkspaceRoot,
  listAgentMemoryDays,
  readAgentMemoryDay,
  getAgentFilePointer,
  readAgentFile,
} from '../src/agent-workspace-api.js'

let sandbox: string
let savedHome: string | undefined

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'agent-workspace-test-'))
  savedHome = process.env.OPENCLAW_HOME
  process.env.OPENCLAW_HOME = sandbox
})

afterAll(() => {
  if (savedHome === undefined) delete process.env.OPENCLAW_HOME
  else process.env.OPENCLAW_HOME = savedHome
  rmSync(sandbox, { recursive: true, force: true })
})

function seedAgent(name: string): string {
  const root = join(sandbox, `workspace-${name}`)
  mkdirSync(join(root, 'memory'), { recursive: true })
  writeFileSync(join(root, 'SOUL.md'), '# Soul\n\nI am ' + name)
  writeFileSync(join(root, 'MEMORY.md'), '# Memory index\n')
  writeFileSync(join(root, 'HEARTBEAT.md'), '# Heartbeat\n')
  writeFileSync(join(root, 'memory', '2026-04-21.md'), '# 2026-04-21\nentry one')
  writeFileSync(join(root, 'memory', '2026-04-20.md'), '# 2026-04-20\nentry zero')
  writeFileSync(join(root, 'memory', '2026-04-19.md'), '# 2026-04-19\nold')
  return root
}

describe('AGENT_NAME_RE / DATE_RE', () => {
  it('accepts valid agent names', () => {
    expect('claude').toMatch(AGENT_NAME_RE)
    expect('genesis-1').toMatch(AGENT_NAME_RE)
    expect('a_b-c').toMatch(AGENT_NAME_RE)
  })

  it('rejects invalid agent names', () => {
    for (const bad of ['', '..', '../etc', 'Claude', '1agent', 'a/b', 'a b', 'a.b']) {
      expect(bad).not.toMatch(AGENT_NAME_RE)
    }
  })

  it('accepts valid dates and rejects bad ones', () => {
    expect('2026-04-21').toMatch(DATE_RE)
    for (const bad of ['', '2026-4-21', '2026/04/21', '21-04-2026', '2026-04-21.md', '../etc']) {
      expect(bad).not.toMatch(DATE_RE)
    }
  })
})

describe('getAgentWorkspaceRoot', () => {
  it('returns workspace path for valid agent', () => {
    expect(getAgentWorkspaceRoot('claude')).toBe(join(sandbox, 'workspace-claude'))
  })

  it('throws on invalid agent name (traversal attempt)', () => {
    expect(() => getAgentWorkspaceRoot('../etc')).toThrow(/Invalid agent name/)
    expect(() => getAgentWorkspaceRoot('a/b')).toThrow(/Invalid agent name/)
    expect(() => getAgentWorkspaceRoot('')).toThrow(/Invalid agent name/)
  })
})

describe('listAgentMemoryDays', () => {
  beforeEach(() => seedAgent('claude'))

  it('lists daily memory files sorted by date desc', async () => {
    const days = await listAgentMemoryDays('claude')
    expect(days).toHaveLength(3)
    expect(days.map((d) => d.date)).toEqual(['2026-04-21', '2026-04-20', '2026-04-19'])
    for (const d of days) {
      expect(d.relPath).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/)
      expect(d.size).toBeGreaterThan(0)
      expect(d.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('returns empty when memory dir missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'aw-empty-'))
    const oldHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = empty
    try {
      const days = await listAgentMemoryDays('ghost')
      expect(days).toEqual([])
    } finally {
      process.env.OPENCLAW_HOME = oldHome
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('skips non-date filenames and non-md files', async () => {
    const root = seedAgent('claude')
    writeFileSync(join(root, 'memory', 'README.md'), 'not a date')
    writeFileSync(join(root, 'memory', '2026-04-22.txt'), 'wrong ext')
    writeFileSync(join(root, 'memory', 'notes.md'), 'no date')
    const days = await listAgentMemoryDays('claude')
    expect(days).toHaveLength(3)
  })
})

describe('readAgentMemoryDay', () => {
  beforeEach(() => seedAgent('claude'))

  it('reads a specific day', async () => {
    const body = await readAgentMemoryDay('claude', '2026-04-21')
    expect(body.exists).toBe(true)
    expect(body.content).toMatch(/entry one/)
    expect(body.relPath).toBe('memory/2026-04-21.md')
  })

  it('returns exists=false for missing day (no throw)', async () => {
    const body = await readAgentMemoryDay('claude', '2099-01-01')
    expect(body.exists).toBe(false)
    expect(body.content).toBe('')
  })

  it('rejects malformed date', async () => {
    await expect(readAgentMemoryDay('claude', '../etc/passwd')).rejects.toThrow(/Invalid date/)
    await expect(readAgentMemoryDay('claude', '2026/04/21')).rejects.toThrow(/Invalid date/)
  })

  it('rejects malformed agent', async () => {
    await expect(readAgentMemoryDay('../etc', '2026-04-21')).rejects.toThrow(/Invalid agent name/)
  })
})

describe('getAgentFilePointer', () => {
  beforeEach(() => seedAgent('claude'))

  it('returns pointer with size + mtime, no content', async () => {
    const ptr = await getAgentFilePointer('claude', 'SOUL.md')
    expect(ptr.exists).toBe(true)
    expect(ptr.relPath).toBe('SOUL.md')
    expect(ptr.size ?? 0).toBeGreaterThan(0)
    expect(ptr.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect((ptr as any).content).toBeUndefined()
  })

  it('exists=false when file missing', async () => {
    const ptr = await getAgentFilePointer('claude', 'AGENTS.md')
    expect(ptr.exists).toBe(false)
  })

  it('rejects non-allowlisted top-level filenames', async () => {
    await expect(getAgentFilePointer('claude', '.env')).rejects.toThrow(/not in the allowlist/)
    await expect(
      getAgentFilePointer('claude', '../../../etc/passwd'),
    ).rejects.toThrow(/not in the allowlist/)
  })
})

describe('readAgentFile', () => {
  beforeEach(() => seedAgent('claude'))

  it('reads SOUL.md content', async () => {
    const body = await readAgentFile('claude', 'SOUL.md')
    expect(body.exists).toBe(true)
    expect(body.content).toMatch(/I am claude/)
  })
})

describe('symlink escape defense', () => {
  it('refuses to read through a symlink that escapes workspace root', async () => {
    seedAgent('claude')
    const root = join(sandbox, 'workspace-claude')
    const outsideTarget = mkdtempSync(join(tmpdir(), 'aw-outside-'))
    try {
      writeFileSync(join(outsideTarget, 'secret.md'), 'leaked')
      try {
        symlinkSync(join(outsideTarget, 'secret.md'), join(root, 'memory', '2026-12-31.md'))
      } catch (err: any) {
        if (err.code === 'EPERM' || err.code === 'ENOSYS') return // platform skip
        throw err
      }
      await expect(readAgentMemoryDay('claude', '2026-12-31')).rejects.toThrow(
        /escapes agent workspace root/,
      )
    } finally {
      rmSync(outsideTarget, { recursive: true, force: true })
    }
  })
})

describe('size cap defense', () => {
  it('rejects oversized SOUL.md', async () => {
    seedAgent('claude')
    const big = 'x'.repeat(401 * 1024)
    writeFileSync(join(sandbox, 'workspace-claude', 'SOUL.md'), big)
    await expect(readAgentFile('claude', 'SOUL.md')).rejects.toThrow(/exceeds size limit/)
  })
})
