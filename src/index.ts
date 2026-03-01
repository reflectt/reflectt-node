// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * reflectt-node - Local node server for agent communication via OpenClaw
 * 
 * Entry point
 */
import { createServer } from './server.js'
import { serverConfig, isDev, openclawConfig } from './config.js'
import { acquirePidLock, releasePidLock, getPidPath } from './pidlock.js'
import { startCloudIntegration, stopCloudIntegration, isCloudConfigured, watchConfigForCloudChanges, stopConfigWatcher } from './cloud.js'
import { stopConfigWatch } from './assignment.js'
import { getDb, closeDb } from './db.js'
import { startTeamConfigLinter, stopTeamConfigLinter } from './team-config.js'
// OpenClaw connection is optional — server works for chat/tasks without it

/**
 * Build-freshness check: warn if dist/ is older than src/
 * Prevents silently running stale compiled code after source changes.
 */
import { statSync, readdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { hostname as osHostname } from 'os'
import { randomBytes } from 'crypto'

function checkBuildFreshness(): void {
  try {
    const thisFile = fileURLToPath(import.meta.url)
    const distDir = dirname(thisFile)
    const srcDir = join(distDir, '..', 'src')

    // Find newest src file
    let newestSrc = 0
    try {
      const srcFiles = readdirSync(srcDir).filter(f => f.endsWith('.ts'))
      for (const f of srcFiles) {
        const mtime = statSync(join(srcDir, f)).mtimeMs
        if (mtime > newestSrc) newestSrc = mtime
      }
    } catch { return } // src dir not accessible, skip

    // Find this dist file's mtime
    const distMtime = statSync(thisFile).mtimeMs

    if (newestSrc > distMtime + 1000) { // 1s tolerance
      const ageSec = Math.round((newestSrc - distMtime) / 1000)
      console.warn(`⚠️  Build may be stale: src/ is ${ageSec}s newer than dist/. Run \`npm run build\` to recompile.`)
    }
  } catch {
    // Non-fatal — skip check if anything goes wrong
  }
}

/**
 * Docker identity isolation: detect if mounted volumes contain another team's
 * config and warn/block to prevent identity inheritance.
 */
function checkDockerIdentity(): void {
  const isDocker = existsSync('/.dockerenv') || process.env.REFLECTT_HOME === '/data'
  if (!isDocker) return

  const reflecttHome = process.env.REFLECTT_HOME || '/data'

  // Check for inherited OpenClaw config
  const openclawConfigPath = join(reflecttHome, '.openclaw', 'openclaw.json')
  if (existsSync(openclawConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(openclawConfigPath, 'utf-8'))
      const gatewayToken = raw?.gateway?.auth?.token
      const agentId = raw?.agentId

      // If there's an inherited identity with a gateway token, warn
      if (gatewayToken && agentId) {
        console.warn('')
        console.warn('⚠️  Inherited identity detected in mounted volume!')
        console.warn(`   Agent ID: ${agentId}`)
        console.warn('   This Docker instance may appear as another team\'s agent.')
        console.warn('')
        console.warn('   To use a fresh identity:')
        console.warn('     1. Remove the mounted .openclaw directory, or')
        console.warn('     2. Set OPENCLAW_AGENT_ID=my-docker-agent in docker-compose.yml')
        console.warn('')
      }
    } catch {
      // Config exists but can't be parsed — not a problem
    }
  }

  // Check for inherited cloud credentials
  const cloudConfigPath = join(reflecttHome, 'config.json')
  if (existsSync(cloudConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(cloudConfigPath, 'utf-8'))
      const hostName = raw?.cloud?.hostName
      const hostId = raw?.cloud?.hostId
      const credential = raw?.cloud?.credential

      if (hostId && credential) {
        const explicitName = process.env.REFLECTT_HOST_NAME
        if (!explicitName) {
          console.warn('')
          console.warn('⚠️  Inherited cloud registration detected!')
          console.warn(`   Host: ${hostName || 'unknown'} (${hostId})`)
          console.warn('   This Docker instance will appear as an existing host in the cloud dashboard.')
          console.warn('')
          console.warn('   To register as a new host:')
          console.warn('     1. Set REFLECTT_HOST_NAME=my-docker-host in docker-compose.yml')
          console.warn('     2. Generate a new join token in the cloud dashboard')
          console.warn('     3. Set REFLECTT_HOST_TOKEN=<new-token> in docker-compose.yml')
          console.warn('')
        }
      }
    } catch {
      // Config exists but can't be parsed
    }
  }

  // Generate a fresh agent identity if none is explicitly set
  if (!process.env.OPENCLAW_AGENT_ID) {
    const hn = osHostname()
    const shortId = randomBytes(3).toString('hex')
    const defaultId = `docker-${hn}-${shortId}`
    process.env.OPENCLAW_AGENT_ID = defaultId
    console.log(`🆔 Docker identity: ${defaultId} (set OPENCLAW_AGENT_ID to override)`)
  }
}

/**
 * Docker bootstrap check: detect container environment and print
 * actionable guidance when required configuration is missing.
 */
function checkDockerBootstrap(): void {
  const isDocker = existsSync('/.dockerenv') || process.env.REFLECTT_HOME === '/data'
  if (!isDocker) return

  const hasGatewayUrl = !!process.env.OPENCLAW_GATEWAY_URL
  const hasGatewayToken = !!process.env.OPENCLAW_GATEWAY_TOKEN

  if (!hasGatewayUrl && !hasGatewayToken) {
    console.log('')
    console.log('┌──────────────────────────────────────────────────────────┐')
    console.log('│  📋 Docker Quick Start                                  │')
    console.log('├──────────────────────────────────────────────────────────┤')
    console.log('│                                                          │')
    console.log('│  reflectt-node is running standalone (no OpenClaw).      │')
    console.log('│  The dashboard, tasks, and API work fine without it.     │')
    console.log('│                                                          │')
    console.log('│  To connect to OpenClaw (for agent messaging):           │')
    console.log('│                                                          │')
    console.log('│  1. Set env vars in docker-compose.yml:                  │')
    console.log('│     OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789 │')
    console.log('│     OPENCLAW_GATEWAY_TOKEN=your_token_here               │')
    console.log('│                                                          │')
    console.log('│  2. Restart: docker-compose up -d                        │')
    console.log('│                                                          │')
    console.log('│  Get your token: openclaw gateway token                  │')
    console.log('│  Full guide: https://reflectt.ai/bootstrap               │')
    console.log('└──────────────────────────────────────────────────────────┘')
    console.log('')
  } else if (hasGatewayUrl && !hasGatewayToken) {
    console.warn('')
    console.warn('⚠️  OPENCLAW_GATEWAY_URL is set but OPENCLAW_GATEWAY_TOKEN is missing.')
    console.warn('   Connection will fail without a valid token.')
    console.warn('   Get your token: openclaw gateway token')
    console.warn('   Then add to docker-compose.yml:')
    console.warn('     OPENCLAW_GATEWAY_TOKEN=your_token_here')
    console.warn('')
  }
}

async function main() {
  console.log('🚀 Starting reflectt-node...')

  // Build-freshness check (non-blocking)
  checkBuildFreshness()

  // Docker identity isolation (must run before bootstrap)
  checkDockerIdentity()

  // Docker bootstrap guidance (non-blocking)
  checkDockerBootstrap()

  // Dev-mode port guard: prevent dev servers from hijacking production port
  const PRODUCTION_PORT = 4445
  if (isDev && serverConfig.port === PRODUCTION_PORT) {
    console.error(`\n🚫 BLOCKED: Cannot run dev server on port ${PRODUCTION_PORT} — that's the production port.`)
    console.error(`   Use a different port: PORT=${PRODUCTION_PORT + 1} npm run dev`)
    console.error(`   Or set NODE_ENV=production if this IS the production server.\n`)
    process.exit(1)
  }
  
  // Acquire PID lock — kills any previous instance and resolves port conflicts
  // Use port-specific lockfile to avoid cross-port conflicts
  const pidPath = getPidPath(serverConfig.port)
  const lockResult = acquirePidLock(serverConfig.port, pidPath)
  if (lockResult.killedPrevious) {
    console.log(`   Replaced previous instance (pid ${lockResult.previousPid})`)
  }
  if (lockResult.portConflictPids.length > 0) {
    console.log(`   Resolved ${lockResult.portConflictPids.length} port conflict(s)`)
  }

  try {
    // Initialize SQLite database (WAL mode, auto-migration from JSONL)
    const db = getDb()
    console.log(`📦 SQLite database initialized (WAL mode)`)

    // Initialize vector search (sqlite-vec) — optional, degrades gracefully
    try {
      const { initVectorSearch } = await import('./db.js')
      initVectorSearch()
    } catch {
      console.warn('⚠️  Vector search not available (sqlite-vec not installed)')
    }

    // Team config linter (TEAM.md + TEAM-ROLES.yaml + TEAM-STANDARDS.md)
    startTeamConfigLinter()

    const app = await createServer()

    
    await app.listen({
      port: serverConfig.port,
      host: serverConfig.host,
    })

    const baseUrl = `http://${serverConfig.host}:${serverConfig.port}`
    console.log(`✅ Server running at ${baseUrl}`)
    console.log(`   - Dashboard: ${baseUrl}/dashboard`)
    console.log(`   - REST API: ${baseUrl}`)
    console.log(`   - WebSocket: ws://${serverConfig.host}:${serverConfig.port}/chat/ws`)
    console.log(`   - Health: ${baseUrl}/health`)
    console.log(`   - PID: ${process.pid}`)

    // OpenClaw gateway status
    if (openclawConfig.gatewayToken) {
      console.log(`🔗 OpenClaw gateway: configured (${openclawConfig.gatewayUrl})`)
    } else {
      console.log('⚠️  OpenClaw gateway: not configured')
      console.log('   To connect agents, set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN')
      console.log('   Get your token: openclaw gateway token')
      console.log('   Guide: https://reflectt.ai/bootstrap')
    }

    // Cloud integration (checks env vars + config.json for credentials)
    if (isCloudConfigured()) {
      // Non-blocking: don't prevent server from starting if cloud is down
      startCloudIntegration().catch(err => {
        console.warn(`☁️  Cloud integration error: ${err?.message || err}`)
      })
    } else {
      console.log('☁️  Cloud integration: disabled (run `reflectt host connect` to enable)')
      // Watch config.json so we auto-connect when agent enrolls
      watchConfigForCloudChanges()
    }
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down...`)
      stopConfigWatch()
      stopConfigWatcher()
      stopCloudIntegration()
      stopTeamConfigLinter()
      closeDb()
      releasePidLock(pidPath)
      await app.close()
      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
    
  } catch (err) {
    releasePidLock(pidPath)
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

main()
