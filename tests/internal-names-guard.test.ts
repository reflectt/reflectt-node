/**
 * Tests for internal-names-guard config correctness.
 * Ensures:
 * - Public reflectt.ai URLs are still caught in shipped files by default
 * - Those URLs are allowed only where explicitly intended (dashboard.ts + README)
 * - Agent names are still caught in shipped surfaces
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

interface BannedRule {
  pattern: string
  flags?: string
  reason?: string
}
interface AllowRule {
  pathPattern: string
  pathFlags?: string
  pattern: string
  flags?: string
  reason?: string
}
interface GuardConfig {
  banned: BannedRule[]
  allow: AllowRule[]
}

const CONFIG_PATH = path.resolve('tools/internal-names-guard.config.json')
const cfg: GuardConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))

function isBanned(filePath: string, lineText: string): boolean {
  for (const b of cfg.banned) {
    const re = new RegExp(b.pattern, b.flags || 'g')
    re.lastIndex = 0
    if (!re.test(lineText)) continue
    // Check if allowed
    const allowed = (cfg.allow || []).some(rule => {
      const pathRe = new RegExp(rule.pathPattern, rule.pathFlags || '')
      const patRe = new RegExp(rule.pattern, rule.flags || 'g')
      return pathRe.test(filePath) && patRe.test(lineText)
    })
    if (!allowed) return true
  }
  return false
}

describe('internal-names-guard config', () => {
  it('catches app.reflectt.ai in non-allowed shipped files', () => {
    expect(isBanned('src/routes.ts', 'const url = "https://app.reflectt.ai/api"')).toBe(true)
  })

  it('catches reflectt.ai in non-dashboard shipped files', () => {
    expect(isBanned('src/server.ts', 'redirect to https://reflectt.ai')).toBe(true)
    expect(isBanned('public/index.html', 'Visit app.reflectt.ai')).toBe(true)
  })

  it('allows reflectt.ai and app.reflectt.ai in src/dashboard.ts', () => {
    expect(isBanned('src/dashboard.ts', 'href="https://app.reflectt.ai/" class="banner-pill"')).toBe(false)
    expect(isBanned('src/dashboard.ts', 'Sign up at app.reflectt.ai')).toBe(false)
  })

  it('allows docs.reflectt.ai in src/dashboard.ts', () => {
    expect(isBanned('src/dashboard.ts', 'href="https://docs.reflectt.ai/first-time-user-journey"')).toBe(false)
  })

  it('allows reflectt.ai in README.md', () => {
    expect(isBanned('README.md', 'Visit https://reflectt.ai for more info')).toBe(false)
  })

  it('still catches agent names in src/dashboard.ts', () => {
    // Agent proper nouns should NOT be allowed in dashboard even though domain URLs are
    expect(isBanned('src/dashboard.ts', 'Built by Ryan and the team')).toBe(true)
    expect(isBanned('src/dashboard.ts', 'Agent Sage reporting')).toBe(true)
  })

  it('catches agent names in other shipped files', () => {
    expect(isBanned('src/routes.ts', 'Created by Kai')).toBe(true)
    expect(isBanned('public/about.html', 'Meet Pixel, our designer')).toBe(true)
  })
})
