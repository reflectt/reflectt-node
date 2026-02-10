/**
 * OpenClaw Gateway integration
 */
import WebSocket from 'ws'
import { openclawConfig } from './config.js'
import type { AgentMessage } from './types.js'

interface OpenClawRequest {
  type: 'req'
  id: string
  method: string
  params: Record<string, unknown>
}

interface OpenClawResponse {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: string
}

interface OpenClawEvent {
  type: 'event'
  event: string
  payload: unknown
  seq?: number
}

type OpenClawMessage = OpenClawRequest | OpenClawResponse | OpenClawEvent

export class OpenClawClient {
  private ws: WebSocket | null = null
  private connected = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private requestId = 0
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()
  private eventHandlers = new Map<string, Set<(payload: unknown) => void>>()

  constructor() {
    this.connect()
  }

  private connect() {
    console.log(`[OpenClaw] Connecting to ${openclawConfig.gatewayUrl}...`)
    
    this.ws = new WebSocket(openclawConfig.gatewayUrl)

    this.ws.on('open', () => {
      console.log('[OpenClaw] WebSocket connected, performing handshake...')
      this.handshake()
    })

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as OpenClawMessage
        this.handleMessage(msg)
      } catch (err) {
        console.error('[OpenClaw] Failed to parse message:', err)
      }
    })

    this.ws.on('close', () => {
      console.log('[OpenClaw] Connection closed, will reconnect...')
      this.connected = false
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      console.error('[OpenClaw] WebSocket error:', err.message)
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 5000)
  }

  private async handshake() {
    try {
      const response = await this.request('connect', {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'cli',
          displayName: 'Reflectt Node',
          version: '0.1.0',
          platform: 'node',
          mode: 'cli',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: openclawConfig.gatewayToken ? {
          token: openclawConfig.gatewayToken
        } : undefined,
        locale: 'en-US',
        userAgent: 'reflectt-node/0.1.0',
      })
      
      console.log('[OpenClaw] Handshake successful:', response)
      this.connected = true
    } catch (err) {
      console.error('[OpenClaw] Handshake failed:', err)
      this.ws?.close()
    }
  }

  private handleMessage(msg: OpenClawMessage) {
    if (msg.type === 'res') {
      const pending = this.pendingRequests.get(msg.id)
      if (pending) {
        this.pendingRequests.delete(msg.id)
        if (msg.ok) {
          pending.resolve(msg.payload)
        } else {
          const errorMsg = typeof msg.error === 'string' 
            ? msg.error 
            : JSON.stringify(msg.error) || 'Request failed'
          pending.reject(new Error(errorMsg))
        }
      }
    } else if (msg.type === 'event') {
      const handlers = this.eventHandlers.get(msg.event)
      if (handlers) {
        handlers.forEach(handler => handler(msg.payload))
      }
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to OpenClaw gateway'))
        return
      }

      const id = `req-${++this.requestId}`
      const req: OpenClawRequest = {
        type: 'req',
        id,
        method,
        params,
      }

      this.pendingRequests.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(req))

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 30000)
    })
  }

  on(event: string, handler: (payload: unknown) => void) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: string, handler: (payload: unknown) => void) {
    this.eventHandlers.get(event)?.delete(handler)
  }

  async sendMessage(message: AgentMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to OpenClaw')
    }
    
    // Use OpenClaw's send method to broadcast messages
    await this.request('send', {
      message: JSON.stringify(message),
      target: message.to || 'broadcast',
    })
  }

  async runAgent(prompt: string, agentId?: string): Promise<unknown> {
    return this.request('agent', {
      prompt,
      agentId: agentId || 'main',
      stream: false,
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
  }
}

// Singleton instance — lazy init, doesn't crash if OpenClaw unavailable
let _client: OpenClawClient | null = null
export const openclawClient = {
  get instance(): OpenClawClient {
    if (!_client) _client = new OpenClawClient()
    return _client
  },
  close() { _client?.close() },
  isConnected() { return _client?.isConnected() ?? false },
}
