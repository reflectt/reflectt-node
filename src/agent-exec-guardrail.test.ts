// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkActionAllowed, requiresApprovalGate } from './agent-exec-guardrail.js'

describe('checkActionAllowed', () => {
  it('allows github_issue_create with github.com domain', () => {
    const result = checkActionAllowed('github_issue_create', 'https://github.com/owner/repo')
    assert.equal(result.allowed, true)
    assert.equal(result.reason, undefined)
  })

  it('allows github_issue_create with no target', () => {
    const result = checkActionAllowed('github_issue_create')
    assert.equal(result.allowed, true)
  })

  it('denies unknown action with reason', () => {
    // @ts-expect-error testing unknown kind
    const result = checkActionAllowed('unknown_action')
    assert.equal(result.allowed, false)
    assert.ok(result.reason?.includes('unknown_action'))
    assert.ok(result.reason?.includes('approved action list'))
  })

  it('denies out-of-scope domain with reason', () => {
    const result = checkActionAllowed('github_issue_create', 'https://evil.com/owner/repo')
    assert.equal(result.allowed, false)
    assert.ok(result.reason?.includes('evil.com'))
    assert.ok(result.reason?.includes('approved domain list'))
  })

  it('allows subdomain of github.com', () => {
    const result = checkActionAllowed('github_issue_create', 'https://api.github.com/repos/owner/repo/issues')
    assert.equal(result.allowed, true)
  })

  it('does not match partial domain (githubx.com)', () => {
    const result = checkActionAllowed('github_issue_create', 'https://githubx.com/owner/repo')
    assert.equal(result.allowed, false)
    assert.ok(result.reason?.includes('githubx.com'))
  })

  it('ignores non-URL target strings (no hostname to check)', () => {
    // If target is not a URL, URL parsing returns null and no domain check is done
    const result = checkActionAllowed('github_issue_create', 'owner/repo')
    assert.equal(result.allowed, true)
  })
})

describe('requiresApprovalGate', () => {
  it('returns true for github_issue_create', () => {
    assert.equal(requiresApprovalGate('github_issue_create'), true)
  })

  it('returns true for all v1 actions (always requires human approval)', () => {
    // All v1 actions are irreversible — gate is always on
    const kinds = ['github_issue_create'] as const
    for (const kind of kinds) {
      assert.equal(requiresApprovalGate(kind), true)
    }
  })
})
