/**
 * Configuration loader
 */
import 'dotenv/config'
import type { ServerConfig, OpenClawConfig } from './types.js'

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '4445', 10),
  host: process.env.HOST || '0.0.0.0',
  corsEnabled: process.env.CORS_ENABLED !== 'false',
}

export const openclawConfig: OpenClawConfig = {
  gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
  agentId: process.env.OPENCLAW_AGENT_ID || 'reflectt-node',
}

export const isDev = process.env.NODE_ENV !== 'production'
