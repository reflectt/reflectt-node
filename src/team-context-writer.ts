// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Team Context Writer — auto-writes team facts to TEAM-CONTEXT.md
 *
 * Listens to key events (task completions, decisions, team roster changes)
 * and appends structured facts to TEAM-CONTEXT.md in the shared workspace.
 * All agents read this file via their workspace bootstrap, so facts
 * propagate automatically without manual injection.
 *
 * task-1774672289270-9qhb17cgk
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

// ── Types ──

export interface TeamFact {
  /** Section header (e.g., "Key Facts", "Decisions", "Priorities", "Team Roster") */
  section: string
  /** The fact content (markdown) */
  content: string
  /** ISO timestamp */
  timestamp: string
  /** Source agent or system */
  source: string
}

export interface TeamContextWriterDeps {
  /** Path to REFLECTT_HOME (e.g., ~/.reflectt) */
  reflecttHome: string
  /** Event bus for subscribing to events */
  eventBus: {
    on: (label: string, handler: (event: { id: string; type: string; timestamp: number; data: unknown }) => void) => void
  }
  /** Task manager for reading task details */
  taskManager: {
    getTask: (id: string) => { id: string; title: string; status: string; assignee?: string } | null
  }
}

// ── Constants ──

const TEAM_CONTEXT_FILENAME = 'TEAM-CONTEXT.md'
const MAX_FACTS_PER_SECTION = 30
const MAX_FILE_SIZE = 50_000 // 50KB cap to prevent unbounded growth

// ── Helpers ──

function getTeamContextPath(reflecttHome: string): string {
  return join(reflecttHome, 'workspace', TEAM_CONTEXT_FILENAME)
}

function ensureTeamContextFile(filePath: string): string {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true })
    const template = `# Team Context (Shared)

This file is automatically maintained by reflectt-node.
All agents read this file at the start of every task.

## Key Facts

## Decisions

## Priorities

## Completed Work

## Team Roster
`
    writeFileSync(filePath, template, 'utf-8')
    return template
  }
  return readFileSync(filePath, 'utf-8')
}

function appendToSection(content: string, section: string, entry: string): string {
  const sectionHeader = `## ${section}`
  const sectionIndex = content.indexOf(sectionHeader)
  if (sectionIndex === -1) {
    // Section doesn't exist — append it at the end
    return content.trimEnd() + `\n\n${sectionHeader}\n\n${entry}\n`
  }

  // Find the end of the section (next ## or end of file)
  const afterHeader = sectionIndex + sectionHeader.length
  const nextSectionIndex = content.indexOf('\n## ', afterHeader)
  const sectionEnd = nextSectionIndex === -1 ? content.length : nextSectionIndex

  // Extract existing section content
  const sectionContent = content.slice(afterHeader, sectionEnd)

  // Count existing entries (lines starting with "- ")
  const existingEntries = sectionContent.split('\n').filter(line => line.startsWith('- '))
  if (existingEntries.length >= MAX_FACTS_PER_SECTION) {
    // Remove oldest entry (first "- " line)
    const firstEntryIndex = sectionContent.indexOf('\n- ')
    if (firstEntryIndex !== -1) {
      const secondEntryIndex = sectionContent.indexOf('\n- ', firstEntryIndex + 1)
      if (secondEntryIndex !== -1) {
        // Remove first entry
        const trimmedSection = sectionContent.slice(0, firstEntryIndex) + sectionContent.slice(secondEntryIndex)
        return content.slice(0, afterHeader) + trimmedSection.trimEnd() + `\n${entry}\n` + content.slice(sectionEnd)
      }
    }
  }

  // Append entry at end of section
  const insertPoint = sectionEnd
  const before = content.slice(0, insertPoint).trimEnd()
  const after = content.slice(insertPoint)
  return `${before}\n${entry}\n${after}`
}

// ── Public API ──

export function writeTeamFact(reflecttHome: string, fact: TeamFact): void {
  const filePath = getTeamContextPath(reflecttHome)
  let content = ensureTeamContextFile(filePath)

  // Size guard
  if (content.length > MAX_FILE_SIZE) {
    // Truncate oldest entries from each section
    const sections = ['Key Facts', 'Completed Work', 'Decisions']
    for (const section of sections) {
      const header = `## ${section}`
      const idx = content.indexOf(header)
      if (idx === -1) continue
      const afterIdx = idx + header.length
      const nextIdx = content.indexOf('\n## ', afterIdx)
      const end = nextIdx === -1 ? content.length : nextIdx
      const sectionBody = content.slice(afterIdx, end)
      const lines = sectionBody.split('\n')
      // Keep only last half of entries
      const entryLines = lines.filter(l => l.startsWith('- '))
      if (entryLines.length > 10) {
        const keepFrom = Math.floor(entryLines.length / 2)
        const keepEntries = entryLines.slice(keepFrom)
        content = content.slice(0, afterIdx) + '\n\n' + keepEntries.join('\n') + '\n' + content.slice(end)
      }
    }
  }

  const entry = `- ${fact.content} _(${fact.source}, ${fact.timestamp.split('T')[0]})_`
  content = appendToSection(content, fact.section, entry)
  writeFileSync(filePath, content, 'utf-8')
}

/**
 * Also write to per-agent workspaces so cross-agent recall works.
 * Copies the shared TEAM-CONTEXT.md to each agent's workspace-{name}/ directory.
 */
export function syncTeamContextToAgents(reflecttHome: string): void {
  // Find all agent workspace directories
  let agentEntries: string[] = []
  try {
    agentEntries = readdirSync(reflecttHome).filter(e => e.startsWith('workspace-'))
  } catch { return }

  // Sync shared TEAM-CONTEXT.md to each agent workspace
  const sharedPath = getTeamContextPath(reflecttHome)
  if (existsSync(sharedPath)) {
    const content = readFileSync(sharedPath, 'utf-8')
    for (const entry of agentEntries) {
      const agentWsPath = join(reflecttHome, entry)
      try {
        if (!statSync(agentWsPath).isDirectory()) continue
        writeFileSync(join(agentWsPath, TEAM_CONTEXT_FILENAME), content, 'utf-8')
      } catch { /* skip inaccessible dirs */ }
    }
  }

  // Sync capability context to each agent workspace so agents see available capabilities
  const capContextPath = join(reflecttHome, 'capability-context.md')
  if (existsSync(capContextPath)) {
    const capContent = readFileSync(capContextPath, 'utf-8')
    for (const entry of agentEntries) {
      const agentWsPath = join(reflecttHome, entry)
      try {
        if (!statSync(agentWsPath).isDirectory()) continue
        writeFileSync(join(agentWsPath, 'capability-context.md'), capContent, 'utf-8')
      } catch { /* skip inaccessible dirs */ }
    }
  }
}

/**
 * Start listening for events and auto-writing team facts.
 */
export function startTeamContextWriter(deps: TeamContextWriterDeps): void {
  const { reflecttHome, eventBus, taskManager } = deps

  // Ensure file exists on startup
  const filePath = getTeamContextPath(reflecttHome)
  ensureTeamContextFile(filePath)

  // Listen for task state changes
  eventBus.on('team-context-task-writer', (event) => {
    if (event.type !== 'task_updated') return
    const data = event.data as Record<string, unknown>
    const status = data.status as string
    const taskId = data.taskId as string
    const previousStatus = data.previousStatus as string

    // Only capture completions (done) and key transitions
    if (status === 'done' && previousStatus !== 'done') {
      const task = taskManager.getTask(taskId)
      if (!task) return
      writeTeamFact(reflecttHome, {
        section: 'Completed Work',
        content: `**${task.title}** completed by ${task.assignee || 'unassigned'}`,
        timestamp: new Date(event.timestamp).toISOString(),
        source: task.assignee || 'system',
      })
      syncTeamContextToAgents(reflecttHome)
    }

    // Capture blocked tasks as priorities
    if (status === 'blocked' && previousStatus !== 'blocked') {
      const task = taskManager.getTask(taskId)
      if (!task) return
      writeTeamFact(reflecttHome, {
        section: 'Priorities',
        content: `**BLOCKED:** ${task.title} (${task.assignee || 'unassigned'})`,
        timestamp: new Date(event.timestamp).toISOString(),
        source: 'system',
      })
      syncTeamContextToAgents(reflecttHome)
    }
  })

  // Listen for team roster changes
  eventBus.on('team-context-roster-writer', (event) => {
    if (event.type !== 'agent_joined' && event.type !== 'agent_left') return
    const data = event.data as Record<string, unknown>
    const agentId = data.agentId as string
    const action = event.type === 'agent_joined' ? 'joined' : 'left'

    writeTeamFact(reflecttHome, {
      section: 'Team Roster',
      content: `**${agentId}** ${action} the team`,
      timestamp: new Date(event.timestamp).toISOString(),
      source: 'system',
    })
    syncTeamContextToAgents(reflecttHome)
  })

  // Listen for decisions (chat messages tagged as decisions)
  eventBus.on('team-context-decision-writer', (event) => {
    if (event.type !== 'decision_made') return
    const data = event.data as Record<string, unknown>
    const summary = data.summary as string
    const author = data.author as string

    writeTeamFact(reflecttHome, {
      section: 'Decisions',
      content: summary,
      timestamp: new Date(event.timestamp).toISOString(),
      source: author || 'team',
    })
    syncTeamContextToAgents(reflecttHome)
  })
}

/**
 * Expose an API endpoint for agents to write facts directly.
 * POST /team-context/facts { section, content, source? }
 */
export function teamContextFactEndpoint(reflecttHome: string) {
  return async (request: { body: unknown }, reply: { status: (code: number) => void }) => {
    const body = request.body as Record<string, unknown>
    const section = typeof body.section === 'string' ? body.section.trim() : ''
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    const source = typeof body.source === 'string' ? body.source.trim() : 'agent'

    if (!section || !content) {
      reply.status(400)
      return { success: false, error: 'section and content are required' }
    }

    writeTeamFact(reflecttHome, {
      section,
      content,
      timestamp: new Date().toISOString(),
      source,
    })
    syncTeamContextToAgents(reflecttHome)

    return { success: true, file: 'TEAM-CONTEXT.md', section }
  }
}
