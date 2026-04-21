import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

describe('identity claim bootstrap prompt', () => {
  it('bootstrap task includes identity claim step and done criteria', () => {
    const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf-8')
    expect(indexSource).toContain('identity/avatar')
    expect(indexSource).toContain('Each agent has claimed their Reflectt identity')
    expect(indexSource).toContain('unique avatar')
  })
})
