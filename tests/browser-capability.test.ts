import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  configureBrowser,
  getBrowserConfig,
  listSessions,
  getSession,
  closeSession,
  closeAllSessions,
} from '../src/capabilities/browser.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('browser capability', () => {
  describe('session management', () => {
    beforeEach(() => {
      configureBrowser({
        maxConcurrentSessions: 3,
        maxSessionsPerHour: 10,
        idleTimeoutMs: 60_000,
        headless: true,
        viewport: { width: 1280, height: 720 },
      })
    })

    afterEach(async () => {
      await closeAllSessions()
    })

    it('getBrowserConfig returns current config', () => {
      const config = getBrowserConfig()
      expect(config.maxConcurrentSessions).toBe(3)
      expect(config.maxSessionsPerHour).toBe(10)
      expect(config.headless).toBe(true)
    })

    it('configureBrowser merges overrides', () => {
      configureBrowser({ maxConcurrentSessions: 5 })
      const config = getBrowserConfig()
      expect(config.maxConcurrentSessions).toBe(5)
      expect(config.maxSessionsPerHour).toBe(10) // unchanged
    })

    it('listSessions returns empty array initially', () => {
      const sessions = listSessions()
      expect(sessions).toEqual([])
    })

    it('getSession returns undefined for non-existent session', () => {
      const session = getSession('non-existent')
      expect(session).toBeUndefined()
    })

    it('closeSession is no-op for non-existent session', async () => {
      await closeSession('non-existent') // should not throw
    })

    it('closeAllSessions is no-op when no sessions', async () => {
      await closeAllSessions() // should not throw
    })
  })

  describe('route-docs contract', () => {
    it('browser routes are documented', () => {
      const docs = readFileSync(join(__dirname, '..', 'public', 'docs.md'), 'utf-8')

      const requiredRoutes = [
        'GET | `/browser/config`',
        'POST | `/browser/sessions`',
        'GET | `/browser/sessions`',
        'GET | `/browser/sessions/:id`',
        'DELETE | `/browser/sessions/:id`',
        'POST | `/browser/sessions/:id/act`',
        'POST | `/browser/sessions/:id/extract`',
        'POST | `/browser/sessions/:id/observe`',
        'POST | `/browser/sessions/:id/navigate`',
        'GET | `/browser/sessions/:id/screenshot`',
      ]

      for (const route of requiredRoutes) {
        expect(docs).toContain(route)
      }
    })
  })
})
