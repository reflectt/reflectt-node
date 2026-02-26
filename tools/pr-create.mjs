#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * PR Create Helper
 *
 * Usage: npm run pr:create -- --task <task-id> [--title "custom title"]
 *
 * Standardizes PR creation with:
 * - Auto-fetches task title for PR title
 * - Generates PR body with task ID, done criteria, and checklist
 * - Runs precheck to surface any missing fields
 * - Creates the PR via `gh pr create`
 */

import { execSync, execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const taskIdx = args.indexOf('--task')
const titleIdx = args.indexOf('--title')

if (taskIdx === -1 || !args[taskIdx + 1]) {
  console.error('Usage: npm run pr:create -- --task <task-id> [--title "custom title"]')
  process.exit(1)
}

const taskId = args[taskIdx + 1]
const customTitle = titleIdx !== -1 ? args[titleIdx + 1] : null
const API_BASE = process.env.REFLECTT_API || 'http://127.0.0.1:4445'

async function main() {
  // 1. Fetch task details
  console.log(`📋 Fetching task ${taskId}...`)
  const taskRes = await fetch(`${API_BASE}/tasks/${taskId}`)
  const taskData = await taskRes.json()

  if (!taskData.task) {
    console.error(`❌ Task not found: ${taskId}`)
    process.exit(1)
  }

  const task = taskData.task
  console.log(`   Title: ${task.title}`)
  console.log(`   Status: ${task.status}`)
  console.log(`   Assignee: ${task.assignee || 'unassigned'}`)

  // 2. Run precheck for validating
  console.log(`\n🔍 Running precheck for validating...`)
  const precheckRes = await fetch(`${API_BASE}/tasks/${taskId}/precheck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetStatus: 'validating' }),
  })
  const precheck = await precheckRes.json()

  if (precheck.items?.length > 0) {
    console.log(`\n⚠️  Precheck items:`)
    for (const item of precheck.items) {
      const icon = item.severity === 'error' ? '❌' : item.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`   ${icon} [${item.field}] ${item.message}`)
      if (item.hint) console.log(`      Hint: ${item.hint}`)
    }
  }

  if (precheck.ready) {
    console.log(`\n✅ Task is ready for validating transition`)
  } else {
    console.log(`\n⚠️  Task has unmet requirements — PR can still be created`)
  }

  // 3. Get current branch and commit
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim()
  const commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  const shortId = taskId.split('-').pop()

  console.log(`\n🔀 Branch: ${branch}`)
  console.log(`   Commit: ${commitSha}`)

  // 4. Build PR title and body
  const prTitle = customTitle || `feat: ${task.title.toLowerCase()}`

  const doneCriteria = (task.done_criteria || [])
    .map(c => `- [ ] ${c}`)
    .join('\n')

  const prBody = `## ${task.title}

### Task
\`${taskId}\`

### Done Criteria
${doneCriteria || '- [ ] (none specified)'}

### Checklist
- [ ] Tests pass (\`npx vitest run\`)
- [ ] TypeScript compiles (\`npx tsc --noEmit\`)
- [ ] Route-docs contract (\`node tools/check-route-docs-contract.mjs\`)
- [ ] Process artifact created (\`process/TASK-${shortId}.md\`)

### Review Handoff
\`\`\`json
{
  "task_id": "${taskId}",
  "repo": "reflectt/reflectt-node",
  "pr_url": "<will be filled after PR creation>",
  "commit_sha": "${commitSha}",
  "artifact_path": "process/TASK-${shortId}.md",
  "test_proof": "<fill in>",
  "known_caveats": "<fill in or 'none'>"
}
\`\`\`
`

  // 5. Create PR
  console.log(`\n🚀 Creating PR: "${prTitle}"...`)
  try {
    const result = execFileSync(
      'gh',
      ['pr', 'create', '--title', prTitle, '--body', prBody, '--base', 'main'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    console.log(`\n✅ PR created: ${result}`)

    // Extract PR number
    const prMatch = result.match(/\/pull\/(\d+)/)
    if (prMatch) {
      console.log(`\n📝 Update task metadata with:`)
      console.log(`   pr_url: ${result}`)
      console.log(`   commit_sha: ${commitSha}`)
    }
  } catch (err) {
    console.error(`\n❌ PR creation failed:`, err.stderr || err.message)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
