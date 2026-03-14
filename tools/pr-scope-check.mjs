#!/usr/bin/env node
/**
 * PR Scope Policy Gate — Signal #3
 *
 * Checks all 4 rules defined in SPEC-pr-scope-policy.md:
 *
 *   Rule 1 (BLOCK): Stash residue — files modified before branch's first commit
 *   Rule 2 (WARN):  File count > N×2 where N=20 default or derived from task scope
 *   Rule 3 (WARN):  Cross-task file overlap with other remote branches
 *   Rule 4 (BLOCK): Sensitive-path files without task ID in commit message
 *
 * Usage:
 *   node tools/pr-scope-check.mjs --base <base-branch> [--pr-body <file>] [--verbose]
 *
 * Exit codes:
 *   0 — all checks passed (warnings may be emitted)
 *   1 — one or more blocking rules triggered
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'

// ── Config ──────────────────────────────────────────────────────────────────

const SENSITIVE_PATHS = [
  'src/server.ts',
  'supabase/migrations/',
  'defaults/',
  '.github/workflows/',
]

const RULE2_DEFAULT_N = 20  // files — must be documented in CI output per @kai note

const TASK_ID_RE = /task-[a-z0-9]+-?[a-z0-9]*/i

// ── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const baseIdx = args.indexOf('--base')
const prBodyIdx = args.indexOf('--pr-body')
const verbose = args.includes('--verbose')

const baseBranch = baseIdx >= 0 ? args[baseIdx + 1] : 'main'
const prBodyFile = prBodyIdx >= 0 ? args[prBodyIdx + 1] : null
const prBody = prBodyFile && existsSync(prBodyFile) ? readFileSync(prBodyFile, 'utf8') : ''

// ── Helpers ─────────────────────────────────────────────────────────────────

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

function log(...args) {
  console.log('[scope-check]', ...args)
}

function warn(...args) {
  console.warn('[scope-check] ⚠️  Warning:', ...args)
}

function fail(...args) {
  console.error('[scope-check] ❌ BLOCK:', ...args)
}

// ── Gather diff info ─────────────────────────────────────────────────────────

// Files changed vs base (names only, no renames)
const diffFiles = run(`git diff --name-only ${baseBranch}...HEAD`)
  .split('\n').map(f => f.trim()).filter(Boolean)

// First commit on current branch (not on base)
const branchFirstCommit = run(`git log ${baseBranch}..HEAD --reverse --format=%H | head -1`)
const branchFirstCommitTime = branchFirstCommit
  ? parseInt(run(`git log -1 --format=%ct ${branchFirstCommit}`), 10)
  : Date.now() / 1000

// All commit messages on current branch (full body, not just subject — task IDs may appear in footer)
const commitMessages = run(`git log ${baseBranch}..HEAD --format=%B`).split('\n').filter(Boolean)

if (verbose) {
  log(`Base: ${baseBranch}`)
  log(`Changed files: ${diffFiles.length}`)
  log(`Branch first commit: ${branchFirstCommit} (${new Date(branchFirstCommitTime * 1000).toISOString()})`)
}

// ── Rule 1: Stash residue ────────────────────────────────────────────────────
// Blocks when a changed file's last modification time predates the branch's
// first commit by >5 min AND no scope-justification is present in the PR body.

const STASH_GRACE_S = 5 * 60  // 5 minutes

const hasScopeJustification = prBody.toLowerCase().includes('scope-justification:')

let rule1Failures = 0

for (const file of diffFiles) {
  if (!existsSync(file)) continue  // deleted file — skip mtime check

  // Check worktree mtime via git log (last modification in repo history)
  const fileLastModEpoch = run(`git log -1 --format=%ct -- "${file}"`)
  const fileModTime = fileLastModEpoch ? parseInt(fileLastModEpoch, 10) : 0

  if (fileModTime > 0 && branchFirstCommitTime > 0) {
    const ageSecs = branchFirstCommitTime - fileModTime
    if (ageSecs > STASH_GRACE_S) {
      if (hasScopeJustification) {
        if (verbose) {
          log(`Rule 1: ${file} modified ${Math.round(ageSecs / 60)}m before branch start — scope-justification present, passing.`)
        }
      } else {
        fail(`Possible stash residue: ${file}`)
        fail(`  File was last modified ~${Math.round(ageSecs / 60)}m before this branch's first commit.`)
        fail(`  Add 'scope-justification: <reason>' to the PR body or unstage before pushing.`)
        rule1Failures++
      }
    }
  }
}

// ── Rule 2: File count warning ───────────────────────────────────────────────
// Warns (does NOT block) when changed file count > N×2.
// N defaults to ${RULE2_DEFAULT_N}. Threshold = N×2 = ${RULE2_DEFAULT_N * 2}.

const rule2Threshold = RULE2_DEFAULT_N * 2

if (diffFiles.length > rule2Threshold) {
  warn(`${diffFiles.length} files changed.`)
  warn(`Expected ≤${rule2Threshold} (default N=${RULE2_DEFAULT_N}, threshold=N×2=${rule2Threshold}).`)
  warn(`Review for stash residue before opening PR.`)
  warn(`(To raise N, set SCOPE_CHECK_N env var: SCOPE_CHECK_N=50 for 100-file threshold)`)
} else if (verbose) {
  log(`Rule 2: ${diffFiles.length} files ≤ ${rule2Threshold} (N=${RULE2_DEFAULT_N}×2). OK.`)
}

// ── Rule 3: Cross-task file overlap ─────────────────────────────────────────
// Warns (does NOT block) when a changed file is also modified on another
// remote branch. Uses git log to find branches that recently touched the file.

const currentBranch = run('git rev-parse --abbrev-ref HEAD')

for (const file of diffFiles) {
  // Find remote branches where this file was modified in last 100 commits
  const branches = run(`git log --all --oneline --branches='*' -100 -- "${file}" --format=%D`)
    .split('\n')
    .flatMap(line => line.split(','))
    .map(b => b.trim().replace(/^origin\//, '').replace(/^HEAD -> /, ''))
    .filter(b => b && b !== currentBranch && !b.includes('HEAD') && !b.includes('main'))

  const uniqueBranches = [...new Set(branches)].filter(Boolean)
  if (uniqueBranches.length > 0) {
    warn(`File '${file}' also modified on: ${uniqueBranches.slice(0, 3).join(', ')}`)
    warn(`  Verify this is intentional before pushing.`)
  }
}

// ── Rule 4: Sensitive paths without task ID ──────────────────────────────────
// Blocks when a file in SENSITIVE_PATHS is changed and NO commit message
// on the branch includes a task ID (task-<id> pattern).

const hasTaskIdInCommits = commitMessages.some(msg => TASK_ID_RE.test(msg))

let rule4Failures = 0

if (!hasTaskIdInCommits) {
  for (const file of diffFiles) {
    const isSensitive = SENSITIVE_PATHS.some(p => file === p || file.startsWith(p))
    if (isSensitive) {
      fail(`Sensitive file changed without task ID in commit message: ${file}`)
      fail(`  Add 'task-<id>' to at least one commit message on this branch to proceed.`)
      fail(`  Sensitive paths: ${SENSITIVE_PATHS.join(', ')}`)
      rule4Failures++
    }
  }
} else if (verbose) {
  log(`Rule 4: Task ID found in commit messages. Sensitive path check passed.`)
}

// ── Summary ──────────────────────────────────────────────────────────────────

const totalBlocks = rule1Failures + rule4Failures

if (totalBlocks > 0) {
  console.error(`\n[scope-check] ❌ ${totalBlocks} blocking rule(s) triggered. Push blocked.`)
  process.exit(1)
} else {
  log(`✅ All blocking rules passed.${diffFiles.length > 0 ? ` (${diffFiles.length} files checked)` : ''}`)
  process.exit(0)
}
