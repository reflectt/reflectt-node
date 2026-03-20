/**
 * canvas-capabilities.ts — Agent capability registration plugin
 * GET /canvas/capability — returns all registered agent capabilities
 * POST /canvas/capability — agents register/update their capabilities
 * SSE capability_setup — browsers receive updates via render stream
 */

import type { AgentCapability, CapabilitySetupCommand } from './canvas-interactive'

export type CapabilityState = 'active' | 'warning' | 'offline'

export interface AgentCapabilities {
  agentName: string
  capabilities: AgentCapability[]
  updatedAt: number
}

const agentCapabilities = new Map<string, AgentCapabilities>()

export function getAgentCapabilities(): Record<string, AgentCapabilities> {
  const r: Record<string, AgentCapabilities> = {}
  for (const [id, data] of agentCapabilities) r[id] = data
  return r
}

export function setupCanvasCapabilities(
  app: any,
  eventBus: any,
  renderStreamSubscribers?: Map<string, any>,
): void {
  app.get('/canvas/capability', (_req: any, res: any) => {
    return res.json(getAgentCapabilities())
  })

  app.post('/canvas/capability', async (req: any, res: any) => {
    try {
      const body = req.body as { agentId?: string; agentName?: string; capabilities?: AgentCapability[] }
      const agentId: string = typeof body?.agentId === 'string' ? body.agentId : 'unknown'
      const agentName: string = typeof body?.agentName === 'string' ? body.agentName : agentId
      const capabilities: AgentCapability[] = Array.isArray(body?.capabilities) ? body.capabilities : []
      if (!capabilities.length) return res.status(400).json({ error: 'capabilities required' })

      agentCapabilities.set(agentId, { agentName, capabilities, updatedAt: Date.now() })

      const cmd: CapabilitySetupCommand = {
        type: 'capability_setup', agentId, agentName, capabilities, timestamp: Date.now(),
      }
      const data = JSON.stringify(cmd)
      if (renderStreamSubscribers) {
        for (const [, client] of renderStreamSubscribers) {
          try { client.send(`event: capability_setup\r\ndata: ${data}\r\n\r\n`) } catch {}
        }
      }

      return res.json({ ok: true, agentId, count: capabilities.length })
    } catch (err: any) {
      console.error('[canvas/capability]', err?.message)
      return res.status(500).json({ error: 'Internal error' })
    }
  })
}
