#!/usr/bin/env node
/**
 * reflectt CLI - Command line interface for reflectt-node
 */
import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { spawn } from 'child_process'

const REFLECTT_HOME = process.env.REFLECTT_HOME || join(homedir(), '.reflectt')
const CONFIG_PATH = join(REFLECTT_HOME, 'config.json')
const DATA_DIR = join(REFLECTT_HOME, 'data')
const PID_FILE = join(REFLECTT_HOME, 'server.pid')

interface Config {
  port: number
  host: string
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

const program = new Command()

program
  .name('reflectt')
  .description('CLI for reflectt-node - local agent communication server')
  .version('0.1.0')

// ============ INIT COMMAND ============
program
  .command('init')
  .description('Initialize reflectt with default configuration')
  .action(() => {
    if (existsSync(REFLECTT_HOME)) {
      console.log(`⚠️  ${REFLECTT_HOME} already exists`)
      
      // Check if migration is needed
      const projectDataDir = join(process.cwd(), 'data')
      if (existsSync(projectDataDir)) {
        console.log(`\n📦 Found legacy data/ directory at ${projectDataDir}`)
        console.log('   You can migrate it manually to ~/.reflectt/data/')
      }
    } else {
      // Create directories
      mkdirSync(REFLECTT_HOME, { recursive: true })
      mkdirSync(DATA_DIR, { recursive: true })
      mkdirSync(join(DATA_DIR, 'inbox'), { recursive: true })
      
      // Create default config
      const config: Config = { port: 4445, host: '127.0.0.1' }
      saveConfig(config)
      
      console.log('✅ Initialized reflectt')
      console.log(`   Home: ${REFLECTT_HOME}`)
      console.log(`   Config: ${CONFIG_PATH}`)
      console.log(`   Data: ${DATA_DIR}`)
      console.log('\nNext steps:')
      console.log('  1. Start the server: reflectt start')
      console.log('  2. Check status: reflectt status')
      console.log('  3. Send a message: reflectt chat send --from agent --content "Hello"')
    }
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
    
    // Find the project root (where package.json is)
    const { fileURLToPath } = await import('url')
    const { dirname } = await import('path')
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const projectRoot = join(__dirname, '..')
    
    const serverPath = join(projectRoot, 'src', 'index.ts')
    
    if (!existsSync(serverPath)) {
      console.error(`❌ Server file not found: ${serverPath}`)
      process.exit(1)
    }

    const env = {
      ...process.env,
      REFLECTT_HOME,
      PORT: String(config.port),
      HOST: config.host,
    }

    if (options.detach) {
      // Background mode
      const child = spawn('npx', ['tsx', serverPath], {
        env,
        detached: true,
        stdio: 'ignore',
        cwd: projectRoot,
      })
      
      child.unref()
      writeFileSync(PID_FILE, String(child.pid))
      
      console.log('✅ Server started in background')
      console.log(`   PID: ${child.pid}`)
      console.log(`   URL: http://${config.host}:${config.port}`)
      console.log('\nCheck status: reflectt status')
    } else {
      // Foreground mode
      console.log('🚀 Starting reflectt server...')
      console.log(`   URL: http://${config.host}:${config.port}`)
      console.log('   Press Ctrl+C to stop\n')
      
      const child = spawn('npx', ['tsx', serverPath], {
        env,
        stdio: 'inherit',
        cwd: projectRoot,
      })
      
      writeFileSync(PID_FILE, String(child.pid))
      
      child.on('exit', (code) => {
        if (existsSync(PID_FILE)) {
          const { unlinkSync } = require('fs')
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
      
      const { unlinkSync } = require('fs')
      unlinkSync(PID_FILE)
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        console.log('⚠️  Process not found (already stopped?)')
        const { unlinkSync } = require('fs')
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
