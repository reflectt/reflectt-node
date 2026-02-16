#!/usr/bin/env node

import { execSync } from 'node:child_process'

const CONTRACT_PATTERNS = [
  /^src\/server\.ts$/,
  /^src\/tasks\.ts$/,
  /^src\/types\.ts$/,
  /^src\/mcp\.ts$/,
  /^src\/health\.ts$/,
]

const DOC_PATTERNS = [
  /^public\/docs\.md$/,
  /^docs\//,
  /^README\.md$/,
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

const changedFiles = getChangedFiles()
if (changedFiles.length === 0) {
  console.log('docs-contract-gate: no changed files detected; skipping')
  process.exit(0)
}

const contractTouched = changedFiles.some((file) => CONTRACT_PATTERNS.some((re) => re.test(file)))
if (!contractTouched) {
  console.log('docs-contract-gate: no API/schema contract changes detected')
  process.exit(0)
}

const docsTouched = changedFiles.some((file) => DOC_PATTERNS.some((re) => re.test(file)))
if (docsTouched) {
  console.log('docs-contract-gate: docs update detected alongside contract changes ✅')
  process.exit(0)
}

console.error('docs-contract-gate: API contract changed but no docs files were updated.')
console.error('Changed files:')
for (const file of changedFiles) console.error(` - ${file}`)
console.error('Expected docs update in public/docs.md, docs/*, or README.md')
process.exit(1)
