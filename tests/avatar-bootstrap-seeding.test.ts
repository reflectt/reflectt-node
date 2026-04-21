import { describe, it, expect } from 'vitest'

describe('identity claim bootstrap', () => {
  it('bootstrap task includes identity claim step', async () => {
    // Verify the bootstrap prompt includes identity claiming instructions
    const indexSource = await import('fs').then(fs =>
      fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf-8')
    )
    expect(indexSource).toContain('claim_identity')
    expect(indexSource).toContain('Each agent has claimed their Reflectt identity')
  })

  it('claim_identity MCP tool is registered', async () => {
    const mcpSource = await import('fs').then(fs =>
      fs.readFileSync(new URL('../src/mcp.ts', import.meta.url), 'utf-8')
    )
    expect(mcpSource).toContain('toolHandlers.set("claim_identity"')
    expect(mcpSource).toContain('avatar_type')
    expect(mcpSource).toContain('avatar_content')
    expect(mcpSource).toContain('agent-claimed')
  })
})
