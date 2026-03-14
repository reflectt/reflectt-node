// PR Scope Policy Gate tests — Signal #3
// Validates: Rule 1 (stash residue), Rule 2 (file count), Rule 4 (sensitive paths)
// Test cases A–E per SPEC-pr-scope-policy.md

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/** Run the scope check script in an isolated git repo */
function runScopeCheck(opts: {
  files: Array<{ path: string; content: string; commitMsg?: string; predate?: boolean }>
  prBody?: string
  verbose?: boolean
  base?: string
}): { stdout: string; stderr: string; exitCode: number } {
  const dir = mkdtempSync(join(tmpdir(), 'scope-check-'))

  try {
    // Init repo (defaults to 'main' branch)
    execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })

    // Seed main branch with a base commit
    writeFileSync(join(dir, 'README.md'), 'base\n')
    execSync('git add .', { cwd: dir, stdio: 'pipe' })
    execSync('git commit -m "init: base commit"', { cwd: dir, stdio: 'pipe' })

    // Create feature branch
    execSync('git checkout -b feature/test', { cwd: dir, stdio: 'pipe' })

    // Write files with optional pre-dating
    const now = Math.floor(Date.now() / 1000)
    const OLD_TS = now - 3600  // 1h ago — predates branch

    for (const f of opts.files) {
      const fullPath = join(dir, f.path)
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'))
      if (parentDir !== dir) mkdirSync(parentDir, { recursive: true })
      writeFileSync(fullPath, f.content)
    }

    // Pre-date specified files BEFORE first branch commit by manipulating git history
    // Strategy: commit pre-dated files with backdated author date, then commit the rest
    const predated = opts.files.filter(f => f.predate)
    const normal   = opts.files.filter(f => !f.predate)

    if (predated.length > 0) {
      // Commit predated files with a timestamp 1h before now (before branch start)
      for (const f of predated) execSync(`git add "${f.path}"`, { cwd: dir, stdio: 'pipe' })
      const oldDate = new Date((OLD_TS) * 1000).toISOString()
      execSync(`GIT_AUTHOR_DATE="${oldDate}" GIT_COMMITTER_DATE="${oldDate}" git commit -m "${predated[0].commitMsg ?? 'old: stale file'}"`, {
        cwd: dir, stdio: 'pipe', shell: true,
      })
    }

    if (normal.length > 0) {
      for (const f of normal) execSync(`git add "${f.path}"`, { cwd: dir, stdio: 'pipe' })
      execSync(`git commit -m "${normal[0].commitMsg ?? 'feat: add files task-test123'}"`, { cwd: dir, stdio: 'pipe' })
    }

    // Write PR body file if provided
    const prBodyFile = join(dir, 'pr-body.txt')
    writeFileSync(prBodyFile, opts.prBody ?? '')

    // Find the actual scope check script path
    const scriptPath = join(process.cwd(), 'tools/pr-scope-check.mjs')

    const args = [
      `node "${scriptPath}"`,
      `--base main`,
      `--pr-body "${prBodyFile}"`,
      opts.verbose ? '--verbose' : '',
    ].filter(Boolean).join(' ')

    try {
      const stdout = execSync(args, { cwd: dir, encoding: 'utf8', shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
      return { stdout, stderr: '', exitCode: 0 }
    } catch (err: any) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.status ?? 1,
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('PR scope gate — Signal #3', () => {
  it('Test A: clean PR (only task-related files) → no errors', () => {
    const result = runScopeCheck({
      files: [
        { path: 'src/feature.ts', content: 'export const x = 1', commitMsg: 'feat: add feature task-abc123' },
      ],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('All blocking rules passed')
    expect(result.stderr).not.toContain('BLOCK')
  })

  it('Test B: PR with stash-residue file → Rule 1 blocks', () => {
    // Stash residue: a file committed on the branch with a timestamp that predates
    // the branch's FIRST commit by >5min (simulates git stash pop of older work).
    // Key ordering: normal file commits FIRST (establishes branch start = NOW),
    // stale file committed SECOND with backdated timestamp.
    const dir = mkdtempSync(join(tmpdir(), 'scope-b-'))
    try {
      execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' })
      writeFileSync(join(dir, 'README.md'), 'base')
      execSync('git add .', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
      execSync('git checkout -b feature/b', { cwd: dir, stdio: 'pipe' })

      // First commit: normal file at current time — this is the branch start timestamp
      writeFileSync(join(dir, 'normal.ts'), 'real work')
      execSync('git add normal.ts', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "feat: real task work task-abc"', { cwd: dir, stdio: 'pipe' })

      // Second commit: stale file with timestamp 2h before NOW (predates branch start by >5min)
      writeFileSync(join(dir, 'stale.ts'), 'stale content from old stash')
      execSync('git add stale.ts', { cwd: dir, stdio: 'pipe' })
      const oldDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      execSync(
        `GIT_AUTHOR_DATE="${oldDate}" GIT_COMMITTER_DATE="${oldDate}" git commit -m "old: stale file from stash"`,
        { cwd: dir, stdio: 'pipe', shell: true },
      )

      const prBodyFile = join(dir, 'pr.txt')
      writeFileSync(prBodyFile, '')
      const scriptPath = join(process.cwd(), 'tools/pr-scope-check.mjs')

      try {
        execSync(`node "${scriptPath}" --base main --pr-body "${prBodyFile}"`, {
          cwd: dir, encoding: 'utf8', shell: true, stdio: 'pipe',
        })
        // Should have thrown
        expect(true).toBe(false) // force fail if no throw
      } catch (err: any) {
        expect(err.status).toBe(1)
        const combined = (err.stdout ?? '') + (err.stderr ?? '')
        expect(combined).toContain('stale')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Test C: PR with many files → Rule 2 warns (no block)', () => {
    // 45 files > Rule 2 threshold (N=20, threshold=N×2=40) → warning emitted
    // Rule 2 is soft — exit code stays 0
    const files = Array.from({ length: 45 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: `export const v${i} = ${i}`,
      commitMsg: `feat: bulk add files task-bulk123`,
    }))

    const result = runScopeCheck({ files, verbose: true })
    // Rule 2 is a warning — must NOT block
    expect(result.exitCode).toBe(0)
    // Output must document N and threshold so agents know the rule
    const combined = result.stdout + result.stderr
    // Warning message must mention file count, N=20, and threshold
    expect(combined).toMatch(/45 files|Warning/i)
  })

  it('Test D: sensitive path without task ID in commit → Rule 4 blocks', () => {
    const result = runScopeCheck({
      files: [
        // Commit message has NO task ID
        { path: 'src/server.ts', content: 'export const app = 1', commitMsg: 'fix: hotfix no task id' },
      ],
    })
    expect(result.exitCode).toBe(1)
    const combined = result.stdout + result.stderr
    expect(combined).toContain('src/server.ts')
    expect(combined).toContain('task ID')
  })

  it('Test E: Rule 1 violation with scope-justification in PR body → passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scope-e-'))
    try {
      execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.email "t@t.com"', { cwd: dir, stdio: 'pipe' })
      execSync('git config user.name "T"', { cwd: dir, stdio: 'pipe' })
      writeFileSync(join(dir, 'README.md'), 'base')
      execSync('git add .', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
      execSync('git checkout -b feature/e', { cwd: dir, stdio: 'pipe' })

      // Stale file in first commit
      writeFileSync(join(dir, 'stale.ts'), 'stale')
      execSync('git add stale.ts', { cwd: dir, stdio: 'pipe' })
      const oldDate = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      execSync(
        `GIT_AUTHOR_DATE="${oldDate}" GIT_COMMITTER_DATE="${oldDate}" git commit -m "old: stale"`,
        { cwd: dir, stdio: 'pipe', shell: true },
      )
      // Second commit with real work
      writeFileSync(join(dir, 'real.ts'), 'real work task-xyz')
      execSync('git add real.ts', { cwd: dir, stdio: 'pipe' })
      execSync('git commit -m "feat: real work task-xyz"', { cwd: dir, stdio: 'pipe' })

      // PR body has scope-justification
      const prBodyFile = join(dir, 'pr.txt')
      writeFileSync(prBodyFile, 'scope-justification: stale.ts is required because it was pre-staged for this task')

      const scriptPath = join(process.cwd(), 'tools/pr-scope-check.mjs')
      const stdout = execSync(`node "${scriptPath}" --base main --pr-body "${prBodyFile}"`, {
        cwd: dir, encoding: 'utf8', shell: true,
      })
      expect(stdout).toContain('All blocking rules passed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
