import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Check = {
  id: string
  pass: boolean
  expected: string
  actual: string
}

function usageAndExit(msg?: string): never {
  if (msg) console.error(msg)
  console.error('Usage: npm run test:task-linkify:dryrun-validator -- <transcript-path>')
  process.exit(1)
}

const input = process.argv[2]
if (!input) usageAndExit('Missing transcript path')

const transcriptPath = resolve(process.cwd(), input)
let transcript = ''
try {
  transcript = readFileSync(transcriptPath, 'utf8')
} catch (err: any) {
  usageAndExit(`Unable to read transcript: ${err?.message || err}`)
}

const lines = transcript.split(/\r?\n/)
const checks: Check[] = []

function push(id: string, pass: boolean, expected: string, actual: string) {
  checks.push({ id, pass, expected, actual })
}

function findExactLine(target: string): string | null {
  return lines.find(line => line.trim() === target) || null
}

const mutationLine = findExactLine('MUTATION=false')
push('mutation-false', Boolean(mutationLine), 'MUTATION=false', mutationLine || '<missing>')

const mutationAssert = findExactLine('ASSERT_OK: MUTATION=false')
push('mutation-assert-ok', Boolean(mutationAssert), 'ASSERT_OK: MUTATION=false', mutationAssert || '<missing>')

const requiredContextLine = findExactLine('REQUIRED_CONTEXT=task-linkify-regression-gate')
push(
  'required-context-exact',
  Boolean(requiredContextLine),
  'REQUIRED_CONTEXT=task-linkify-regression-gate',
  requiredContextLine || '<missing>',
)

const requiredContextAssert = findExactLine('ASSERT_OK: REQUIRED_CONTEXT exact match')
push(
  'required-context-assert-ok',
  Boolean(requiredContextAssert),
  'ASSERT_OK: REQUIRED_CONTEXT exact match',
  requiredContextAssert || '<missing>',
)

const mutationEndpointLine = lines.find(line => /^MUTATION_ENDPOINT_CALLS=\d+$/.test(line.trim())) || null
const mutationEndpointValue = mutationEndpointLine ? Number(mutationEndpointLine.trim().split('=')[1]) : NaN
push(
  'mutation-endpoint-calls-zero',
  Number.isFinite(mutationEndpointValue) && mutationEndpointValue === 0,
  'MUTATION_ENDPOINT_CALLS=0',
  mutationEndpointLine || '<missing>',
)

const decisionLines = lines.filter(line => /^DECISION=(GO|HOLD)$/.test(line.trim()))
push(
  'decision-explicit-single',
  decisionLines.length === 1,
  'Exactly one DECISION=GO|HOLD line',
  decisionLines.length === 0 ? '<missing>' : `${decisionLines.length} lines: ${decisionLines.join(' | ')}`,
)

const decisionReasonLine = lines.find(line => /^DECISION_REASON=.+/.test(line.trim())) || null
push('decision-reason-present', Boolean(decisionReasonLine), 'DECISION_REASON=<non-empty>', decisionReasonLine || '<missing>')

const playbookStepLine = findExactLine('[step] dry-run playbook read mode')
push(
  'playbook-read-step-present',
  Boolean(playbookStepLine),
  '[step] dry-run playbook read mode',
  playbookStepLine || '<missing>',
)

const failCount = checks.filter(c => !c.pass).length
const result = {
  validator: 'task-linkify-dryrun-transcript-validator',
  transcript: input,
  status: failCount === 0 ? 'PASS' : 'FAIL',
  failCount,
  checks,
}

console.log('TASK_LINKIFY_DRYRUN_TRANSCRIPT_VALIDATION_RESULT')
console.log(JSON.stringify(result, null, 2))

if (failCount > 0) process.exit(1)
