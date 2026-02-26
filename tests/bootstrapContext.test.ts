// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getBootstrapContextReport } from '../src/bootstrapContext.js'

function makeTempStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'reflectt-bootctx-'))
}

describe('getBootstrapContextReport', () => {
  it('reports workspace-* bootstrap file sizes and flags large totals', async () => {
    const stateDir = makeTempStateDir()

    const w1 = join(stateDir, 'workspace-alpha')
    mkdirSync(w1, { recursive: true })
    writeFileSync(join(w1, 'AGENTS.md'), 'hello')
    writeFileSync(join(w1, 'SOUL.md'), 'world')

    const w2 = join(stateDir, 'workspace-bravo')
    mkdirSync(w2, { recursive: true })
    writeFileSync(join(w2, 'MEMORY.md'), 'x'.repeat(30_000))

    const report = await getBootstrapContextReport({
      stateDir,
      warnTotalChars: 100,
      failTotalChars: 200,
      warnSingleFileChars: 100,
      failSingleFileChars: 200,
    })

    expect(report.workspaces.length).toBe(2)
    const bravo = report.workspaces.find(w => w.agent === 'bravo')
    expect(bravo).toBeTruthy()
    expect(bravo!.flags.length).toBeGreaterThan(0)
    expect(bravo!.files.find(f => f.name === 'MEMORY.md')!.chars).toBe(30_000)
    expect(report.totals.flaggedWorkspaceCount).toBe(1)
  })
})
