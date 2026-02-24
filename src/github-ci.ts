// SPDX-License-Identifier: Apache-2.0

export type GitHubCiState = 'success' | 'failure' | 'pending' | 'error' | 'unknown'

export type GitHubCiSource = 'github-check-runs' | 'github-status' | 'unavailable'

type CheckRun = {
  status?: string
  conclusion?: string | null
}

const SUCCESS_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'stale',
])

export function computeCiFromCheckRuns(checkRuns: CheckRun[]): { state: GitHubCiState; details?: string } {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return { state: 'unknown', details: 'No check-runs returned' }
  }

  const statuses = checkRuns.map(r => String(r.status || '').toLowerCase())
  const conclusions = checkRuns.map(r => (r.conclusion === null || r.conclusion === undefined) ? '' : String(r.conclusion).toLowerCase())

  // If anything is not completed, CI is still pending.
  if (statuses.some(s => s !== 'completed')) {
    return { state: 'pending', details: 'Some check-runs are not completed' }
  }

  // Completed, but any failing conclusion means failure.
  if (conclusions.some(c => FAILURE_CONCLUSIONS.has(c))) {
    return { state: 'failure', details: 'At least one check-run concluded non-success' }
  }

  // If all completed runs are success-ish, CI is success.
  if (conclusions.every(c => SUCCESS_CONCLUSIONS.has(c))) {
    return { state: 'success' }
  }

  return { state: 'unknown', details: 'Unrecognized check-run conclusion mix' }
}

export function computeCiFromCombinedStatus(state: unknown): { state: GitHubCiState; details?: string } {
  const normalized = typeof state === 'string' ? state.toLowerCase() : 'unknown'
  if (normalized === 'success' || normalized === 'failure' || normalized === 'pending' || normalized === 'error') {
    return { state: normalized }
  }
  return { state: 'unknown', details: 'Unknown combined status state' }
}
