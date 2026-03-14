#!/usr/bin/env tsx
/**
 * Reflectt Native Runtime — Proof of Concept
 *
 * Proves one agent turn through Reflectt-managed runtime only.
 * No OpenClaw runtime dependency in the execution path.
 *
 * Execution path:
 *   CLI → model call (Anthropic SDK) → tool dispatch → persisted transcript → output
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<your-key> npx tsx spike/runtime-poc.ts [objective]
 *
 * Task: task-1773445129996-2vt45xvi1
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomBytes } from 'node:crypto'

// ── Config ──────────────────────────────────────────────────────────────────

const MODEL = process.env.REFLECTT_MODEL || 'claude-sonnet-4-5'
const OBJECTIVE = process.argv[2] || 'Read the reflectt-node version from package.json and report it'
const TRANSCRIPT_DIR = process.env.REFLECTT_TRANSCRIPT_DIR
  || path.join(os.homedir(), '.reflectt', 'transcripts')

// ── Session ──────────────────────────────────────────────────────────────────

const SESSION_ID = `rs-${Date.now()}-${randomBytes(4).toString('hex')}`
const startedAt = Date.now()

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read text content from a file path',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write text content to a file path (creates parent dirs)',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute or relative file path' },
        content: { type: 'string', description: 'Text content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'search',
    description: 'Search for text patterns in files under a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Text pattern to search for' },
        dir: { type: 'string', description: 'Directory to search in' },
      },
      required: ['pattern', 'dir'],
    },
  },
]

// ── Tool dispatch ────────────────────────────────────────────────────────────

interface ToolResult {
  tool: string
  input: Record<string, unknown>
  output: string
  durationMs: number
}

const toolResults: ToolResult[] = []

async function dispatchTool(name: string, input: Record<string, unknown>): Promise<string> {
  const t0 = Date.now()
  let output: string

  try {
    if (name === 'read_file') {
      const p = String(input.path)
      if (!fs.existsSync(p)) {
        output = `Error: file not found: ${p}`
      } else {
        output = fs.readFileSync(p, 'utf8').slice(0, 8000) // cap at 8KB
      }
    } else if (name === 'write_file') {
      const p = String(input.path)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, String(input.content), 'utf8')
      output = `Written ${String(input.content).length} bytes to ${p}`
    } else if (name === 'search') {
      const dir = String(input.dir)
      const pattern = String(input.pattern)
      const results: string[] = []
      function walk(d: string, depth = 0) {
        if (depth > 3) return
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
          const full = path.join(d, entry.name)
          if (entry.isDirectory()) { walk(full, depth + 1); continue }
          try {
            const content = fs.readFileSync(full, 'utf8')
            const lines = content.split('\n')
            lines.forEach((line, i) => {
              if (line.includes(pattern)) {
                results.push(`${full}:${i + 1}: ${line.trim()}`)
              }
            })
          } catch { /* binary file */ }
        }
      }
      walk(dir)
      output = results.slice(0, 50).join('\n') || 'No matches found'
    } else {
      output = `Unknown tool: ${name}`
    }
  } catch (e: any) {
    output = `Error: ${e.message}`
  }

  toolResults.push({ tool: name, input, output, durationMs: Date.now() - t0 })
  return output
}

// ── Transcript ───────────────────────────────────────────────────────────────

interface Transcript {
  sessionId: string
  objective: string
  model: string
  startedAt: string
  endedAt?: string
  elapsedMs?: number
  messages: Anthropic.MessageParam[]
  toolResults: ToolResult[]
  finalAnswer?: string
  status: 'running' | 'complete' | 'error'
  error?: string
}

function saveTranscript(t: Transcript) {
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true })
  const file = path.join(TRANSCRIPT_DIR, `${t.sessionId}.json`)
  fs.writeFileSync(file, JSON.stringify(t, null, 2), 'utf8')
  return file
}

// ── Main turn ────────────────────────────────────────────────────────────────

async function runTurn() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not set. This is a known blocker — see writeup.')
    console.log('\nSimulating dry-run (no model call)...')
    // Still persist transcript shell so the session ID path works
    const t: Transcript = {
      sessionId: SESSION_ID,
      objective: OBJECTIVE,
      model: MODEL,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      messages: [],
      toolResults: [],
      status: 'error',
      error: 'ANTHROPIC_API_KEY not set — dry run only',
    }
    const file = saveTranscript(t)
    console.log(`📝 Transcript saved (dry run): ${file}`)
    console.log(`🔑 Session ID: ${SESSION_ID}`)
    return { sessionId: SESSION_ID, status: 'dry_run', file }
  }

  const client = new Anthropic({ apiKey })

  const transcript: Transcript = {
    sessionId: SESSION_ID,
    objective: OBJECTIVE,
    model: MODEL,
    startedAt: new Date(startedAt).toISOString(),
    messages: [],
    toolResults: [],
    status: 'running',
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: OBJECTIVE },
  ]

  console.log(`🚀 Reflectt Runtime POC — session: ${SESSION_ID}`)
  console.log(`📋 Objective: ${OBJECTIVE}`)
  console.log(`🤖 Model: ${MODEL}`)
  console.log()

  // Agentic loop (max 5 turns to prevent runaway)
  for (let turn = 0; turn < 5; turn++) {
    console.log(`[Turn ${turn + 1}] Calling model...`)
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: TOOLS,
      messages,
    })

    // Append assistant turn
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'end_turn') {
      // Extract text answer
      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('\n')
      transcript.finalAnswer = text
      transcript.status = 'complete'
      console.log(`\n✅ Final answer:\n${text}`)
      break
    }

    if (response.stop_reason === 'tool_use') {
      const toolBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const toolResultContent: Anthropic.ToolResultBlockParam[] = []

      for (const block of toolBlocks) {
        console.log(`  🔧 Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 80)})`)
        const result = await dispatchTool(block.name, block.input as Record<string, unknown>)
        console.log(`     → ${result.slice(0, 120)}`)
        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        })
      }

      messages.push({ role: 'user', content: toolResultContent })
    }
  }

  transcript.messages = messages
  transcript.endedAt = new Date().toISOString()
  transcript.elapsedMs = Date.now() - startedAt

  const file = saveTranscript(transcript)
  console.log(`\n📝 Transcript saved: ${file}`)
  console.log(`🔑 Session ID: ${SESSION_ID}`)
  console.log(`⏱  Elapsed: ${transcript.elapsedMs}ms`)
  console.log(`🔧 Tool calls: ${toolResults.length}`)

  return { sessionId: SESSION_ID, status: transcript.status, file, elapsedMs: transcript.elapsedMs }
}

// ── Entry ────────────────────────────────────────────────────────────────────

runTurn()
  .then(result => {
    console.log('\n📊 Run metadata:', JSON.stringify(result, null, 2))
    process.exit(0)
  })
  .catch(e => {
    console.error('💥 Spike failed:', e.message)
    process.exit(1)
  })
