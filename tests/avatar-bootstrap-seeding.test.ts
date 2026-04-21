import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('identity claim bootstrap prompt', () => {
  it('bootstrap task includes identity claim step and done criteria', () => {
    const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf-8')
    // Main must claim on self first
    expect(indexSource).toContain('POST /agents/main/identity/claim')
    expect(indexSource).toContain('Claim your own identity FIRST')
    // Each agent must claim name, displayName, color, avatar, and a Kokoro voice
    expect(indexSource).toContain('has claimed its identity')
    expect(indexSource).toContain('name + displayName + color + avatar + Kokoro voice')
    // Voice list must be enumerated so LLMs don't hallucinate
    expect(indexSource).toContain('af_sarah')
    expect(indexSource).toContain('am_adam')
    expect(indexSource).toContain('bf_emma')
    expect(indexSource).toContain('bm_george')
  })
})
