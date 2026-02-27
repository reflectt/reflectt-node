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
import { startCloudIntegration, stopCloudIntegration, isCloudConfigured, watchConfigForCloudChanges, stopConfigWatcher } from './cloud.js'
import { stopConfigWatch } from './assignment.js'
import { getDb, closeDb } from './db.js'
import { startTeamConfigLinter, stopTeamConfigLinter } from './team-config.js'
// OpenClaw connection is optional — server works for chat/tasks without it

/**
 * Build-freshness check: warn if dist/ is older than src/
 * Prevents silently running stale compiled code after source changes.
 */
import { statSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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

async function main() {
  console.log('🚀 Starting reflectt-node...')

  // Build-freshness check (non-blocking)
  checkBuildFreshness()

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
