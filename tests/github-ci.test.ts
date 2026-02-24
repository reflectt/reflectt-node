import { describe, expect, it } from 'vitest'
import { computeCiFromCheckRuns, computeCiFromCombinedStatus } from '../src/github-ci.js'

describe('github-ci', () => {
  it('treats all completed success-ish check-runs as success', () => {
    const { state } = computeCiFromCheckRuns([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'skipped' },
      { status: 'completed', conclusion: 'neutral' },
    ])
    expect(state).toBe('success')
  })

  it('treats any non-completed check-run as pending', () => {
    const { state } = computeCiFromCheckRuns([
      { status: 'in_progress', conclusion: null },
      { status: 'completed', conclusion: 'success' },
    ])
    expect(state).toBe('pending')
  })

  it('treats failing conclusions as failure', () => {
    const { state } = computeCiFromCheckRuns([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ])
    expect(state).toBe('failure')
  })

  it('combined status parses supported states and defaults unknown', () => {
    expect(computeCiFromCombinedStatus('success').state).toBe('success')
    expect(computeCiFromCombinedStatus('pending').state).toBe('pending')
    expect(computeCiFromCombinedStatus('wat').state).toBe('unknown')
  })

  // Regression driver for strict review-bundle:
  // if combined statuses are empty/pending but check-runs are green, strict should pass.
  it('green check-runs can represent success even if combined status is pending/empty', () => {
    const checks = computeCiFromCheckRuns([
      { status: 'completed', conclusion: 'success' },
    ])
    const statuses = computeCiFromCombinedStatus('pending')

    expect(checks.state).toBe('success')
    expect(statuses.state).toBe('pending')
  })
})
