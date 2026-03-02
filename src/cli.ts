#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
/**
 * reflectt CLI - Command line interface for reflectt-node
 */
import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { collectDoctorReport, formatDoctorHuman } from './doctor.js'
import { homedir, hostname } from 'os'
import { join, dirname } from 'path'
import { spawn, execSync } from 'child_process'
import { fileURLToPath } from 'url'

const REFLECTT_HOME = process.env.REFLECTT_HOME || join(homedir(), '.reflectt')
const CONFIG_PATH = join(REFLECTT_HOME, 'config.json')
const DATA_DIR = join(REFLECTT_HOME, 'data')
const PID_FILE = join(REFLECTT_HOME, 'server.pid')

interface CloudEnrollmentConfig {
  cloudUrl: string
  hostName: string
  hostType: string
  hostId: string
  credential: string
  connectedAt: number
}

interface Config {
  port: number
  host: string
  cloud?: CloudEnrollmentConfig
}

function loadConfig(): Config {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    } catch (err) {
      console.error('⚠️  Failed to parse config.json, using defaults')
    }
  }
  return { port: 4445, host: '127.0.0.1' }
}

function saveConfig(config: Config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

function ensureReflecttHome() {
  mkdirSync(REFLECTT_HOME, { recursive: true })
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(join(DATA_DIR, 'inbox'), { recursive: true })
}

function isServerRunning(): boolean {
  if (!existsSync(PID_FILE)) return false
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf-8').trim())
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function getRuntimePaths() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const projectRoot = join(__dirname, '..')

  // Detect whether running from source (dev) or dist (npm install)
  const srcPath = join(projectRoot, 'src', 'index.ts')
  const distPath = join(projectRoot, 'dist', 'index.js')
  const isSource = existsSync(srcPath)
  const serverPath = isSource ? srcPath : distPath
  const useNode = !isSource // npm install: use node directly; dev: use tsx

  return { projectRoot, serverPath, useNode }
}

function buildServerEnv(config: Config): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REFLECTT_HOME,
    PORT: String(config.port),
    HOST: config.host,
  }

  if (config.cloud) {
    env.REFLECTT_CLOUD_URL = config.cloud.cloudUrl
    env.REFLECTT_HOST_NAME = config.cloud.hostName
    env.REFLECTT_HOST_TYPE = config.cloud.hostType
    env.REFLECTT_HOST_ID = config.cloud.hostId
    env.REFLECTT_HOST_CREDENTIAL = config.cloud.credential
    env.REFLECTT_HOST_TOKEN = config.cloud.credential
  }

  return env
}

function startServerDetached(config: Config): number {
  const { projectRoot, serverPath, useNode } = getRuntimePaths()

  if (!existsSync(serverPath)) {
    throw new Error(`Server file not found: ${serverPath}`)
  }

  const cmd = useNode ? 'node' : 'npx'
  const args = useNode ? [serverPath] : ['tsx', serverPath]

  const child = spawn(cmd, args, {
    env: buildServerEnv(config),
    detached: true,
    stdio: 'ignore',
    cwd: projectRoot,
  })

  child.unref()
  writeFileSync(PID_FILE, String(child.pid))
  return child.pid ?? -1
}

function stopServerIfRunning() {
  if (!existsSync(PID_FILE)) return

  const pidRaw = readFileSync(PID_FILE, 'utf-8').trim()
  const pid = Number(pidRaw)
  if (!Number.isFinite(pid)) {
    unlinkSync(PID_FILE)
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // process already gone
  }

  try {
    unlinkSync(PID_FILE)
  } catch {
    // ignore cleanup errors
  }
}

async function tryApiRequest(path: string, options: RequestInit = {}): Promise<any | null> {
  const config = loadConfig()
  const url = `http://${config.host}:${config.port}${path}`

  try {
    const response = await fetch(url, options)
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

interface CloudRegisterResult {
  hostId: string
  credential: string
}

interface CloudApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

async function enrollHostWithApiKey(input: {
  cloudUrl: string
  apiKey: string
  hostName: string
  hostType: string
}): Promise<CloudRegisterResult> {
  const url = `${input.cloudUrl.replace(/\/+$/, '')}/api/hosts/enroll`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      name: input.hostName,
      capabilities: [input.hostType],
    }),
  })

  const payload: any = await response.json().catch(() => ({}))
  const hostId = payload?.host?.id
  const credential = payload?.credential?.token

  if (response.ok && hostId && credential) {
    return { hostId: String(hostId), credential: String(credential) }
  }

  throw new Error(`API key enrollment failed: ${payload?.error || `${response.status} ${response.statusText}`}`)
}

async function registerHostWithCloud(input: {
  cloudUrl: string
  joinToken: string
  hostName: string
  hostType: string
  authToken?: string
}): Promise<CloudRegisterResult> {
  const cloudBase = input.cloudUrl.replace(/\/+$/, '')

  // New cloud API path (reflectt-cloud): /api/hosts/claim
  // Legacy path (older API): /v1/hosts/register
  const attempts = [
    {
      name: 'claim-join-token',
      url: `${cloudBase}/api/hosts/claim`,
      bearer: input.joinToken,
      body: {
        joinToken: input.joinToken,
        name: input.hostName,
        hostName: input.hostName,
        hostType: input.hostType,
      },
    },
    ...(input.authToken
      ? [{
          name: 'claim-user-jwt',
          url: `${cloudBase}/api/hosts/claim`,
          bearer: input.authToken,
          body: {
            joinToken: input.joinToken,
            name: input.hostName,
            hostName: input.hostName,
            hostType: input.hostType,
          },
        }]
      : []),
    {
      name: 'legacy-register',
      url: `${cloudBase}/v1/hosts/register`,
      bearer: input.joinToken,
      body: {
        joinToken: input.joinToken,
        hostName: input.hostName,
        hostType: input.hostType,
      },
    },
  ]

  const errors: string[] = []

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${attempt.bearer}`,
        },
        body: JSON.stringify(attempt.body),
      })

      const payload: any = await response.json().catch(() => ({}))

      // Current cloud response shape
      const hostId = payload?.host?.id || payload?.data?.hostId
      const credential = payload?.credential?.token || payload?.data?.credential

      if (response.ok && hostId && credential) {
        return {
          hostId: String(hostId),
          credential: String(credential),
        }
      }

      const detail = payload?.error || payload?.message || `${response.status} ${response.statusText}`
      errors.push(`${attempt.name}: ${detail}`)
    } catch (err: any) {
      errors.push(`${attempt.name}: ${err?.message || 'request failed'}`)
    }
  }

  throw new Error(`Cloud registration failed (${errors.join(' | ')})`)
}

async function waitForCloudHeartbeat(timeoutMs = 45_000): Promise<{ hostId: string; heartbeatCount: number } | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await tryApiRequest('/cloud/status')
    if (status?.registered && typeof status.hostId === 'string' && (status.heartbeatCount || 0) > 0) {
      return { hostId: status.hostId, heartbeatCount: status.heartbeatCount }
    }
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  return null
}

async function apiRequest(path: string, options: RequestInit = {}): Promise<any> {
  const config = loadConfig()
  const url = `http://${config.host}:${config.port}${path}`

  try {
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return await response.json()
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
      console.error('❌ Server is not running. Start it with: reflectt start')
    } else {
      console.error('❌ Request failed:', err.message)
    }
    process.exit(1)
  }
}

async function cloudRequest(url: string, token: string, method: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const json = await response.json().catch(() => ({}))
  return { status: response.status, json }
}

function printStep(name: string, pass: boolean, detail: string) {
  const icon = pass ? '✅' : '❌'
  console.log(`${icon} ${name} — ${detail}`)
}

const program = new Command()

program
  .name('reflectt')
  .description('CLI for reflectt-node - local agent communication server')
  .version('0.1.0')

// ============ INIT COMMAND ============
program
  .command('init')
  .description('Initialize reflectt team ops directory (~/.reflectt/)')
  .option('--no-git', 'Skip git init and initial commit')
  .option('--force', 'Overwrite existing team files with defaults')
  .action((opts) => {
    const isNew = !existsSync(REFLECTT_HOME)
    let filesCreated = 0
    let filesSkipped = 0

    // Create directories
    mkdirSync(REFLECTT_HOME, { recursive: true })
    mkdirSync(DATA_DIR, { recursive: true })
    mkdirSync(join(DATA_DIR, 'inbox'), { recursive: true })

    // Create default config if missing
    if (!existsSync(CONFIG_PATH)) {
      const config: Config = { port: 4445, host: '127.0.0.1' }
      saveConfig(config)
      filesCreated++
      console.log('  ✅ config.json')
    } else {
      filesSkipped++
      console.log('  ⏭️  config.json (exists)')
    }

    // Copy default team files from defaults/ directory
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const defaultsDir = join(__dirname, '..', 'defaults')

    const teamFiles = [
      { src: 'TEAM.md', desc: 'Team culture and principles' },
      { src: 'TEAM-ROLES.yaml', desc: 'Agent role registry' },
      { src: 'TEAM-STANDARDS.md', desc: 'Operational standards' },
      { src: '.gitignore', desc: 'Git exclusions for runtime data' },
    ]

    for (const file of teamFiles) {
      const destPath = join(REFLECTT_HOME, file.src)
      const srcPath = join(defaultsDir, file.src)

      if (existsSync(destPath) && !opts.force) {
        filesSkipped++
        console.log(`  ⏭️  ${file.src} (exists)`)
      } else if (existsSync(srcPath)) {
        const content = readFileSync(srcPath, 'utf-8')
        writeFileSync(destPath, content)
        filesCreated++
        console.log(`  ✅ ${file.src} — ${file.desc}`)
      } else {
        console.log(`  ⚠️  ${file.src} — default template not found`)
      }
    }

    // Copy starter templates into ~/.reflectt/templates
    const templatesSrcDir = join(__dirname, '..', 'templates')
    const templatesDestDir = join(REFLECTT_HOME, 'templates')
    mkdirSync(templatesDestDir, { recursive: true })

    const templates = [
      { src: 'task-template.md', desc: 'Task template' },
      { src: 'review-packet.md', desc: 'Review packet template' },
      { src: 'incident-template.md', desc: 'Incident template' },
    ]

    for (const file of templates) {
      const destPath = join(templatesDestDir, file.src)
      const srcPath = join(templatesSrcDir, file.src)

      if (existsSync(destPath) && !opts.force) {
        filesSkipped++
        console.log(`  ⏭️  templates/${file.src} (exists)`)
      } else if (existsSync(srcPath)) {
        const content = readFileSync(srcPath, 'utf-8')
        writeFileSync(destPath, content)
        filesCreated++
        console.log(`  ✅ templates/${file.src} — ${file.desc}`)
      } else {
        console.log(`  ⚠️  templates/${file.src} — template not found in package`)
      }
    }

    // Git init
    if (opts.git !== false) {
      const gitDir = join(REFLECTT_HOME, '.git')
      if (!existsSync(gitDir)) {
        try {
          execSync('git init', { cwd: REFLECTT_HOME, stdio: 'pipe' })
          execSync('git add -A', { cwd: REFLECTT_HOME, stdio: 'pipe' })
          execSync('git commit -m "chore: initialize team ops directory"', {
            cwd: REFLECTT_HOME,
            stdio: 'pipe',
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: 'reflectt',
              GIT_AUTHOR_EMAIL: 'init@reflectt.ai',
              GIT_COMMITTER_NAME: 'reflectt',
              GIT_COMMITTER_EMAIL: 'init@reflectt.ai',
            },
          })
          console.log('  ✅ git repo initialized with initial commit')
        } catch (err) {
          console.log('  ⚠️  git init failed (git may not be installed)')
        }
      } else {
        console.log('  ⏭️  .git (exists)')
      }
    }

    console.log('')
    if (isNew) {
      console.log('🎉 Team ops directory initialized!')
    } else {
      console.log(`✅ Init complete (${filesCreated} created, ${filesSkipped} existing)`)
    }
    console.log(`   Home: ${REFLECTT_HOME}`)
    console.log('')
    console.log('Next steps:')
    console.log('  1. Start the server:   reflectt start')
    console.log('  2. Open the dashboard: http://localhost:4445/dashboard')
    console.log('  3. Connect to cloud:   reflectt host connect --join-token <token>')
    console.log('     Get your token at:  https://app.reflectt.ai')
    console.log('')
    console.log('Optional:')
    console.log('  - Edit TEAM.md with your team\'s mission and values')
    console.log('  - Edit TEAM-ROLES.yaml to customize your agent roster')
  })

// ============ START COMMAND ============
program
  .command('start')
  .description('Start the reflectt server')
  .option('-d, --detach', 'Run in background')
  .action(async (options) => {
    if (!existsSync(REFLECTT_HOME)) {
      console.error('❌ reflectt not initialized. Run: reflectt init')
      process.exit(1)
    }
    
    // Check if already running
    if (existsSync(PID_FILE)) {
      const pid = readFileSync(PID_FILE, 'utf-8').trim()
      try {
        process.kill(Number(pid), 0) // Check if process exists
        console.log(`⚠️  Server already running (PID: ${pid})`)
        console.log('   Stop it first with: reflectt stop')
        process.exit(1)
      } catch (err) {
        // Process doesn't exist, clean up stale PID file
        console.log('🧹 Cleaning up stale PID file...')
        const { unlinkSync } = await import('fs')
        unlinkSync(PID_FILE)
      }
    }

    const config = loadConfig()
    const { projectRoot, serverPath, useNode } = getRuntimePaths()

    if (!existsSync(serverPath)) {
      console.error(`❌ Server file not found: ${serverPath}`)
      process.exit(1)
    }

    const env = buildServerEnv(config)
    const cmd = useNode ? 'node' : 'npx'
    const args = useNode ? [serverPath] : ['tsx', serverPath]

    if (options.detach) {
      const pid = startServerDetached(config)
      console.log('✅ Server started in background')
      console.log(`   PID: ${pid}`)
      console.log(`   URL: http://${config.host}:${config.port}`)
      console.log(`   Dashboard: http://${config.host}:${config.port}/dashboard`)
      if (config.cloud) {
        console.log(`   Cloud: ${config.cloud.cloudUrl} (host: ${config.cloud.hostName})`)
      }
      console.log('\nCheck status: reflectt status')
    } else {
      // Foreground mode
      console.log('🚀 Starting reflectt server...')
      console.log(`   URL: http://${config.host}:${config.port}`)
      console.log(`   Dashboard: http://${config.host}:${config.port}/dashboard`)
      if (config.cloud) {
        console.log(`   Cloud: ${config.cloud.cloudUrl} (host: ${config.cloud.hostName})`)
      }
      console.log('   Press Ctrl+C to stop\n')

      const child = spawn(cmd, args, {
        env,
        stdio: 'inherit',
        cwd: projectRoot,
      })

      writeFileSync(PID_FILE, String(child.pid))

      child.on('exit', (code) => {
        if (existsSync(PID_FILE)) {
          unlinkSync(PID_FILE)
        }
        process.exit(code || 0)
      })
    }
  })

// ============ STOP COMMAND ============
program
  .command('stop')
  .description('Stop the reflectt server')
  .action(() => {
    if (!existsSync(PID_FILE)) {
      console.log('⚠️  Server is not running')
      process.exit(0)
    }
    
    const pid = readFileSync(PID_FILE, 'utf-8').trim()
    
    try {
      process.kill(Number(pid), 'SIGTERM')
      console.log('✅ Server stopped')
      
      unlinkSync(PID_FILE)
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        console.log('⚠️  Process not found (already stopped?)')
        unlinkSync(PID_FILE)
      } else {
        console.error('❌ Failed to stop server:', err.message)
        process.exit(1)
      }
    }
  })

// ============ STATUS COMMAND ============
program
  .command('status')
  .description('Check server health and status')
  .action(async () => {
    const config = loadConfig()
    
    // Check PID file
    const isRunning = existsSync(PID_FILE)
    const pid = isRunning ? readFileSync(PID_FILE, 'utf-8').trim() : null
    
    console.log('📊 reflectt Status')
    console.log(`   Config: ${CONFIG_PATH}`)
    console.log(`   URL: http://${config.host}:${config.port}`)
    
    if (pid) {
      try {
        process.kill(Number(pid), 0) // Check if process exists
        console.log(`   Process: Running (PID: ${pid})`)
      } catch (err) {
        console.log(`   Process: Not found (stale PID file)`)
        return
      }
    } else {
      console.log(`   Process: Not running`)
      return
    }
    
    // Try to get health status
    try {
      const health = await apiRequest('/health')
      console.log('\n✅ Server Health')
      console.log(`   Status: ${health.status}`)
      console.log(`   Chat messages: ${health.chat?.messageCount || 0}`)
      console.log(`   Tasks: ${health.tasks?.taskCount || 0}`)
    } catch (err) {
      console.log('\n⚠️  Server process exists but not responding')
    }
  })

// ============ DOCTOR COMMAND ============
program
  .command('doctor')
  .description('Run self-serve diagnostics (onboarding + support bundle)')
  .option('--url <baseUrl>', 'Override base URL (default from ~/.reflectt/config.json)')
  .option('--json', 'Print JSON output')
  .option('--timeout <ms>', 'Per-request timeout in ms', '4000')
  .action(async (options) => {
    const config = loadConfig()
    const clientHost = (config.host === '0.0.0.0' || config.host === '::') ? '127.0.0.1' : config.host
    const baseUrl = String(options.url || `http://${clientHost}:${config.port}`).replace(/\/+$/, '')
    const timeoutMs = Math.max(250, Number(options.timeout || 4000))

    const report = await collectDoctorReport({ baseUrl, timeoutMs })

    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
      if (report.overall === 'fail') process.exit(2)
      if (report.overall === 'warn') process.exit(1)
      return
    }

    console.log(formatDoctorHuman(report))

    if (report.overall === 'fail') process.exit(2)
    if (report.overall === 'warn') process.exit(1)
  })

// ============ CHAT COMMANDS ============
const chat = program.command('chat').description('Chat commands')

chat
  .command('send')
  .description('Send a message')
  .requiredOption('--from <agent>', 'Sender agent name')
  .requiredOption('--content <text>', 'Message content')
  .option('--to <agent>', 'Recipient agent')
  .option('--channel <name>', 'Channel name')
  .option('--thread <id>', 'Thread ID to reply to')
  .action(async (options) => {
    const body: any = {
      from: options.from,
      content: options.content,
    }
    if (options.to) body.to = options.to
    if (options.channel) body.channel = options.channel
    if (options.thread) body.threadId = options.thread
    
    const result = await apiRequest('/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    console.log('✅ Message sent')
    console.log(`   ID: ${result.message.id}`)
    console.log(`   From: ${result.message.from}`)
    if (result.message.channel) console.log(`   Channel: ${result.message.channel}`)
  })

chat
  .command('list')
  .description('List messages')
  .option('--channel <name>', 'Filter by channel')
  .option('--from <agent>', 'Filter by sender')
  .option('--to <agent>', 'Filter by recipient')
  .option('--limit <n>', 'Maximum number of messages', '20')
  .action(async (options) => {
    const query = new URLSearchParams()
    if (options.channel) query.set('channel', options.channel)
    if (options.from) query.set('from', options.from)
    if (options.to) query.set('to', options.to)
    if (options.limit) query.set('limit', options.limit)
    
    const result = await apiRequest(`/chat/messages?${query}`)
    
    if (result.messages.length === 0) {
      console.log('No messages found')
      return
    }
    
    console.log(`\n📬 Messages (${result.messages.length})\n`)
    for (const msg of result.messages) {
      const timestamp = new Date(msg.timestamp).toLocaleString()
      const channel = msg.channel ? `[${msg.channel}]` : ''
      console.log(`${timestamp} ${channel}`)
      console.log(`  ${msg.from} → ${msg.to || 'broadcast'}: ${msg.content}`)
      console.log()
    }
  })

// ============ TASKS COMMANDS ============
const tasks = program.command('tasks').description('Task commands')

tasks
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'Filter by status (todo, doing, blocked, validating, done)')
  .option('--assignee <agent>', 'Filter by assignee')
  .option('--priority <p>', 'Filter by priority (P0, P1, P2, P3)')
  .action(async (options) => {
    const query = new URLSearchParams()
    if (options.status) query.set('status', options.status)
    if (options.assignee) query.set('assignee', options.assignee)
    if (options.priority) query.set('priority', options.priority)
    
    const result = await apiRequest(`/tasks?${query}`)
    
    if (result.tasks.length === 0) {
      console.log('No tasks found')
      return
    }
    
    console.log(`\n📋 Tasks (${result.tasks.length})\n`)
    for (const task of result.tasks) {
      const status = task.status.toUpperCase().padEnd(10)
      const priority = task.priority ? `[${task.priority}]` : ''
      const assignee = task.assignee ? `→ ${task.assignee}` : ''
      console.log(`${status} ${priority} ${task.title} ${assignee}`)
      if (task.description) {
        console.log(`           ${task.description}`)
      }
      console.log()
    }
  })

tasks
  .command('next')
  .description('Get next available task')
  .option('--agent <name>', 'Agent requesting the task')
  .action(async (options) => {
    const query = new URLSearchParams()
    if (options.agent) query.set('agent', options.agent)
    
    const result = await apiRequest(`/tasks/next?${query}`)
    
    if (!result.task) {
      console.log('🎉 No tasks available!')
      return
    }
    
    const task = result.task
    console.log('\n📌 Next Task\n')
    console.log(`   ID: ${task.id}`)
    console.log(`   Title: ${task.title}`)
    if (task.description) console.log(`   Description: ${task.description}`)
    console.log(`   Status: ${task.status}`)
    if (task.priority) console.log(`   Priority: ${task.priority}`)
    if (task.assignee) console.log(`   Assignee: ${task.assignee}`)
  })

tasks
  .command('create')
  .description('Create a new task')
  .requiredOption('--title <text>', 'Task title')
  .requiredOption('--created-by <agent>', 'Agent creating the task')
  .requiredOption('--assignee <agent>', 'Task owner/assignee')
  .requiredOption('--reviewer <agent>', 'Task reviewer')
  .requiredOption('--done-criteria <items...>', 'Done criteria (space-separated; quote each item)')
  .requiredOption('--eta <text>', 'ETA (e.g., "30m" or "2026-02-15T18:00Z")')
  .option('--description <text>', 'Task description')
  .option('--status <status>', 'Initial status', 'todo')
  .option('--priority <p>', 'Priority (P0, P1, P2, P3)')
  .action(async (options) => {
    const body: any = {
      title: options.title,
      createdBy: options.createdBy,
      status: options.status,
      assignee: options.assignee,
      reviewer: options.reviewer,
      done_criteria: options.doneCriteria,
      eta: options.eta,
    }
    if (options.description) body.description = options.description
    if (options.priority) body.priority = options.priority

    const result = await apiRequest('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    console.log('✅ Task created')
    console.log(`   ID: ${result.task.id}`)
    console.log(`   Title: ${result.task.title}`)
    console.log(`   Status: ${result.task.status}`)
  })

// ============ DOGFOOD COMMANDS ============
const dogfood = program.command('dogfood').description('Dogfood verification commands')

dogfood
  .command('smoke')
  .description('Run end-to-end cloud enrollment chain verification')
  .requiredOption('--team-id <id>', 'Cloud team id to target')
  .requiredOption('--token <jwt>', 'Bearer token for cloud API auth (team admin/owner)')
  .option('--cloud-url <url>', 'Cloud API base URL', process.env.REFLECTT_CLOUD_URL || 'https://api.reflectt.ai')
  .option('--dashboard-url <url>', 'Dashboard base URL', process.env.REFLECTT_APP_URL || 'https://app.reflectt.ai')
  .option('--host-name <name>', 'Host name to register', `dogfood-${process.pid}`)
  .option('--capability <value...>', 'Host capabilities', ['openclaw', 'dogfood-smoke'])
  .action(async (options) => {
    const cloudBase = String(options.cloudUrl || '').replace(/\/+$/, '')
    const dashboardBase = String(options.dashboardUrl || '').replace(/\/+$/, '')
    const teamId = String(options.teamId)
    const token = String(options.token)
    const hostName = String(options.hostName)
    const capabilities = Array.isArray(options.capability) ? options.capability.map((v: string) => String(v).trim()).filter(Boolean) : ['openclaw']

    if (!cloudBase || !token || !teamId) {
      console.error('❌ Missing required inputs: --cloud-url, --token, --team-id')
      process.exit(1)
    }

    let failed = false
    let hostId = ''

    console.log('🧪 Running dogfood smoke chain\n')
    console.log(`   Cloud API: ${cloudBase}`)
    console.log(`   Dashboard: ${dashboardBase}`)
    console.log(`   Team ID: ${teamId}`)
    console.log(`   Host Name: ${hostName}\n`)

    // 1) register host token
    const register = await cloudRequest(`${cloudBase}/api/hosts/register-token`, token, 'POST', { teamId })
    const joinToken = register.json?.registerToken?.joinToken
    const registerOk = register.status === 201 && typeof joinToken === 'string' && joinToken.length > 0
    printStep('register host token', registerOk, registerOk ? 'join token issued' : `status ${register.status} ${(register.json?.error || '').toString()}`)
    failed = failed || !registerOk

    // 2) claim host
    let credential = ''
    if (registerOk) {
      const claim = await cloudRequest(`${cloudBase}/api/hosts/claim`, token, 'POST', {
        joinToken,
        name: hostName,
        capabilities,
      })
      hostId = String(claim.json?.host?.id || '')
      credential = String(claim.json?.credential?.token || '')
      const claimOk = claim.status === 201 && Boolean(hostId)
      printStep('claim host', claimOk, claimOk ? `hostId=${hostId}` : `status ${claim.status} ${(claim.json?.error || '').toString()}`)
      failed = failed || !claimOk
    }

    // 3) heartbeat
    if (hostId) {
      const heartbeat = await cloudRequest(`${cloudBase}/api/hosts/${encodeURIComponent(hostId)}/heartbeat`, token, 'POST', {
        status: 'online',
        agents: [{ id: 'dogfood-smoke', state: 'active' }],
        activeTasks: [{ id: `smoke-${Date.now()}`, status: 'doing' }],
      })
      const heartbeatOk = heartbeat.status === 200 && String(heartbeat.json?.host?.status || '') === 'online'
      printStep('heartbeat', heartbeatOk, heartbeatOk ? 'cloud accepted heartbeat' : `status ${heartbeat.status} ${(heartbeat.json?.error || '').toString()}`)
      failed = failed || !heartbeatOk
    }

    // 4) verify cloud state
    let cloudHostSeen = false
    if (hostId) {
      const verify = await cloudRequest(`${cloudBase}/api/hosts?teamId=${encodeURIComponent(teamId)}`, token, 'GET')
      const hosts = Array.isArray(verify.json?.hosts) ? verify.json.hosts : []
      const match = hosts.find((h: any) => String(h?.id || '') === hostId)
      cloudHostSeen = Boolean(match)
      const verifyOk = verify.status === 200 && cloudHostSeen
      printStep('verify cloud state', verifyOk, verifyOk ? 'host visible in /api/hosts' : `status ${verify.status} host missing`)
      failed = failed || !verifyOk
    }

    // 5) verify dashboard reachability + data source alignment
    if (hostId) {
      const dashboardProbe = await fetch(`${dashboardBase}/dashboard/hosts`, { method: 'GET' })
        .then((res) => ({ ok: res.status < 500, status: res.status }))
        .catch(() => ({ ok: false, status: 0 }))

      const dashboardOk = dashboardProbe.ok && cloudHostSeen
      printStep(
        'verify dashboard reflection path',
        dashboardOk,
        dashboardOk
          ? `dashboard reachable (HTTP ${dashboardProbe.status}); host present in dashboard source endpoint`
          : `dashboard probe HTTP ${dashboardProbe.status}; or host missing from source endpoint`,
      )
      failed = failed || !dashboardOk
    }

    console.log('')
    if (failed) {
      console.error('❌ Dogfood smoke FAILED')
      process.exit(1)
    }

    console.log('✅ Dogfood smoke PASSED')
    if (hostId) {
      console.log(`   hostId: ${hostId}`)
      if (credential) {
        console.log('   credential: issued (shown once)')
      }
    }
  })

// ============ HOST COMMANDS ============
// ============ BOOTSTRAP (one-shot install + connect + start) ============
program
  .command('bootstrap')
  .description('One-shot setup: init + connect to cloud + start server. Fastest way to get running.')
  .option('--join-token <token>', 'Cloud host join token (get one at app.reflectt.ai)')
  .option('--api-key <key>', 'Team API key')
  .option('--cloud-url <url>', 'Cloud API base URL', 'https://api.reflectt.ai')
  .option('--name <hostName>', 'Host display name', hostname())
  .option('--type <hostType>', 'Host type', 'openclaw')
  .action(async (options) => {
    try {
      if (!options.joinToken && !options.apiKey) {
        console.error('❌ Either --join-token or --api-key is required')
        console.error('')
        console.error('Get a join token at: https://app.reflectt.ai')
        console.error('')
        console.error('Usage:')
        console.error('  npx reflectt bootstrap --join-token <token>')
        console.error('  npx reflectt bootstrap --api-key <key>')
        process.exit(1)
      }

      // Step 0: Preflight checks
      console.log('🔍 Preflight checks...')
      try {
        const { runPreflight, formatPreflightReport } = await import('./preflight.js')
        const report = await runPreflight({
          cloudUrl: options.cloudUrl,
          joinToken: options.joinToken,
          apiKey: options.apiKey,
        })
        console.log(formatPreflightReport(report))
        console.log('')
        if (!report.allPassed && report.firstBlocker) {
          console.error(`❌ Preflight failed: ${report.firstBlocker.message}`)
          console.error('')
          console.error('Fix the issue above and retry.')
          process.exit(1)
        }
      } catch (err: any) {
        console.log('   ⚠️  Preflight checks unavailable, proceeding...')
      }

      // Step 1: Init
      console.log('📦 Step 1/3: Initializing reflectt home...')
      ensureReflecttHome()
      if (!existsSync(CONFIG_PATH)) {
        saveConfig({ port: 4445, host: '127.0.0.1' })
      }
      console.log(`   ✅ Home: ${REFLECTT_HOME}`)

      // Step 2: Connect
      console.log('☁️  Step 2/3: Connecting to Reflectt Cloud...')
      const cloudUrl = String(options.cloudUrl || 'https://api.reflectt.ai').replace(/\/+$/, '')

      const registered = options.apiKey
        ? await enrollHostWithApiKey({
            cloudUrl,
            apiKey: options.apiKey,
            hostName: options.name,
            hostType: options.type,
          })
        : await registerHostWithCloud({
            cloudUrl,
            joinToken: options.joinToken,
            hostName: options.name,
            hostType: options.type,
          })

      const config = loadConfig()
      const nextConfig: Config = {
        ...config,
        cloud: {
          cloudUrl,
          hostName: options.name,
          hostType: options.type,
          hostId: registered.hostId,
          credential: registered.credential,
          connectedAt: Date.now(),
        },
      }
      saveConfig(nextConfig)
      console.log(`   ✅ Registered (host: ${registered.hostId})`)

      // Step 3: Start
      console.log('🚀 Step 3/3: Starting reflectt server...')
      if (isServerRunning()) {
        console.log('   Server already running, reloading cloud config...')
        const reloadResult = await tryApiRequest('/cloud/reload', { method: 'POST' })
        if (reloadResult?.success) {
          console.log('   ✅ Cloud config reloaded')
        } else {
          console.log('   ⚠️  Reload failed, restarting...')
          stopServerIfRunning()
          startServerDetached(nextConfig)
        }
      } else {
        startServerDetached(nextConfig)
      }

      // Verify
      const heartbeat = await waitForCloudHeartbeat()
      if (heartbeat) {
        const dashboardUrl = `http://127.0.0.1:${nextConfig?.port || 4445}/dashboard`
        console.log('')
        console.log('✅ Bootstrap complete!')
        console.log(`   Host ID: ${registered.hostId}`)
        console.log(`   Cloud: ${cloudUrl}`)
        console.log(`   Heartbeats: ${heartbeat.heartbeatCount}`)
        console.log('')
        console.log('Your host is connected and reporting to Reflectt Cloud.')
        console.log('')
        console.log(`🖥️  Open your dashboard: ${dashboardUrl}`)
      } else {
        const dashboardUrlTimeout = `http://127.0.0.1:${nextConfig?.port || 4445}/dashboard`
        console.log('')
        console.log('⚠️  Bootstrap complete but heartbeat verification timed out.')
        console.log('   Run `reflectt host status` to check.')
        console.log('')
        console.log(`🖥️  Open your dashboard: ${dashboardUrlTimeout}`)
        process.exitCode = 1
      }
    } catch (err: any) {
      console.error(`❌ Bootstrap failed: ${err?.message || err}`)
      process.exit(1)
    }
  })

// ============ HOST COMMANDS ============
const host = program.command('host').description('Cloud host enrollment and status')

host
  .command('connect')
  .description('Enroll this reflectt-node host with Reflectt Cloud')
  .option('--join-token <token>', 'Cloud host join token (from dashboard)')
  .option('--api-key <key>', 'Team API key for agent-friendly enrollment (no browser needed)')
  .option('--cloud-url <url>', 'Cloud API base URL', 'https://api.reflectt.ai')
  .option('--name <hostName>', 'Host display name', hostname())
  .option('--type <hostType>', 'Host type', 'openclaw')
  .option('--auth-token <jwt>', 'Temporary user JWT for environments where claim endpoint is JWT-gated')
  .option('--no-restart', 'Do not restart/start local reflectt server after enrollment')
  .action(async (options) => {
    try {
      if (!options.joinToken && !options.apiKey) {
        console.error('❌ Either --join-token or --api-key is required')
        console.error('   --join-token <token>  From dashboard (human flow)')
        console.error('   --api-key <key>       Team API key (agent flow)')
        process.exit(1)
      }

      ensureReflecttHome()
      const config = loadConfig()
      const cloudUrl = String(options.cloudUrl || 'https://api.reflectt.ai').replace(/\/+$/, '')

      console.log('☁️  Enrolling host with Reflectt Cloud...')
      console.log(`   Cloud: ${cloudUrl}`)
      console.log(`   Host: ${options.name} (${options.type})`)
      console.log(`   Method: ${options.apiKey ? 'API key' : 'join token'}`)

      const registered = options.apiKey
        ? await enrollHostWithApiKey({
            cloudUrl,
            apiKey: options.apiKey,
            hostName: options.name,
            hostType: options.type,
          })
        : await registerHostWithCloud({
            cloudUrl,
            joinToken: options.joinToken,
            hostName: options.name,
            hostType: options.type,
            authToken: options.authToken,
          })

      const nextConfig: Config = {
        ...config,
        cloud: {
          cloudUrl,
          hostName: options.name,
          hostType: options.type,
          hostId: registered.hostId,
          credential: registered.credential,
          connectedAt: Date.now(),
        },
      }
      saveConfig(nextConfig)

      console.log('✅ Cloud registration complete')
      console.log(`   Host ID: ${registered.hostId}`)
      console.log('   Credential: received and stored in ~/.reflectt/config.json')

      if (options.restart) {
        if (isServerRunning()) {
          // Try hot-reload first (avoids full restart)
          console.log('🔄 Reloading cloud config on running server...')
          const reloadResult = await tryApiRequest('/cloud/reload', { method: 'POST' })
          if (reloadResult?.success) {
            console.log('✅ Cloud config hot-reloaded')
            const heartbeat = await waitForCloudHeartbeat()
            if (heartbeat) {
              console.log('✅ Heartbeat verified')
              console.log(`   Cloud host ID: ${heartbeat.hostId}`)
              console.log(`   Heartbeats sent: ${heartbeat.heartbeatCount}`)
            } else {
              console.log('⚠️  Config reloaded, but heartbeat verification timed out')
              console.log('   Check: reflectt host status')
              process.exitCode = 1
            }
          } else {
            // Fallback: full restart (older server without /cloud/reload)
            console.log('⚠️  Hot-reload unavailable, falling back to full restart...')
            stopServerIfRunning()
            const pid = startServerDetached(nextConfig)
            console.log(`   Server PID: ${pid}`)

            const heartbeat = await waitForCloudHeartbeat()
            if (heartbeat) {
              console.log('✅ Heartbeat verified')
              console.log(`   Cloud host ID: ${heartbeat.hostId}`)
              console.log(`   Heartbeats sent: ${heartbeat.heartbeatCount}`)
            } else {
              console.log('⚠️  Enrollment saved, but heartbeat verification timed out')
              console.log('   Check: reflectt status')
              console.log('   Check: reflectt host status')
              process.exitCode = 1
            }
          }
        } else {
          console.log('🚀 Starting local reflectt server...')
          const pid = startServerDetached(nextConfig)
          console.log(`   Server PID: ${pid}`)

          const heartbeat = await waitForCloudHeartbeat()
          if (heartbeat) {
            console.log('✅ Heartbeat verified')
            console.log(`   Cloud host ID: ${heartbeat.hostId}`)
            console.log(`   Heartbeats sent: ${heartbeat.heartbeatCount}`)
          } else {
            console.log('⚠️  Enrollment saved, but heartbeat verification timed out')
            console.log('   Check: reflectt status')
            console.log('   Check: reflectt host status')
            process.exitCode = 1
          }
        }
      } else {
        console.log('ℹ️  Enrollment saved. Restart/start reflectt manually to begin heartbeats.')
      }
    } catch (err: any) {
      console.error(`❌ Host connect failed: ${err?.message || err}`)
      process.exit(1)
    }
  })

host
  .command('status')
  .description('Show local host cloud enrollment + heartbeat status')
  .action(async () => {
    const config = loadConfig()
    if (!config.cloud) {
      console.log('Cloud enrollment not configured.')
      console.log('Run: reflectt host connect --join-token <token>')
      return
    }

    console.log('☁️  Cloud Enrollment')
    console.log(`   Cloud URL: ${config.cloud.cloudUrl}`)
    console.log(`   Host ID: ${config.cloud.hostId}`)
    console.log(`   Host Name: ${config.cloud.hostName}`)
    console.log(`   Host Type: ${config.cloud.hostType}`)
    console.log(`   Connected At: ${new Date(config.cloud.connectedAt).toLocaleString()}`)

    const status = await tryApiRequest('/cloud/status')
    if (!status) {
      console.log('\n⚠️  Local server not reachable (cloud runtime status unavailable)')
      return
    }

    console.log('\n📡 Runtime Cloud Status')
    console.log(`   Configured: ${status.configured ? 'yes' : 'no'}`)
    console.log(`   Registered: ${status.registered ? 'yes' : 'no'}`)
    console.log(`   Running: ${status.running ? 'yes' : 'no'}`)
    console.log(`   Heartbeats: ${status.heartbeatCount || 0}`)
    if (status.lastHeartbeat) {
      console.log(`   Last Heartbeat: ${new Date(status.lastHeartbeat).toLocaleString()}`)
    }
    if (status.errors) {
      console.log(`   Errors: ${status.errors}`)
    }
  })

// ============ MEMORY COMMANDS ============
const memory = program.command('memory').description('Memory commands')

memory
  .command('read')
  .description('Read memory for an agent')
  .argument('<agent>', 'Agent name')
  .action(async (agent) => {
    const result = await apiRequest(`/memory/${agent}`)
    
    if (!result.success) {
      console.error('❌', result.error)
      process.exit(1)
    }
    
    if (result.memories.length === 0) {
      console.log(`No memory files for agent: ${agent}`)
      return
    }
    
    console.log(`\n🧠 Memory for ${agent} (${result.memories.length} files)\n`)
    for (const mem of result.memories) {
      console.log(`📄 ${mem.file}`)
      console.log(`   Size: ${mem.size} bytes`)
      console.log(`   Modified: ${new Date(mem.mtime).toLocaleString()}`)
      console.log()
    }
  })

memory
  .command('write')
  .description('Append to daily memory file')
  .argument('<agent>', 'Agent name')
  .requiredOption('--content <text>', 'Content to append')
  .action(async (agent, options) => {
    const result = await apiRequest(`/memory/${agent}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: options.content }),
    })
    
    if (!result.success) {
      console.error('❌', result.error)
      process.exit(1)
    }
    
    console.log('✅ Memory written')
    console.log(`   File: ${result.file}`)
    console.log(`   Size: ${result.size} bytes`)
  })

memory
  .command('search')
  .description('Search memory files')
  .argument('<agent>', 'Agent name')
  .requiredOption('--query <text>', 'Search query')
  .action(async (agent, options) => {
    const query = new URLSearchParams({ q: options.query })
    const result = await apiRequest(`/memory/${agent}/search?${query}`)
    
    if (!result.success) {
      console.error('❌', result.error)
      process.exit(1)
    }
    
    if (result.results.length === 0) {
      console.log('No matches found')
      return
    }
    
    console.log(`\n🔍 Search Results (${result.count})\n`)
    for (const match of result.results) {
      console.log(`📄 ${match.file}`)
      console.log(`   Line ${match.lineNumber}: ${match.line}`)
      console.log()
    }
  })

program.parse()
