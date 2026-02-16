// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * reflectt-node - Local node server for agent communication via OpenClaw
 * 
 * Entry point
 */
import { createServer } from './server.js'
import { serverConfig } from './config.js'
import { acquirePidLock, releasePidLock } from './pidlock.js'
import { startCloudIntegration, stopCloudIntegration, isCloudConfigured } from './cloud.js'
import { getDb, closeDb } from './db.js'
// OpenClaw connection is optional — server works for chat/tasks without it

async function main() {
  console.log('🚀 Starting reflectt-node...')
  
  // Acquire PID lock — kills any previous instance and resolves port conflicts
  const lockResult = acquirePidLock(serverConfig.port)
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
      releasePidLock()
      await app.close()
      process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
    
  } catch (err) {
    releasePidLock()
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

main()
