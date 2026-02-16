// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * reflectt-node - Local node server for agent communication via OpenClaw
 * 
 * Entry point
 */
import { createServer } from './server.js'
import { serverConfig, isDev } from './config.js'
import { acquirePidLock, releasePidLock, getPidPath } from './pidlock.js'
import { startCloudIntegration, stopCloudIntegration, isCloudConfigured } from './cloud.js'
import { getDb, closeDb } from './db.js'
// OpenClaw connection is optional — server works for chat/tasks without it

async function main() {
  console.log('🚀 Starting reflectt-node...')

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

    const app = await createServer()
    
    await app.listen({
      port: serverConfig.port,
      host: serverConfig.host,
    })

    console.log(`✅ Server running at http://${serverConfig.host}:${serverConfig.port}`)
    console.log(`   - REST API: http://${serverConfig.host}:${serverConfig.port}`)
    console.log(`   - WebSocket: ws://${serverConfig.host}:${serverConfig.port}/chat/ws`)
    console.log(`   - Health: http://${serverConfig.host}:${serverConfig.port}/health`)
    console.log(`   - PID: ${process.pid}`)

    // Cloud integration (optional — requires REFLECTT_HOST_TOKEN)
    if (isCloudConfigured()) {
      // Non-blocking: don't prevent server from starting if cloud is down
      startCloudIntegration().catch(err => {
        console.warn(`☁️  Cloud integration error: ${err?.message || err}`)
      })
    } else {
      console.log('☁️  Cloud integration: disabled (set REFLECTT_HOST_TOKEN to enable)')
    }
    
    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down...`)
      stopCloudIntegration()
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
