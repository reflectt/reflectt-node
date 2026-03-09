// SPDX-License-Identifier: Apache-2.0
import { extractAgentFromBranch, resolveWebhookAttribution, enrichWebhookPayload, remapGitHubMentions } from '../src/github-webhook-attribution.js'
import { loadAgentRoles } from '../src/assignment.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TEST_ROLES_YAML = `
- name: link
  role: builder
- name: spark
  role: tester
- name: kai
  role: lead
- name: rhythm
  role: ops
`

function setupRoles() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflectt-test-'))
  const rolesFile = path.join(tmpDir, 'TEAM-ROLES.yaml')
  fs.writeFileSync(rolesFile, TEST_ROLES_YAML)
  loadAgentRoles(rolesFile)
  return tmpDir
}

describe('github-webhook-attribution', () => {
  beforeEach(() => {
    setupRoles()
  })

  describe('extractAgentFromBranch', () => {
    it('extracts agent from standard branch name', () => {
      expect(extractAgentFromBranch('link/c8-coverage')).toBe('link')
    })

    it('extracts agent from task branch', () => {
      expect(extractAgentFromBranch('spark/task-123-fix-tests')).toBe('spark')
    })

    it('is case-insensitive', () => {
      expect(extractAgentFromBranch('Link/some-feature')).toBe('link')
    })

    it('returns null for unknown agent prefix', () => {
      expect(extractAgentFromBranch('unknown-user/some-branch')).toBeNull()
    })

    it('returns null for branch without slash', () => {
      expect(extractAgentFromBranch('main')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(extractAgentFromBranch('')).toBeNull()
    })

    it('returns null for null/undefined', () => {
      expect(extractAgentFromBranch(null as any)).toBeNull()
      expect(extractAgentFromBranch(undefined as any)).toBeNull()
    })
  })

  describe('resolveWebhookAttribution', () => {
    it('resolves from pull_request branch name', () => {
      const result = resolveWebhookAttribution({
        sender: { login: 'itskaidev' },
        pull_request: { head: { ref: 'link/c8-coverage' } },
      })
      expect(result.agent).toBe('link')
      expect(result.source).toBe('branch')
      expect(result.remapped).toBe(true)
    })

    it('resolves from push event ref', () => {
      const result = resolveWebhookAttribution({
        sender: { login: 'itskaidev' },
        ref: 'refs/heads/spark/fix-tests',
      })
      expect(result.agent).toBe('spark')
      expect(result.source).toBe('branch')
    })

    it('falls back to kai for shared account without branch info', () => {
      const result = resolveWebhookAttribution({
        sender: { login: 'itskaidev' },
      })
      expect(result.agent).toBe('kai')
      expect(result.source).toBe('fallback')
      expect(result.remapped).toBe(true)
    })

    it('returns none for unknown non-shared sender without branch', () => {
      const result = resolveWebhookAttribution({
        sender: { login: 'random-github-user' },
      })
      expect(result.agent).toBeNull()
      expect(result.source).toBe('none')
    })

    it('returns direct match if sender is a known agent name', () => {
      const result = resolveWebhookAttribution({
        sender: { login: 'rhythm' },
      })
      expect(result.agent).toBe('rhythm')
      expect(result.source).toBe('direct')
      expect(result.remapped).toBe(false)
    })

    it('handles empty payload', () => {
      const result = resolveWebhookAttribution({})
      expect(result.agent).toBeNull()
      expect(result.source).toBe('none')
    })
  })

  describe('enrichWebhookPayload', () => {
    it('adds _reflectt_attribution to payload', () => {
      const payload = {
        action: 'opened',
        sender: { login: 'itskaidev' },
        pull_request: { head: { ref: 'link/task-123' } },
      }
      const enriched = enrichWebhookPayload(payload)
      expect(enriched.action).toBe('opened')
      expect(enriched._reflectt_attribution).toBeDefined()
      const attr = enriched._reflectt_attribution as any
      expect(attr.agent).toBe('link')
      expect(attr.remapped).toBe(true)
      expect(attr.source).toBe('branch')
    })

    it('preserves original payload fields', () => {
      const payload = { action: 'closed', number: 42 }
      const enriched = enrichWebhookPayload(payload)
      expect(enriched.action).toBe('closed')
      expect(enriched.number).toBe(42)
    })
  })

  describe('remapGitHubMentions', () => {
    it('remaps @itskaidev to @kai at start of message', () => {
      const input = '@itskaidev\n✅ **PR merged** #828: [fix: branch guard crash]'
      expect(remapGitHubMentions(input)).toBe('@kai\n✅ **PR merged** #828: [fix: branch guard crash]')
    })

    it('remaps @itskaidev inline in message body', () => {
      const input = '💬 **Comment by @supabase[bot]** on PR #686 — review by @itskaidev requested'
      expect(remapGitHubMentions(input)).toContain('@kai')
      expect(remapGitHubMentions(input)).not.toContain('@itskaidev')
    })

    it('remaps multiple occurrences', () => {
      const input = '@itskaidev opened PR and @itskaidev requested review'
      const result = remapGitHubMentions(input)
      expect(result).toBe('@kai opened PR and @kai requested review')
    })

    it('is case-insensitive for the GitHub username', () => {
      const input = '@ITSKAIDEV merged the PR'
      expect(remapGitHubMentions(input)).toBe('@kai merged the PR')
    })

    it('does not remap non-shared GitHub usernames', () => {
      const input = '@ryancampbell requested a review'
      expect(remapGitHubMentions(input)).toBe('@ryancampbell requested a review')
    })

    it('does not partial-match (e.g. @itskaidev123 is left alone)', () => {
      const input = 'mentioned @itskaidev123 in a comment'
      expect(remapGitHubMentions(input)).toBe('mentioned @itskaidev123 in a comment')
    })

    it('handles empty or non-string input gracefully', () => {
      expect(remapGitHubMentions('')).toBe('')
      expect(remapGitHubMentions(null as any)).toBeNull()
    })
  })
})
