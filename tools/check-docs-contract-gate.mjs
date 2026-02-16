#!/usr/bin/env node

/**
 * Docs contract gate — only fires when API surface actually changes.
 *
 * Previous version triggered on ANY edit to server.ts/tasks.ts/types.ts,
 * which blocked internal refactors that don't affect the API.
 *
 * Now it only triggers when the diff in contract files contains:
 *   - Route definitions (app.get/post/patch/delete)
 *   - Exported types/interfaces
 *   - Schema/migration changes
 *
 * The route-to-docs contract check (check-route-docs-contract.mjs) already
 * ensures every route in server.ts has a docs entry. This gate catches
 * broader schema/type changes that also need documentation.
 */

import { execSync } from 'node:child_process'

const CONTRACT_FILES = [
  'src/server.ts',
  'src/tasks.ts',
  'src/types.ts',
  'src/mcp.ts',
  'src/health.ts',
]

const DOC_PATTERNS = [
  /^public\/docs\.md$/,
  /^docs\//,
  /^README\.md$/,
]

// Patterns in the diff that indicate API surface changes (not just internal refactors)
const API_SURFACE_PATTERNS = [
  /app\.(get|post|patch|delete)\s*[<(]/,      // Route definitions
  /export\s+(interface|type|enum|const)\s/,    // Exported types
  /export\s+function\s/,                        // Exported functions
  /export\s+async\s+function\s/,                // Exported async functions
  /schema.*version/i,                            // Schema version changes
  /migration/i,                                  // Migration changes
]

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function tryRun(command) {
  try {
    return run(command)
  } catch {
    return ''
  }
}

function getChangedFiles() {
  const baseRef = process.env.GITHUB_BASE_REF

  if (baseRef) {
    tryRun(`git fetch --no-tags --depth=1 origin ${baseRef}`)
    const out = tryRun(`git diff --name-only origin/${baseRef}...HEAD`)
    if (out) return out.split('\n').filter(Boolean)
  }

  const out = tryRun('git diff --name-only HEAD~1..HEAD')
  if (out) return out.split('\n').filter(Boolean)

  return []
}

function getDiffForFile(file) {
  const baseRef = process.env.GITHUB_BASE_REF

  if (baseRef) {
    return tryRun(`git diff origin/${baseRef}...HEAD -- ${file}`)
  }

  return tryRun(`git diff HEAD~1..HEAD -- ${file}`)
}

const changedFiles = getChangedFiles()
if (changedFiles.length === 0) {
  console.log('docs-contract-gate: no changed files detected; skipping')
  process.exit(0)
}

// Check if any contract files were changed
const contractFilesChanged = changedFiles.filter((file) =>
  CONTRACT_FILES.some((cf) => file === cf),
)

if (contractFilesChanged.length === 0) {
  console.log('docs-contract-gate: no API/schema contract files changed')
  process.exit(0)
}

// Check if the DIFF in those files actually touches API surface
let apiSurfaceChanged = false
const surfaceChanges = []

for (const file of contractFilesChanged) {
  const diff = getDiffForFile(file)
  if (!diff) continue

  // Only look at added/modified lines (lines starting with +, excluding +++ header)
  const addedLines = diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))

  for (const line of addedLines) {
    for (const pattern of API_SURFACE_PATTERNS) {
      if (pattern.test(line)) {
        apiSurfaceChanged = true
        surfaceChanges.push({ file, line: line.substring(1).trim(), pattern: pattern.source })
        break
      }
    }
  }
}

if (!apiSurfaceChanged) {
  console.log('docs-contract-gate: contract files changed but no API surface changes detected (internal refactor) ✅')
  process.exit(0)
}

// API surface changed — check if docs were also updated
const docsTouched = changedFiles.some((file) => DOC_PATTERNS.some((re) => re.test(file)))
if (docsTouched) {
  console.log('docs-contract-gate: API surface changed with docs update ✅')
  process.exit(0)
}

console.error('docs-contract-gate: API surface changed but no docs files were updated.')
console.error('Surface changes detected:')
for (const { file, line } of surfaceChanges.slice(0, 10)) {
  console.error(`  ${file}: ${line}`)
}
console.error('Expected docs update in public/docs.md, docs/*, or README.md')
console.error('If this is a false positive (internal change that looks like API surface), add a trivial docs touch.')
process.exit(1)
