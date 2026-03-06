// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * reflectt-node - Local node server for agent communication via OpenClaw
 * 
 * Entry point
 */
import { createServer } from './server.js'
import { serverConfig, isDev, openclawConfig, DATA_DIR, REFLECTT_HOME } from './config.js'
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
import { statSync, readdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { hostname as osHostname, homedir } from 'os'
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

  // Branch guard: refuse to run non-main branch against production DB
  // unless REFLECTT_ALLOW_BRANCH_DB=1 is set
  try {
    const { getBuildInfo } = await import('./buildInfo.js')
    const build = getBuildInfo()
    const branch = build.gitBranch || ''
    const isMainBranch = branch === 'main' || branch === 'master' || branch === ''
    const isProdDb = DATA_DIR === join(homedir(), '.reflectt', 'data')
    const allowOverride = process.env.REFLECTT_ALLOW_BRANCH_DB === '1'

    if (!isMainBranch && isProdDb && !allowOverride) {
      console.error('')
      console.error(`🚫 [BRANCH GUARD] Refusing to start: branch "${branch}" is using production DB path`)
      console.error(`   DB path: ${DATA_DIR}`)
      console.error(`   Only "main" branch should run against the production database.`)
      console.error(`   To override: set REFLECTT_ALLOW_BRANCH_DB=1`)
      console.error('')
      process.exit(1)
    } else if (!isMainBranch && isProdDb && allowOverride) {
      console.warn(`⚠️  [BRANCH GUARD] Running branch "${branch}" against production DB (override active)`)
    }
  } catch {
    // Non-fatal — skip if build-info not available
  }

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

    // ── Startup task count guard ──────────────────────────────────────
    // Detect unexpected task count drops that indicate DB wipe/corruption.
    try {
      const db = getDb()
      const currentCount = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number })?.count ?? 0
      const lastKnown = db.prepare("SELECT value FROM kv WHERE key = 'startup_task_count'").get() as { value: string } | undefined
      const lastCount = lastKnown ? parseInt(lastKnown.value, 10) : 0

      // Save current count for next startup
      db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('startup_task_count', ?)").run(String(currentCount))

      if (lastCount > 0 && currentCount < lastCount * 0.5) {
        const dropPct = Math.round((1 - currentCount / lastCount) * 100)
        console.error(`🚨 [STARTUP GUARD] Task count dropped ${dropPct}%: ${lastCount} → ${currentCount}. Possible DB wipe/corruption!`)
        console.error(`   Data dir: ${DATA_DIR}`)
        console.error(`   DB path: ${join(DATA_DIR, 'reflectt.db')}`)
        // Post to chat if possible (best-effort)
        try {
          const { chatManager } = await import('./chat.js')
          await chatManager.sendMessage({
            from: 'system',
            content: `🚨 **STARTUP GUARD ALERT**: Task count dropped ${dropPct}% (${lastCount} → ${currentCount}). Possible DB wipe or corruption. Data dir: \`${DATA_DIR}\``,
            channel: 'ops',
          })
        } catch { /* non-critical */ }
      } else if (currentCount > 0) {
        console.log(`📊 Startup guard: ${currentCount} tasks (previous: ${lastCount || 'first run'})`)
      }
    } catch (err) {
      console.warn('[STARTUP GUARD] Could not run task count check:', err)
    }

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
    
    // First-boot seeding: if no agents and no tasks, create starter team + welcome task
    try {
      const { taskManager } = await import('./tasks.js')
      const { createStarterTeam } = await import('./starter-team.js')

      // Seed TEAM.md if missing (every new node needs one)
      const teamMdPath = join(REFLECTT_HOME, 'TEAM.md')
      if (!existsSync(teamMdPath)) {
        const teamName = process.env.TEAM_NAME || 'My Team'
        const teamIntent = process.env.TEAM_INTENT || ''
        const teamMdContent = [
          `# ${teamName}`,
          '',
          teamIntent ? `> ${teamIntent}` : '> A team of AI agents working together.',
          '',
          '## How We Work',
          '',
          '- **Reflect → Tasks → Improve** — every insight becomes an actionable task',
          '- **Quality over quantity** — ship fewer things that actually work',
          '- **Read before writing** — understand what exists before changing it',
          '- **Small changes, shipped often** — easier to review, revert, and understand',
          '',
          '## Communication',
          '',
          '- Status updates → task comments first',
          '- Ship announcements → #shipping',
          '- Blockers → #blockers with assignee + task ID',
          '- #general is for decisions and coordination',
        ].join('\n')
        writeFileSync(teamMdPath, teamMdContent, 'utf-8')
        console.log(`🌱 Seeded TEAM.md at ${teamMdPath}`)
      }

      const allTasks = taskManager.listTasks({})
      const agentsDir = join(DATA_DIR, 'agents')
      const hasAgents = existsSync(agentsDir) && readdirSync(agentsDir).filter(f => !f.startsWith('.')).length > 0
      if (allTasks.length === 0 && !hasAgents) {
        const teamIntent = process.env.TEAM_INTENT || ''

        if (teamIntent) {
          // ── Intent-driven bootstrap: save intent + create bootstrap task ──
          console.log('🌱 First boot detected with TEAM_INTENT — creating bootstrap task…')

          // Save intent to a file the main agent can read
          const intentPath = join(DATA_DIR, 'TEAM_INTENT.md')
          const { writeFileSync, mkdirSync } = await import('node:fs')
          mkdirSync(DATA_DIR, { recursive: true })
          writeFileSync(intentPath, [
            '# Team Intent',
            '',
            '> This was provided by the user during onboarding.',
            '',
            teamIntent,
            '',
            '---',
            '',
            'Use `POST /bootstrap/team` to get the TEAM-ROLES.yaml schema,',
            'then `PUT /config/team-roles` to save your team configuration.',
          ].join('\n'), 'utf-8')
          console.log(`   Saved team intent to ${intentPath}`)

          // Create a single "main" agent so the gateway has someone to talk to
          const result = await createStarterTeam({
            agents: [{
              name: 'main',
              role: 'team-lead',
              description: 'Bootstrap agent — reads TEAM_INTENT and creates the rest of the team.',
              soulMd: [
                '# Main Agent',
                '',
                'You are the first agent on a new team. Your job:',
                '',
                '1. Read TEAM_INTENT.md (in your data directory) — this is what the user wants',
                '2. Call `GET /bootstrap/team` to get the team schema and examples',
                '3. Design a team that fulfills the user\'s intent',
                '4. Save it via `PUT /config/team-roles` with the YAML config',
                '5. Post an intro message to #general explaining the team you built',
                '6. Create initial tasks for each agent',
                '',
                '## The User Said:',
                '',
                teamIntent,
                '',
                '## Rules',
                '- Build the right team for their needs, not a generic template',
                '- Give agents specific names and personalities, not "agent-1"',
                '- Start small (2-4 agents) — they can add more later',
                '- Post to #general when done so the user sees activity immediately',
              ].join('\n'),
            }],
          })
          console.log(`   Created bootstrap agent: ${result.created.join(', ') || 'main (already exists)'}`)

          // Create the bootstrap task
          taskManager.createTask({
            status: 'todo',
            createdBy: 'system',
            title: 'Bootstrap your team from the user\'s intent',
            description: [
              '## Your First Task',
              '',
              'The user described what they need:',
              '',
              `> ${teamIntent}`,
              '',
              '### Steps:',
              '1. Read `TEAM_INTENT.md` for the full intent',
              '2. Call `GET /bootstrap/team` for the TEAM-ROLES.yaml schema',
              '3. Design agents that match what the user needs',
              '4. Save the team config via `PUT /config/team-roles`',
              '5. Post an intro to #general: "Hi! I\'m [name], your team lead. Here\'s the team I\'ve set up..."',
              '6. Create starter tasks for each agent',
              '',
              'The user should see a working team with named agents when they check the dashboard.',
            ].join('\n'),
            priority: 'P0',
            assignee: 'main',
            done_criteria: [
              'TEAM-ROLES.yaml saved with agents matching user intent',
              'Intro message posted to #general',
              'At least one task created per agent',
            ],
            metadata: { source: 'first-boot-intent', reflection_exempt: true, reflection_exempt_reason: 'Auto-created bootstrap task' },
          })
          console.log('   Created bootstrap task for main agent')
        } else {
          // ── Default bootstrap: no intent, create starter team ──
          console.log('🌱 First boot detected — seeding starter team…')
          const result = await createStarterTeam()
          console.log(`   Created agents: ${result.created.join(', ') || 'none (already exist)'}`)

          // Create a welcome task so the dashboard isn't empty
          taskManager.createTask({
            status: 'todo',
            createdBy: 'system',
            title: 'Welcome to reflectt-node — explore the dashboard and connect your agents',
            description: [
              '## Getting Started',
              '',
              'Your reflectt-node is running! Here\'s what to do next:',
              '',
              '1. **Connect OpenClaw agents** — set `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`',
              '2. **Explore the dashboard** — visit `/dashboard` to see tasks, agents, and chat',
              '3. **Try the API** — `GET /capabilities` lists every endpoint',
              '4. **Connect to the cloud** — `reflectt host connect --join-token <token>`',
              '',
              'When done, move this task to `done`. Your first task cycle is complete!',
            ].join('\n'),
            priority: 'P2',
            assignee: 'builder',
            reviewer: 'ops',
            done_criteria: [
              'Dashboard loads and shows this task',
              'At least one agent connected via OpenClaw',
            ],
            metadata: { source: 'first-boot', reflection_exempt: true, reflection_exempt_reason: 'Auto-created welcome task' },
          })
          console.log('   Created welcome task')
        }
      }
    } catch (err) {
      // Non-blocking — don't prevent server from starting
      console.warn(`⚠️  First-boot seeding: ${(err as Error)?.message || err}`)
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
