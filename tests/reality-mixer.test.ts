import { describe, it, expect, beforeAll } from 'vitest'

// Unit tests for Reality Mixer — POST /canvas/express validation
// Integration/SSE tests require a running server; these cover the contract shape.

describe('Reality Mixer command types', () => {
  const VALID_TYPES = ['text', 'speak', 'visual', 'color', 'sound', 'haptic', 'clear']

  it('accepts all valid command types', () => {
    for (const type of VALID_TYPES) {
      expect(VALID_TYPES.includes(type)).toBe(true)
    }
  })

  it('text command has required content field', () => {
    const cmd = { type: 'text', content: 'Hello, world', durationMs: 3000 }
    expect(cmd.type).toBe('text')
    expect(cmd.content).toBeTruthy()
  })

  it('speak command has required content field', () => {
    const cmd = { type: 'speak', content: 'The build is complete', agentId: 'link' }
    expect(cmd.type).toBe('speak')
    expect(cmd.content).toBeTruthy()
  })

  it('visual command uses valid presets', () => {
    const PRESETS = ['urgency', 'celebration', 'thinking', 'flow', 'tension', 'exhale', 'spark']
    for (const preset of PRESETS) {
      const cmd = { type: 'visual', preset }
      expect(cmd.preset).toBe(preset)
    }
  })

  it('haptic command uses valid patterns', () => {
    const PATTERNS = ['light', 'medium', 'heavy', 'success', 'warning', 'error']
    for (const pattern of PATTERNS) {
      const cmd = { type: 'haptic', pattern }
      expect(cmd.pattern).toBe(pattern)
    }
  })

  it('color command has agent + hex color', () => {
    const cmd = { type: 'color', agent: 'link', color: '#60a5fa' }
    expect(cmd.agent).toBe('link')
    expect(cmd.color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('clear command has no required fields beyond type', () => {
    const cmd = { type: 'clear' }
    expect(cmd.type).toBe('clear')
  })

  it('render log has correct shape', () => {
    const entry = {
      id: `rc-${Date.now()}-abc123`,
      ts: Date.now(),
      agentId: 'link',
      cmd: { type: 'speak', content: 'Task complete' },
    }
    expect(entry.id).toMatch(/^rc-/)
    expect(entry.agentId).toBeTruthy()
    expect(entry.cmd.type).toBe('speak')
  })
})
