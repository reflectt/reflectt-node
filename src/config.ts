// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Configuration loader
 */
import 'dotenv/config'
import type { ServerConfig, OpenClawConfig } from './types.js'
import { homedir } from 'os'
import { join } from 'path'

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

/**
 * Data directory configuration
 * Uses REFLECTT_HOME environment variable or defaults to ~/.reflectt
 */
export const REFLECTT_HOME = process.env.REFLECTT_HOME || join(homedir(), '.reflectt')
export const DATA_DIR = join(REFLECTT_HOME, 'data')
export const INBOX_DIR = join(DATA_DIR, 'inbox')

// Legacy data directory (for migration)
import { fileURLToPath } from 'url'
import { dirname } from 'path'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
export const LEGACY_DATA_DIR = join(__dirname, '../data')
