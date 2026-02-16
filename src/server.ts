// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Fastify server with REST + WebSocket endpoints
 */
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
import { z } from 'zod'
import { createHash } from 'crypto'
import { promises as fs, existsSync, readFileSync, statSync } from 'fs'
import { resolve, sep, join } from 'path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { serverConfig, isDev, REFLECTT_HOME } from './config.js'
import { chatManager } from './chat.js'
import { taskManager } from './tasks.js'
import { inboxManager } from './inbox.js'
import type { AgentMessage, Task } from './types.js'
import { handleMCPRequest, handleSSERequest, handleMessagesRequest } from './mcp.js'
import { memoryManager } from './memory.js'
import { eventBus, VALID_EVENT_TYPES } from './events.js'
import { presenceManager } from './presence.js'
import { mentionAckTracker } from './mention-ack.js'
import type { PresenceStatus, FocusLevel } from './presence.js'
import { analyticsManager } from './analytics.js'
import { getDashboardHTML } from './dashboard.js'
import { healthMonitor } from './health.js'
import { contentManager } from './content.js'
import { experimentsManager } from './experiments.js'
import { releaseManager } from './release.js'
import { researchManager } from './research.js'
import { wsHeartbeat } from './ws-heartbeat.js'
import { getBuildInfo } from './buildInfo.js'
import { getAgentRoles, getAgentRolesSource, loadAgentRoles, startConfigWatch, suggestAssignee, checkWipCap } from './assignment.js'

// Schemas
const SendMessageSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  content: z.string().min(1),
  channel: z.string().optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).default('todo'),
  assignee: z.string().trim().min(1),
  reviewer: z.string().trim().min(1),
  done_criteria: z.array(z.string().trim().min(1)).min(1),
  eta: z.string().trim().min(1),
  createdBy: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  done_criteria: z.array(z.string().min(1)).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  actor: z.string().trim().min(1).optional(),
})

const CreateTaskCommentSchema = z.object({
  author: z.string().trim().min(1),
  content: z.string().trim().min(1),
})

const TaskOutcomeBodySchema = z.object({
  verdict: z.enum(['PASS', 'NO-CHANGE', 'REGRESSION']),
  author: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
})

const ReviewBundleBodySchema = z.object({
  author: z.string().trim().min(1).optional(),
  strict: z.boolean().optional(),
})

const TaskReviewDecisionSchema = z.object({
  reviewer: z.string().trim().min(1),
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().min(1),
})

const RecurringTaskScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('weekly'),
    dayOfWeek: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
  }),
  z.object({
    kind: z.literal('interval'),
    everyMs: z.number().int().min(60_000),
    anchorAt: z.number().int().positive().optional(),
  }),
])

const CreateRecurringTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignee: z.string().trim().min(1),
  reviewer: z.string().trim().min(1),
  done_criteria: z.array(z.string().trim().min(1)).min(1),
  eta: z.string().trim().min(1),
  createdBy: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  schedule: RecurringTaskScheduleSchema,
  enabled: z.boolean().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).optional(),
})

const UpdateRecurringTaskSchema = z.object({
  enabled: z.boolean().optional(),
  schedule: RecurringTaskScheduleSchema.optional(),
}).refine((value) => value.enabled !== undefined || value.schedule !== undefined, {
  message: 'At least one of enabled or schedule is required',
  path: [],
})

const CreateExperimentSchema = z.object({
  name: z.string().trim().min(1),
  hypothesis: z.string().trim().min(1),
  type: z.enum(['fake-door', 'pricing', 'messaging', 'onboarding', 'activation', 'retention', 'other']),
  owner: z.string().trim().min(1),
  status: z.enum(['planned', 'active', 'paused', 'completed', 'canceled']),
  startAt: z.number().int().positive().optional(),
  endAt: z.number().int().positive().nullable().optional(),
  metricPrimary: z.string().trim().min(1),
  metricGuardrail: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional(),
})

const MarkDeploySchema = z.object({
  deployedBy: z.string().trim().min(1).optional(),
  note: z.string().trim().min(1).optional(),
})

const CreateResearchRequestSchema = z.object({
  title: z.string().trim().min(1),
  question: z.string().trim().min(1),
  requestedBy: z.string().trim().min(1),
  owner: z.string().trim().min(1).optional(),
  category: z.enum(['market', 'competitor', 'customer', 'other']).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  status: z.enum(['open', 'in_progress', 'answered', 'archived']).optional(),
  taskId: z.string().trim().min(1).optional(),
  dueAt: z.number().int().positive().optional(),
  slaHours: z.number().int().positive().max(24 * 30).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const CreateResearchFindingSchema = z.object({
  requestId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  author: z.string().trim().min(1),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  artifactUrl: z.string().trim().url().optional(),
  highlights: z.array(z.string().trim().min(1)).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const CreateResearchHandoffSchema = z.object({
  requestId: z.string().trim().min(1),
  findingIds: z.array(z.string().trim().min(1)).min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  assignee: z.string().trim().min(1),
  reviewer: z.string().trim().min(1),
  eta: z.string().trim().min(1),
  createdBy: z.string().trim().min(1).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  done_criteria: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  artifactUrl: z.string().trim().url().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const QaBundleSchema = z.object({
  summary: z.string().trim().min(1),
  artifact_links: z.array(z.string().trim().min(1)).min(1),
  checks: z.array(z.string().trim().min(1)).min(1),
  reviewer_notes: z.string().trim().min(1).optional(),
})

const ChatMessagesQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  channel: z.string().optional(),
  limit: z.string().optional(),
  since: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
})

const ChatSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.string().optional(),
})

const MessageReactionBodySchema = z.object({
  emoji: z.string().trim().min(1),
  from: z.string().trim().min(1),
})

const EditMessageBodySchema = z.object({
  from: z.string().trim().min(1),
  content: z.string().trim().min(1),
})

const DeleteMessageBodySchema = z.object({
  from: z.string().trim().min(1),
})

const InboxQuerySchema = z.object({
  priority: z.enum(['high', 'medium', 'low']).optional(),
  limit: z.string().optional(),
  since: z.string().optional(),
})

const InboxAckBodySchema = z.object({
  messageIds: z.array(z.string().trim().min(1)).optional(),
  all: z.boolean().optional(),
  timestamp: z.number().int().optional(),
})

const InboxSubscribeBodySchema = z.object({
  channels: z.array(z.string().trim().min(1)).min(1),
})

const MentionAckRecentQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
})

const HealthTickQuerySchema = z.object({
  dryRun: z.enum(['true', 'false']).optional(),
  force: z.enum(['true', 'false']).optional(),
  nowMs: z.string().regex(/^\d+$/).optional(),
})

const HealthHistoryQuerySchema = z.object({
  days: z.string().regex(/^\d+$/).optional(),
})

const LogsQuerySchema = z.object({
  level: z.string().optional(),
  since: z.string().regex(/^\d+$/).optional(),
})

const ReleaseNotesQuerySchema = z.object({
  since: z.string().regex(/^\d+$/).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
})

const ReleaseDiffQuerySchema = z.object({
  from: z.string().regex(/^[a-fA-F0-9]{7,40}$/).optional(),
  to: z.string().regex(/^[a-fA-F0-9]{7,40}$/).optional(),
  commitLimit: z.string().regex(/^\d+$/).optional(),
})

const MetricsDailyQuerySchema = z.object({
  timezone: z.string().optional(),
})

function enforceQaBundleGateForValidating(
  status: Task['status'] | undefined,
  metadata: unknown,
): { ok: true } | { ok: false; error: string; hint: string } {
  if (status !== 'validating') return { ok: true }

  const parsed = z
    .object({
      qa_bundle: QaBundleSchema,
    })
    .safeParse(metadata ?? {})

  if (!parsed.success) {
    return {
      ok: false,
      error: 'QA bundle required: PATCH to status=validating must include metadata.qa_bundle { summary, artifact_links[], checks[] }',
      hint: 'Example: { "status":"validating", "metadata": { "artifact_path":"...", "qa_bundle": { "summary":"what changed", "artifact_links": ["PR/link"], "checks": ["npm run build"] } } }',
    }
  }

  return { ok: true }
}

const DEFAULT_LIMITS = {
  chatMessages: 50,
  chatSearch: 25,
  inbox: 30,
  unreadMentions: 20,
  activity: 60,
  tasks: 50,
  contentCalendar: 50,
  contentPublished: 50,
} as const

const MAX_LIMITS = {
  chatMessages: 200,
  chatSearch: 100,
  inbox: 100,
  unreadMentions: 100,
  activity: 200,
  tasks: 200,
  contentCalendar: 200,
  contentPublished: 200,
  inboxScanMessages: 150,
  unreadScanMessages: 300,
} as const

const OUTCOME_CHECK_DELAY_MS = 48 * 60 * 60 * 1000

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function parseEpochMs(value: string | undefined): number | undefined {
  const parsed = parsePositiveInt(value)
  return parsed
}

function boundedLimit(
  value: string | undefined,
  defaultsTo: number,
  max: number,
): number {
  const parsed = parsePositiveInt(value)
  if (!parsed) return defaultsTo
  return Math.min(parsed, max)
}

function generateWeakETag(payload: unknown): string {
  const body = JSON.stringify(payload)
  const digest = createHash('sha1').update(body).digest('base64url')
  return `W/"${digest}"`
}

function applyConditionalCaching(
  request: FastifyRequest,
  reply: any,
  payload: unknown,
  lastModifiedMs?: number,
): boolean {
  const etag = generateWeakETag(payload)
  reply.header('ETag', etag)
  reply.header('Cache-Control', 'private, max-age=0, must-revalidate')

  if (lastModifiedMs) {
    reply.header('Last-Modified', new Date(lastModifiedMs).toUTCString())
  }

  const ifNoneMatch = request.headers['if-none-match']
  if (ifNoneMatch && ifNoneMatch === etag) {
    reply.code(304).send()
    return true
  }

  const ifModifiedSince = request.headers['if-modified-since']
  if (lastModifiedMs && ifModifiedSince) {
    const sinceMs = Date.parse(ifModifiedSince)
    if (!Number.isNaN(sinceMs) && lastModifiedMs <= sinceMs) {
      reply.code(304).send()
      return true
    }
  }

  return false
}

type ValidationField = { path: string; message: string }

function parseValidationFieldsFromUnknown(input: unknown): ValidationField[] {
  const list = Array.isArray(input)
    ? input
    : (input && typeof input === 'object' && Array.isArray((input as any).issues) ? (input as any).issues : [])

  return list
    .map((issue: any) => {
      if (!issue || typeof issue !== 'object') return null
      const pathRaw = issue.path
      const path = Array.isArray(pathRaw)
        ? pathRaw.map((p: unknown) => String(p)).join('.') || '(root)'
        : (typeof pathRaw === 'string' && pathRaw.length > 0 ? pathRaw : '(root)')
      const message = typeof issue.message === 'string' && issue.message.length > 0
        ? issue.message
        : 'Invalid value'
      return { path, message }
    })
    .filter((row: ValidationField | null): row is ValidationField => Boolean(row))
}

function extractValidationFields(errorText: string): ValidationField[] {
  // Zod parse() errors are often serialized as JSON arrays in err.message.
  if (errorText.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(errorText)
      return parseValidationFieldsFromUnknown(parsed)
    } catch {
      return []
    }
  }
  return []
}

function extractPrUrlFromTask(task: Task): string | undefined {
  const links = new Set<string>()
  const metadata = (task.metadata || {}) as Record<string, unknown>

  const artifactPath = metadata.artifact_path
  if (typeof artifactPath === 'string') links.add(artifactPath)

  const artifacts = metadata.artifacts
  if (Array.isArray(artifacts)) {
    for (const item of artifacts) {
      if (typeof item === 'string') links.add(item)
    }
  }

  const qaBundle = metadata.qa_bundle as Record<string, unknown> | undefined
  const qaLinks = qaBundle?.artifact_links
  if (Array.isArray(qaLinks)) {
    for (const item of qaLinks) {
      if (typeof item === 'string') links.add(item)
    }
  }

  for (const link of links) {
    if (/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(link)) {
      return link
    }
  }

  return undefined
}

function extractArtifactPathsFromTask(task: Task): string[] {
  const metadata = (task.metadata || {}) as Record<string, unknown>
  const out = new Set<string>()

  const addIfPath = (value: unknown) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.startsWith('process/')) out.add(trimmed)
  }

  addIfPath(metadata.artifact_path)

  const artifacts = metadata.artifacts
  if (Array.isArray(artifacts)) {
    for (const item of artifacts) addIfPath(item)
  }

  const qaBundle = metadata.qa_bundle as Record<string, unknown> | undefined
  const qaLinks = qaBundle?.artifact_links
  if (Array.isArray(qaLinks)) {
    for (const item of qaLinks) addIfPath(item)
  }

  return Array.from(out)
}

function parseGitHubPrUrl(prUrl: string): { owner: string; repo: string; pullNumber: number } | null {
  const match = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:$|[/?#])/i)
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    pullNumber: Number.parseInt(match[3], 10),
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveArtifactEvidence(paths: string[]): Promise<Array<{ path: string; absolutePath: string; exists: boolean }>> {
  const processRoot = resolve(process.cwd(), 'process')
  const results: Array<{ path: string; absolutePath: string; exists: boolean }> = []

  for (const relPath of paths) {
    const absolutePath = resolve(process.cwd(), relPath)
    const inProcessDir = absolutePath === processRoot || absolutePath.startsWith(processRoot + sep)
    const exists = inProcessDir ? await fileExists(absolutePath) : false
    results.push({ path: relPath, absolutePath, exists })
  }

  return results
}

async function resolvePrAndCi(prUrl: string): Promise<{
  pr: {
    url: string
    owner: string
    repo: string
    pullNumber: number
    state?: string
    merged?: boolean
    headSha?: string
  } | null
  ci: {
    state: 'success' | 'failure' | 'pending' | 'error' | 'unknown'
    source: 'github-status' | 'unavailable'
    details?: string
  }
}> {
  const parsed = parseGitHubPrUrl(prUrl)
  if (!parsed) {
    return {
      pr: null,
      ci: {
        state: 'unknown',
        source: 'unavailable',
        details: 'Invalid PR URL format',
      },
    }
  }

  try {
    const prRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })

    if (!prRes.ok) {
      return {
        pr: {
          url: prUrl,
          owner: parsed.owner,
          repo: parsed.repo,
          pullNumber: parsed.pullNumber,
        },
        ci: {
          state: 'unknown',
          source: 'unavailable',
          details: `GitHub PR lookup failed (${prRes.status})`,
        },
      }
    }

    const prJson = await prRes.json() as any
    const headSha = typeof prJson?.head?.sha === 'string' ? prJson.head.sha : undefined

    let ci: { state: 'success' | 'failure' | 'pending' | 'error' | 'unknown'; source: 'github-status' | 'unavailable'; details?: string } = {
      state: 'unknown',
      source: 'unavailable',
      details: 'No commit SHA resolved',
    }

    if (headSha) {
      const statusRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${headSha}/status`, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (statusRes.ok) {
        const statusJson = await statusRes.json() as any
        const state = (statusJson?.state || 'unknown') as 'success' | 'failure' | 'pending' | 'error' | 'unknown'
        ci = {
          state,
          source: 'github-status',
        }
      } else {
        ci = {
          state: 'unknown',
          source: 'unavailable',
          details: `GitHub status lookup failed (${statusRes.status})`,
        }
      }
    }

    return {
      pr: {
        url: prUrl,
        owner: parsed.owner,
        repo: parsed.repo,
        pullNumber: parsed.pullNumber,
        state: prJson?.state,
        merged: Boolean(prJson?.merged_at),
        headSha,
      },
      ci,
    }
  } catch (err: any) {
    return {
      pr: {
        url: prUrl,
        owner: parsed.owner,
        repo: parsed.repo,
        pullNumber: parsed.pullNumber,
      },
      ci: {
        state: 'unknown',
        source: 'unavailable',
        details: err?.message || 'PR/CI lookup failed',
      },
    }
  }
}

type MentionWarning = {
  mention: string
  reason: 'unknown_agent' | 'offline_agent'
  message: string
}

function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+)/g) || []
  return Array.from(new Set(matches.map(token => token.slice(1).toLowerCase()).filter(Boolean)))
}

function buildMentionWarnings(content: string): MentionWarning[] {
  const mentions = extractMentions(content)
  if (mentions.length === 0) return []

  const presenceByAgent = new Map(
    presenceManager
      .getAllPresence()
      .map((row) => [String(row.agent || '').toLowerCase(), row.status] as const)
      .filter(([agent]) => Boolean(agent)),
  )

  const warnings: MentionWarning[] = []
  for (const mention of mentions) {
    const status = presenceByAgent.get(mention)
    if (!status) {
      warnings.push({
        mention,
        reason: 'unknown_agent',
        message: `@${mention} is not in the presence roster`,
      })
      continue
    }

    if (status === 'offline') {
      warnings.push({
        mention,
        reason: 'offline_agent',
        message: `@${mention} is currently offline`,
      })
    }
  }

  return warnings
}

function inferErrorStatus(errorText: string): number {
  const text = errorText.toLowerCase()
  if (text.includes('not found')) return 404
  if (text.includes('forbidden') || text.includes('not allowed')) return 403
  if (text.includes('unauthorized')) return 401
  if (text.includes('conflict') || text.includes('already')) return 409
  if (text.includes('invalid') || text.includes('required') || text.includes('must') || text.includes('failed to parse')) return 400
  return 500
}

function inferErrorCode(status: number): string {
  if (status >= 500) return 'INTERNAL_ERROR'
  if (status === 404) return 'NOT_FOUND'
  if (status === 403) return 'FORBIDDEN'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 409) return 'CONFLICT'
  return 'BAD_REQUEST'
}

function defaultHintForStatus(status: number): string | undefined {
  if (status >= 400 && status < 500) {
    return 'Check required fields and request format in /docs.'
  }
  return undefined
}

const QUIET_HOURS_ENABLED = process.env.WATCHDOG_QUIET_HOURS_ENABLED !== 'false'
const QUIET_HOURS_START_HOUR = Number(process.env.WATCHDOG_QUIET_HOURS_START_HOUR || 23)
const QUIET_HOURS_END_HOUR = Number(process.env.WATCHDOG_QUIET_HOURS_END_HOUR || 8)
const QUIET_HOURS_TZ = process.env.WATCHDOG_QUIET_HOURS_TZ || 'America/Vancouver'

function getHourInTimezone(nowMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  })
  const part = formatter.formatToParts(new Date(nowMs)).find(p => p.type === 'hour')
  const hour = Number(part?.value ?? '0')
  return Number.isFinite(hour) ? hour : 0
}

function isQuietHours(nowMs: number): boolean {
  if (!QUIET_HOURS_ENABLED) return false

  const start = Math.max(0, Math.min(23, QUIET_HOURS_START_HOUR))
  const end = Math.max(0, Math.min(23, QUIET_HOURS_END_HOUR))
  const hour = getHourInTimezone(nowMs, QUIET_HOURS_TZ)

  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isDev ? {
      transport: {
        target: 'pino-pretty',
      }
    } : true,
  })

  // Register plugins
  await app.register(fastifyCors, {
    origin: serverConfig.corsEnabled ? true : false,
  })

  await app.register(fastifyWebsocket)

  // Normalize error responses to a consistent envelope
  app.addHook('preSerialization', async (_request, reply, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload
    }

    const body = payload as Record<string, unknown>
    const hasError = typeof body.error === 'string'
    const alreadyEnvelope = typeof body.success === 'boolean' && hasError
    if (!hasError) return payload

    let status = Number(body.status)
    if (!Number.isFinite(status) || status <= 0) {
      status = reply.statusCode >= 400 ? reply.statusCode : inferErrorStatus(String(body.error))
    }

    if (reply.statusCode < 400) {
      reply.code(status)
    }

    const code = typeof body.code === 'string' && body.code.trim().length > 0
      ? body.code
      : inferErrorCode(status)
    const hint = typeof body.hint === 'string' && body.hint.trim().length > 0
      ? body.hint
      : defaultHintForStatus(status)

    const parsedFields = extractValidationFields(String(body.error))

    const envelope: Record<string, unknown> = {
      success: false,
      error: parsedFields.length > 0 ? 'Validation failed' : body.error,
      code,
      status,
    }

    if (hint) envelope.hint = hint
    if (parsedFields.length > 0) {
      envelope.fields = parsedFields
    }
    if (body.details !== undefined) envelope.details = body.details
    if (body.gate !== undefined) envelope.gate = body.gate
    if (alreadyEnvelope && body.data !== undefined) envelope.data = body.data

    return envelope
  })

  // Request tracking middleware for system health monitoring
  app.addHook('onRequest', async (request) => {
    ;(request as any).startTime = Date.now()
  })

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - ((request as any).startTime || Date.now())
    healthMonitor.trackRequest(duration)
    
    if (reply.statusCode >= 400) {
      healthMonitor.trackError()
    }
  })

  // Periodic health snapshot (every request, but throttled internally)
  app.addHook('onResponse', async () => {
    await healthMonitor.recordSnapshot().catch(() => {}) // Silent fail
  })

  // Load agent roles from YAML config (or fall back to built-in defaults)
  loadAgentRoles()
  startConfigWatch()

  // System idle nudge watchdog (process-in-code guardrail)
  const idleNudgeTimer = setInterval(() => {
    if (isQuietHours(Date.now())) return
    healthMonitor.runIdleNudgeTick().catch(() => {})
  }, 60 * 1000)
  idleNudgeTimer.unref()

  // Collaboration cadence watchdog (trio silence + stale working alerts)
  const cadenceWatchdogTimer = setInterval(() => {
    if (isQuietHours(Date.now())) return
    healthMonitor.runCadenceWatchdogTick().catch(() => {})
  }, 60 * 1000)
  cadenceWatchdogTimer.unref()

  // Mention rescue fallback (if Ryan mentions trio and no response arrives)
  const mentionRescueTimer = setInterval(() => {
    if (isQuietHours(Date.now())) return
    healthMonitor.runMentionRescueTick().catch(() => {})
  }, 30 * 1000)
  mentionRescueTimer.unref()

  app.addHook('onClose', async () => {
    clearInterval(idleNudgeTimer)
    clearInterval(cadenceWatchdogTimer)
    clearInterval(mentionRescueTimer)
    wsHeartbeat.stop()
  })

  // Health check
  app.get('/health', async () => {
    return {
      status: 'ok',
      openclaw: 'not configured',
      chat: chatManager.getStats(),
      tasks: taskManager.getStats(),
      inbox: inboxManager.getStats(),
      timestamp: Date.now(),
    }
  })

  // Team health monitoring
  app.get('/health/team', async (request, reply) => {
    const health = await healthMonitor.getHealth()
    if (applyConditionalCaching(request, reply, health, health.timestamp)) {
      return
    }
    return health
  })

  // Per-agent structured health summary (dashboard v2)
  app.get('/health/agents', async (request, reply) => {
    const payload = await healthMonitor.getAgentHealthSummary()
    if (applyConditionalCaching(request, reply, payload, payload.timestamp)) {
      return
    }
    return payload
  })

  // Unified per-agent workflow state (task + PR + artifact + blocker)
  app.get('/health/workflow', async (request, reply) => {
    const now = Date.now()
    const tasks = taskManager.listTasks({})
    const messages = chatManager.getMessages({ limit: 500 })
    const presences = presenceManager.getAllPresence()

    const agents = Array.from(new Set([
      ...presences.map(p => (p.agent || '').toLowerCase()).filter(Boolean),
      ...tasks.map(t => (t.assignee || '').toLowerCase()).filter(Boolean),
      ...messages.map((m: any) => (m.from || '').toLowerCase()).filter(Boolean),
    ])).sort()

    const rows = agents.map((agent) => {
      const doingTasks = tasks
        .filter(t => (t.assignee || '').toLowerCase() === agent && t.status === 'doing')
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      const doingTask = doingTasks[0] || null
      const doingTaskAgeMs = doingTask ? Math.max(0, now - Number(doingTask.updatedAt || doingTask.createdAt || now)) : null

      const agentMessages = messages
        .filter((m: any) => (m.from || '').toLowerCase() === agent)
        .sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0))

      const shippedMsg = agentMessages.find((m: any) => {
        const c = String(m.content || '')
        return /\bshipped\b/i.test(c)
      })
      const lastShippedAt = shippedMsg ? Number(shippedMsg.timestamp || 0) : null

      const blockerMsg = agentMessages.find((m: any) => {
        const c = String(m.content || '')
        return /\bblocker\b/i.test(c)
      })
      const blockerText = blockerMsg ? String(blockerMsg.content || '') : null
      const blockerActive = blockerText ? !/blocker\s*:\s*none/i.test(blockerText) : false

      const taskMeta = doingTask?.metadata as Record<string, unknown> | undefined
      const artifacts = Array.isArray(taskMeta?.artifacts) ? taskMeta?.artifacts as unknown[] : []
      const artifactPath = typeof taskMeta?.artifact_path === 'string' ? taskMeta.artifact_path : null

      const prCandidate = [
        typeof taskMeta?.pr === 'string' ? taskMeta.pr : null,
        typeof taskMeta?.pr_url === 'string' ? taskMeta.pr_url : null,
        ...artifacts.map(a => typeof a === 'string' ? a : null),
      ].find((s): s is string => !!s && /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(s)) || null

      const prState = prCandidate ? 'linked' : 'none'

      return {
        agent,
        doingTaskId: doingTask?.id || null,
        doingTaskAgeMs,
        lastShippedAt,
        blockerActive,
        blockerText,
        artifactPath,
        pr: prCandidate,
        prState,
      }
    })

    const payload = {
      agents: rows,
      timestamp: now,
    }

    if (applyConditionalCaching(request, reply, payload, payload.timestamp)) {
      return
    }
    return payload
  })

  // Team health compliance payload (dashboard panel)
  app.get('/health/compliance', async (request, reply) => {
    const compliance = await healthMonitor.getCollaborationCompliance()
    const mentionAck = mentionAckTracker.getMetrics()
    const payload = { compliance, mentionAck, timestamp: Date.now() }
    if (applyConditionalCaching(request, reply, payload, payload.timestamp)) {
      return
    }
    return payload
  })

  // Mention ack metrics
  app.get('/health/mention-ack', async () => {
    return mentionAckTracker.getMetrics()
  })

  // Mention ack recent entries (debug)
  app.get('/health/mention-ack/recent', async (request, reply) => {
    const parsedQuery = MentionAckRecentQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const limit = Math.min(parseInt(parsedQuery.data.limit || '20', 10), 100)
    return { entries: mentionAckTracker.getRecent(limit) }
  })

  // Mention ack pending for specific agent
  app.get<{ Params: { agent: string } }>('/health/mention-ack/:agent', async (request) => {
    const pending = mentionAckTracker.getPending(request.params.agent)
    return { agent: request.params.agent, pending, count: pending.length }
  })

  // Mention ack timeout check (trigger manually or via cron)
  app.post('/health/mention-ack/check-timeouts', async () => {
    const timedOut = mentionAckTracker.checkTimeouts()
    return {
      timedOut: timedOut.map(t => ({
        agent: t.agent,
        mentionedBy: t.entry.mentionedBy,
        messageId: t.entry.messageId,
        channel: t.entry.channel,
        waitedMs: Date.now() - t.entry.createdAt,
      })),
      count: timedOut.length,
    }
  })

  // Idle-nudge debug surface (deterministic proof support)
  app.get('/health/idle-nudge/debug', async () => {
    return healthMonitor.getIdleNudgeDebug()
  })

  // One-shot idle-nudge tick (dry-run and real modes)
  app.post('/health/idle-nudge/tick', async (request, reply) => {
    const parsedQuery = HealthTickQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const query = parsedQuery.data
    const dryRun = query.dryRun === 'true'
    const force = query.force === 'true'
    const now = parseEpochMs(query.nowMs) || Date.now()

    if (!force && isQuietHours(now)) {
      return {
        success: true,
        dryRun,
        force,
        suppressed: true,
        reason: 'quiet-hours',
        quietHours: {
          enabled: QUIET_HOURS_ENABLED,
          startHour: QUIET_HOURS_START_HOUR,
          endHour: QUIET_HOURS_END_HOUR,
          tz: QUIET_HOURS_TZ,
        },
        nudged: [],
        decisions: [],
        timestamp: now,
      }
    }

    const result = await healthMonitor.runIdleNudgeTick(now, { dryRun })
    return {
      success: true,
      dryRun,
      force,
      suppressed: false,
      ...result,
      timestamp: now,
    }
  })

  // One-shot cadence-watchdog tick (dry-run and real modes)
  app.post('/health/cadence-watchdog/tick', async (request, reply) => {
    const parsedQuery = HealthTickQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const query = parsedQuery.data
    const dryRun = query.dryRun === 'true'
    const force = query.force === 'true'
    const now = parseEpochMs(query.nowMs) || Date.now()

    if (!force && isQuietHours(now)) {
      return {
        success: true,
        dryRun,
        force,
        suppressed: true,
        reason: 'quiet-hours',
        quietHours: {
          enabled: QUIET_HOURS_ENABLED,
          startHour: QUIET_HOURS_START_HOUR,
          endHour: QUIET_HOURS_END_HOUR,
          tz: QUIET_HOURS_TZ,
        },
        alerts: [],
        timestamp: now,
      }
    }

    const result = await healthMonitor.runCadenceWatchdogTick(now, { dryRun })
    return {
      success: true,
      dryRun,
      force,
      suppressed: false,
      ...result,
      timestamp: now,
    }
  })

  // One-shot mention-rescue tick (dry-run and real modes)
  app.post('/health/mention-rescue/tick', async (request, reply) => {
    const parsedQuery = HealthTickQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const query = parsedQuery.data
    const dryRun = query.dryRun === 'true'
    const force = query.force === 'true'
    const now = parseEpochMs(query.nowMs) || Date.now()

    if (!force && isQuietHours(now)) {
      return {
        success: true,
        dryRun,
        force,
        suppressed: true,
        reason: 'quiet-hours',
        quietHours: {
          enabled: QUIET_HOURS_ENABLED,
          startHour: QUIET_HOURS_START_HOUR,
          endHour: QUIET_HOURS_END_HOUR,
          tz: QUIET_HOURS_TZ,
        },
        rescued: [],
        timestamp: now,
      }
    }

    const result = await healthMonitor.runMentionRescueTick(now, { dryRun })
    return {
      success: true,
      dryRun,
      force,
      suppressed: false,
      ...result,
      timestamp: now,
    }
  })

  // Team health summary (quick view)
  app.get('/health/team/summary', async (request, reply) => {
    const summary = await healthMonitor.getSummary()
    const payload = { summary }
    const cacheBucketMs = Math.floor(Date.now() / 30000) * 30000 // 30s cache bucket
    if (applyConditionalCaching(request, reply, payload, cacheBucketMs)) {
      return
    }
    return payload
  })

  // Team health history (trends over time)
  app.get('/health/team/history', async (request, reply) => {
    const parsedQuery = HealthHistoryQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const days = parsedQuery.data.days ? parseInt(parsedQuery.data.days, 10) : 7
    const history = healthMonitor.getHealthHistory(days)
    return { history, count: history.length, days }
  })

  // System health (uptime, performance, errors)
  app.get('/health/system', async () => {
    return healthMonitor.getSystemHealth()
  })

  // Build info — git SHA, branch, PID, uptime
  app.get('/health/build', async () => {
    return getBuildInfo()
  })

  // Deploy identity — version + SHA + build timestamp for attestation workflows
  app.get('/health/deploy', async () => {
    const build = getBuildInfo()
    return {
      version: build.appVersion,
      gitSha: build.gitSha,
      gitShortSha: build.gitShortSha,
      branch: build.gitBranch,
      buildTimestamp: build.buildTimestamp,
      startedAt: build.startedAt,
      startedAtMs: build.startedAtMs,
      pid: build.pid,
      nodeVersion: build.nodeVersion,
      uptime: build.uptime,
    }
  })

  // Error logs (for debugging)
  app.get('/logs', async (request, reply) => {
    const parsedQuery = LogsQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const level = parsedQuery.data.level || 'error'
    const since = parsedQuery.data.since ? parseInt(parsedQuery.data.since, 10) : Date.now() - (24 * 60 * 60 * 1000)

    // For now, return empty array with note
    // In production, this would read from actual log files
    return {
      logs: [],
      message: 'Log storage not implemented yet. Use system logs or monitoring service.',
      level,
      since,
    }
  })

  // ============ RELEASE / DEPLOY ENDPOINTS ============

  app.get('/release/status', async () => {
    return releaseManager.getDeployStatus()
  })

  app.get('/release/notes', async (request, reply) => {
    const parsedQuery = ReleaseNotesQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const query = parsedQuery.data
    const since = parseEpochMs(query.since)
    const limit = boundedLimit(query.limit, 25, 200)
    const notes = await releaseManager.getReleaseNotes({ since, limit })
    return notes
  })

  app.get('/release/diff', async (request, reply) => {
    const parsedQuery = ReleaseDiffQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const query = parsedQuery.data
    return releaseManager.getReleaseDiff({
      from: query.from,
      to: query.to,
      commitLimit: boundedLimit(query.commitLimit, 100, 500),
    })
  })

  app.post('/release/deploy', async (request) => {
    try {
      const data = MarkDeploySchema.parse(request.body || {})
      const marker = await releaseManager.markDeploy(data.deployedBy, data.note)
      return { success: true, marker }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to mark deploy' }
    }
  })

  // ============ DASHBOARD ============

  app.get('/dashboard', async (_request, reply) => {
    reply.type('text/html').send(getDashboardHTML())
  })

  // API docs page (markdown — token-efficient for agents)
  app.get('/docs', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const md = await fs.readFile(join(__dirname, '..', 'public', 'docs.md'), 'utf-8')
      reply.type('text/plain; charset=utf-8').send(md)
    } catch (err) {
      reply.code(500).send({ error: 'Failed to load docs' })
    }
  })

  // Serve avatar images
  app.get<{ Params: { filename: string } }>('/avatars/:filename', async (request, reply) => {
    const { filename } = request.params
    // Basic security: only allow .png files with alphanumeric names
    if (!/^[a-z]+\.png$/.test(filename)) {
      return reply.code(404).send({ error: 'Not found' })
    }
    
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const publicDir = join(__dirname, '..', 'public', 'avatars')
      const filePath = join(publicDir, filename)
      
      const data = await fs.readFile(filePath)
      reply.type('image/png').send(data)
    } catch (err) {
      reply.code(404).send({ error: 'Avatar not found' })
    }
  })

  // Serve dashboard JS (extracted from inline template)
  app.get('/dashboard.js', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')

      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const publicDir = join(__dirname, '..', 'public')
      const filePath = join(publicDir, 'dashboard.js')

      const data = await fs.readFile(filePath, 'utf-8')
      reply.type('application/javascript').send(data)
    } catch (err) {
      reply.code(404).send({ error: 'Dashboard JS not found' })
    }
  })

  // Serve dashboard animations CSS
  app.get('/dashboard-animations.css', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const publicDir = join(__dirname, '..', 'public')
      const filePath = join(publicDir, 'dashboard-animations.css')
      
      const data = await fs.readFile(filePath, 'utf-8')
      reply.type('text/css').send(data)
    } catch (err) {
      reply.code(404).send({ error: 'Animations CSS not found' })
    }
  })

  // ============ CHAT ENDPOINTS ============

  // WebSocket for real-time chat (with ping/pong heartbeat)
  app.get('/chat/ws', { websocket: true }, (socket: WebSocket) => {
    // Subscribe to new messages
    const unsubscribe = chatManager.subscribe((message: AgentMessage) => {
      if (socket.readyState === socket.OPEN) {
        try {
          socket.send(JSON.stringify({
            type: 'message',
            message,
          }))
        } catch (err) {
          console.error('[Server] WS send error:', err)
        }
      }
    })

    // Track connection with heartbeat manager (handles ping/pong + cleanup)
    const connId = wsHeartbeat.track(socket, unsubscribe)

    // Send existing messages
    const messages = chatManager.getMessages({ limit: 50 })
    socket.send(JSON.stringify({
      type: 'history',
      messages,
    }))

    console.log(`[Server] New WebSocket connection ${connId}`)
  })

  // WebSocket heartbeat stats
  app.get('/ws/stats', async () => {
    return wsHeartbeat.getStats()
  })

  // Send message
  app.post('/chat/messages', async (request) => {
    const data = SendMessageSchema.parse(request.body)
    const message = await chatManager.sendMessage(data)
    const warnings = buildMentionWarnings(data.content)

    // Auto-update presence: if you're posting, you're active
    if (data.from) {
      presenceManager.recordActivity(data.from, 'message')
      presenceManager.updatePresence(data.from, 'working')
    }

    // Track mention ack lifecycle
    if (message.id && data.from && data.content) {
      mentionAckTracker.recordMessage({
        id: message.id,
        from: data.from,
        content: data.content,
        channel: data.channel || 'general',
        timestamp: message.timestamp,
      })
    }

    // Fire-and-forget: index chat message for semantic search
    if (message.id && data.content && data.content.trim().length >= 10) {
      import('./vector-store.js')
        .then(({ indexChatMessage }) => indexChatMessage(message.id, data.content))
        .catch(() => {})
    }

    return {
      success: true,
      message,
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  })

  // Get messages
  app.get('/chat/messages', async (request, reply) => {
    const parsedQuery = ChatMessagesQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }
    const query = parsedQuery.data
    const messages = chatManager.getMessages({
      from: query.from,
      to: query.to,
      channel: query.channel,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.chatMessages, MAX_LIMITS.chatMessages),
      since: parseEpochMs(query.since),
      before: parseEpochMs(query.before),
      after: parseEpochMs(query.after),
    })
    const payload = { messages }
    const lastModified = messages.length > 0 ? Math.max(...messages.map(m => m.timestamp || 0)) : undefined
    if (applyConditionalCaching(request, reply, payload, lastModified)) {
      return
    }
    return payload
  })

  // Edit message (author only)
  app.patch<{ Params: { id: string } }>('/chat/messages/:id', async (request, reply) => {
    const parsedBody = EditMessageBodySchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      reply.code(400)
      return {
        error: 'Invalid body: from and content are required',
        details: parsedBody.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const body = parsedBody.data
    const result = await chatManager.editMessage(request.params.id, body.from, body.content)

    if (!result.ok) {
      if (result.error === 'not_found') {
        reply.code(404)
        return { error: 'Message not found' }
      }
      if (result.error === 'forbidden') {
        reply.code(403)
        return { error: 'Only original author can edit this message' }
      }
      reply.code(400)
      return { error: 'Message content cannot be empty' }
    }

    return { success: true, message: result.message }
  })

  // Delete message (author only)
  app.delete<{ Params: { id: string } }>('/chat/messages/:id', async (request, reply) => {
    const parsedBody = DeleteMessageBodySchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      reply.code(400)
      return {
        error: 'Invalid body: from is required',
        details: parsedBody.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const body = parsedBody.data
    const result = await chatManager.deleteMessage(request.params.id, body.from)
    if (!result.ok) {
      if (result.error === 'not_found') {
        reply.code(404)
        return { error: 'Message not found' }
      }
      reply.code(403)
      return { error: 'Only original author can delete this message' }
    }

    return { success: true }
  })

  // Add reaction to message
  app.post<{ Params: { id: string } }>('/chat/messages/:id/react', async (request, reply) => {
    const parsedBody = MessageReactionBodySchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      reply.code(400)
      return {
        error: 'Invalid body: emoji and from are required',
        details: parsedBody.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }
    const body = parsedBody.data
    const message = await chatManager.addReaction(request.params.id, body.emoji, body.from)
    if (!message) {
      return { error: 'Message not found' }
    }
    return { success: true, message }
  })

  // Get reactions for a message
  app.get<{ Params: { id: string } }>('/chat/messages/:id/reactions', async (request) => {
    const reactions = chatManager.getReactions(request.params.id)
    if (reactions === null) {
      return { error: 'Message not found' }
    }
    return { reactions }
  })

  // Get channels with message counts
  app.get('/chat/channels', async () => {
    const channels = chatManager.getChannels()
    return { channels }
  })

  // Search messages
  app.get('/chat/search', async (request, reply) => {
    const parsedQuery = ChatSearchQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }
    const query = parsedQuery.data
    const messages = chatManager.search(query.q, {
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.chatSearch, MAX_LIMITS.chatSearch),
    })
    return { messages, count: messages.length }
  })

  // Get thread (parent + all replies)
  app.get<{ Params: { id: string } }>('/chat/messages/:id/thread', async (request) => {
    const thread = chatManager.getThread(request.params.id)
    if (!thread) {
      return { error: 'Message not found' }
    }
    return { messages: thread, count: thread.length }
  })

  // ============ INBOX ENDPOINTS ============

  // Get inbox for an agent
  app.get<{ Params: { agent: string } }>('/inbox/:agent', async (request, reply) => {
    const parsedQuery = InboxQuerySchema.safeParse(request.query ?? {})
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }
    const query = parsedQuery.data
    
    // For inbox, get more messages than default to scan for @mentions etc.
    // But still cap it to avoid blowing through context windows
    // Get last 100 messages or since timestamp if provided
    const allMessages = chatManager.getMessages({
      limit: MAX_LIMITS.inboxScanMessages,
      since: parseEpochMs(query.since),
    })
    
    const inbox = inboxManager.getInbox(request.params.agent, allMessages, {
      priority: query.priority,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.inbox, MAX_LIMITS.inbox),
      since: parseEpochMs(query.since),
    })
    
    // Auto-update presence when agent checks inbox
    presenceManager.updatePresence(request.params.agent, 'working')
    
    return { messages: inbox, count: inbox.length }
  })

  // Acknowledge messages
  app.post<{ Params: { agent: string } }>('/inbox/:agent/ack', async (request, reply) => {
    const parsedBody = InboxAckBodySchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      reply.code(400)
      return {
        error: 'Invalid body',
        details: parsedBody.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }
    const body = parsedBody.data
    
    if (body.all) {
      const allMessages = chatManager.getMessages()
      await inboxManager.ackAll(request.params.agent, allMessages)
      return { success: true, message: 'All messages acknowledged' }
    }
    
    // Allow updating lastReadTimestamp without acking specific messages
    if (body.timestamp !== undefined && !body.messageIds) {
      await inboxManager.ackMessages(request.params.agent, undefined, body.timestamp)
      return { success: true, message: 'lastReadTimestamp updated' }
    }
    
    if (!body.messageIds || !Array.isArray(body.messageIds)) {
      return { error: 'messageIds array, timestamp, or all=true is required' }
    }
    
    await inboxManager.ackMessages(request.params.agent, body.messageIds, body.timestamp)
    return { success: true, count: body.messageIds.length }
  })

  // Update subscriptions
  app.post<{ Params: { agent: string } }>('/inbox/:agent/subscribe', async (request, reply) => {
    const parsedBody = InboxSubscribeBodySchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      reply.code(400)
      return {
        error: 'Invalid body: channels array is required',
        details: parsedBody.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }
    const body = parsedBody.data
    
    const subscriptions = await inboxManager.updateSubscriptions(request.params.agent, body.channels)
    return { success: true, subscriptions }
  })

  // Get subscriptions
  app.get<{ Params: { agent: string } }>('/inbox/:agent/subscriptions', async (request) => {
    const subscriptions = inboxManager.getSubscriptions(request.params.agent)
    return { subscriptions }
  })

  // Get unread mentions count (for notification badge)
  app.get<{ Params: { agent: string } }>('/inbox/:agent/unread', async (request) => {
    const allMessages = chatManager.getMessages({ limit: MAX_LIMITS.unreadScanMessages })
    const count = inboxManager.getUnreadMentionsCount(request.params.agent, allMessages)
    return { count, agent: request.params.agent }
  })

  // Get unread mentions (for dropdown/panel)
  app.get<{ Params: { agent: string } }>('/inbox/:agent/mentions', async (request) => {
    const query = request.query as Record<string, string>
    const limit = boundedLimit(query.limit, DEFAULT_LIMITS.unreadMentions, MAX_LIMITS.unreadMentions)
    
    const allMessages = chatManager.getMessages({ limit: MAX_LIMITS.unreadScanMessages })
    const mentions = inboxManager.getUnreadMentions(request.params.agent, allMessages)
    
    return { 
      mentions: mentions.slice(0, limit), 
      count: mentions.length,
      agent: request.params.agent
    }
  })

  // List rooms
  app.get('/chat/rooms', async () => {
    const rooms = chatManager.listRooms()
    return { rooms }
  })

  // Create room
  app.post('/chat/rooms', async (request) => {
    const body = request.body as { id: string; name: string }
    const room = chatManager.createRoom(body.id, body.name)
    return { success: true, room }
  })

  // ============ TASK ENDPOINTS ============

  const enrichTaskWithComments = (task: Task) => ({
    ...task,
    commentCount: taskManager.getTaskCommentCount(task.id),
  })

  // List tasks
  app.get('/tasks', async (request, reply) => {
    const query = request.query as Record<string, string>
    const updatedSince = parseEpochMs(query.updatedSince || query.since)
    const limit = boundedLimit(query.limit, DEFAULT_LIMITS.tasks, MAX_LIMITS.tasks)

    const tagFilter = query.tag
      ? [query.tag]
      : (query.tags ? query.tags.split(',') : undefined)

    let tasks = taskManager.listTasks({
      status: query.status as Task['status'] | undefined,
      assignee: query.assignee || query.assignedTo, // Support both for backward compatibility
      createdBy: query.createdBy,
      priority: query.priority as Task['priority'] | undefined,
      tags: tagFilter,
    })

    if (updatedSince) {
      tasks = tasks.filter(task => task.updatedAt >= updatedSince)
    }

    tasks = tasks.slice(0, limit)

    const payload = { tasks: tasks.map(enrichTaskWithComments) }
    const lastModified = tasks.length > 0 ? Math.max(...tasks.map(t => t.updatedAt || 0)) : undefined
    if (applyConditionalCaching(request, reply, payload, lastModified)) {
      return
    }

    return payload
  })

  // Search tasks by keyword in title + description
  app.get('/tasks/search', async (request) => {
    const query = request.query as Record<string, string>
    const q = query.q || ''
    const limit = boundedLimit(query.limit, DEFAULT_LIMITS.tasks, MAX_LIMITS.tasks)

    const tasks = taskManager.searchTasks(q).slice(0, limit)
    return { tasks: tasks.map(enrichTaskWithComments), count: tasks.length }
  })

  // Semantic search across tasks and chat messages
  app.get('/search/semantic', async (request, reply) => {
    const query = request.query as Record<string, string>
    const q = (query.q || '').trim()
    if (!q) {
      reply.code(400)
      return { error: 'Query parameter q is required', code: 'BAD_REQUEST' }
    }

    const limit = Math.min(Math.max(parseInt(query.limit || '10', 10) || 10, 1), 50)
    const type = query.type // optional: 'task' | 'chat'

    try {
      const { isVectorSearchAvailable } = await import('./db.js')
      if (!isVectorSearchAvailable()) {
        reply.code(503)
        return {
          error: 'Semantic search not available (sqlite-vec extension not loaded)',
          code: 'VEC_NOT_AVAILABLE',
        }
      }

      const { semanticSearch } = await import('./vector-store.js')
      const results = await semanticSearch(q, { limit, type })

      return {
        query: q,
        results,
        count: results.length,
      }
    } catch (err: any) {
      reply.code(500)
      return { error: err?.message || 'Semantic search failed', code: 'SEARCH_ERROR' }
    }
  })

  // Vector index status
  app.get('/search/semantic/status', async () => {
    try {
      const { isVectorSearchAvailable } = await import('./db.js')
      if (!isVectorSearchAvailable()) {
        return { available: false, reason: 'sqlite-vec extension not loaded' }
      }

      const { vectorCount } = await import('./vector-store.js')
      const { getDb } = await import('./db.js')
      const db = getDb()

      return {
        available: true,
        indexed: {
          total: vectorCount(db),
          tasks: vectorCount(db, 'task'),
          chat: vectorCount(db, 'chat'),
        },
      }
    } catch (err: any) {
      return { available: false, reason: err?.message }
    }
  })

  // Manually trigger indexing of existing tasks
  app.post('/search/semantic/reindex', async (request, reply) => {
    try {
      const { isVectorSearchAvailable } = await import('./db.js')
      if (!isVectorSearchAvailable()) {
        reply.code(503)
        return { error: 'Semantic search not available', code: 'VEC_NOT_AVAILABLE' }
      }

      const { indexTask } = await import('./vector-store.js')
      const allTasks = taskManager.listTasks({})
      let indexed = 0

      for (const task of allTasks) {
        try {
          await indexTask(
            task.id,
            task.title,
            (task as any).description,
            task.done_criteria,
          )
          indexed++
        } catch {
          // skip individual failures
        }
      }

      return { indexed, total: allTasks.length }
    } catch (err: any) {
      reply.code(500)
      return { error: err?.message || 'Reindex failed', code: 'REINDEX_ERROR' }
    }
  })

  // List recurring task definitions
  app.get('/tasks/recurring', async (request) => {
    const query = request.query as Record<string, string>
    const enabled = query.enabled === undefined
      ? undefined
      : query.enabled === 'true'

    const recurring = taskManager.listRecurringTasks({ enabled })
    return { recurring, count: recurring.length }
  })

  // Create recurring task definition
  app.post('/tasks/recurring', async (request) => {
    try {
      const data = CreateRecurringTaskSchema.parse(request.body)
      const { eta, ...rest } = data
      const recurring = await taskManager.createRecurringTask({
        ...rest,
        metadata: {
          ...(rest.metadata || {}),
          eta,
        },
      })
      return { success: true, recurring }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create recurring task' }
    }
  })

  // Update recurring task definition
  app.patch<{ Params: { id: string } }>('/tasks/recurring/:id', async (request, reply) => {
    try {
      const updates = UpdateRecurringTaskSchema.parse(request.body)
      const recurring = await taskManager.updateRecurringTask(request.params.id, updates)

      if (!recurring) {
        reply.code(404)
        return { success: false, error: 'Recurring task not found' }
      }

      return { success: true, recurring }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update recurring task' }
    }
  })

  // Delete recurring task definition
  app.delete<{ Params: { id: string } }>('/tasks/recurring/:id', async (request, reply) => {
    const deleted = await taskManager.deleteRecurringTask(request.params.id)
    if (!deleted) {
      reply.code(404)
      return { success: false, error: 'Recurring task not found' }
    }

    return { success: true, id: request.params.id }
  })

  // Force recurring materialization pass
  app.post('/tasks/recurring/materialize', async (request) => {
    const query = request.query as Record<string, string>
    const force = query.force === 'true'
    const result = await taskManager.materializeDueRecurringTasks(Date.now(), { force })
    return { success: true, force, ...result }
  })

  function resolveTaskFromParam(idParam: string, reply?: any): { task: Task; resolvedId: string } | null {
    const resolved = taskManager.resolveTaskId(idParam)

    if (resolved.matchType === 'ambiguous') {
      if (reply) reply.code(400)
      return null
    }

    if (!resolved.task || !resolved.resolvedId) {
      if (reply) reply.code(404)
      return null
    }

    return { task: resolved.task, resolvedId: resolved.resolvedId }
  }

  // Get task
  app.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const resolved = taskManager.resolveTaskId(request.params.id)

    if (resolved.matchType === 'ambiguous') {
      reply.code(400)
      return {
        error: 'Ambiguous task ID prefix',
        details: {
          input: request.params.id,
          suggestions: resolved.suggestions,
        },
        hint: 'Use a longer prefix or the full task ID',
      }
    }

    if (!resolved.task || !resolved.resolvedId) {
      reply.code(404)
      return {
        error: 'Task not found',
        input: request.params.id,
        suggestions: resolved.suggestions,
      }
    }

    return {
      task: enrichTaskWithComments(resolved.task),
      resolvedId: resolved.resolvedId,
      matchType: resolved.matchType,
    }
  })

  // Task history
  app.get<{ Params: { id: string } }>('/tasks/:id/history', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) {
      const match = taskManager.resolveTaskId(request.params.id)
      if (match.matchType === 'ambiguous') {
        return {
          error: 'Ambiguous task ID prefix',
          details: {
            input: request.params.id,
            suggestions: match.suggestions,
          },
          hint: 'Use a longer prefix or the full task ID',
        }
      }
      return { error: 'Task not found', details: { input: request.params.id, suggestions: match.suggestions } }
    }

    const events = taskManager.getTaskHistory(resolved.resolvedId)
    const history = events
      .filter(event => event.type === 'status_changed')
      .map(event => ({
        status: String(event.data?.to ?? 'unknown'),
        changedBy: event.actor,
        changedAt: event.timestamp,
        metadata: {
          from: event.data?.from ?? null,
          to: event.data?.to ?? null,
          eventType: event.type,
          eventId: event.id,
        },
      }))

    return { history, count: history.length, resolvedId: resolved.resolvedId }
  })

  // Task comments
  app.get<{ Params: { id: string } }>('/tasks/:id/comments', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) {
      const match = taskManager.resolveTaskId(request.params.id)
      if (match.matchType === 'ambiguous') {
        return {
          error: 'Ambiguous task ID prefix',
          details: {
            input: request.params.id,
            suggestions: match.suggestions,
          },
          hint: 'Use a longer prefix or the full task ID',
        }
      }
      return { error: 'Task not found', details: { input: request.params.id, suggestions: match.suggestions } }
    }

    const comments = taskManager.getTaskComments(resolved.resolvedId)
    return { comments, count: comments.length, resolvedId: resolved.resolvedId }
  })

  // Add task comment
  app.post<{ Params: { id: string } }>('/tasks/:id/comments', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) {
      const match = taskManager.resolveTaskId(request.params.id)
      if (match.matchType === 'ambiguous') {
        return {
          success: false,
          error: 'Ambiguous task ID prefix',
          details: {
            input: request.params.id,
            suggestions: match.suggestions,
          },
          hint: 'Use a longer prefix or the full task ID',
        }
      }
      return { success: false, error: 'Task not found', details: { input: request.params.id, suggestions: match.suggestions } }
    }

    try {
      const data = CreateTaskCommentSchema.parse(request.body)
      const comment = await taskManager.addTaskComment(resolved.resolvedId, data.author, data.content)

      // Task-comments are now primary execution comms:
      // fan out inbox-visible notifications to assignee/reviewer + explicit @mentions.
      const task = taskManager.getTask(resolved.resolvedId)
      if (task) {
        const targets = new Set<string>()

        if (task.assignee) targets.add(task.assignee)
        if (task.reviewer) targets.add(task.reviewer)
        for (const mention of extractMentions(data.content)) {
          targets.add(mention)
        }

        // Keep sender out of forced mention fanout to avoid self-noise.
        targets.delete(data.author)

        const mentionPrefix = Array.from(targets)
          .map(agent => `@${agent}`)
          .join(' ')

        const maxContent = 280
        const snippet = data.content.length > maxContent
          ? `${data.content.slice(0, maxContent)}…`
          : data.content

        const inboxNotification = `${mentionPrefix} [task-comment:${task.id}] ${snippet}`.trim()

        // Non-blocking best-effort notification path via chat/inbox routing.
        // Uses dedicated task-comments channel; mentions still route as high-priority inbox items.
        await chatManager.sendMessage({
          from: data.author,
          content: inboxNotification,
          channel: 'task-comments',
          metadata: {
            kind: 'task_comment',
            taskId: task.id,
            commentId: comment.id,
          },
        })
      }

      presenceManager.recordActivity(data.author, 'message')
      presenceManager.updatePresence(data.author, 'working')

      return { success: true, comment }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to add comment' }
    }
  })

  // Capture outcome verdict for a completed task
  app.post<{ Params: { id: string } }>('/tasks/:id/outcome', async (request, reply) => {
    const task = taskManager.getTask(request.params.id)
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }

    if (task.status !== 'done') {
      reply.code(400)
      return { success: false, error: 'Outcome verdicts are only accepted for done tasks' }
    }

    try {
      const body = TaskOutcomeBodySchema.parse(request.body || {})
      const capturedAt = Date.now()
      const updated = await taskManager.updateTask(task.id, {
        metadata: {
          ...(task.metadata || {}),
          outcome_checkpoint: {
            ...(((task.metadata as any)?.outcome_checkpoint || {}) as Record<string, unknown>),
            verdict: body.verdict,
            notes: body.notes,
            capturedAt,
            capturedBy: body.author || 'unknown',
            status: 'captured',
          },
        },
      })

      return { success: true, task: updated ? enrichTaskWithComments(updated) : null }
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Failed to capture outcome verdict' }
    }
  })

  // Build normalized reviewer packet (PR + CI + artifacts)
  app.post<{ Params: { id: string } }>('/tasks/:id/review-bundle', async (request, reply) => {
    const task = taskManager.getTask(request.params.id)
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }

    let body: { author?: string; strict?: boolean }
    try {
      body = ReviewBundleBodySchema.parse(request.body || {})
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Invalid review bundle body' }
    }

    const strict = body.strict ?? true
    const author = body.author || 'review-bundle-bot'

    const prUrl = extractPrUrlFromTask(task)
    const artifactPaths = extractArtifactPathsFromTask(task)
    const artifactEvidence = await resolveArtifactEvidence(artifactPaths)

    const prCi = prUrl
      ? await resolvePrAndCi(prUrl)
      : {
          pr: null,
          ci: {
            state: 'unknown' as const,
            source: 'unavailable' as const,
            details: 'No PR link found in task metadata',
          },
        }

    const reasons: string[] = []
    if (!prUrl) reasons.push('no_pr_url_resolved')
    if (strict && prCi.ci.state !== 'success') reasons.push(`ci_not_success:${prCi.ci.state}`)
    if (artifactEvidence.length === 0) reasons.push('no_artifact_paths_resolved')
    if (artifactEvidence.length > 0 && !artifactEvidence.some(item => item.exists)) {
      reasons.push('artifact_paths_missing')
    }

    const verdict = reasons.length === 0 ? 'pass' : 'fail'

    const bundle = {
      taskId: task.id,
      generatedAt: Date.now(),
      strict,
      verdict,
      reasons,
      pr: prCi.pr,
      ci: prCi.ci,
      artifacts: artifactEvidence,
      evidence: {
        taskStatus: task.status,
        reviewer: task.reviewer,
      },
    }

    await taskManager.addTaskComment(
      task.id,
      author,
      `[review-bundle] verdict=${verdict}; ci=${prCi.ci.state}; artifacts=${artifactEvidence.filter(a => a.exists).length}/${artifactEvidence.length}; reasons=${reasons.join(',') || 'none'}`,
    )

    return { success: true, bundle }
  })

  // Reviewer decision endpoint (approve/reject in-tool)
  app.post<{ Params: { id: string } }>('/tasks/:id/review', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) {
      const match = taskManager.resolveTaskId(request.params.id)
      if (match.matchType === 'ambiguous') {
        return {
          success: false,
          error: 'Ambiguous task ID prefix',
          details: {
            input: request.params.id,
            suggestions: match.suggestions,
          },
          hint: 'Use a longer prefix or the full task ID',
        }
      }
      return { success: false, error: 'Task not found', details: { input: request.params.id, suggestions: match.suggestions } }
    }

    let body: { reviewer: string; decision: 'approve' | 'reject'; comment: string }
    try {
      body = TaskReviewDecisionSchema.parse(request.body || {})
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Invalid review body' }
    }

    const task = resolved.task
    if (!task.reviewer || task.reviewer.trim().length === 0) {
      reply.code(400)
      return { success: false, error: 'Task has no assigned reviewer' }
    }

    const expectedReviewer = task.reviewer.trim().toLowerCase()
    const actualReviewer = body.reviewer.trim().toLowerCase()
    if (expectedReviewer !== actualReviewer) {
      reply.code(403)
      return {
        success: false,
        error: `Only assigned reviewer "${task.reviewer}" can submit task review decisions`,
      }
    }

    const decidedAt = Date.now()
    const decisionLabel = body.decision === 'approve' ? 'approved' : 'rejected'
    const mergedMetadata = {
      ...(task.metadata || {}),
      reviewer_approved: body.decision === 'approve',
      reviewer_decision: {
        decision: decisionLabel,
        reviewer: body.reviewer,
        comment: body.comment,
        decidedAt,
      },
      reviewer_notes: body.comment,
    }

    const updated = await taskManager.updateTask(task.id, {
      metadata: mergedMetadata,
    })

    await taskManager.addTaskComment(task.id, body.reviewer, `[review] ${decisionLabel}: ${body.comment}`)

    return {
      success: true,
      decision: {
        taskId: task.id,
        reviewer: body.reviewer,
        decision: decisionLabel,
        comment: body.comment,
        decidedAt,
      },
      task: updated ? enrichTaskWithComments(updated) : null,
    }
  })

  // Create task
  app.post('/tasks', async (request, reply) => {
    try {
      const data = CreateTaskSchema.parse(request.body)

      // Reject TEST: prefixed tasks in production to prevent CI pollution
      if (process.env.NODE_ENV === 'production' && typeof data.title === 'string' && data.title.startsWith('TEST:')) {
        reply.code(400)
        return { success: false, error: 'TEST: prefixed tasks are not allowed in production', code: 'TEST_TASK_REJECTED' }
      }

      const { eta, ...rest } = data
      const task = await taskManager.createTask({
        ...rest,
        metadata: {
          ...(rest.metadata || {}),
          eta,
        },
      })
      
      // Auto-update presence: creating tasks = working
      if (data.createdBy) {
        presenceManager.updatePresence(data.createdBy, 'working')
      }

      // Fire-and-forget: index task for semantic search
      if (!data.title.startsWith('TEST:')) {
        import('./vector-store.js')
          .then(({ indexTask }) => indexTask(task.id, task.title, undefined, data.done_criteria))
          .catch(() => {})
      }
      
      return { success: true, task: enrichTaskWithComments(task) }
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Failed to create task' }
    }
  })

  // Batch create tasks with deduplication
  const BatchCreateSchema = z.object({
    tasks: z.array(CreateTaskSchema).min(1).max(20),
    deduplicate: z.boolean().default(true),
    dryRun: z.boolean().default(false),
    createdBy: z.string().min(1),
  })

  app.post('/tasks/batch-create', async (request, reply) => {
    try {
      const data = BatchCreateSchema.parse(request.body)
      const results: Array<{
        title: string
        status: 'created' | 'duplicate' | 'error'
        task?: ReturnType<typeof enrichTaskWithComments>
        duplicateOf?: string
        similarity?: number
        error?: string
      }> = []

      for (const taskData of data.tasks) {
        try {
          // Reject TEST: tasks in production
          if (process.env.NODE_ENV === 'production' && taskData.title.startsWith('TEST:')) {
            results.push({ title: taskData.title, status: 'error', error: 'TEST: tasks not allowed in production' })
            continue
          }

          // Deduplication: check existing tasks for similar titles
          if (data.deduplicate) {
            const existingTasks = taskManager.listTasks({})
            const activeTasks = existingTasks.filter(t => t.status !== 'done')
            const normalizedNew = taskData.title.toLowerCase().trim()

            // Exact title match
            const exactMatch = activeTasks.find(t =>
              t.title.toLowerCase().trim() === normalizedNew
            )
            if (exactMatch) {
              results.push({
                title: taskData.title,
                status: 'duplicate',
                duplicateOf: exactMatch.id,
                similarity: 1.0,
              })
              continue
            }

            // Fuzzy match: check for high word overlap
            const newWords = new Set(normalizedNew.split(/\s+/).filter(w => w.length > 3))
            let bestMatch: { id: string; overlap: number } | null = null
            for (const existing of activeTasks) {
              const existingWords = new Set(existing.title.toLowerCase().split(/\s+/).filter(w => w.length > 3))
              const intersection = [...newWords].filter(w => existingWords.has(w))
              const union = new Set([...newWords, ...existingWords])
              const overlap = union.size > 0 ? intersection.length / union.size : 0
              if (overlap > 0.6 && (!bestMatch || overlap > bestMatch.overlap)) {
                bestMatch = { id: existing.id, overlap }
              }
            }
            if (bestMatch) {
              results.push({
                title: taskData.title,
                status: 'duplicate',
                duplicateOf: bestMatch.id,
                similarity: Math.round(bestMatch.overlap * 100) / 100,
              })
              continue
            }
          }

          if (data.dryRun) {
            results.push({ title: taskData.title, status: 'created' })
            continue
          }

          const { eta, ...rest } = taskData
          const task = await taskManager.createTask({
            ...rest,
            createdBy: taskData.createdBy || data.createdBy,
            metadata: {
              ...(rest.metadata || {}),
              eta,
              batch_created: true,
            },
          })

          // Index for semantic search
          if (!taskData.title.startsWith('TEST:')) {
            import('./vector-store.js')
              .then(({ indexTask }) => indexTask(task.id, task.title, undefined, taskData.done_criteria))
              .catch(() => {})
          }

          results.push({
            title: taskData.title,
            status: 'created',
            task: enrichTaskWithComments(task),
          })
        } catch (err: any) {
          results.push({ title: taskData.title, status: 'error', error: err.message })
        }
      }

      const created = results.filter(r => r.status === 'created').length
      const duplicates = results.filter(r => r.status === 'duplicate').length
      const errors = results.filter(r => r.status === 'error').length

      return {
        success: true,
        dryRun: data.dryRun,
        summary: { total: results.length, created, duplicates, errors },
        results,
      }
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Batch create failed' }
    }
  })

  // Board health: low-watermark detection
  app.get('/tasks/board-health', async () => {
    const allTasks = taskManager.listTasks({})
    const agents = [...new Set(allTasks.map(t => t.assignee).filter(Boolean))] as string[]

    const agentHealth = agents.map(agent => {
      const agentTasks = allTasks.filter(t => (t.assignee || '').toLowerCase() === agent.toLowerCase())
      const doing = agentTasks.filter(t => t.status === 'doing').length
      const validating = agentTasks.filter(t => t.status === 'validating').length
      const todo = agentTasks.filter(t => t.status === 'todo').length
      const active = doing + validating

      return {
        agent,
        doing,
        validating,
        todo,
        active,
        needsWork: active === 0 && todo === 0,
        lowWatermark: active < 1,
      }
    })

    const totalTodo = allTasks.filter(t => t.status === 'todo').length
    const totalDoing = allTasks.filter(t => t.status === 'doing').length
    const totalValidating = allTasks.filter(t => t.status === 'validating').length
    const unassignedTodo = allTasks.filter(t => t.status === 'todo' && !t.assignee).length

    const agentsNeedingWork = agentHealth.filter(a => a.needsWork).map(a => a.agent)
    const agentsLowWatermark = agentHealth.filter(a => a.lowWatermark).map(a => a.agent)
    const replenishNeeded = agentsNeedingWork.length >= 2 || totalTodo < 3

    return {
      success: true,
      board: {
        totalTodo,
        totalDoing,
        totalValidating,
        unassignedTodo,
        replenishNeeded,
        replenishReason: replenishNeeded
          ? agentsNeedingWork.length >= 2
            ? `${agentsNeedingWork.length} agents have no work: ${agentsNeedingWork.join(', ')}`
            : `Only ${totalTodo} tasks in backlog (threshold: 3)`
          : null,
      },
      agents: agentHealth,
      agentsNeedingWork,
      agentsLowWatermark,
    }
  })

  // Update task
  app.patch<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    try {
      const parsed = UpdateTaskSchema.parse(request.body)
      const lookup = taskManager.resolveTaskId(request.params.id)
      if (lookup.matchType === 'ambiguous') {
        reply.code(400)
        return {
          success: false,
          error: 'Ambiguous task ID prefix',
          input: request.params.id,
          suggestions: lookup.suggestions,
          hint: 'Use a longer prefix or the full task ID',
        }
      }
      const existing = lookup.task
      if (!existing || !lookup.resolvedId) {
        reply.code(404)
        return { success: false, error: 'Task not found', input: request.params.id, suggestions: lookup.suggestions }
      }

      // Merge incoming metadata with existing for gate checks + persistence
      const mergedMeta = { ...(existing.metadata || {}), ...(parsed.metadata || {}) }

      // TEST: prefixed tasks bypass gates (WIP cap, etc.)
      const isTestTask = typeof existing.title === 'string' && existing.title.startsWith('TEST:')

      // QA bundle gate: validating requires structured review evidence.
      const effectiveStatus = parsed.status ?? existing.status
      const qaGate = enforceQaBundleGateForValidating(effectiveStatus, mergedMeta)
      if (!qaGate.ok) {
        reply.code(400)
        return {
          success: false,
          error: qaGate.error,
          gate: 'qa_bundle',
          hint: qaGate.hint,
        }
      }

      // ── Task-close gate: enforce proof + reviewer sign-off before done ──
      if (parsed.status === 'done') {
        const artifacts = mergedMeta.artifacts as string[] | undefined

        // Gate 1: require artifacts (links, PR URLs, evidence)
        if (!artifacts || !Array.isArray(artifacts) || artifacts.length === 0) {
          reply.code(422)
          return {
            success: false,
            error: 'Task-close gate: metadata.artifacts required (array of proof links/evidence)',
            gate: 'artifacts',
            hint: 'Include metadata.artifacts: ["https://github.com/.../pull/7", "tested locally"]',
          }
        }

        // Gate 2: reviewer sign-off (if task has a reviewer assigned)
        if (existing.reviewer) {
          const signedOff = mergedMeta.reviewer_approved as boolean | undefined
          if (!signedOff) {
            reply.code(422)
            return {
              success: false,
              error: `Task-close gate: reviewer sign-off required from "${existing.reviewer}"`,
              gate: 'reviewer_signoff',
              hint: `Reviewer "${existing.reviewer}" must approve via: PATCH with metadata.reviewer_approved: true`,
            }
          }
        }
      }
      // ── End task-close gate ──

      // ── WIP cap check on doing transition ──
      if (parsed.status === 'doing' && existing.status !== 'doing' && !isTestTask) {
        const assignee = parsed.assignee || existing.assignee || 'unknown'
        const wipOverride = mergedMeta.wip_override as string | undefined
        const wipCheck = checkWipCap(assignee, taskManager.listTasks({}), wipOverride)
        if (!wipCheck.allowed) {
          reply.code(422)
          return {
            success: false,
            error: wipCheck.message,
            gate: 'wip_cap',
            wipCount: wipCheck.wipCount,
            wipCap: wipCheck.wipCap,
            hint: 'Include metadata.wip_override with a reason to bypass the WIP cap.',
          }
        }
        if (wipOverride) {
          mergedMeta.wip_override_used = true
        }
      }

      // ── Branch tracking: auto-populate on doing transition ──
      if (parsed.status === 'doing' && existing.status !== 'doing') {
        const assignee = parsed.assignee || existing.assignee || 'unknown'
        const shortId = lookup.resolvedId.replace(/^task-\d+-/, '')
        const branch = `${assignee}/task-${shortId}`
        if (!mergedMeta.branch) {
          mergedMeta.branch = branch
        }

        // Prevent branch stacking: warn if agent already has a doing task
        const agentDoingTasks = taskManager.listTasks({ status: 'doing' })
          .filter(t => (t.assignee || '').toLowerCase() === assignee.toLowerCase() && t.id !== lookup.resolvedId)
        if (agentDoingTasks.length > 0) {
          const existingIds = agentDoingTasks.map(t => t.id.slice(0, 20)).join(', ')
          mergedMeta.branch_warning = `Agent "${assignee}" already has ${agentDoingTasks.length} doing task(s): ${existingIds}. Ensure one branch per task.`
        }
      }
      // ── End branch tracking ──

      const { actor, ...rest } = parsed

      const nextMetadata: Record<string, unknown> = {
        ...mergedMeta,
        ...(actor ? { actor } : {}),
      }

      if (parsed.status === 'done' && existing.status !== 'done') {
        const completedAt = Date.now()
        const outcomeMeta = ((nextMetadata.outcome_checkpoint as Record<string, unknown>) || {})
        nextMetadata.completed_at = completedAt
        nextMetadata.outcome_checkpoint = {
          ...outcomeMeta,
          dueAt: completedAt + OUTCOME_CHECK_DELAY_MS,
          status: 'scheduled',
        }
      }

      const updates = {
        ...rest,
        metadata: nextMetadata,
      }
      const task = await taskManager.updateTask(lookup.resolvedId, updates)
      if (!task) {
        reply.code(404)
        return { success: false, error: 'Task not found' }
      }
      
      // Auto-update presence on task activity
      if (task.assignee) {
        if (parsed.status === 'done') {
          presenceManager.recordActivity(task.assignee, 'task_completed')
          presenceManager.updatePresence(task.assignee, 'working')
        } else if (parsed.status === 'doing') {
          presenceManager.updatePresence(task.assignee, 'working')
        } else if (parsed.status === 'blocked') {
          presenceManager.updatePresence(task.assignee, 'blocked')
        } else if (parsed.status === 'validating') {
          presenceManager.updatePresence(task.assignee, 'reviewing')
        }
      }
      
      return { success: true, task: enrichTaskWithComments(task) }
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Failed to update task' }
    }
  })

  // Delete task
  app.delete<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const lookup = taskManager.resolveTaskId(request.params.id)
    if (lookup.matchType === 'ambiguous') {
      reply.code(400)
      return {
        error: 'Ambiguous task ID prefix',
        input: request.params.id,
        suggestions: lookup.suggestions,
        hint: 'Use a longer prefix or the full task ID',
      }
    }

    if (!lookup.task || !lookup.resolvedId) {
      reply.code(404)
      return { error: 'Task not found', input: request.params.id, suggestions: lookup.suggestions }
    }

    const deleted = await taskManager.deleteTask(lookup.resolvedId)
    if (!deleted) {
      reply.code(404)
      return { error: 'Task not found' }
    }
    return { success: true, resolvedId: lookup.resolvedId }
  })

  // Team manifest: serve TEAM.md from ~/.reflectt/ with structured sections
  app.get('/team/manifest', async () => {
    const { createHash } = await import('crypto')
    const teamPaths = [
      join(REFLECTT_HOME, 'TEAM.md'),
    ]

    // Try defaults if no user file
    const defaultPath = new URL('../defaults/TEAM.md', import.meta.url)

    let content: string | null = null
    let source = 'none'

    for (const p of teamPaths) {
      try {
        if (existsSync(p)) {
          content = readFileSync(p, 'utf-8')
          source = p
          break
        }
      } catch { /* ignore */ }
    }

    if (!content) {
      try {
        content = readFileSync(defaultPath, 'utf-8')
        source = 'defaults/TEAM.md'
      } catch { /* ignore */ }
    }

    if (!content) {
      return { success: false, message: 'No TEAM.md found. Run `reflectt init` to create one.' }
    }

    // Parse into structured sections
    const sections: Record<string, string> = {}
    let currentSection = '_preamble'
    const lines = content.split('\n')

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,3}\s+(.+)/)
      if (headingMatch) {
        currentSection = headingMatch[1].trim().toLowerCase().replace(/\s+/g, '_')
        sections[currentSection] = ''
      } else {
        sections[currentSection] = (sections[currentSection] || '') + line + '\n'
      }
    }

    // Trim whitespace from sections
    for (const key of Object.keys(sections)) {
      sections[key] = sections[key].trim()
      if (!sections[key]) delete sections[key]
    }

    const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
    let updatedAt: number | null = null
    try {
      const stat = statSync(source === 'defaults/TEAM.md' ? defaultPath : source)
      updatedAt = stat.mtimeMs
    } catch { /* ignore */ }

    return {
      success: true,
      source,
      hash,
      updatedAt,
      content,
      sections,
    }
  })

  // Agent role registry
  app.get('/agents/roles', async () => {
    const roles = getAgentRoles()
    const allTasks = taskManager.listTasks({})

    const enriched = roles.map(agent => {
      const wipCount = allTasks.filter(t =>
        t.status === 'doing' && (t.assignee || '').toLowerCase() === agent.name
      ).length
      return {
        ...agent,
        wipCount,
        overCap: wipCount >= agent.wipCap,
      }
    })

    const sourceInfo = getAgentRolesSource()
    return { success: true, agents: enriched, config: sourceInfo }
  })

  // Suggest assignee for a task
  app.post('/tasks/suggest-assignee', async (request) => {
    const body = request.body as Record<string, unknown>
    const title = body.title as string
    if (!title) {
      return { success: false, error: 'title is required' }
    }

    const allTasks = taskManager.listTasks({})
    const result = suggestAssignee(
      {
        title,
        tags: Array.isArray(body.tags) ? body.tags as string[] : undefined,
        done_criteria: Array.isArray(body.done_criteria) ? body.done_criteria as string[] : undefined,
      },
      allTasks,
    )

    return {
      success: true,
      suggested: result.suggested,
      protectedMatch: result.protectedMatch || null,
      scores: result.scores,
    }
  })

  // Get next task (pull-based assignment)
  app.get('/tasks/next', async (request) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    const task = taskManager.getNextTask(agent)
    if (!task) {
      return { task: null, message: 'No available tasks' }
    }
    return { task: enrichTaskWithComments(task) }
  })

  // Backlog: ranked list of unassigned tasks any agent can claim
  app.get('/tasks/backlog', async () => {
    const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
    const tasks = taskManager.listTasks({ status: 'todo' })
      .filter(t => !t.assignee)
      .sort((a, b) => {
        const pa = pOrder[a.priority || 'P3'] ?? 9
        const pb = pOrder[b.priority || 'P3'] ?? 9
        if (pa !== pb) return pa - pb
        return a.createdAt - b.createdAt
      })
    return { tasks: tasks.map(enrichTaskWithComments), count: tasks.length }
  })

  // Claim a task (self-assign)
  app.post('/tasks/:id/claim', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as { agent?: string }
    if (!body?.agent) {
      return { success: false, error: 'agent is required' }
    }

    const lookup = taskManager.resolveTaskId(id)
    if (lookup.matchType === 'ambiguous') {
      reply.code(400)
      return {
        success: false,
        error: 'Ambiguous task ID prefix',
        input: id,
        suggestions: lookup.suggestions,
        hint: 'Use a longer prefix or the full task ID',
      }
    }

    const task = lookup.task
    if (!task || !lookup.resolvedId) {
      reply.code(404)
      return { success: false, error: 'Task not found', input: id, suggestions: lookup.suggestions }
    }
    if (task.assignee) {
      return { success: false, error: `Task already assigned to ${task.assignee}` }
    }
    const shortId = lookup.resolvedId.replace(/^task-\d+-/, '')
    const branch = `${body.agent}/task-${shortId}`
    const updated = await taskManager.updateTask(lookup.resolvedId, {
      assignee: body.agent,
      status: 'doing',
      metadata: {
        ...(task.metadata || {}),
        actor: body.agent,
        branch,
      },
    })
    return { success: true, task: updated ? enrichTaskWithComments(updated) : null, resolvedId: lookup.resolvedId }
  })

  // Task lifecycle instrumentation: reviewer + done criteria gates
  app.get('/tasks/instrumentation/lifecycle', async () => {
    const instrumentation = taskManager.getLifecycleInstrumentation()
    return { instrumentation }
  })

  // ============ EXPERIMENT ENDPOINTS ============

  // Create experiment
  app.post('/experiments', async (request) => {
    try {
      const data = CreateExperimentSchema.parse(request.body)
      const experiment = await experimentsManager.createExperiment(data)
      return { success: true, experiment }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create experiment' }
    }
  })

  // List active experiments
  app.get('/experiments/active', async () => {
    const experiments = experimentsManager.getActiveExperiments()
    return { experiments, count: experiments.length }
  })

  // ============ RESEARCH ENDPOINTS ============

  app.get('/research/requests', async (request) => {
    const query = request.query as Record<string, string>
    const requests = await researchManager.listRequests({
      status: query.status as any,
      owner: query.owner,
      category: query.category as any,
      limit: boundedLimit(query.limit, 50, 200),
    })
    return { requests, count: requests.length }
  })

  app.post('/research/requests', async (request) => {
    try {
      const data = CreateResearchRequestSchema.parse(request.body)
      const dueAt = data.dueAt || (data.slaHours ? Date.now() + (data.slaHours * 60 * 60 * 1000) : undefined)
      const item = await researchManager.createRequest({
        title: data.title,
        question: data.question,
        requestedBy: data.requestedBy,
        owner: data.owner,
        category: data.category,
        priority: data.priority,
        status: data.status,
        taskId: data.taskId,
        dueAt,
        metadata: data.metadata,
      })
      return { success: true, request: item }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create research request' }
    }
  })

  app.get('/research/findings', async (request) => {
    const query = request.query as Record<string, string>
    const findings = await researchManager.listFindings({
      requestId: query.requestId,
      author: query.author,
      limit: boundedLimit(query.limit, 50, 200),
    })
    return { findings, count: findings.length }
  })

  app.post('/research/findings', async (request) => {
    try {
      const data = CreateResearchFindingSchema.parse(request.body)
      const finding = await researchManager.createFinding(data)
      return { success: true, finding }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create research finding' }
    }
  })

  // Structured research → execution handoff (auto-creates a task)
  app.post('/research/handoff', async (request) => {
    try {
      const data = CreateResearchHandoffSchema.parse(request.body)

      const sourceRequest = await researchManager.getRequest(data.requestId)
      if (!sourceRequest) {
        return { success: false, error: 'requestId not found' }
      }

      const findings = await researchManager.listFindings({ requestId: data.requestId, limit: 500 })
      const findingIdSet = new Set(findings.map(f => f.id))
      const missingFindings = data.findingIds.filter(id => !findingIdSet.has(id))
      if (missingFindings.length > 0) {
        return { success: false, error: `findingIds not found for request: ${missingFindings.join(', ')}` }
      }

      const doneCriteria = (data.done_criteria && data.done_criteria.length > 0)
        ? data.done_criteria
        : [
            'Review linked research source and summarize decision',
            'Translate findings into implementation plan with acceptance checks',
          ]

      const sourceLink = data.artifactUrl || `research://request/${data.requestId}`
      const tags = Array.from(new Set([...(data.tags || []), 'research-handoff']))

      const createdTask = await taskManager.createTask({
        title: data.title,
        description: `${data.summary}\n\nSource request: ${data.requestId}\nLinked findings: ${data.findingIds.join(', ')}\nSource link: ${sourceLink}`,
        status: 'todo',
        assignee: data.assignee,
        reviewer: data.reviewer,
        done_criteria: doneCriteria,
        createdBy: data.createdBy || 'scout',
        priority: data.priority,
        tags,
        metadata: {
          ...(data.metadata || {}),
          eta: data.eta,
          source: {
            kind: 'research-handoff',
            requestId: data.requestId,
            findingIds: data.findingIds,
            sourceLink,
          },
        },
      })

      await researchManager.updateRequest(data.requestId, {
        taskId: createdTask.id,
        status: sourceRequest.status === 'archived' ? sourceRequest.status : 'in_progress',
      })

      return {
        success: true,
        task: createdTask,
        source: {
          requestId: data.requestId,
          findingIds: data.findingIds,
          sourceLink,
        },
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create research handoff' }
    }
  })

  // ============ MEMORY ENDPOINTS ============

  // Get all memory files for an agent
  app.get<{ Params: { agent: string } }>('/memory/:agent', async (request) => {
    try {
      const memories = await memoryManager.getMemories(request.params.agent)
      return { success: true, memories }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Append to daily memory file
  app.post<{ Params: { agent: string }; Body: { content: string } }>('/memory/:agent', async (request) => {
    try {
      const body = request.body as { content: string }
      if (!body.content || typeof body.content !== 'string') {
        return { success: false, error: 'content is required' }
      }
      const result = await memoryManager.appendToDaily(request.params.agent, body.content)
      return { success: true, ...result }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Search memory files
  app.get<{ Params: { agent: string }; Querystring: { q: string } }>('/memory/:agent/search', async (request) => {
    try {
      const query = (request.query as { q: string }).q
      if (!query) {
        return { success: false, error: 'query parameter "q" is required' }
      }
      const results = await memoryManager.searchMemories(request.params.agent, query)
      return { success: true, results, count: results.length }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ============ PRESENCE ENDPOINTS ============

  // Update agent presence
  app.post<{ Params: { agent: string } }>('/presence/:agent', async (request) => {
    try {
      const body = request.body as { status: PresenceStatus; task?: string; since?: number }
      
      if (!body.status) {
        return { success: false, error: 'status is required' }
      }

      const validStatuses = ['idle', 'working', 'reviewing', 'blocked', 'offline']
      if (!validStatuses.includes(body.status)) {
        return { success: false, error: `status must be one of: ${validStatuses.join(', ')}` }
      }

      const presence = presenceManager.updatePresence(
        request.params.agent,
        body.status,
        body.task,
        body.since
      )

      return { success: true, presence }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get all agent presences
  app.get('/presence', async () => {
    const explicitPresences = presenceManager.getAllPresence()
    const allActivity = presenceManager.getAllActivity()
    
    // Build map of explicit presence by agent
    const presenceMap = new Map(explicitPresences.map(p => [p.agent, p]))
    
    // Add inferred presence for agents with only activity
    const now = Date.now()
    for (const activity of allActivity) {
      if (!presenceMap.has(activity.agent) && activity.last_active) {
        const inactiveMs = now - activity.last_active
        
        let status: PresenceStatus = 'offline'
        if (inactiveMs < 10 * 60 * 1000) { // Active in last 10 minutes
          status = activity.tasks_completed_today > 0 ? 'working' : 'idle'
        }
        
        presenceMap.set(activity.agent, {
          agent: activity.agent,
          status,
          since: activity.first_seen_today || activity.last_active,
          lastUpdate: activity.last_active,
          last_active: activity.last_active,
        })
      }
    }
    
    return { presences: Array.from(presenceMap.values()) }
  })

  // Get specific agent presence
  app.get<{ Params: { agent: string } }>('/presence/:agent', async (request) => {
    let presence = presenceManager.getPresence(request.params.agent)
    
    // If no explicit presence, infer from activity
    if (!presence) {
      const activity = presenceManager.getAgentActivity(request.params.agent)
      if (activity && activity.last_active) {
        const now = Date.now()
        const inactiveMs = now - activity.last_active
        
        // Infer status based on recent activity
        let status: PresenceStatus = 'offline'
        if (inactiveMs < 10 * 60 * 1000) { // Active in last 10 minutes
          status = activity.tasks_completed_today > 0 ? 'working' : 'idle'
        }
        
        presence = {
          agent: request.params.agent,
          status,
          since: activity.first_seen_today || activity.last_active,
          lastUpdate: activity.last_active,
          last_active: activity.last_active,
        }
      }
    }
    
    if (!presence) {
      return { presence: null, message: 'No presence data for this agent' }
    }
    return { presence }
  })

  // Set agent focus mode
  app.post<{ Params: { agent: string } }>('/presence/:agent/focus', async (request) => {
    const agent = request.params.agent
    const data = request.body as { active?: boolean; level?: string; durationMin?: number; reason?: string } | undefined

    const active = data?.active !== false // default true
    const level = (data?.level === 'deep' ? 'deep' : 'soft') as FocusLevel
    const durationMin = typeof data?.durationMin === 'number' ? data.durationMin : undefined
    const reason = typeof data?.reason === 'string' ? data.reason : undefined

    const focus = presenceManager.setFocus(agent, active, { level, durationMin, reason })
    return { success: true, agent, focus }
  })

  // Get agent focus state
  app.get<{ Params: { agent: string } }>('/presence/:agent/focus', async (request) => {
    const focus = presenceManager.isInFocus(request.params.agent)
    return { agent: request.params.agent, focus }
  })

  // Get all agent activity metrics
  app.get('/agents/activity', async () => {
    const activity = presenceManager.getAllActivity()
    return { activity }
  })

  // Get specific agent activity metrics
  app.get<{ Params: { agent: string } }>('/agents/:agent/activity', async (request) => {
    const activity = presenceManager.getAgentActivity(request.params.agent)
    if (!activity) {
      return { activity: null, message: 'No activity data for this agent' }
    }
    return { activity }
  })

  // ============ ACTIVITY FEED ENDPOINT ============

  // Get recent activity across all systems
  app.get('/activity', async (request, reply) => {
    const query = request.query as Record<string, string>
    const events = eventBus.getEvents({
      agent: query.agent,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.activity, MAX_LIMITS.activity),
      since: parseEpochMs(query.since),
    })
    const payload = { events, count: events.length }
    const lastModified = events.length > 0 ? Math.max(...events.map(e => e.timestamp || 0)) : undefined
    if (applyConditionalCaching(request, reply, payload, lastModified)) {
      return
    }
    return payload
  })

  // ============ ANALYTICS ENDPOINTS ============

  // Get Vercel analytics for forAgents.dev
  app.get('/analytics/foragents', async (request) => {
    const query = request.query as Record<string, string>
    const period = (query.period || '7d') as '1h' | '24h' | '7d' | '30d'
    
    const analytics = await analyticsManager.getForAgentsAnalytics(period)
    
    if (!analytics) {
      return { 
        error: 'Vercel analytics not configured', 
        message: 'Set VERCEL_TOKEN and VERCEL_PROJECT_ID in .env' 
      }
    }
    
    return { analytics }
  })

  // Get dev.to + forAgents content performance
  app.get('/content/performance', async () => {
    const performance = await analyticsManager.getContentPerformance()
    return { performance }
  })

  // Get task analytics
  app.get('/tasks/analytics', async (request) => {
    const query = request.query as Record<string, string>
    const since = query.since ? parseInt(query.since, 10) : undefined
    
    const analytics = analyticsManager.getTaskAnalytics(since)
    return { analytics }
  })

  // Operational metrics endpoint (lightweight dashboard contract)
  app.get('/metrics', async () => {
    const startedAt = Date.now()
    const now = Date.now()
    const oneHourAgo = now - (60 * 60 * 1000)

    const tasks = taskManager.getStats()
    const presence = presenceManager.getStats()
    const activity = presenceManager.getAllActivity()
    const messages = chatManager.getMessages({ limit: 500 })
    const recentMessagesLastHour = messages.filter(m => m.timestamp >= oneHourAgo).length

    const agentActivityRates = activity.map(item => {
      const anchor = item.first_seen_today || item.last_active || now
      const elapsedHours = Math.max((now - anchor) / (60 * 60 * 1000), 1 / 60)
      return {
        agent: item.agent,
        messagesPerHour: Number((item.messages_today / elapsedHours).toFixed(2)),
        tasksCompletedPerHour: Number((item.tasks_completed_today / elapsedHours).toFixed(2)),
        heartbeatsPerHour: Number((item.heartbeats_today / elapsedHours).toFixed(2)),
      }
    })

    return {
      tasks,
      chat: {
        totalMessages: messages.length,
        recentMessagesLastHour,
        messagesPerHour: Number((recentMessagesLastHour / 1).toFixed(2)),
      },
      presence: {
        totalAgents: presence.total,
        byStatus: presence.statusCounts,
      },
      agentActivityRates,
      uptimeMs: process.uptime() * 1000,
      responseTimeMs: Date.now() - startedAt,
      timestamp: now,
    }
  })

  // Daily funnel metrics by channel (visits -> signups -> activations)
  app.get('/metrics/daily', async (request, reply) => {
    const parsedQuery = MetricsDailyQuerySchema.safeParse(request.query)
    if (!parsedQuery.success) {
      reply.code(400)
      return {
        success: false,
        error: 'Invalid metrics daily query params',
        details: parsedQuery.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const timezone = parsedQuery.data.timezone || 'America/Vancouver'
    const funnel = await analyticsManager.getDailyFunnelMetrics(timezone)
    return { funnel }
  })

  // Get summary metrics dashboard
  app.get('/metrics/summary', async (request, reply) => {
    const query = request.query as Record<string, string>
    const includeContent = query.includeContent !== 'false'
    
    const summary = await analyticsManager.getMetricsSummary(includeContent)
    const rawTimestamp = (summary as any)?.timestamp || Date.now()
    const cacheBucketMs = Math.floor(rawTimestamp / 30000) * 30000 // 30s bucket

    const payload = {
      summary: {
        ...(summary as any),
        timestamp: cacheBucketMs,
      },
    }

    if (applyConditionalCaching(request, reply, payload, cacheBucketMs)) {
      return
    }
    return payload
  })

  // ============ CONTENT ENDPOINTS ============

  // Log a published piece of content
  app.post('/content/published', async (request) => {
    try {
      const body = request.body as {
        title: string
        topic: string
        url: string
        platform: 'dev.to' | 'foragents.dev' | 'medium' | 'substack' | 'twitter' | 'linkedin' | 'other'
        publishedBy: string
        publishedAt?: number
        tags?: string[]
        metadata?: Record<string, unknown>
      }

      if (!body.title || !body.topic || !body.url || !body.platform || !body.publishedBy) {
        return {
          success: false,
          error: 'title, topic, url, platform, and publishedBy are required',
        }
      }

      const publication = await contentManager.logPublication(body)

      // Update presence: publishing content = working
      if (body.publishedBy) {
        presenceManager.recordActivity(body.publishedBy, 'message')
        presenceManager.updatePresence(body.publishedBy, 'working')
      }

      return { success: true, publication }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get content calendar (scheduled/published/draft)
  app.get('/content/calendar', async (request) => {
    const query = request.query as Record<string, string>
    const calendar = contentManager.getCalendar({
      status: query.status as 'draft' | 'scheduled' | 'published' | undefined,
      assignee: query.assignee,
      platform: query.platform,
      tags: query.tags ? query.tags.split(',') : undefined,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.contentCalendar, MAX_LIMITS.contentCalendar),
      since: parseEpochMs(query.since),
    })
    return { calendar, count: calendar.length }
  })

  // Get publication log
  app.get('/content/published', async (request) => {
    const query = request.query as Record<string, string>
    const publications = contentManager.getPublications({
      platform: query.platform as any,
      publishedBy: query.publishedBy,
      tags: query.tags ? query.tags.split(',') : undefined,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.contentPublished, MAX_LIMITS.contentPublished),
      since: parseEpochMs(query.since),
    })
    return { publications, count: publications.length }
  })

  // Add or update calendar item
  app.post('/content/calendar', async (request) => {
    try {
      const body = request.body as {
        id?: string
        title: string
        topic: string
        status: 'draft' | 'scheduled' | 'published'
        assignee?: string
        createdBy: string
        scheduledFor?: number
        publishedAt?: number
        platform?: string
        url?: string
        tags?: string[]
        notes?: string
        metadata?: Record<string, unknown>
      }

      if (!body.title || !body.topic || !body.status || !body.createdBy) {
        return {
          success: false,
          error: 'title, topic, status, and createdBy are required',
        }
      }

      const item = await contentManager.upsertCalendarItem(body)

      // Update presence when adding content to calendar
      if (body.createdBy) {
        presenceManager.updatePresence(body.createdBy, 'working')
      }

      return { success: true, item }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Update content performance metrics
  app.patch<{ Params: { id: string } }>('/content/published/:id/performance', async (request) => {
    try {
      const body = request.body as {
        views?: number
        reactions?: number
        comments?: number
        shares?: number
      }

      const publication = await contentManager.updatePerformance(request.params.id, body)

      if (!publication) {
        return { success: false, error: 'Publication not found' }
      }

      return { success: true, publication }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get single publication
  app.get<{ Params: { id: string } }>('/content/published/:id', async (request) => {
    const publication = contentManager.getPublication(request.params.id)
    if (!publication) {
      return { error: 'Publication not found' }
    }
    return { publication }
  })

  // Get single calendar item
  app.get<{ Params: { id: string } }>('/content/calendar/:id', async (request) => {
    const item = contentManager.getCalendarItem(request.params.id)
    if (!item) {
      return { error: 'Calendar item not found' }
    }
    return { item }
  })

  // Delete calendar item
  app.delete<{ Params: { id: string } }>('/content/calendar/:id', async (request) => {
    const deleted = await contentManager.deleteCalendarItem(request.params.id)
    if (!deleted) {
      return { error: 'Calendar item not found' }
    }
    return { success: true }
  })

  // Get content stats
  app.get('/content/stats', async () => {
    const stats = contentManager.getStats()
    return { stats }
  })

  // ============ EVENT ENDPOINTS ============

  // Subscribe to events via SSE
  app.get('/events/subscribe', async (request, reply) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    const topics = query.topics ? query.topics.split(',').map(t => t.trim()) : undefined
    const types = query.types ? query.types.split(',').map(t => t.trim()) : undefined

    eventBus.subscribe(reply, agent, topics, types)
    
    // Keep the connection open - don't return anything
    // The reply is handled by the event bus
  })

  // Alias: /events → /events/subscribe (reflectt-channel plugin connects to /events)
  app.get('/events', async (request, reply) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    const topics = query.topics ? query.topics.split(',').map(t => t.trim()) : undefined
    const types = query.types ? query.types.split(',').map(t => t.trim()) : undefined

    eventBus.subscribe(reply, agent, topics, types)
  })

  // Get event bus status
  app.get('/events/status', async () => {
    return eventBus.getStatus()
  })

  // Get event batch configuration
  app.get('/events/config', async () => {
    return eventBus.getBatchConfig()
  })

  // Set event batch configuration
  app.post('/events/config', async (request) => {
    const body = request.body as { batchWindowMs: number }
    if (typeof body.batchWindowMs !== 'number') {
      return { error: 'batchWindowMs must be a number' }
    }
    try {
      eventBus.setBatchConfig(body.batchWindowMs)
      return { success: true, config: eventBus.getBatchConfig() }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // List valid event types for SSE filtering
  app.get('/events/types', async () => {
    return {
      types: Array.from(VALID_EVENT_TYPES),
      usage: 'GET /events/subscribe?types=task_created,task_updated to filter by exact event type',
    }
  })

  // ============ DATABASE ============

  app.get('/db/status', async () => {
    const { getDb } = await import('./db.js')
    try {
      const db = getDb()
      const version = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB '_*'").all() as { name: string }[]
      const counts: Record<string, number> = {}
      for (const { name } of tables) {
        const row = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get() as { c: number }
        counts[name] = row.c
      }
      return {
        status: 'ok',
        engine: 'sqlite',
        walMode: true,
        schemaVersion: version.v,
        tables: counts,
      }
    } catch (err: any) {
      return { status: 'error', error: err?.message }
    }
  })

  // ============ CLOUD INTEGRATION (see docs/CLOUD_ENDPOINTS.md) ============

  app.get('/cloud/status', async () => {
    const { getCloudStatus } = await import('./cloud.js')
    return getCloudStatus()
  })

  app.post('/cloud/reload', async () => {
    const { stopCloudIntegration, startCloudIntegration, getCloudStatus } = await import('./cloud.js')
    const { readFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { homedir } = await import('node:os')

    const reflecttHome = process.env.REFLECTT_HOME || join(homedir(), '.reflectt')
    const configPath = join(reflecttHome, 'config.json')

    if (!existsSync(configPath)) {
      return { success: false, error: 'No config.json found', configPath }
    }

    let config: any
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err: any) {
      return { success: false, error: `Failed to parse config.json: ${err?.message}` }
    }

    if (!config.cloud) {
      return { success: false, error: 'No cloud enrollment found in config.json' }
    }

    // Update env vars from config
    const cloud = config.cloud
    if (cloud.cloudUrl) process.env.REFLECTT_CLOUD_URL = cloud.cloudUrl
    if (cloud.hostName) process.env.REFLECTT_HOST_NAME = cloud.hostName
    if (cloud.hostType) process.env.REFLECTT_HOST_TYPE = cloud.hostType
    if (cloud.hostId) process.env.REFLECTT_HOST_ID = cloud.hostId
    if (cloud.credential) {
      process.env.REFLECTT_HOST_CREDENTIAL = cloud.credential
      process.env.REFLECTT_HOST_TOKEN = cloud.credential
    }

    // Restart cloud integration
    stopCloudIntegration()
    await startCloudIntegration()

    return {
      success: true,
      message: 'Cloud integration reloaded from config.json',
      status: getCloudStatus(),
    }
  })

  app.get('/runtime/truth', async () => {
    const build = getBuildInfo()
    const deploy = await releaseManager.getDeployStatus()

    let cloud: Record<string, unknown> = {
      configured: false,
      registered: false,
      running: false,
      heartbeatCount: 0,
      errors: 0,
    }

    try {
      const { getCloudStatus } = await import('./cloud.js')
      cloud = getCloudStatus() as Record<string, unknown>
    } catch (err: any) {
      cloud = {
        configured: false,
        registered: false,
        running: false,
        heartbeatCount: 0,
        errors: 0,
        error: err?.message || 'cloud status unavailable',
      }
    }

    return {
      timestamp: Date.now(),
      repo: {
        name: process.env.REFLECTT_REPO || 'reflectt/reflectt-node',
        branch: build.gitBranch,
        sha: build.gitSha,
        shortSha: build.gitShortSha,
        cwd: process.cwd(),
      },
      runtime: {
        status: 'running',
        pid: build.pid,
        nodeVersion: build.nodeVersion,
        startedAt: build.startedAt,
        uptimeSec: build.uptime,
        host: serverConfig.host,
        port: serverConfig.port,
        baseUrl: `http://${serverConfig.host}:${serverConfig.port}`,
      },
      ports: {
        api: serverConfig.port,
        dashboard: serverConfig.port,
      },
      cloud,
      deploy: {
        stale: Boolean(deploy.stale),
        reasons: Array.isArray(deploy.reasons) ? deploy.reasons : [],
        startupCommit: deploy.startup?.commit || null,
        currentCommit: deploy.current?.commit || null,
      },
      paths: {
        reflecttHome: REFLECTT_HOME,
      },
    }
  })

  // ============ OPENCLAW ENDPOINTS ============

  // OpenClaw status (TODO: wire up when gateway token configured)
  app.get('/openclaw/status', async () => {
    return { connected: false, note: 'OpenClaw integration pending' }
  })

  // ============ MCP ENDPOINTS ============

  // MCP HTTP endpoint (new protocol)
  app.all('/mcp', async (request, reply) => {
    const fullUrl = `http://${request.headers.host || 'localhost'}${request.url}`
    const req = new Request(fullUrl, {
      method: request.method,
      headers: request.headers as any,
      body: request.body ? JSON.stringify(request.body) : undefined,
    })
    const response = await handleMCPRequest(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    const body = await response.text()
    return body
  })

  // MCP SSE endpoint (legacy protocol)
  app.get('/sse', async (request, reply) => {
    const fullUrl = `http://${request.headers.host || 'localhost'}${request.url}`
    const req = new Request(fullUrl)
    const response = await handleSSERequest(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    reply.send(response.body)
  })

  // MCP messages endpoint (legacy protocol)
  app.post('/mcp/messages', async (request, reply) => {
    const fullUrl = `http://${request.headers.host || 'localhost'}${request.url}`
    const req = new Request(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
    })
    const response = await handleMessagesRequest(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    const body = await response.text()
    return body
  })

  return app
}
