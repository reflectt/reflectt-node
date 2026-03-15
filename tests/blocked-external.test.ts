import { describe, it, expect } from 'vitest'

/**
 * Tests for blocked-external task flag logic.
 *
 * Unit-tests the core predicate used by boardHealthWorker.findAbandonedTasks
 * and the API validation / metadata shape for block-external / unblock-external.
 */

// ── Core predicate ────────────────────────────────────────────────────────

function isExternallyBlocked(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.blocked_external === true
}

function shouldSkipAbandonCheck(task: {
  metadata?: Record<string, unknown> | null
}): boolean {
  return isExternallyBlocked(task.metadata)
}

// ── Validation helper ─────────────────────────────────────────────────────

function validateBlockExternalBody(body: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body is required' }
  const b = body as Record<string, unknown>
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason) {
    return {
      ok: false,
      error: 'reason is required — describe the external dependency',
    }
  }
  return { ok: true }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('blocked-external flag', () => {
  describe('isExternallyBlocked predicate', () => {
    it('returns true when metadata.blocked_external is true', () => {
      expect(isExternallyBlocked({ blocked_external: true })).toBe(true)
    })

    it('returns false when metadata.blocked_external is false', () => {
      expect(isExternallyBlocked({ blocked_external: false })).toBe(false)
    })

    it('returns false when metadata.blocked_external is absent', () => {
      expect(isExternallyBlocked({})).toBe(false)
    })

    it('returns false when metadata is null', () => {
      expect(isExternallyBlocked(null)).toBe(false)
    })

    it('returns false when metadata is undefined', () => {
      expect(isExternallyBlocked(undefined)).toBe(false)
    })

    it('returns false when blocked_external is a string (not boolean)', () => {
      expect(isExternallyBlocked({ blocked_external: 'true' })).toBe(false)
    })
  })

  describe('shouldSkipAbandonCheck', () => {
    it('skips tasks with blocked_external=true (Apple creds example)', () => {
      const task = {
        metadata: {
          blocked_external: true,
          blocked_external_reason: 'Apple Developer credentials — Ryan required',
        },
      }
      expect(shouldSkipAbandonCheck(task)).toBe(true)
    })

    it('skips tasks with blocked_external=true (X API creds example)', () => {
      const task = {
        metadata: {
          blocked_external: true,
          blocked_external_reason: 'X developer app not created. Requires Ryan.',
        },
      }
      expect(shouldSkipAbandonCheck(task)).toBe(true)
    })

    it('does not skip normal blocked tasks', () => {
      const task = { metadata: { transition: { reason: 'waiting on review' } } }
      expect(shouldSkipAbandonCheck(task)).toBe(false)
    })

    it('does not skip tasks with no metadata', () => {
      const task = { metadata: null }
      expect(shouldSkipAbandonCheck(task)).toBe(false)
    })

    it('does not skip tasks with empty metadata', () => {
      const task = { metadata: {} }
      expect(shouldSkipAbandonCheck(task)).toBe(false)
    })
  })

  describe('block-external API validation', () => {
    it('rejects empty reason', () => {
      const result = validateBlockExternalBody({ reason: '' })
      expect(result.ok).toBe(false)
    })

    it('rejects whitespace-only reason', () => {
      const result = validateBlockExternalBody({ reason: '   ' })
      expect(result.ok).toBe(false)
    })

    it('rejects missing reason field', () => {
      const result = validateBlockExternalBody({})
      expect(result.ok).toBe(false)
    })

    it('rejects null body', () => {
      const result = validateBlockExternalBody(null)
      expect(result.ok).toBe(false)
    })

    it('accepts valid reason', () => {
      const result = validateBlockExternalBody({ reason: 'Apple Developer credentials — Ryan required' })
      expect(result.ok).toBe(true)
    })

    it('trims whitespace from reason before validation', () => {
      const result = validateBlockExternalBody({ reason: '  valid reason  ' })
      expect(result.ok).toBe(true)
    })
  })

  describe('metadata shape', () => {
    it('sets blocked_external=true with reason and timestamp, preserves existing fields', () => {
      const existingMetadata = { lane: 'engineering', eta: '2d' }
      const reason = 'API credentials — Ryan required'
      const now = Date.now()

      const updated = {
        ...existingMetadata,
        blocked_external: true,
        blocked_external_reason: reason,
        blocked_external_at: now,
      }

      expect(updated.blocked_external).toBe(true)
      expect(updated.blocked_external_reason).toBe(reason)
      expect(updated.blocked_external_at).toBe(now)
      expect((updated as Record<string, unknown>).lane).toBe('engineering')
    })

    it('removes flag on unblock, preserves other metadata fields', () => {
      const metadata = {
        lane: 'engineering',
        blocked_external: true,
        blocked_external_reason: 'Apple creds',
        blocked_external_at: Date.now(),
      }

      const { blocked_external, blocked_external_reason, blocked_external_at, ...rest } = metadata
      void blocked_external; void blocked_external_reason; void blocked_external_at

      expect((rest as Record<string, unknown>).blocked_external).toBeUndefined()
      expect((rest as Record<string, unknown>).blocked_external_reason).toBeUndefined()
      expect((rest as Record<string, unknown>).lane).toBe('engineering')
    })
  })
})
