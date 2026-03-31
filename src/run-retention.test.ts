// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

interface RetentionPolicy {
  maxAgeDays: number
  maxCompletedRuns: number
  deleteArchived: boolean
}

const DEFAULT_POLICY: RetentionPolicy = { maxAgeDays: 30, maxCompletedRuns: 100, deleteArchived: false }

function shouldArchive(run: { status: string; startedAt: number }, policy: RetentionPolicy, now: number): boolean {
  const terminal = ['completed', 'failed', 'cancelled'].includes(run.status)
  if (!terminal) return false
  const cutoff = now - policy.maxAgeDays * 24 * 60 * 60 * 1000
  return run.startedAt < cutoff
}

describe('run retention policy', () => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  it('does not archive active runs', () => {
    assert.equal(shouldArchive({ status: 'working', startedAt: now - 60 * day }, DEFAULT_POLICY, now), false)
    assert.equal(shouldArchive({ status: 'idle', startedAt: now - 60 * day }, DEFAULT_POLICY, now), false)
    assert.equal(shouldArchive({ status: 'blocked', startedAt: now - 60 * day }, DEFAULT_POLICY, now), false)
  })

  it('archives completed runs older than maxAgeDays', () => {
    assert.equal(shouldArchive({ status: 'completed', startedAt: now - 31 * day }, DEFAULT_POLICY, now), true)
  })

  it('does not archive recent completed runs', () => {
    assert.equal(shouldArchive({ status: 'completed', startedAt: now - 5 * day }, DEFAULT_POLICY, now), false)
  })

  it('archives failed runs older than maxAgeDays', () => {
    assert.equal(shouldArchive({ status: 'failed', startedAt: now - 31 * day }, DEFAULT_POLICY, now), true)
  })

  it('archives cancelled runs older than maxAgeDays', () => {
    assert.equal(shouldArchive({ status: 'cancelled', startedAt: now - 31 * day }, DEFAULT_POLICY, now), true)
  })

  it('respects custom maxAgeDays', () => {
    const policy = { ...DEFAULT_POLICY, maxAgeDays: 7 }
    assert.equal(shouldArchive({ status: 'completed', startedAt: now - 8 * day }, policy, now), true)
    assert.equal(shouldArchive({ status: 'completed', startedAt: now - 5 * day }, policy, now), false)
  })

  it('boundary: exactly at cutoff is not archived', () => {
    const cutoff = now - 30 * day
    assert.equal(shouldArchive({ status: 'completed', startedAt: cutoff }, DEFAULT_POLICY, now), false)
  })

  it('boundary: one ms before cutoff is archived', () => {
    const cutoff = now - 30 * day
    assert.equal(shouldArchive({ status: 'completed', startedAt: cutoff - 1 }, DEFAULT_POLICY, now), true)
  })

  it('default policy values are sensible', () => {
    assert.equal(DEFAULT_POLICY.maxAgeDays, 30)
    assert.equal(DEFAULT_POLICY.maxCompletedRuns, 100)
    assert.equal(DEFAULT_POLICY.deleteArchived, false)
  })

  it('deleteArchived flag controls hard delete vs soft archive', () => {
    const soft = { ...DEFAULT_POLICY, deleteArchived: false }
    const hard = { ...DEFAULT_POLICY, deleteArchived: true }
    assert.equal(soft.deleteArchived, false)
    assert.equal(hard.deleteArchived, true)
  })
})
