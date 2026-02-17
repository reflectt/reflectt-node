#!/usr/bin/env node

/**
 * Concise test output wrapper
 *
 * Runs vitest and prints only:
 *   - Pass/fail counts per file
 *   - Failed test names + errors
 *   - Final summary line
 *
 * Usage:
 *   node tools/test-summary.mjs          # concise mode
 *   node tools/test-summary.mjs --verbose # full vitest output
 *   npm run test:summary                 # via package.json
 */

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const verbose = process.argv.includes('--verbose') || process.argv.includes('-v')

if (verbose) {
  // Pass-through: run vitest with full output
  const child = spawn('npx', ['vitest', 'run'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  // Concise mode: capture output, extract JSON from last line
  const child = spawn('npx', ['vitest', 'run', '--reporter=json'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (data) => { stdout += data.toString() })
  child.stderr.on('data', (data) => { stderr += data.toString() })

  child.on('exit', (code) => {
    // Vitest JSON reporter may mix log lines with JSON
    // The JSON object is typically the last complete line
    const parsed = extractJson(stdout)

    if (parsed) {
      printSummary(parsed, code)
    } else {
      // Fall back: parse vitest default output for counts
      printFallbackSummary(stdout + stderr, code)
    }
    process.exit(code ?? 0)
  })
}

function extractJson(output) {
  // Try each line from the end — JSON reporter puts the result object last
  const lines = output.split('\n').filter(l => l.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line)
      } catch {
        continue
      }
    }
  }

  // Try to find JSON blob anywhere in the output
  const jsonMatch = output.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {}
  }

  return null
}

function printSummary(result, exitCode) {
  const { testResults, numTotalTests, numPassedTests, numFailedTests, numPendingTests } = result

  console.log('')
  console.log('┌─────────────────────────────────────────┐')
  console.log('│          Test Summary (concise)          │')
  console.log('└─────────────────────────────────────────┘')
  console.log('')

  // Per-file summary
  if (testResults && testResults.length > 0) {
    for (const file of testResults) {
      const name = file.name?.replace(root + '/', '') || file.name || '?'
      const assertions = file.assertionResults || []
      const passed = assertions.filter(r => r.status === 'passed').length
      const failed = assertions.filter(r => r.status === 'failed').length
      const skipped = assertions.filter(r => r.status === 'pending' || r.status === 'skipped').length
      const total = passed + failed + skipped

      const icon = failed > 0 ? '❌' : '✅'
      const parts = [`${passed} passed`]
      if (failed > 0) parts.push(`${failed} failed`)
      if (skipped > 0) parts.push(`${skipped} skipped`)

      console.log(`  ${icon} ${name} (${total} tests: ${parts.join(', ')})`)

      // Print failed test details
      if (failed > 0) {
        for (const test of assertions) {
          if (test.status === 'failed') {
            const testName = test.ancestorTitles?.length
              ? `${test.ancestorTitles.join(' > ')} > ${test.title}`
              : test.title
            console.log(`     ❌ ${testName}`)
            if (test.failureMessages?.length) {
              for (const msg of test.failureMessages) {
                const firstLine = msg.split('\n').find(l => l.trim().length > 0) || msg.slice(0, 120)
                console.log(`        ${firstLine.trim().slice(0, 100)}`)
              }
            }
          }
        }
      }
    }
  }

  // Final summary
  console.log('')
  const duration = result.startTime
    ? `${((Date.now() - result.startTime) / 1000).toFixed(1)}s`
    : '?'

  const statusIcon = (numFailedTests ?? 0) > 0 ? '❌ FAIL' : '✅ PASS'
  console.log(`  ${statusIcon}  ${numPassedTests ?? 0} passed, ${numFailedTests ?? 0} failed, ${numPendingTests ?? 0} skipped (${numTotalTests ?? 0} total) [${duration}]`)
  console.log('')
}

function printFallbackSummary(output, exitCode) {
  // Parse vitest default output for summary line
  console.log('')
  console.log('┌─────────────────────────────────────────┐')
  console.log('│          Test Summary (concise)          │')
  console.log('└─────────────────────────────────────────┘')
  console.log('')

  // Look for "Tests  X passed" or similar
  const testLine = output.match(/Tests?\s+.*?(\d+)\s+passed.*?(\d+)\s+(?:failed|skipped)?/i)
  const fileLine = output.match(/Test Files?\s+.*?(\d+)\s+passed/i)

  if (fileLine) console.log(`  📁 ${fileLine[0].trim()}`)
  if (testLine) console.log(`  🧪 ${testLine[0].trim()}`)

  // Extract any failure lines
  const failLines = output.split('\n').filter(l =>
    l.includes('FAIL') || l.includes('✗') || l.includes('×') || l.includes('AssertionError')
  ).slice(0, 10)

  if (failLines.length > 0) {
    console.log('')
    console.log('  Failures:')
    for (const line of failLines) {
      console.log(`    ${line.trim().slice(0, 100)}`)
    }
  }

  const icon = exitCode === 0 ? '✅ PASS' : '❌ FAIL'
  console.log(`\n  ${icon}  (exit code: ${exitCode})`)
  console.log('')
}
