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
import { promises as fs, existsSync, readFileSync, readdirSync } from 'fs'
import { resolve, sep, join } from 'path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { execSync } from 'child_process'
import { serverConfig, isDev, REFLECTT_HOME } from './config.js'

// ── Build info (read once at startup) ──────────────────────────────────────
const BUILD_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    return pkg.version || '0.0.0'
  } catch { return '0.0.0' }
})()

const BUILD_COMMIT = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 3000 }).trim()
  } catch { return 'unknown' }
})()

const BUILD_STARTED_AT = Date.now()
import { chatManager } from './chat.js'
import { taskManager } from './tasks.js'
import { detectApproval, applyApproval } from './chat-approval-detector.js'
import { inboxManager } from './inbox.js'
import { getDb } from './db.js'
import type { AgentMessage, Task } from './types.js'
import { handleMCPRequest, handleSSERequest, handleMessagesRequest } from './mcp.js'
import { memoryManager } from './memory.js'
import { eventBus, VALID_EVENT_TYPES } from './events.js'
import { presenceManager } from './presence.js'
import { startSweeper, getSweeperStatus, sweepValidatingQueue, flagPrDrift, generateDriftReport } from './executionSweeper.js'
import { autoPopulateCloseGate, tryAutoCloseTask, getMergeAttemptLog } from './prAutoMerge.js'
import { recordReviewMutation, diffReviewFields, getAuditEntries, loadAuditLedger } from './auditLedger.js'
import { listSharedFiles, readSharedFile, resolveTaskArtifact, validatePath, ALLOWED_EXTENSIONS } from './shared-workspace-api.js'
import { normalizeArtifactPath, normalizeTaskArtifactPaths, buildGitHubBlobUrl, buildGitHubRawUrl } from './artifact-resolver.js'
import {
  emitActivationEvent,
  getUserFunnelState,
  getFunnelSummary,
  hasCompletedEvent,
  isDay2Eligible,
  loadActivationFunnel,
  getConversionFunnel,
  getFailureDistribution,
  getWeeklyTrends,
  getOnboardingDashboard,
  type ActivationEventType,
} from './activationEvents.js'
import { alertUnauthorizedApproval, alertFlipAttempt, getMutationAlertStatus, pruneOldAttempts } from './mutationAlert.js'
import { mentionAckTracker } from './mention-ack.js'
import type { PresenceStatus, FocusLevel } from './presence.js'
import { analyticsManager } from './analytics.js'
import { getDashboardHTML } from './dashboard.js'
import { healthMonitor, computeActiveLane } from './health.js'
import { contentManager } from './content.js'
import { experimentsManager } from './experiments.js'
import { releaseManager } from './release.js'
import { researchManager } from './research.js'
import { wsHeartbeat } from './ws-heartbeat.js'
import { getBuildInfo } from './buildInfo.js'
import { appendStoredLog, readStoredLogs, getStoredLogPath } from './logStore.js'
import { getAgentRoles, getAgentRolesSource, loadAgentRoles, startConfigWatch, suggestAssignee, suggestReviewer, checkWipCap, saveAgentRoles, scoreAssignment, getAgentRole } from './assignment.js'
import { initTelemetry, trackRequest as trackTelemetryRequest, trackError as trackTelemetryError, trackTaskEvent, getSnapshot as getTelemetrySnapshot, getTelemetryConfig, isTelemetryEnabled, stopTelemetry } from './telemetry.js'
import { recordUsage, recordUsageBatch, getUsageSummary, getUsageByAgent, getUsageByModel, getUsageByTask, setCap, listCaps, deleteCap, checkCaps, getRoutingSuggestions, estimateCost, ensureUsageTables, type UsageEvent, type SpendCap } from './usage-tracking.js'
import { getTeamConfigHealth } from './team-config.js'
import { SecretVault } from './secrets.js'
import type { GitHubIdentityProvider } from './github-identity.js'
import { computeCiFromCheckRuns, computeCiFromCombinedStatus } from './github-ci.js'
import { createGitHubIdentityProvider } from './github-identity.js'
import { getProvisioningManager } from './provisioning.js'
import { getWebhookDeliveryManager } from './webhooks.js'
import { exportBundle, importBundle } from './portability.js'
import { getNotificationManager } from './notifications.js'
import { getConnectivityManager } from './connectivity.js'
import { boardHealthWorker } from './boardHealthWorker.js'
import { buildAgentFeed, type FeedEventKind } from './changeFeed.js'
import { policyManager } from './policy.js'
import { runPrecheck, applyAutoDefaults } from './taskPrecheck.js'
import { resolveRoute, getRoutingLog, getRoutingStats, type MessageSeverity, type MessageCategory } from './messageRouter.js'
import { noiseBudgetManager } from './noise-budget.js'
import { suppressionLedger } from './suppression-ledger.js'
import {
  submitFeedback,
  listFeedback,
  getFeedback,
  updateFeedback,
  voteFeedback,
  checkRateLimit,
  getTriageQueue,
  buildTriageTask,
  markTriaged,
  computeSLAStatus,
  TIER_POLICIES,
  type FeedbackQuery,
  type FeedbackSeverity,
  type FeedbackReporterType,
  type SupportTier,
} from './feedback.js'
import {
  createEscalation,
  acknowledgeEscalation,
  resolveEscalation,
  tickEscalations,
  getEscalation,
  getEscalationByFeedback,
  listEscalations,
  setAlertSink,
  type EscalationStatus,
} from './escalation.js'
import { slotManager as canvasSlots } from './canvas-slots.js'
import { createReflection, getReflection, listReflections, countReflections, reflectionStats, validateReflection, ROLE_TYPES, SEVERITY_LEVELS } from './reflections.js'
import { ingestReflection, getInsight, listInsights, insightStats, INSIGHT_STATUSES, extractClusterKey, tickCooldowns, updateInsightStatus, getOrphanedInsights, reconcileInsightTaskLinks, getLoopSummary } from './insights.js'
import { promoteInsight, validatePromotionInput, generateRecurringCandidates, listPromotionAudits, getPromotionAuditByInsight, type PromotionInput } from './insight-promotion.js'
import { runIntake, batchIntake, pipelineMaintenance, getPipelineStats } from './intake-pipeline.js'
import { listLineage, getLineage, lineageStats } from './lineage.js'
import { startInsightTaskBridge, stopInsightTaskBridge, getInsightTaskBridgeStats, configureBridge, getBridgeConfig, resolveAssignment } from './insight-task-bridge.js'
import { startShippedHeartbeat, stopShippedHeartbeat, getShippedHeartbeatStats } from './shipped-heartbeat.js'
import { initContactsTable, createContact, getContact, updateContact, deleteContact, listContacts, countContacts } from './contacts.js'
import { processRender, logRejection, getRecentRejections, subscribeCanvas } from './canvas-multiplexer.js'
import { startTeamPulse, stopTeamPulse, postTeamPulse, computeTeamPulse, getTeamPulseConfig, configureTeamPulse, getTeamPulseHistory } from './team-pulse.js'
import { runTeamDoctor } from './team-doctor.js'
import { createStarterTeam } from './starter-team.js'
import { validatePrIntegrity, type PrIntegrityResult } from './pr-integrity.js'
import { createOverride, getOverride, listOverrides, findActiveOverride, validateOverrideInput, tickOverrideLifecycle, type CreateOverrideInput } from './routing-override.js'
import { getRoutingApprovalQueue, getRoutingSuggestion, buildApprovalPatch, buildRejectionPatch, buildRoutingSuggestionPatch, isRoutingApproval } from './routing-approvals.js'
import { calendarManager, type BlockType, type CreateBlockInput, type UpdateBlockInput } from './calendar.js'
import { calendarEvents, type CreateEventInput, type UpdateEventInput, type AttendeeStatus } from './calendar-events.js'
import { startReminderEngine, stopReminderEngine, getReminderEngineStats } from './calendar-reminder-engine.js'
import { exportICS, exportEventICS, importICS, parseICS } from './calendar-ical.js'
import { createDoc, getDoc, listDocs, updateDoc, deleteDoc, countDocs, VALID_CATEGORIES, type CreateDocInput, type UpdateDocInput, type DocCategory } from './knowledge-docs.js'
import { onTaskShipped, onProcessFileWritten, onDecisionComment, isDecisionComment } from './knowledge-auto-index.js'

// Schemas
const SendMessageSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  content: z.string().min(1),
  channel: z.string().optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

// Task type determines required fields beyond the base schema
const TASK_TYPES = ['bug', 'feature', 'process', 'docs', 'chore'] as const
type TaskType = typeof TASK_TYPES[number]

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  type: z.enum(TASK_TYPES).optional(), // optional for backward compat, validated when present
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).default('todo'),
  assignee: z.string().trim().min(1),
  reviewer: z.string().trim().min(1).or(z.literal('auto')).default('auto'), // 'auto' triggers load-balanced assignment
  done_criteria: z.array(z.string().trim().min(1)).min(1),
  eta: z.string().trim().min(1),
  createdBy: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P3'),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  teamId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

/**
 * Definition-of-ready check: validates task quality at creation time.
 * Returns array of problems (empty = ready).
 */
function checkDefinitionOfReady(data: z.infer<typeof CreateTaskSchema>): string[] {
  const problems: string[] = []

  // Title quality: reject vague/generic titles
  const vaguePatterns = [
    /^fix\s*$/i,
    /^update\s*$/i,
    /^todo\s*$/i,
    /^task\s*$/i,
    /^do\s+the\s+thing/i,
    /^implement\s*$/i,
    /^work\s+on/i,
    /^stuff/i,
  ]
  if (vaguePatterns.some(p => p.test(data.title.trim()))) {
    problems.push(`Title "${data.title}" is too vague. Include what/where/why.`)
  }

  // Title minimum length (at least a subject + verb)
  if (data.title.trim().length < 10) {
    problems.push(`Title must be at least 10 characters (got ${data.title.trim().length}). Be specific about what needs to happen.`)
  }

  // Done criteria quality: reject single-word criteria
  for (const criterion of data.done_criteria) {
    if (criterion.split(/\s+/).length < 3) {
      problems.push(`Done criterion "${criterion}" is too vague. Use a full sentence describing the verifiable outcome.`)
    }
  }

  // Type-specific checks
  if (data.type === 'bug') {
    // Bugs should reference what's broken
    const hasImpactWord = /break|broken|fail|error|crash|stuck|wrong|missing|block/i.test(data.title + ' ' + (data.description || ''))
    if (!hasImpactWord && !data.metadata?.source) {
      problems.push('Bug tasks should describe the impact (what\'s broken) in the title or description, or include metadata.source.')
    }
  }

  if (data.type === 'feature') {
    // Features should have at least 2 done criteria
    if (data.done_criteria.length < 2) {
      problems.push('Feature tasks should have at least 2 done criteria (user-facing outcome + verification).')
    }
  }

  // Type-specific: docs tasks should reference what docs are needed
  if (data.type === 'docs') {
    const hasDocContext = /doc|guide|readme|spec|architecture|api|reference/i.test(data.title + ' ' + (data.description || ''))
    if (!hasDocContext) {
      problems.push('Docs tasks should mention what documentation is needed (guide, spec, API reference, etc.).')
    }
  }

  // Type-specific: process tasks should describe what changes
  if (data.type === 'process') {
    const hasProcessContext = /enforce|automate|improve|change|add|remove|update|track|monitor|alert|gate|check|validate/i.test(data.title + ' ' + (data.description || ''))
    if (!hasProcessContext) {
      problems.push('Process tasks should describe what process is being changed or improved.')
    }
  }

  // Reflection-origin invariant: all tasks must trace back to a reflection/insight
  // unless explicitly exempted (system tasks, recurring materialization, etc.)
  const meta = (data.metadata || {}) as Record<string, unknown>
  const hasReflectionSource = Boolean(meta.source_reflection || meta.source_insight || meta.source === 'reflection_pipeline')
  const isExempt = Boolean(meta.reflection_exempt)
  const hasExemptReason = typeof meta.reflection_exempt_reason === 'string' && meta.reflection_exempt_reason.trim().length > 0

  if (!hasReflectionSource && !isExempt) {
    problems.push(
      'Reflection-origin required: tasks must include metadata.source_reflection or metadata.source_insight. ' +
      'If this task legitimately does not originate from a reflection, set metadata.reflection_exempt=true with metadata.reflection_exempt_reason.'
    )
  }
  if (isExempt && !hasExemptReason) {
    problems.push('reflection_exempt=true requires reflection_exempt_reason explaining why this task is exempt from reflection-origin policy.')
  }

  return problems
}

const MODEL_ALIASES: Record<string, string> = {
  gpt: 'openai-codex/gpt-5.3',
  'gpt-codex': 'openai-codex/gpt-5.3-codex',
  opus: 'anthropic/claude-opus-4-6',
  sonnet: 'anthropic/claude-sonnet-4-5',
}

const DEFAULT_MODEL_ALIAS = 'gpt-codex'
const PROVIDER_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i

function normalizeConfiguredModel(value: unknown): { ok: boolean; value?: string; resolved?: string; error?: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: 'Model must be a string' }
  }
  const raw = value.trim()
  if (!raw) {
    return { ok: false, error: 'Model cannot be empty' }
  }

  const alias = raw.toLowerCase()
  if (MODEL_ALIASES[alias]) {
    return { ok: true, value: raw, resolved: MODEL_ALIASES[alias] }
  }

  if (PROVIDER_MODEL_PATTERN.test(raw)) {
    return { ok: true, value: raw, resolved: raw }
  }

  return {
    ok: false,
    error: `Unknown model identifier "${raw}". Allowed aliases: ${Object.keys(MODEL_ALIASES).join(', ')} or provider/model format.`,
  }
}

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
  // Optional categorization for comms_policy enforcement
  category: z.string().trim().min(1).optional(),
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

const ReviewPacketSchema = z.object({
  task_id: z.string().trim().regex(/^task-[a-z0-9-]+$/i, 'must be a task-* id'),
  pr_url: z.string().trim().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:$|[/?#])/i, 'must be a GitHub PR URL'),
  commit: z.string().trim().min(7),
  changed_files: z.array(z.string().trim().min(1)).min(1),
  artifact_path: z.string().trim().regex(/^process\/.+/, 'must be repo-relative under process/'),
  caveats: z.string().trim().min(1),
})

const QaBundleSchema = z.object({
  lane: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  pr_link: z.string().trim().min(1).optional(),        // optional for config_only tasks
  commit_shas: z.array(z.string().trim().min(1)).optional(),  // optional for config_only tasks
  changed_files: z.array(z.string().trim().min(1)).min(1),
  artifact_links: z.array(z.string().trim().min(1)).min(1),
  checks: z.array(z.string().trim().min(1)).min(1),
  screenshot_proof: z.array(z.string().trim().min(1)).min(1),
  reviewer_notes: z.string().trim().min(1).optional(),
  config_only: z.boolean().optional(),  // true for ~/.reflectt/ config artifacts
  non_code: z.boolean().optional(),
  review_packet: ReviewPacketSchema,
})

const ReviewHandoffSchema = z.object({
  task_id: z.string().trim().regex(/^task-[a-zA-Z0-9-]+$/),
  repo: z.string().trim().min(1).optional(),  // optional for config_only tasks
  artifact_path: z.string().trim().min(1),    // relaxed: accepts any path (process/, ~/.reflectt/, etc.)
  test_proof: z.string().trim().min(1),
  known_caveats: z.string().trim().min(1),
  doc_only: z.boolean().optional(),
  config_only: z.boolean().optional(),  // true for ~/.reflectt/ config artifacts
  non_code: z.boolean().optional(),
  pr_url: z.string().trim().url().optional(),
  commit_sha: z.string().trim().regex(/^[a-fA-F0-9]{7,40}$/).optional(),
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
  limit: z.string().regex(/^\d+$/).optional(),
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
  expectedTaskId?: string,
): { ok: true } | { ok: false; error: string; hint: string } {
  if (status !== 'validating') return { ok: true }
  if (isTaskAutomatedRecurring(metadata)) return { ok: true }

  const root = ((metadata ?? {}) as Record<string, unknown>)

  // Non-code/doc-only/config-only tasks can satisfy validating via review_handoff alone.
  // Requiring a code-shaped qa_bundle.review_packet (PR/commit/files) blocks strategic tasks.
  const handoff = ReviewHandoffSchema.safeParse(root.review_handoff ?? {})
  if (handoff.success) {
    const h = handoff.data
    const nonCodeLane = h.doc_only === true || h.config_only === true || h.non_code === true || isDesignOrDocsLane(root)
    if (nonCodeLane) return { ok: true }
  }

  const parsed = z
    .object({
      qa_bundle: QaBundleSchema,
    })
    .safeParse(root)

  if (!parsed.success) {
    const missing = parsed.error.issues
      .map(issue => {
        const path = issue.path.join('.')
        const label = path ? `metadata.${path}` : 'metadata'
        return `${label} (${issue.message})`
      })
    const detail = missing.length > 0 ? ` Missing/invalid: ${missing.join(', ')}.` : ''
    return {
      ok: false,
      error: `Review packet required before validating.${detail}`,
      hint: 'Include metadata.qa_bundle.review_packet with: task_id, pr_url, commit, changed_files[], artifact_path, caveats (plus summary/artifact_links/checks).',
    }
  }

  const metadataObj = (metadata ?? {}) as Record<string, unknown>
  const nonCodeLane = parsed.data.qa_bundle.non_code === true || isDesignOrDocsLane(metadataObj)
  const reviewPacket = parsed.data.qa_bundle.review_packet

  if (!nonCodeLane && expectedTaskId && reviewPacket.task_id !== expectedTaskId) {
    return {
      ok: false,
      error: `Review packet task mismatch: metadata.qa_bundle.review_packet.task_id must match ${expectedTaskId}`,
      hint: 'Set review_packet.task_id to the current task ID before moving to validating.',
    }
  }

  const artifactPath = typeof metadataObj.artifact_path === 'string' ? metadataObj.artifact_path.trim() : ''
  if (!nonCodeLane && artifactPath && artifactPath !== reviewPacket.artifact_path) {
    return {
      ok: false,
      error: 'Review packet mismatch: metadata.qa_bundle.review_packet.artifact_path must match metadata.artifact_path',
      hint: 'Use the same canonical process/... artifact path in both fields.',
    }
  }

  // PR integrity: validate commit SHA + changed_files against live PR head
  if (!nonCodeLane && reviewPacket.pr_url) {
    const overrideFlag = metadataObj.pr_integrity_override === true
    if (!overrideFlag) {
      const integrity = validatePrIntegrity({
        pr_url: reviewPacket.pr_url,
        packet_commit: reviewPacket.commit,
        packet_changed_files: reviewPacket.changed_files,
      })

      // Store integrity result in metadata for audit trail
      ;(metadataObj as Record<string, unknown>).pr_integrity = {
        valid: integrity.valid,
        skipped: integrity.skipped,
        skip_reason: integrity.skip_reason,
        live_head_sha: integrity.live_head_sha,
        checked_at: Date.now(),
        errors: integrity.errors.length > 0 ? integrity.errors : undefined,
      }

      if (!integrity.valid && !integrity.skipped) {
        const errorMsgs = integrity.errors.map(e => e.message).join('; ')
        return {
          ok: false,
          error: `PR integrity check failed: ${errorMsgs}`,
          hint: 'Update review_packet.commit and changed_files to match the live PR head. Or set metadata.pr_integrity_override=true to bypass.',
        }
      }
    }
  }

  return { ok: true }
}

function applyReviewStateMetadata(
  existing: Task,
  parsed: z.infer<typeof UpdateTaskSchema>,
  mergedMeta: Record<string, unknown>,
  now: number,
): Record<string, unknown> {
  const metadata = { ...mergedMeta }
  const previousStatus = existing.status
  const nextStatus = parsed.status ?? existing.status
  const incomingMeta = parsed.metadata ?? {}
  const incomingReviewState = typeof incomingMeta.review_state === 'string'
    ? incomingMeta.review_state.trim().toLowerCase()
    : ''

  if (nextStatus === 'validating' && previousStatus !== 'validating') {
    metadata.entered_validating_at = now
    if (!incomingReviewState) {
      metadata.review_state = 'queued'
    }
    metadata.review_last_activity_at = now

    // ── Artifact path normalization on validating transition ──
    // Normalize workspace-prefixed paths to repo-relative.
    // This prevents reviewers from hitting "file not found" due to workspace-dependent paths.
    const normResult = normalizeTaskArtifactPaths(metadata)
    if (normResult.rejected.length > 0) {
      // Log but don't block — auto-normalize what we can
      console.warn(`[ArtifactNormalize] task ${existing.id}: rejected paths:`, normResult.rejected)
    }
    if (Object.keys(normResult.patches).length > 0) {
      Object.assign(metadata, normResult.patches)
      metadata.artifact_normalization = {
        normalized: true,
        warnings: normResult.warnings,
        rejected: normResult.rejected,
        normalizedAt: new Date().toISOString(),
      }
      console.log(`[ArtifactNormalize] task ${existing.id}: normalized`, normResult.warnings)
    }
  }

  if (previousStatus === 'validating' && nextStatus === 'doing' && !incomingReviewState) {
    metadata.review_state = 'needs_author'
    metadata.review_last_activity_at = now
  }

  const actor = parsed.actor?.trim()
  if (
    nextStatus === 'validating'
    && actor
    && existing.reviewer
    && actor.toLowerCase() === existing.reviewer.toLowerCase()
    && !incomingReviewState
  ) {
    metadata.review_state = 'in_progress'
    metadata.review_last_activity_at = now
  }

  const touchedReviewFields =
    Object.prototype.hasOwnProperty.call(incomingMeta, 'review_state')
    || Object.prototype.hasOwnProperty.call(incomingMeta, 'reviewer_approved')
    || Object.prototype.hasOwnProperty.call(incomingMeta, 'review_notes')
    || Object.prototype.hasOwnProperty.call(incomingMeta, 'review_last_activity_at')

  if (touchedReviewFields) {
    metadata.review_last_activity_at = now
  }

  if (metadata.reviewer_approved === true) {
    metadata.review_state = 'approved'
    metadata.review_last_activity_at = now
  }

  return metadata
}

function isTaskAutomatedRecurring(metadata: unknown): boolean {
  const recurringId = (metadata as Record<string, unknown> | null)?.recurring as Record<string, unknown> | undefined
  return typeof recurringId?.id === 'string' && recurringId.id.trim().length > 0
}

function normalizeLaneValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isDesignOrDocsLane(metadata: Record<string, unknown>): boolean {
  const lane = normalizeLaneValue(metadata.lane)
  if (lane.includes('design') || lane.includes('docs') || lane.includes('documentation')) return true

  const supports = normalizeLaneValue(metadata.supports)
  if (supports.includes('design') || supports.includes('docs') || supports.includes('documentation')) return true

  const qaBundle = (metadata.qa_bundle as Record<string, unknown> | undefined) || {}
  const qaLane = normalizeLaneValue(qaBundle.lane)
  if (qaLane.includes('design') || qaLane.includes('docs') || qaLane.includes('documentation')) return true

  return false
}

function hasExplicitReassignment(metadata: Record<string, unknown>): boolean {
  const directBoolean = [
    metadata.reassigned,
    metadata.manual_reassignment,
    metadata.owner_override,
    metadata.assignment_override,
  ].some((value) => value === true)
  if (directBoolean) return true

  const directText = [
    metadata.reassignment,
    metadata.reassign_reason,
    metadata.reassigned_by,
    metadata.assignment_reason,
    metadata.assignment_override_reason,
    metadata.owner_override_reason,
    metadata.reviewer_reassign_reason,
  ]

  return directText.some((value) => typeof value === 'string' && value.trim().length > 0)
}

function inferTaskWorkDomain(task: Task): 'ops' | 'content' | 'design' | 'qa' | 'analysis' | 'backend' | 'unknown' {
  const metadata = (task.metadata || {}) as Record<string, unknown>
  const pieces = [
    task.title || '',
    task.description || '',
    typeof metadata.lane === 'string' ? metadata.lane : '',
    typeof metadata.supports === 'string' ? metadata.supports : '',
    Array.isArray(task.tags) ? task.tags.join(' ') : '',
    Array.isArray(metadata.tags) ? metadata.tags.filter((v): v is string => typeof v === 'string').join(' ') : '',
  ].join(' ').toLowerCase()

  if (/(content|copy|messaging|marketing|landing|docs|documentation|blog|social|brand)/i.test(pieces)) return 'content'
  if (/(design|ux|ui|visual|polish|layout|figma)/i.test(pieces)) return 'design'
  if (/(qa|review|validation|audit|compliance|security)/i.test(pieces)) return 'qa'
  if (/(analysis|analytics|research|insight|metrics|reporting)/i.test(pieces)) return 'analysis'
  if (/(backend|api|database|migration|fastify|server|typescript)/i.test(pieces)) return 'backend'
  if (/(ops|infra|ci|deploy|release|pipeline|watchdog|system)/i.test(pieces)) return 'ops'
  return 'unknown'
}

function isEchoOutOfLaneTask(task: Task): boolean {
  const assignee = (task.assignee || '').trim().toLowerCase()
  if (assignee !== 'echo') return false
  const role = getAgentRole('echo')
  if (!role) return false

  const domain = inferTaskWorkDomain(task)
  if (domain === 'unknown' || domain === 'content') return false

  const metadata = (task.metadata || {}) as Record<string, unknown>
  if (hasExplicitReassignment(metadata)) return false

  // For Echo, anything classified outside content/docs voice lane gets flagged unless reassigned.
  return true
}

function enforceReviewHandoffGateForValidating(
  status: Task['status'] | undefined,
  taskId: string,
  metadata: unknown,
): { ok: true } | { ok: false; error: string; hint: string } {
  if (status !== 'validating') return { ok: true }
  if (isTaskAutomatedRecurring(metadata)) return { ok: true }

  const root = (metadata as Record<string, unknown> | null) || {}
  const parsed = ReviewHandoffSchema.safeParse(root.review_handoff ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Review handoff required: metadata.review_handoff must include task_id, artifact_path, test_proof, known_caveats (and pr_url + commit_sha unless doc_only=true or config_only=true).',
      hint: 'Example: { "review_handoff": { "task_id":"task-...", "repo":"reflectt/reflectt-node", "pr_url":"https://github.com/.../pull/123", "commit_sha":"abc1234", "artifact_path":"process/TASK-...md", "test_proof":"npm test -- ... (pass)", "known_caveats":"none" } }. For config tasks: set config_only=true.',
    }
  }

  const handoff = parsed.data
  if (handoff.task_id !== taskId) {
    return {
      ok: false,
      error: `Review handoff task_id mismatch: expected ${taskId}`,
      hint: 'Set metadata.review_handoff.task_id to the exact task being transitioned.',
    }
  }

  // config_only: artifacts live in ~/.reflectt/, no repo/PR required
  // doc_only/non_code/design/docs lanes: no PR/commit required
  const nonCodeLane = handoff.non_code === true || isDesignOrDocsLane(root)
  if (!handoff.doc_only && !handoff.config_only && !nonCodeLane) {
    if (!handoff.pr_url || !parseGitHubPrUrl(handoff.pr_url)) {
      return {
        ok: false,
        error: 'Validating gate: open PR URL required in metadata.review_handoff.pr_url (or set doc_only=true for docs-only, config_only=true for ~/.reflectt/ config tasks).',
        hint: 'Use a canonical PR URL like https://github.com/<owner>/<repo>/pull/<number>.',
      }
    }
    if (!handoff.commit_sha) {
      return {
        ok: false,
        error: 'Validating gate: commit SHA required in metadata.review_handoff.commit_sha when doc_only/config_only is not set.',
        hint: 'Use 7-40 hex chars, e.g. "a1b2c3d".',
      }
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

function getDesignHandoffArtifactPath(metadata: Record<string, unknown>): string | undefined {
  const artifactPath = metadata.artifact_path
  if (typeof artifactPath === 'string' && artifactPath.trim().length > 0) {
    return artifactPath.trim()
  }

  const artifacts = metadata.artifacts
  if (Array.isArray(artifacts)) {
    const firstPath = artifacts.find((item) => typeof item === 'string' && item.trim().length > 0)
    if (typeof firstPath === 'string') return firstPath.trim()
  }

  return undefined
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

const FOLLOW_ON_REQUIRED_TASK_TYPES = new Set(['spec', 'design', 'research'])

type FollowOnEvidence = {
  required: boolean
  state: 'linked' | 'na' | 'missing' | 'not_required'
  taskType?: string
  followOnTaskId?: string
  followOnNaReason?: string
}

function normalizeTaskType(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function inferFollowOnPolicy(task: Task, mergedMeta?: Record<string, unknown>): { required: boolean; taskType?: string } {
  const taskMeta = (task.metadata || {}) as Record<string, unknown>
  const candidates: unknown[] = [
    (task as any).type,
    mergedMeta?.task_type,
    taskMeta.task_type,
    mergedMeta?.work_type,
    taskMeta.work_type,
    mergedMeta?.type,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeTaskType(candidate)
    if (normalized && FOLLOW_ON_REQUIRED_TASK_TYPES.has(normalized)) {
      return { required: true, taskType: normalized }
    }
  }

  const tags = new Set<string>()
  const addTag = (value: unknown) => {
    if (typeof value !== 'string') return
    const normalized = value.trim().toLowerCase()
    if (normalized.length > 0) tags.add(normalized)
  }

  const tagArrays: unknown[] = [task.tags, taskMeta.tags, mergedMeta?.tags]
  for (const arr of tagArrays) {
    if (!Array.isArray(arr)) continue
    for (const tag of arr) addTag(tag)
  }

  for (const tag of tags) {
    if (FOLLOW_ON_REQUIRED_TASK_TYPES.has(tag)) {
      return { required: true, taskType: tag }
    }
  }

  return { required: false }
}

function getFollowOnEvidence(task: Task): FollowOnEvidence {
  const meta = (task.metadata || {}) as Record<string, unknown>
  const policy = inferFollowOnPolicy(task)
  if (!policy.required) {
    return { required: false, state: 'not_required' }
  }

  const followOnTaskId = typeof meta.follow_on_task_id === 'string' ? meta.follow_on_task_id.trim() : ''
  const followOnNa = meta.follow_on_na === true
  const followOnNaReason = typeof meta.follow_on_na_reason === 'string' ? meta.follow_on_na_reason.trim() : ''

  if (followOnTaskId.length > 0) {
    return {
      required: true,
      state: 'linked',
      taskType: policy.taskType,
      followOnTaskId,
    }
  }

  if (followOnNa && followOnNaReason.length > 0) {
    return {
      required: true,
      state: 'na',
      taskType: policy.taskType,
      followOnNaReason,
    }
  }

  return {
    required: true,
    state: 'missing',
    taskType: policy.taskType,
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

// (github identity imports moved to top)

let githubIdentityProvider: GitHubIdentityProvider | null = null

async function githubHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const token = await githubIdentityProvider?.getToken()
  if (token?.token) h.Authorization = `Bearer ${token.token}`
  return h
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
    source: 'github-check-runs' | 'github-status' | 'unavailable'
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
      headers: await githubHeaders(),
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

    let ci: { state: 'success' | 'failure' | 'pending' | 'error' | 'unknown'; source: 'github-check-runs' | 'github-status' | 'unavailable'; details?: string } = {
      state: 'unknown',
      source: 'unavailable',
      details: 'No commit SHA resolved',
    }

    if (headSha) {
      // Prefer check-runs (modern CI signal). Many repos do not publish commit statuses.
      try {
        const checksRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${headSha}/check-runs?per_page=100`, {
          headers: await githubHeaders(),
        })

        if (checksRes.ok) {
          const checksJson = await checksRes.json() as any
          const checkRuns = Array.isArray(checksJson?.check_runs) ? checksJson.check_runs : []
          const computed = computeCiFromCheckRuns(checkRuns)
          if (computed.state !== 'unknown') {
            ci = {
              state: computed.state,
              source: 'github-check-runs',
              ...(computed.details ? { details: computed.details } : {}),
            }
          }
        }
      } catch {
        // ignore and fall back
      }

      // Fall back to combined status API if we couldn't determine via check-runs.
      if (ci.source === 'unavailable') {
        const statusRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${headSha}/status`, {
          headers: await githubHeaders(),
        })
        if (statusRes.ok) {
          const statusJson = await statusRes.json() as any
          const computed = computeCiFromCombinedStatus(statusJson?.state)
          ci = {
            state: computed.state,
            source: 'github-status',
            ...(computed.details ? { details: computed.details } : {}),
          }
        } else {
          ci = {
            state: 'unknown',
            source: 'unavailable',
            details: `GitHub status lookup failed (${statusRes.status})`,
          }
        }
      }

      // If check-runs returned but were unknown and status API is empty/pending, preserve check-runs source.
      if (ci.source === 'unavailable') {
        ci.details = ci.details || 'CI lookup unavailable'
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

type ActionMessageValidation = {
  isActionRequired: boolean
  blockingError?: string
  hint?: string
  warnings: string[]
}

const STRICT_ACTION_CHANNELS = new Set(['reviews', 'blockers'])

function hasTaskIdReference(content: string): boolean {
  return /\btask-[a-zA-Z0-9-]+\b/.test(content)
}

function hasOwnerMention(content: string): boolean {
  return /@([a-zA-Z][a-zA-Z0-9_-]*)/.test(content)
}

function isLikelyActionRequired(content: string, channel?: string): boolean {
  const normalizedChannel = (channel || 'general').toLowerCase()
  if (STRICT_ACTION_CHANNELS.has(normalizedChannel)) return true

  const actionKeyword = /(please|review|approve|unblock|need|must|action required|can you|owner)/i
  return hasTaskIdReference(content) && actionKeyword.test(content)
}

function validateActionRequiredMessage(content: string, channel?: string): ActionMessageValidation {
  const isActionRequired = isLikelyActionRequired(content, channel)
  if (!isActionRequired) return { isActionRequired: false, warnings: [] }

  const hasOwner = hasOwnerMention(content)
  const hasTaskId = hasTaskIdReference(content)
  const normalizedChannel = (channel || 'general').toLowerCase()
  const strict = STRICT_ACTION_CHANNELS.has(normalizedChannel)

  if (strict && (!hasOwner || !hasTaskId)) {
    return {
      isActionRequired,
      warnings: [],
      blockingError: 'Action-required message must include both @owner and task-<id> in #reviews/#blockers.',
      hint: 'Example: "@owner task-1234 ready for review ..."',
    }
  }

  const warnings: string[] = []
  if (!hasOwner) warnings.push('Action-required message is missing @owner mention.')
  if (!hasTaskId) warnings.push('Action-required message is missing task-<id> reference.')

  return { isActionRequired, warnings }
}

function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+)/g) || []
  return Array.from(new Set(matches.map(token => token.slice(1).toLowerCase()).filter(Boolean)))
}

function buildAutonomyWarnings(content: string): string[] {
  const mentions = extractMentions(content)
  if (mentions.length === 0) return []

  // Only warn when the message is explicitly directed at Ryan.
  const directedAtRyan = mentions.includes('ryan') || mentions.includes('ryancampbell')
  if (!directedAtRyan) return []

  const normalized = content.toLowerCase()

  // Detect the specific anti-pattern: asking leadership what to do next.
  // Keep the pattern narrow to avoid false positives on legitimate asks.
  const approvalSeeking =
    /\b(what should i (do|work on) next|what(?:['’]?s) next(?: for me)?|what do i do next|what do you want me to do next|should i (do|work on)( [^\n\r]{0,80})? next)\b/i
  if (!approvalSeeking.test(normalized)) return []

  return [
    'Autonomy guardrail: avoid asking Ryan what to do next. Pull from the board (/tasks/next) or pick the highest-priority task and ship. Escalate to Ryan only if blocked on a decision only a human can make.',
  ]
}

type RyanApprovalGate = {
  blockingError?: string
  hint?: string
}

function validateRyanApprovalPing(content: string, from: string, channel?: string): RyanApprovalGate {
  // Only gate messages directed at Ryan.
  const mentions = extractMentions(content)
  const directedAtRyan = mentions.includes('ryan') || mentions.includes('ryancampbell')
  if (!directedAtRyan) return {}

  // Don't gate Ryan/system talking to themselves.
  const sender = String(from || '').toLowerCase()
  if (sender === 'ryan' || sender === 'system') return {}

  const normalized = content.toLowerCase()

  // We only care about PR approval/merge requests.
  const looksLikePrRequest =
    /\b(approve|merge)\b/.test(normalized) &&
    (/(\bpr\b|pull request|github\.com\/[^\s]+\/pull\/[0-9]+|#\d+)/i.test(normalized))

  if (!looksLikePrRequest) return {}

  // Allow if the message explicitly explains why Ryan is required and references a task id.
  const hasTaskId = hasTaskIdReference(content)
  const hasPermissionsReason = /(permission|permissions|auth|authed|rights|cannot|can\s*not|can't|blocked|branch protection|required)/i.test(normalized)

  if (hasTaskId && hasPermissionsReason) return {}

  const normalizedChannel = (channel || 'general').toLowerCase()
  return {
    blockingError: `Don't ask @ryan to approve/merge PRs by default (channel=${normalizedChannel}). Ask the assigned reviewer, or merge it yourself. Escalate to Ryan only when truly blocked by permissions/auth.`,
    hint: 'If Ryan is genuinely required: include task-<id> and a short permissions/auth reason (e.g., "no merge rights" / "branch protection"), plus the PR link.',
  }
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

// Quiet hours — now driven by unified policy config
function getHourInTimezone(nowMs: number, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    })
    const part = formatter.formatToParts(new Date(nowMs)).find(p => p.type === 'hour')
    const hour = Number(part?.value ?? '0')
    return Number.isFinite(hour) ? hour : 0
  } catch {
    return new Date(nowMs).getHours()
  }
}

function isQuietHours(nowMs: number): boolean {
  const qh = policyManager.get().quietHours
  if (!qh.enabled) return false

  const start = Math.max(0, Math.min(23, qh.startHour))
  const end = Math.max(0, Math.min(23, qh.endHour))
  const hour = getHourInTimezone(nowMs, qh.timezone)

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
  app.addHook('preSerialization', async (request, reply, payload) => {
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
    if (body.problems !== undefined) envelope.problems = body.problems
    if (alreadyEnvelope && body.data !== undefined) envelope.data = body.data

    // Minimal persisted error log: enables /logs to return real entries.
    // Avoid logging 4xx validation noise by default.
    if (status >= 500) {
      const message = String((envelope as any).error ?? body.error ?? 'error')
      const gate = typeof body.gate === 'string' ? body.gate : undefined

      appendStoredLog({
        level: 'error',
        timestamp: Date.now(),
        message,
        status,
        code,
        hint,
        gate,
        method: request.method,
        url: request.url,
        details: body.details,
      }).catch(() => {})
    }

    return envelope
  })

  // Request tracking middleware for system health monitoring
  app.addHook('onRequest', async (request) => {
    ;(request as any).startTime = Date.now()
  })

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - ((request as any).startTime || Date.now())
    healthMonitor.trackRequest(duration)
    trackTelemetryRequest(request.method, request.url, reply.statusCode, duration)
    
    if (reply.statusCode >= 400) {
      healthMonitor.trackError()
      // Normalize URL before telemetry to prevent PII leaks in query params
      const sanitizedUrl = request.url.split('?')[0]
        .replace(/\/task-\d+-[a-z0-9]+/g, '/:id')
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:uuid')
        .replace(/\/msg-\d+-[a-z0-9]+/g, '/:msgId')
      trackTelemetryError(`HTTP_${reply.statusCode}`, `${request.method} ${sanitizedUrl}`)
    }
  })

  // Periodic health snapshot (every request, but throttled internally)
  app.addHook('onResponse', async () => {
    await healthMonitor.recordSnapshot().catch(() => {}) // Silent fail
  })

  // Load agent roles from YAML config (or fall back to built-in defaults)
  loadAgentRoles()
  startConfigWatch()

  // Initialize secret vault
  const hostId = process.env.REFLECTT_HOST_ID || process.env.HOSTNAME || 'unknown'
  const vault = new SecretVault(REFLECTT_HOME, hostId)
  try {
    vault.init()
    console.log(`[Vault] Initialized (${vault.getStats().secretCount} secrets)`)
  } catch (err) {
    console.error('[Vault] Failed to initialize:', (err as Error).message)
  }

  // Initialize GitHub identity provider (PAT env fallback + optional GitHub App installation token mode)
  // v1: per-node/team configuration via env vars; secrets stored in SecretVault.
  const githubMode = (process.env.REFLECTT_GITHUB_IDENTITY_MODE || 'pat') as 'pat' | 'app_installation'
  githubIdentityProvider = createGitHubIdentityProvider({
    config: {
      mode: githubMode,
      app: {
        privateKeySecretName: process.env.REFLECTT_GITHUB_APP_PRIVATE_KEY_SECRET || 'github.app.private_key_pem',
        appIdSecretName: process.env.REFLECTT_GITHUB_APP_ID_SECRET || 'github.app.app_id',
        installationIdSecretName: process.env.REFLECTT_GITHUB_APP_INSTALLATION_ID_SECRET || 'github.app.installation_id',
      },
    },
    vault,
  })
  console.log(`[GitHubIdentity] mode=${githubIdentityProvider.getMode()}`)

  // Initialize contacts table
  try {
    initContactsTable()
  } catch (err) {
    console.error('[Contacts] Table init failed:', (err as Error).message)
  }

  // Initialize telemetry (opt-in via REFLECTT_TELEMETRY=true)
  initTelemetry({
    enabled: process.env.REFLECTT_TELEMETRY === 'true',
    cloudUrl: process.env.REFLECTT_CLOUD_URL || '',
    hostId: process.env.REFLECTT_HOST_ID || process.env.HOSTNAME || 'unknown',
    reportIntervalMs: parseInt(process.env.REFLECTT_TELEMETRY_INTERVAL || '300000', 10),
  })

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

  // Reflection→Insight pipeline health monitor
  const reflectionPipelineHealth = {
    lastCheckedAt: 0,
    lastAlertAt: 0,
    firstZeroInsightAt: 0,
    recentReflections: 0,
    recentInsightsCreated: 0,
    recentInsightsUpdated: 0,
    recentInsightActivity: 0,
    recentPromotions: 0,
    windowMin: 30,
    zeroInsightThresholdMin: 10,
    status: 'unknown' as 'healthy' | 'at_risk' | 'broken' | 'unknown',
  }

  function computeReflectionPipelineHealth(now = Date.now()) {
    const since = now - reflectionPipelineHealth.windowMin * 60_000
    const db = getDb()

    const recentReflections = countReflections({ since })
    // Count both newly created insights AND existing insights that received new reflections (updated_at advanced)
    const recentInsightsCreated = (db.prepare('SELECT COUNT(*) as c FROM insights WHERE created_at >= ?').get(since) as { c: number }).c
    const recentInsightsUpdated = (db.prepare('SELECT COUNT(*) as c FROM insights WHERE updated_at >= ? AND created_at < ?').get(since, since) as { c: number }).c
    const recentInsightActivity = recentInsightsCreated + recentInsightsUpdated
    const recentPromotions = listPromotionAudits(500).filter(a => a.created_at >= since).length

    reflectionPipelineHealth.recentReflections = recentReflections
    reflectionPipelineHealth.recentInsightsCreated = recentInsightsCreated
    reflectionPipelineHealth.recentInsightsUpdated = recentInsightsUpdated
    reflectionPipelineHealth.recentInsightActivity = recentInsightActivity
    reflectionPipelineHealth.recentPromotions = recentPromotions
    reflectionPipelineHealth.lastCheckedAt = now

    if (recentReflections === 0) {
      reflectionPipelineHealth.status = 'healthy'
      reflectionPipelineHealth.firstZeroInsightAt = 0
      return reflectionPipelineHealth
    }

    // Pipeline is healthy if any insight activity occurred (create or merge-update)
    if (recentInsightActivity > 0) {
      reflectionPipelineHealth.status = 'healthy'
      reflectionPipelineHealth.firstZeroInsightAt = 0
      return reflectionPipelineHealth
    }

    if (!reflectionPipelineHealth.firstZeroInsightAt) {
      reflectionPipelineHealth.firstZeroInsightAt = now
    }

    const zeroDurationMin = Math.round((now - reflectionPipelineHealth.firstZeroInsightAt) / 60_000)
    reflectionPipelineHealth.status = zeroDurationMin >= reflectionPipelineHealth.zeroInsightThresholdMin ? 'broken' : 'at_risk'

    return reflectionPipelineHealth
  }

  const reflectionPipelineTimer = setInterval(() => {
    if (isQuietHours(Date.now())) return
    const health = computeReflectionPipelineHealth(Date.now())

    // Alert when reflections are flowing but insights remain zero past threshold
    if (health.status === 'broken') {
      const now = Date.now()
      const cooldownMs = 30 * 60_000 // 30 minutes
      if (now - reflectionPipelineHealth.lastAlertAt >= cooldownMs) {
        reflectionPipelineHealth.lastAlertAt = now
        chatManager.sendMessage({
          channel: 'general',
          from: 'system',
          content: `🚨 Reflection pipeline broken: ${health.recentReflections} reflections in last ${health.windowMin}m but 0 insights created. @link @sage investigate ingestion/listener path.`,
        }).catch(() => {})
      }
    }
  }, 60 * 1000)
  reflectionPipelineTimer.unref()

  // Load unified policy config (file + env overrides)
  const policy = policyManager.load()

  // Board health execution worker — config from policy
  boardHealthWorker.updateConfig(policy.boardHealth)
  boardHealthWorker.start()

  // Noise budget: wire digest flush handler to send batched messages to #ops
  noiseBudgetManager.setDigestFlushHandler(async (channel, entries) => {
    if (entries.length === 0) return
    const summary = entries.map(e =>
      `• [${e.category}] ${e.from}: ${e.content.substring(0, 120)}${e.content.length > 120 ? '…' : ''}`
    ).join('\n')
    const digestContent = `📦 **Noise Budget Digest** (${entries.length} batched messages for #${channel}):\n${summary}`
    await chatManager.sendMessage({
      from: 'system',
      channel: 'ops',
      content: digestContent,
      metadata: { noiseDigest: true, originalChannel: channel, batchSize: entries.length },
    })
  })

  // Insight:promoted → auto-task bridge (severity-aware)
  startInsightTaskBridge()

  // Team pulse: proactive status broadcast (trust-gap mitigation)
  startTeamPulse()

  // Shipped-artifact auto-heartbeat → #general on validating/done with artifact_path
  startShippedHeartbeat()

  // Calendar reminder engine — polls for pending reminders every 30s
  startReminderEngine()

  app.addHook('onClose', async () => {
    clearInterval(idleNudgeTimer)
    clearInterval(cadenceWatchdogTimer)
    clearInterval(mentionRescueTimer)
    boardHealthWorker.stop()
    stopInsightTaskBridge()
    stopShippedHeartbeat()
    stopTeamPulse()
    stopReminderEngine()
    wsHeartbeat.stop()
  })

  // Health check
  app.get('/health', async (request) => {
    const query = request.query as Record<string, string>
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    return {
      status: 'ok',
      version: BUILD_VERSION,
      commit: BUILD_COMMIT,
      uptime_seconds: Math.round((Date.now() - BUILD_STARTED_AT) / 1000),
      openclaw: 'not configured',
      chat: chatManager.getStats(),
      tasks: taskManager.getStats({ includeTest }),
      inbox: inboxManager.getStats(),
      timestamp: Date.now(),
    }
  })

  app.get('/health/reflection-pipeline', async () => {
    const health = computeReflectionPipelineHealth(Date.now())
    return {
      status: health.status,
      windowMin: health.windowMin,
      zeroInsightThresholdMin: health.zeroInsightThresholdMin,
      recentReflections: health.recentReflections,
      recentInsightsCreated: health.recentInsightsCreated,
      recentInsightsUpdated: health.recentInsightsUpdated,
      recentInsightActivity: health.recentInsightActivity,
      recentPromotions: health.recentPromotions,
      lastCheckedAt: health.lastCheckedAt,
      lastAlertAt: health.lastAlertAt || null,
      firstZeroInsightAt: health.firstZeroInsightAt || null,
      signals: {
        reflections_flowing: health.recentReflections > 0,
        insights_created: health.recentInsightsCreated > 0,
        insights_updated: health.recentInsightsUpdated > 0,
        insights_flowing: health.recentInsightActivity > 0,
        promotions_flowing: health.recentPromotions > 0,
      },
    }
  })

  // Team configuration linter health (TEAM.md / TEAM-ROLES.yaml / TEAM-STANDARDS.md)
  app.get('/team/health', async () => {
    const health = getTeamConfigHealth()
    return {
      ok: health.ok,
      checkedAt: health.checkedAt,
      root: health.root,
      files: health.files,
      issues: health.issues,
      roleNamesFromConfig: health.roleNamesFromConfig,
      assignmentRoleNames: health.assignmentRoleNames,
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
    const query = request.query as Record<string, string>
    const teamId = normalizeTeamId(query.teamId)

    let payload = await healthMonitor.getAgentHealthSummary()

    if (teamId) {
      const teamTasks = taskManager.listTasks({ teamId })
      const teamTaskIds = new Set(teamTasks.map(task => task.id))
      const teamAgents = new Set(teamTasks.map(task => (task.assignee || '').toLowerCase()).filter(Boolean))

      payload = {
        ...payload,
        agents: payload.agents.filter((agent) => {
          if (teamAgents.has(agent.agent.toLowerCase())) return true
          if (!agent.active_task) return false
          return teamTaskIds.has(agent.active_task)
        }),
      }
    }

    if (applyConditionalCaching(request, reply, payload, payload.timestamp)) {
      return
    }
    return payload
  })

  // Unified per-agent workflow state (task + PR + artifact + blocker)
  app.get('/health/workflow', async (request, reply) => {
    const query = request.query as Record<string, string>
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    const now = Date.now()
    const tasks = taskManager.listTasks({ includeTest })
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

  // ─── Backlog health: ready counts per lane, breach status, floor compliance ───
  app.get('/health/backlog', async (request, reply) => {
    const query = request.query as Record<string, string>
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    const now = Date.now()
    const allTasks = taskManager.listTasks({ includeTest })

    // Define lanes and their agents
    const lanes: Record<string, { agents: string[]; readyFloor: number }> = {
      engineering: { agents: ['link', 'pixel'], readyFloor: 2 },
      content: { agents: ['echo'], readyFloor: 2 },
      operations: { agents: ['kai', 'sage'], readyFloor: 1 },
      research: { agents: ['scout'], readyFloor: 1 },
      rhythm: { agents: ['rhythm'], readyFloor: 1 },
    }

    // Helper: check if a task is blocked
    const isBlocked = (task: typeof allTasks[number]): boolean => {
      if (!task.blocked_by || task.blocked_by.length === 0) return false
      return task.blocked_by.some((blockerId: string) => {
        const blocker = taskManager.getTask(blockerId)
        return blocker && blocker.status !== 'done'
      })
    }

    // Definition-of-ready gate for backlog readiness: todo + required fields + unblocked
    const hasRequiredFields = (task: typeof allTasks[number]): boolean => {
      const hasTitle = typeof task.title === 'string' && task.title.trim().length > 0
      const hasPriority = typeof task.priority === 'string' && ['P0', 'P1', 'P2', 'P3'].includes(task.priority)
      const hasReviewer = typeof task.reviewer === 'string' && task.reviewer.trim().length > 0
      const hasDoneCriteria = Array.isArray(task.done_criteria) && task.done_criteria.length > 0
      return hasTitle && hasPriority && hasReviewer && hasDoneCriteria
    }

    // Build per-lane health
    const laneHealth = Object.entries(lanes).map(([laneName, config]) => {
      const laneTasks = allTasks.filter(t => config.agents.includes(t.assignee || ''))

      const todo = laneTasks.filter(t => t.status === 'todo')
      const doing = laneTasks.filter(t => t.status === 'doing')
      const validating = laneTasks.filter(t => t.status === 'validating')
      const blocked = laneTasks.filter(t => t.status === 'blocked' || (t.status === 'todo' && isBlocked(t)))
      const done = laneTasks.filter(t => t.status === 'done')

      // Ready = todo + required fields + unblocked
      const ready = todo.filter(t => !isBlocked(t) && hasRequiredFields(t))
      const notReady = todo.filter(t => isBlocked(t) || !hasRequiredFields(t))

      // Per-agent breakdown
      const agentBreakdown = config.agents.map(agent => {
        const agentTasks = laneTasks.filter(t => t.assignee === agent)
        const agentReady = ready.filter(t => t.assignee === agent)
        const agentDoing = doing.filter(t => t.assignee === agent)
        const agentValidating = validating.filter(t => t.assignee === agent)

        return {
          agent,
          ready: agentReady.length,
          doing: agentDoing.length,
          validating: agentValidating.length,
          total: agentTasks.length,
          belowFloor: agentReady.length < config.readyFloor,
          readyTasks: agentReady.map(t => ({ id: t.id, title: t.title, priority: t.priority })),
        }
      })

      // Active agents = those with doing or validating tasks, or any recent activity
      const activeAgents = agentBreakdown.filter(a => a.doing > 0 || a.validating > 0 || a.ready > 0)

      // Floor compliance: per-active-assignee floor
      const floorBreaches = agentBreakdown.filter(a =>
        (a.doing > 0 || a.validating > 0) && a.belowFloor,
      )

      return {
        lane: laneName,
        agents: config.agents,
        readyFloor: config.readyFloor,
        counts: {
          todo: todo.length,
          ready: ready.length,
          notReady: notReady.length,
          doing: doing.length,
          validating: validating.length,
          blocked: blocked.length,
          done: done.length,
        },
        compliance: {
          status: floorBreaches.length > 0 ? 'breach' : ready.length >= config.readyFloor ? 'healthy' : 'warning',
          floorBreaches: floorBreaches.map(a => ({
            agent: a.agent,
            ready: a.ready,
            required: config.readyFloor,
            deficit: config.readyFloor - a.ready,
          })),
          notReadyReasons: {
            blocked: todo.filter(t => isBlocked(t)).length,
            missingRequiredFields: todo.filter(t => !hasRequiredFields(t)).length,
          },
        },
        agentBreakdown,
      }
    })

    // Aggregate summary
    const totalReady = laneHealth.reduce((sum, l) => sum + l.counts.ready, 0)
    const totalNotReady = laneHealth.reduce((sum, l) => sum + l.counts.notReady, 0)
    const totalDoing = laneHealth.reduce((sum, l) => sum + l.counts.doing, 0)
    const totalValidating = laneHealth.reduce((sum, l) => sum + l.counts.validating, 0)
    const totalBlocked = laneHealth.reduce((sum, l) => sum + l.counts.blocked, 0)
    const breachedLanes = laneHealth.filter(l => l.compliance.status === 'breach')

    // Stale validating tasks (>30min)
    const staleValidating = allTasks
      .filter(t => t.status === 'validating')
      .filter(t => {
        const updatedAt = Number(t.updatedAt || 0)
        return updatedAt > 0 && now - updatedAt > 30 * 60_000
      })
      .map(t => ({
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        staleMinutes: Math.floor((now - Number(t.updatedAt || 0)) / 60_000),
      }))

    const payload = {
      summary: {
        totalReady,
        totalNotReady,
        totalDoing,
        totalValidating,
        totalBlocked,
        breachedLaneCount: breachedLanes.length,
        overallStatus: breachedLanes.length > 0 ? 'breach' : totalReady === 0 ? 'critical' : 'healthy',
        staleValidatingCount: staleValidating.length,
      },
      lanes: laneHealth,
      staleValidating,
      timestamp: now,
    }

    if (applyConditionalCaching(request, reply, payload, now)) {
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
          enabled: policyManager.get().quietHours.enabled,
          startHour: policyManager.get().quietHours.startHour,
          endHour: policyManager.get().quietHours.endHour,
          tz: policyManager.get().quietHours.timezone,
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
          enabled: policyManager.get().quietHours.enabled,
          startHour: policyManager.get().quietHours.startHour,
          endHour: policyManager.get().quietHours.endHour,
          tz: policyManager.get().quietHours.timezone,
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
          enabled: policyManager.get().quietHours.enabled,
          startHour: policyManager.get().quietHours.startHour,
          endHour: policyManager.get().quietHours.endHour,
          tz: policyManager.get().quietHours.timezone,
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

  // Working contract enforcement tick (auto-requeue stale doing tasks)
  app.post('/health/working-contract/tick', async (request, reply) => {
    try {
      const { tickWorkingContract } = await import('./working-contract.js')
      const result = await tickWorkingContract()
      return { success: true, ...result }
    } catch (err) {
      reply.code(500)
      return { success: false, error: (err as Error).message }
    }
  })

  // Working contract claim gate check (dry-run)
  app.get<{ Params: { agent: string } }>('/health/working-contract/gate/:agent', async (request) => {
    try {
      const { checkClaimGate } = await import('./working-contract.js')
      return checkClaimGate(request.params.agent)
    } catch {
      return { allowed: true, reason: 'Working contract module not loaded' }
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
    const limit = parsedQuery.data.limit ? Math.min(parseInt(parsedQuery.data.limit, 10), 500) : 200

    try {
      const logs = await readStoredLogs({ since, level, limit })
      return {
        logs,
        count: logs.length,
        level,
        since,
        path: getStoredLogPath(),
      }
    } catch (err: any) {
      reply.code(500)
      return {
        error: 'Failed to read logs',
        details: String(err?.message || err),
      }
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

  // Serve feedback widget (embeddable, self-contained)
  app.get('/widget/feedback.js', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')

      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const filePath = join(__dirname, '..', 'public', 'widget', 'feedback.js')

      const data = await fs.readFile(filePath, 'utf-8')
      reply
        .type('application/javascript')
        .header('Access-Control-Allow-Origin', '*')
        .header('Cache-Control', 'public, max-age=3600')
        .send(data)
    } catch (err) {
      reply.code(404).send({ error: 'Widget not found' })
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
  app.post('/chat/messages', async (request, reply) => {
    const parsedBody = SendMessageSchema.safeParse(request.body ?? {})
    if (!parsedBody.success) {
      reply.code(400)
      return {
        success: false,
        error: 'Invalid body: from and content are required',
        fields: parsedBody.error.issues.map(issue => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      }
    }

    const data = parsedBody.data
    const actionValidation = validateActionRequiredMessage(data.content, data.channel)
    if (actionValidation.blockingError) {
      reply.code(400)
      return {
        success: false,
        error: actionValidation.blockingError,
        gate: 'action_message_contract',
        hint: actionValidation.hint,
      }
    }

    const ryanApprovalGate = validateRyanApprovalPing(data.content, data.from, data.channel)
    if (ryanApprovalGate.blockingError) {
      reply.code(400)
      return {
        success: false,
        error: ryanApprovalGate.blockingError,
        gate: 'ryan_approval_gate',
        hint: ryanApprovalGate.hint,
      }
    }

    const message = await chatManager.sendMessage(data)
    const mentionWarnings = buildMentionWarnings(data.content)
    const autonomyWarnings = buildAutonomyWarnings(data.content)

    // Track content messages for noise budget denominator
    // (agent/human messages posted via POST /chat/messages are content, not control-plane)
    if (data.channel) {
      noiseBudgetManager.recordContentMessage(data.channel, data.from)
    }

    // Auto-update presence: if you're posting, you're active
    if (data.from) {
      presenceManager.recordActivity(data.from, 'message')
      presenceManager.updatePresence(data.from, 'working')

      // Activation funnel: first team message
      emitActivationEvent('first_team_message_sent', data.from, {
        channel: data.channel || 'general',
      }).catch(() => {})

      // Day-2 return via chat
      if (isDay2Eligible(data.from) && !hasCompletedEvent(data.from, 'day2_return_action')) {
        emitActivationEvent('day2_return_action', data.from, { action: 'chat_message' }).catch(() => {})
      }
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

    // ── Chat approval detector: bridge chat approvals → formal review decisions ──
    let approvalApplied: { taskId: string; reviewer: string } | undefined
    if (data.from && data.content) {
      const detection = detectApproval(data.from, data.content)
      if (detection.detected && detection.signal) {
        try {
          const updated = await applyApproval(detection.signal)
          if (updated) {
            approvalApplied = { taskId: detection.signal.taskId, reviewer: detection.signal.reviewer }
            app.log.info(
              { taskId: detection.signal.taskId, reviewer: detection.signal.reviewer, source: detection.signal.source },
              '[ChatApproval] Auto-applied reviewer approval from chat message',
            )
          }
        } catch (err) {
          app.log.warn({ err, signal: detection.signal }, '[ChatApproval] Failed to apply approval')
        }
      }
    }

    return {
      success: true,
      message,
      ...(mentionWarnings.length > 0 ? { warnings: mentionWarnings } : {}),
      ...(actionValidation.warnings.length > 0 ? { action_warnings: actionValidation.warnings } : {}),
      ...(autonomyWarnings.length > 0 ? { autonomy_warnings: autonomyWarnings } : {}),
      ...(approvalApplied ? { approval_applied: approvalApplied } : {}),
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

  // ── Agent context endpoint ──────────────────────────────────────────
  // Returns a compact, deduplicated view of recent chat optimized for
  // agent context injection. Includes: mentions of the agent, recent
  // system alerts (deduplicated), and team messages — all in slim format.
  app.get<{ Params: { agent: string } }>('/chat/context/:agent', async (request) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    const query = request.query as Record<string, string>
    const limit = Math.min(Number(query.limit) || 30, 100)
    const channelFilter = query.channel || undefined
    const sinceMs = query.since ? Number(query.since) : Date.now() - (4 * 60 * 60 * 1000) // default 4h

    const allMessages = chatManager.getMessages({
      channel: channelFilter,
      limit: Math.min(limit * 5, 500), // fetch more, then filter
      since: sinceMs,
    })

    // Partition: mentions, system alerts, team messages
    const mentions: typeof allMessages = []
    const systemAlerts: typeof allMessages = []
    const teamMessages: typeof allMessages = []

    const agentPattern = new RegExp(`@${agent}\\b`, 'i')

    for (const m of allMessages) {
      const content = m.content || ''
      if (m.from === 'system') {
        systemAlerts.push(m)
      } else if (agentPattern.test(content)) {
        mentions.push(m)
      } else {
        teamMessages.push(m)
      }
    }

    // Deduplicate system alerts by normalized content (aggressive normalization)
    const seenHashes = new Set<string>()
    const dedupedAlerts = systemAlerts.filter(m => {
      const normalized = (m.content || '')
        .replace(/\d{10,}/g, '')           // strip epoch timestamps
        .replace(/task-\S+/g, 'TASK')      // normalize task IDs
        .replace(/@[\w-]+/g, '@AGENT')     // normalize @mentions (incl. hyphens)
        .replace(/\d+\/\d+/g, 'N/M')      // normalize counts like "0/2"
        .replace(/\d+h\b/g, 'Nh')         // normalize durations like "10h", "28h"
        .replace(/\d+m\b/g, 'Nm')         // normalize minutes
        .replace(/\d+\s*hour/g, 'N hour')
        .replace(/\d+\s*min/g, 'N min')
        .replace(/\(need \d+ more\)/g, '') // normalize "need N more"
        .replace(/\s+/g, ' ')             // collapse whitespace
        .trim().slice(0, 200)
      const hash = `${m.channel}:${normalized}`
      if (seenHashes.has(hash)) return false
      seenHashes.add(hash)
      return true
    })

    // Slim format: strip id, reactions, replyCount
    const slim = (m: typeof allMessages[0]) => ({
      from: m.from,
      content: m.content,
      ts: m.timestamp,
      ch: m.channel,
    })

    // Assemble: prioritize mentions, then deduped alerts, then team msgs
    const result = [
      ...mentions.slice(-limit).map(slim),
      ...dedupedAlerts.slice(-Math.ceil(limit / 3)).map(slim),
      ...teamMessages.slice(-Math.ceil(limit / 3)).map(slim),
    ].sort((a, b) => a.ts - b.ts).slice(-limit)

    return {
      agent,
      since: sinceMs,
      count: result.length,
      messages: result,
      suppressed: {
        system_deduped: systemAlerts.length - dedupedAlerts.length,
        total_scanned: allMessages.length,
      },
    }
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

    const rawQuery = request.query as Record<string, string>
    if (isCompact(rawQuery)) {
      const slim = inbox.map(m => ({
        from: m.from,
        content: m.content,
        ts: m.timestamp,
        ch: m.channel,
        ...(m.priority ? { priority: m.priority } : {}),
      }))
      return { messages: slim, count: slim.length }
    }
    
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

  const normalizeTeamId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const enrichTaskWithComments = (task: Task) => ({
    ...task,
    commentCount: taskManager.getTaskCommentCount(task.id),
  })

  /** Strip metadata (and other heavy fields) from a task for compact responses. */
  const compactTask = (task: ReturnType<typeof enrichTaskWithComments>) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { metadata, description, done_criteria, ...slim } = task
    return slim
  }

  const isCompact = (query: Record<string, string>) =>
    query.compact === '1' || query.compact === 'true'

  // List tasks
  app.get('/tasks', async (request, reply) => {
    const query = request.query as Record<string, string>
    const updatedSince = parseEpochMs(query.updatedSince || query.since)
    const limit = boundedLimit(query.limit, DEFAULT_LIMITS.tasks, MAX_LIMITS.tasks)

    const tagFilter = query.tag
      ? [query.tag]
      : (query.tags ? query.tags.split(',') : undefined)

    const includeTest = query.include_test === '1' || query.include_test === 'true'

    let tasks = taskManager.listTasks({
      status: query.status as Task['status'] | undefined,
      assignee: query.assignee || query.assignedTo, // Support both for backward compatibility
      createdBy: query.createdBy,
      teamId: normalizeTeamId(query.teamId),
      priority: query.priority as Task['priority'] | undefined,
      tags: tagFilter,
      includeTest,
    })

    if (updatedSince) {
      tasks = tasks.filter(task => task.updatedAt >= updatedSince)
    }

    // Text search filter
    const searchQuery = (query.q || '').trim().toLowerCase()
    if (searchQuery) {
      tasks = tasks.filter(task =>
        (task.title || '').toLowerCase().includes(searchQuery) ||
        (task.description || '').toLowerCase().includes(searchQuery) ||
        (task.assignee || '').toLowerCase().includes(searchQuery) ||
        (task.id || '').toLowerCase().includes(searchQuery)
      )
    }

    const total = tasks.length
    const offset = parsePositiveInt(query.offset) || 0
    tasks = tasks.slice(offset, offset + limit)
    const hasMore = offset + tasks.length < total

    const enriched = tasks.map(enrichTaskWithComments)
    const compact = isCompact(query)
    const payload = { tasks: compact ? enriched.map(compactTask) : enriched, total, offset, limit, hasMore }
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
    const includeTest = query.include_test === '1' || query.include_test === 'true'

    const isTestHarnessTask = (task: Task): boolean => {
      const meta = (task.metadata || {}) as Record<string, unknown>
      if (meta.is_test === true) return true
      if (typeof meta.source_reflection === 'string' && meta.source_reflection.startsWith('ref-test-')) return true
      if (typeof meta.source_insight === 'string' && meta.source_insight.startsWith('ins-test-')) return true
      if (/test run \d{13}/i.test(task.title || '')) return true
      return false
    }

    const tasks = taskManager.searchTasks(q)
      .filter(t => includeTest ? true : !isTestHarnessTask(t))
      .slice(0, limit)

    const enriched = tasks.map(enrichTaskWithComments)
    return { tasks: isCompact(query) ? enriched.map(compactTask) : enriched, count: tasks.length }
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
          reflections: vectorCount(db, 'reflection'),
          insights: vectorCount(db, 'insight'),
          shared_files: vectorCount(db, 'shared_file'),
          knowledge_docs: vectorCount(db, 'knowledge_doc'),
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

      const { indexTask, indexReflection, indexInsight } = await import('./vector-store.js')
      const allTasks = taskManager.listTasks({})
      let tasksIndexed = 0

      for (const task of allTasks) {
        try {
          await indexTask(
            task.id,
            task.title,
            (task as any).description,
            task.done_criteria,
          )
          tasksIndexed++
        } catch {
          // skip individual failures
        }
      }

      // Backfill reflections
      let reflectionsIndexed = 0
      try {
        const reflections = listReflections({ limit: 5000 })
        for (const ref of reflections) {
          try {
            await indexReflection(ref.id, ref.pain, ref.evidence, ref.proposed_fix, ref.author, ref.tags)
            reflectionsIndexed++
          } catch { /* skip */ }
        }
      } catch { /* reflections module may not be loaded */ }

      // Backfill insights
      let insightsIndexed = 0
      try {
        const { insights: insightList } = listInsights({ limit: 5000 })
        for (const ins of insightList) {
          try {
            await indexInsight(ins.id, ins.title, ins.evidence_refs, ins.authors, ins.cluster_key)
            insightsIndexed++
          } catch { /* skip */ }
        }
      } catch { /* insights module may not be loaded */ }

      return {
        indexed: tasksIndexed + reflectionsIndexed + insightsIndexed,
        tasks: tasksIndexed,
        reflections: reflectionsIndexed,
        insights: insightsIndexed,
        total: allTasks.length,
      }
    } catch (err: any) {
      reply.code(500)
      return { error: err?.message || 'Reindex failed', code: 'REINDEX_ERROR' }
    }
  })

  // ── Knowledge Search ─────────────────────────────────────────────────

  // Unified knowledge search across all indexed content types
  app.get('/knowledge/search', async (request, reply) => {
    const query = request.query as Record<string, string>
    const q = (query.q || '').trim()
    if (!q) {
      reply.code(400)
      return { error: 'Query parameter q is required', code: 'BAD_REQUEST' }
    }

    const limit = Math.min(Math.max(parseInt(query.limit || '10', 10) || 10, 1), 50)
    const type = query.type // optional filter: task|chat|reflection|insight|shared_file

    try {
      const { isVectorSearchAvailable } = await import('./db.js')
      if (!isVectorSearchAvailable()) {
        reply.code(503)
        return { error: 'Knowledge search not available (vector store not loaded)', code: 'VEC_NOT_AVAILABLE' }
      }

      const { semanticSearch } = await import('./vector-store.js')
      const results = await semanticSearch(q, { limit, type })

      // Enrich results with deep links
      const enriched = results.map((r) => ({
        ...r,
        link: r.sourceType === 'task' ? `/tasks/${r.sourceId}`
          : r.sourceType === 'reflection' ? `/reflections/${r.sourceId}`
          : r.sourceType === 'insight' ? `/insights/${r.sourceId}`
          : r.sourceType === 'shared_file' ? `/shared/read?path=${encodeURIComponent(r.sourceId)}`
          : r.sourceType === 'knowledge_doc' ? `/knowledge/docs/${r.sourceId}`
          : r.sourceType === 'chat' ? `/chat/search?q=${encodeURIComponent(q)}`
          : null,
      }))

      return { query: q, results: enriched, count: enriched.length }
    } catch (err: any) {
      reply.code(500)
      return { error: err?.message || 'Knowledge search failed', code: 'SEARCH_ERROR' }
    }
  })

  // Knowledge index stats
  app.get('/knowledge/stats', async () => {
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
          reflections: vectorCount(db, 'reflection'),
          insights: vectorCount(db, 'insight'),
          shared_files: vectorCount(db, 'shared_file'),
          knowledge_docs: vectorCount(db, 'knowledge_doc'),
        },
      }
    } catch (err: any) {
      return { available: false, reason: err?.message }
    }
  })

  // Index shared workspace files
  app.post('/knowledge/reindex-shared', async (request, reply) => {
    try {
      const { isVectorSearchAvailable } = await import('./db.js')
      if (!isVectorSearchAvailable()) {
        reply.code(503)
        return { error: 'Vector store not available', code: 'VEC_NOT_AVAILABLE' }
      }

      const { indexSharedFile } = await import('./vector-store.js')
      const { SHARED_WORKSPACE } = await import('./artifact-mirror.js')
      const sharedRoot = SHARED_WORKSPACE()

      const allowedDirs = ['process', 'specs', 'artifacts', 'handoffs', 'references']
      let indexed = 0
      const errors: string[] = []

      for (const dir of allowedDirs) {
        const dirPath = join(sharedRoot, dir)
        try {
          const entries = readdirSync(dirPath, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile()) continue
            if (!/\.(md|txt|json)$/i.test(entry.name)) continue
            try {
              const filePath = join(dirPath, entry.name)
              const content = readFileSync(filePath, 'utf-8')
              const relativePath = `${dir}/${entry.name}`
              await indexSharedFile(relativePath, content.slice(0, 4000))
              indexed++
            } catch (err: any) {
              errors.push(`${dir}/${entry.name}: ${err?.message}`)
            }
          }
        } catch {
          // directory may not exist
        }
      }

      return { indexed, errors: errors.length ? errors : undefined }
    } catch (err: any) {
      reply.code(500)
      return { error: err?.message || 'Reindex failed', code: 'REINDEX_ERROR' }
    }
  })

  // ── Knowledge Docs CRUD ──────────────────────────────────────────────────

  app.post('/knowledge/docs', async (request, reply) => {
    try {
      const body = request.body as CreateDocInput
      const doc = createDoc(body)

      // Auto-index in vector store
      import('./vector-store.js')
        .then(({ indexKnowledgeDoc }) =>
          indexKnowledgeDoc(doc.id, doc.title, doc.content, doc.category, doc.tags)
        )
        .catch(() => { /* vector search may not be available */ })

      reply.code(201)
      return { success: true, doc }
    } catch (err: any) {
      reply.code(400)
      return { error: err.message }
    }
  })

  app.get('/knowledge/docs', async (request) => {
    const query = request.query as Record<string, string>
    const filters: Parameters<typeof listDocs>[0] = {}
    if (query.tag) filters.tag = query.tag
    if (query.category) filters.category = query.category as DocCategory
    if (query.author) filters.author = query.author
    if (query.search) filters.search = query.search
    if (query.limit) filters.limit = parseInt(query.limit, 10)

    const docs = listDocs(filters)
    return { docs, count: docs.length }
  })

  app.get<{ Params: { id: string } }>('/knowledge/docs/:id', async (request, reply) => {
    const doc = getDoc(request.params.id)
    if (!doc) return reply.code(404).send({ error: 'Document not found' })
    return { doc }
  })

  app.patch<{ Params: { id: string } }>('/knowledge/docs/:id', async (request, reply) => {
    try {
      const doc = updateDoc(request.params.id, request.body as UpdateDocInput)
      if (!doc) return reply.code(404).send({ error: 'Document not found' })

      // Re-index in vector store
      import('./vector-store.js')
        .then(({ indexKnowledgeDoc }) =>
          indexKnowledgeDoc(doc.id, doc.title, doc.content, doc.category, doc.tags)
        )
        .catch(() => { /* vector search may not be available */ })

      return { success: true, doc }
    } catch (err: any) {
      reply.code(400)
      return { error: err.message }
    }
  })

  app.delete<{ Params: { id: string } }>('/knowledge/docs/:id', async (request, reply) => {
    // Remove from vector store
    Promise.all([import('./vector-store.js'), import('./db.js')])
      .then(([{ deleteVector }, { getDb: getDatabase }]) => {
        deleteVector(getDatabase(), 'knowledge_doc', request.params.id)
      })
      .catch(() => { /* vector search may not be available */ })

    const deleted = deleteDoc(request.params.id)
    if (!deleted) return reply.code(404).send({ error: 'Document not found' })
    return { success: true }
  })

  // ── Contacts Directory ───────────────────────────────────────────────

  app.post('/contacts', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const name = (body.name as string || '').trim()

    if (!name) {
      reply.code(400)
      return { error: 'Required: name', code: 'BAD_REQUEST' }
    }

    const contact = createContact({
      name,
      org: typeof body.org === 'string' ? body.org.trim() : undefined,
      emails: Array.isArray(body.emails) ? body.emails.filter((e: unknown) => typeof e === 'string') : [],
      handles: (body.handles && typeof body.handles === 'object' && !Array.isArray(body.handles))
        ? body.handles as Record<string, string> : {},
      tags: Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : [],
      notes: typeof body.notes === 'string' ? body.notes : '',
      source: typeof body.source === 'string' ? body.source : undefined,
      owner: typeof body.owner === 'string' ? body.owner : undefined,
      last_contact: typeof body.last_contact === 'number' ? body.last_contact : undefined,
      related_task_ids: Array.isArray(body.related_task_ids) ? body.related_task_ids : [],
    })

    // Fire-and-forget: index for knowledge search
    import('./vector-store.js')
      .then(({ indexSharedFile }) => {
        const text = `[contact] ${contact.name}${contact.org ? ` (${contact.org})` : ''} — ${contact.notes} tags:${contact.tags.join(',')}`
        indexSharedFile(`contact/${contact.id}`, text)
      })
      .catch(() => {})

    reply.code(201)
    return { success: true, contact }
  })

  app.get('/contacts', async (request) => {
    const query = request.query as Record<string, string>
    const { contacts, total } = listContacts({
      name: query.name,
      org: query.org,
      tag: query.tag,
      owner: query.owner,
      q: query.q,
      limit: Math.min(parseInt(query.limit || '50', 10) || 50, 200),
      offset: parseInt(query.offset || '0', 10) || 0,
    })
    return { contacts, total, count: contacts.length }
  })

  app.get<{ Params: { id: string } }>('/contacts/:id', async (request, reply) => {
    const contact = getContact(request.params.id)
    if (!contact) {
      reply.code(404)
      return { error: 'Contact not found', code: 'NOT_FOUND' }
    }
    return { contact }
  })

  app.patch<{ Params: { id: string } }>('/contacts/:id', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const input: Record<string, unknown> = {}

    if (typeof body.name === 'string') input.name = body.name.trim()
    if (typeof body.org === 'string') input.org = body.org.trim()
    if (Array.isArray(body.emails)) input.emails = body.emails.filter((e: unknown) => typeof e === 'string')
    if (body.handles && typeof body.handles === 'object' && !Array.isArray(body.handles)) input.handles = body.handles
    if (Array.isArray(body.tags)) input.tags = body.tags.filter((t: unknown) => typeof t === 'string')
    if (typeof body.notes === 'string') input.notes = body.notes
    if (typeof body.source === 'string') input.source = body.source
    if (typeof body.owner === 'string') input.owner = body.owner
    if (typeof body.last_contact === 'number') input.last_contact = body.last_contact
    if (Array.isArray(body.related_task_ids)) input.related_task_ids = body.related_task_ids

    const contact = updateContact(request.params.id, input as any)
    if (!contact) {
      reply.code(404)
      return { error: 'Contact not found', code: 'NOT_FOUND' }
    }

    // Re-index
    import('./vector-store.js')
      .then(({ indexSharedFile }) => {
        const text = `[contact] ${contact.name}${contact.org ? ` (${contact.org})` : ''} — ${contact.notes} tags:${contact.tags.join(',')}`
        indexSharedFile(`contact/${contact.id}`, text)
      })
      .catch(() => {})

    return { success: true, contact }
  })

  app.delete<{ Params: { id: string } }>('/contacts/:id', async (request, reply) => {
    const deleted = deleteContact(request.params.id)
    if (!deleted) {
      reply.code(404)
      return { error: 'Contact not found', code: 'NOT_FOUND' }
    }

    // Remove from vector index
    import('./vector-store.js')
      .then(async (vs) => {
        const { getDb: gdb } = await import('./db.js')
        vs.deleteVector(gdb(), 'shared_file', `contact/${request.params.id}`)
      })
      .catch(() => {})

    return { success: true, deleted: true }
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

    const query = request.query as Record<string, string>
    const enriched = enrichTaskWithComments(resolved.task)
    return {
      task: isCompact(query) ? compactTask(enriched) : enriched,
      resolvedId: resolved.resolvedId,
      matchType: resolved.matchType,
    }
  })

  // Task artifact visibility — resolves artifact paths and checks accessibility
  app.get<{ Params: { id: string } }>('/tasks/:id/artifacts', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) return

    const query = request.query as Record<string, string>
    const includeMode = query.include as 'content' | 'preview' | undefined

    const task = resolved.task
    const meta = (task.metadata || {}) as Record<string, any>

    // Collect all artifact references from metadata
    const artifactRefs: Array<{ source: string; path: string }> = []

    if (typeof meta.artifact_path === 'string' && meta.artifact_path.trim()) {
      artifactRefs.push({ source: 'metadata.artifact_path', path: meta.artifact_path.trim() })
    }
    if (Array.isArray(meta.artifacts)) {
      for (const a of meta.artifacts) {
        if (typeof a === 'string') artifactRefs.push({ source: 'metadata.artifacts[]', path: a })
        else if (a && typeof a.path === 'string') artifactRefs.push({ source: 'metadata.artifacts[]', path: a.path })
        else if (a && typeof a.url === 'string') artifactRefs.push({ source: 'metadata.artifacts[]', path: a.url })
      }
    }
    if (meta.qa_bundle?.review_packet?.artifact_path) {
      artifactRefs.push({ source: 'metadata.qa_bundle.review_packet.artifact_path', path: meta.qa_bundle.review_packet.artifact_path })
    }
    if (meta.qa_bundle?.review_packet?.pr_url) {
      artifactRefs.push({ source: 'metadata.qa_bundle.review_packet.pr_url', path: meta.qa_bundle.review_packet.pr_url })
    }
    if (meta.review_handoff?.artifact_path) {
      artifactRefs.push({ source: 'metadata.review_handoff.artifact_path', path: meta.review_handoff.artifact_path })
    }
    if (meta.review_handoff?.pr_url) {
      artifactRefs.push({ source: 'metadata.review_handoff.pr_url', path: meta.review_handoff.pr_url })
    }

    // Resolve each artifact: check file existence for repo-relative paths, or validate URLs
    const repoRoot = resolve(import.meta.dirname || process.cwd(), '..')
    const artifacts = await Promise.all(
      artifactRefs.map(async (ref) => {
        const urlMatch = ref.path.match(/https?:\/\/[^\s)]+/i)
        if (urlMatch) {
          return { ...ref, type: 'url' as const, accessible: true, resolvedPath: urlMatch[0] }
        }
        // Repo-relative path: try repo root first, then shared-workspace fallback
        const resolved = await resolveTaskArtifact(ref.path, repoRoot)
        if (resolved.accessible) {
          const result: Record<string, unknown> = {
            ...ref,
            type: resolved.type as 'file' | 'directory',
            accessible: true,
            source: resolved.source,
            resolvedPath: resolved.resolvedPath,
          }
          const isProcessArtifact = String(ref.path || '').trim().startsWith('process/')
          // Optionally include content/preview (process/ only)
          if (isProcessArtifact && includeMode === 'preview' && resolved.preview) {
            result.preview = resolved.preview
            result.previewTruncated = true
          } else if (isProcessArtifact && includeMode === 'content' && resolved.preview) {
            // For full content, re-read the file (resolveTaskArtifact returns preview-length)
            try {
              const fullContent = await fs.readFile(resolved.resolvedPath!, 'utf-8')
              result.content = fullContent.slice(0, 400_000) // 400KB cap
              result.contentTruncated = fullContent.length > 400_000
            } catch {
              result.content = resolved.preview
              result.contentTruncated = true
            }
          }
          return result
        }
        // GitHub blob fallback: if local file missing but PR is known, build a GitHub URL
        const prUrl = meta.pr_url || meta.qa_bundle?.review_packet?.pr_url || meta.review_handoff?.pr_url
        const commitSha = meta.commit_sha || meta.commit || meta.qa_bundle?.review_packet?.commit || meta.review_handoff?.commit_sha
        if (typeof prUrl === 'string' && typeof commitSha === 'string' && ref.path.startsWith('process/')) {
          const blobUrl = buildGitHubBlobUrl(prUrl, commitSha, ref.path)
          const rawUrl = buildGitHubRawUrl(prUrl, commitSha, ref.path)
          if (blobUrl) {
            return {
              ...ref,
              type: 'file' as const,
              accessible: true,
              source: 'github-fallback',
              resolvedPath: blobUrl,
              rawUrl,
              note: 'Local file not found; resolved via GitHub blob URL from PR metadata.',
            }
          }
        }
        return { ...ref, type: 'file' as const, accessible: false, error: 'File not found (checked workspace + shared-workspace + GitHub fallback)' }
      })
    )

    // Heartbeat: last comment timestamp for this task
    const comments = taskManager.getTaskComments(resolved.resolvedId)
    const lastComment = comments.length > 0 ? comments[comments.length - 1] : null
    const lastCommentAge = lastComment ? Date.now() - lastComment.timestamp : null
    const HEARTBEAT_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

    return {
      taskId: resolved.resolvedId,
      title: task.title,
      status: task.status,
      artifactCount: artifacts.length,
      artifacts,
      heartbeat: {
        lastCommentAt: lastComment?.timestamp ?? null,
        lastCommentAgeMs: lastCommentAge,
        lastCommentAuthor: lastComment?.author ?? null,
        stale: task.status === 'doing' && (lastCommentAge === null || lastCommentAge > HEARTBEAT_THRESHOLD_MS),
        thresholdMs: HEARTBEAT_THRESHOLD_MS,
      },
    }
  })

  // Artifact viewer — safe in-browser view for repo-relative proof docs (process/ etc.)
  app.get('/artifacts/view', async (request, reply) => {
    const parsed = z.object({ path: z.string().min(1).max(500) }).safeParse(request.query || {})
    if (!parsed.success) {
      reply.code(400)
      return { error: 'path is required', hint: 'GET /artifacts/view?path=process/...' }
    }

    const rawPath = String(parsed.data.path || '').trim()

    // Convenience: if a URL is embedded in the path string, redirect.
    const urlMatch = rawPath.match(/https?:\/\/[^\s)]+/i)
    if (urlMatch) {
      reply.redirect(urlMatch[0])
      return
    }

    const { promises: fs } = await import('node:fs')
    const { resolve, sep, extname } = await import('node:path')

    const repoRoot = resolve(import.meta.dirname || process.cwd(), '..')
    const fullPath = resolve(repoRoot, rawPath)

    // Security: ensure resolved path stays inside repo root
    if (!fullPath.startsWith(repoRoot + sep)) {
      reply.code(400)
      return { error: 'Invalid path (escapes repo root)' }
    }

    const allowedExt = new Set(['.md', '.txt', '.json', '.log', '.yml', '.yaml'])
    const ext = extname(fullPath).toLowerCase()
    if (!allowedExt.has(ext)) {
      reply.code(415)
      return { error: 'Unsupported file type', ext, allowed: Array.from(allowedExt) }
    }

    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    try {
      const stat = await fs.stat(fullPath)
      const maxBytes = 400_000
      if (stat.size > maxBytes) {
        reply.code(413)
        return { error: 'File too large', size: stat.size, maxBytes }
      }

      const content = await fs.readFile(fullPath, 'utf-8')
      const title = rawPath.split('/').pop() || rawPath

      reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — artifact view</title>
<style>
  :root { --bg:#0a0e14; --surface:#141920; --border:#252d38; --text:#d4dae3; --text-muted:#6b7a8d; --accent:#4da6ff; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background:var(--bg); color:var(--text); }
  header { padding:14px 18px; border-bottom:1px solid var(--border); background:var(--surface); display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .path { font-size:12px; color:var(--text-muted); }
  a { color: var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  main { padding:18px; }
  pre { white-space: pre-wrap; word-wrap: break-word; background:#0f141a; border:1px solid var(--border); border-radius:10px; padding:14px; line-height:1.55; font-size:12px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
</style>
</head>
<body>
<header>
  <div>
    <div style="font-weight:700">Artifact</div>
    <div class="path"><code>${escapeHtml(rawPath)}</code></div>
  </div>
  <div><a href="/dashboard" rel="noreferrer">← dashboard</a></div>
</header>
<main>
  <pre><code>${escapeHtml(content)}</code></pre>
</main>
</body>
</html>`)
    } catch {
      reply.code(404)
      return { error: 'File not found', path: rawPath }
    }
  })

  // ── Shared Workspace Read API ──────────────────────────────────────
  // Read-only access to shared artifacts (process/ under ~/.openclaw/workspace-shared).
  // Security: path validation, traversal protection, extension + size limits.

  app.get('/shared/list', async (request, reply) => {
    const query = request.query as Record<string, string>
    const path = query.path || 'process/'
    const limit = Math.min(Math.max(1, parseInt(query.limit || '200', 10) || 200), 500)
    const result = await listSharedFiles(path, limit)
    if (!result.success) {
      const msg = String(result.error || '')
      const lower = msg.toLowerCase()
      if (lower.includes('does not exist') || lower.includes('not found')) reply.code(404)
      else if (lower.includes('inaccessible')) reply.code(503)
      else if (lower.includes('escapes') || lower.includes('symlink')) reply.code(403)
      else reply.code(400)
    }
    return result
  })

  app.get('/shared/read', async (request, reply) => {
    const query = request.query as Record<string, string>
    const path = query.path
    if (!path) {
      reply.code(400)
      return { success: false, error: 'path query parameter is required' }
    }
    const preview = query.include === 'preview'
    const maxChars = parseInt(query.maxChars || '2000', 10) || 2000
    const result = await readSharedFile(path, { preview, maxChars })
    if (!result.success) {
      const msg = String(result.error || '')
      const lower = msg.toLowerCase()
      if (lower.includes('does not exist') || lower.includes('not found')) reply.code(404)
      else if (lower.includes('size limit')) reply.code(413)
      else if (lower.includes('inaccessible')) reply.code(503)
      else if (lower.includes('escapes') || lower.includes('symlink')) reply.code(403)
      else reply.code(400)
    }
    return result
  })

  app.get('/shared/view', async (request, reply) => {
    const query = request.query as Record<string, string>
    const path = query.path
    if (!path) {
      reply.code(400)
      return { error: 'path query parameter is required', hint: 'GET /shared/view?path=process/...' }
    }
    const result = await readSharedFile(path)
    if (!result.success || !result.file) {
      const msg = String(result.error || '')
      const lower = msg.toLowerCase()
      if (lower.includes('does not exist') || lower.includes('not found')) reply.code(404)
      else if (lower.includes('size limit')) reply.code(413)
      else if (lower.includes('inaccessible')) reply.code(503)
      else if (lower.includes('escapes') || lower.includes('symlink')) reply.code(403)
      else reply.code(400)
      return { error: result.error || 'File not found' }
    }
    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const title = path.split('/').pop() || path
    reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — shared artifact</title>
<style>:root{--bg:#0a0e14;--surface:#141920;--border:#252d38;--text:#d4dae3;--muted:#6b7a8d;--accent:#4da6ff}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text)}header{padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:space-between}a{color:var(--accent);text-decoration:none}main{padding:18px}pre{white-space:pre-wrap;background:#0f141a;border:1px solid var(--border);border-radius:10px;padding:14px;line-height:1.55;font-size:12px}code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}</style>
</head><body>
<header><div><b>Shared Artifact</b><div style="font-size:12px;color:var(--muted)">${escapeHtml(path)}</div></div><div><a href="/dashboard">← dashboard</a></div></header>
<main><pre><code>${escapeHtml(result.file.content)}</code></pre></main>
</body></html>`)
  })

  // Task heartbeat status — all doing tasks with stale comment activity
  app.get('/tasks/heartbeat-status', async () => {
    const HEARTBEAT_THRESHOLD_MS = 30 * 60 * 1000
    const now = Date.now()
    const allTasks = taskManager.listTasks({ status: 'doing' })
    const stale: Array<{
      taskId: string
      title: string
      assignee: string | null
      lastCommentAt: number | null
      staleSinceMs: number
    }> = []

    for (const task of allTasks) {
      const comments = taskManager.getTaskComments(task.id)
      const lastComment = comments.length > 0 ? comments[comments.length - 1] : null
      const lastTs = lastComment?.timestamp ?? task.updatedAt ?? task.createdAt
      const age = now - lastTs

      if (age > HEARTBEAT_THRESHOLD_MS) {
        stale.push({
          taskId: task.id,
          title: task.title,
          assignee: task.assignee || null,
          lastCommentAt: lastComment?.timestamp ?? null,
          staleSinceMs: age,
        })
      }
    }

    return {
      threshold: '30m',
      thresholdMs: HEARTBEAT_THRESHOLD_MS,
      doingTaskCount: allTasks.length,
      staleCount: stale.length,
      staleTasks: stale.sort((a, b) => b.staleSinceMs - a.staleSinceMs),
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
  app.get<{ Params: { id: string }; Querystring: { includeSuppressed?: string } }>('/tasks/:id/comments', async (request, reply) => {
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

    const includeSuppressed = String(request.query?.includeSuppressed || '').toLowerCase()
    const shouldIncludeSuppressed = includeSuppressed === 'true' || includeSuppressed === '1'

    const comments = taskManager.getTaskComments(resolved.resolvedId, { includeSuppressed: shouldIncludeSuppressed })
    return { comments, count: comments.length, resolvedId: resolved.resolvedId, includeSuppressed: shouldIncludeSuppressed }
  })

  // PR review quality panel data
  app.get<{ Params: { id: string } }>('/tasks/:id/pr-review', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) return

    const task = resolved.task as any
    const meta = task.metadata || {}

    // Extract PR URL from metadata (same logic as dashboard.js extractTaskPrLink)
    const candidates: string[] = []
    if (typeof meta.pr_url === 'string') candidates.push(meta.pr_url)
    if (typeof meta.pr_link === 'string') candidates.push(meta.pr_link)
    if (Array.isArray(meta.artifacts)) meta.artifacts.forEach((a: unknown) => { if (typeof a === 'string') candidates.push(a) })
    if (meta.qa_bundle && Array.isArray(meta.qa_bundle.pr_link)) candidates.push(meta.qa_bundle.pr_link)
    else if (typeof meta.qa_bundle?.pr_link === 'string') candidates.push(meta.qa_bundle.pr_link)
    if (meta.qa_bundle && Array.isArray(meta.qa_bundle.artifact_links)) {
      meta.qa_bundle.artifact_links.forEach((a: unknown) => { if (typeof a === 'string') candidates.push(a) })
    }

    const prUrlMatch = candidates.find(c => /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/i.test(c)) || null
    if (!prUrlMatch) {
      return { available: false, message: 'No PR URL found in task metadata', taskId: resolved.resolvedId }
    }

    const parsed = parseGitHubPrUrl(prUrlMatch)
    if (!parsed) {
      return { available: false, message: 'Invalid PR URL format', taskId: resolved.resolvedId }
    }

    const hdrs = await githubHeaders()

    // Fetch PR details (including files changed)
    let prData: any = null
    let prFiles: any[] = []
    let checkRuns: any[] = []

    try {
      const [prRes, filesRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}`, { headers: hdrs }),
        fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}/files?per_page=100`, { headers: hdrs }),
      ])

      if (prRes.ok) prData = await prRes.json()
      if (filesRes.ok) prFiles = (await filesRes.json()) as any[]
    } catch { /* GitHub API unavailable — degrade gracefully */ }

    // Fetch CI check runs
    const headSha = prData?.head?.sha
    if (headSha) {
      try {
        const checksRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${headSha}/check-runs?per_page=100`, { headers: hdrs })
        if (checksRes.ok) {
          const checksJson = await checksRes.json() as any
          checkRuns = checksJson.check_runs || []
        }
      } catch { /* CI data unavailable */ }
    }

    // Build diff scope summary
    const additions = prData?.additions ?? 0
    const deletions = prData?.deletions ?? 0
    const changedFiles = prData?.changed_files ?? prFiles.length
    const totalChurn = additions + deletions
    const commits = prData?.commits ?? 0

    // Group files by directory prefix (2-level for monorepo paths)
    const dirGroups: Record<string, { files: number; additions: number; deletions: number }> = {}
    for (const f of prFiles) {
      const parts = (f.filename || '').split('/')
      const dir = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0] || '(root)'
      if (!dirGroups[dir]) dirGroups[dir] = { files: 0, additions: 0, deletions: 0 }
      dirGroups[dir].files++
      dirGroups[dir].additions += f.additions || 0
      dirGroups[dir].deletions += f.deletions || 0
    }

    // Risk indicator (use total churn, not net — pure deletions are still large changes)
    let riskLevel: 'small' | 'medium' | 'large' = 'small'
    if (totalChurn > 500 || changedFiles > 15) riskLevel = 'large'
    else if (totalChurn > 100 || changedFiles > 5) riskLevel = 'medium'

    // Build CI check results
    const ciChecks = checkRuns.map((cr: any) => ({
      name: cr.name || 'unknown',
      status: cr.status || 'unknown',
      conclusion: cr.conclusion || null,
      durationSec: cr.started_at && cr.completed_at
        ? Math.round((new Date(cr.completed_at).getTime() - new Date(cr.started_at).getTime()) / 1000)
        : null,
      detailsUrl: cr.html_url || cr.details_url || null,
    }))
    const ciPassed = ciChecks.filter((c: any) => c.conclusion === 'success').length
    const ciFailed = ciChecks.filter((c: any) => c.conclusion === 'failure').length
    const ciTotal = ciChecks.length

    // Also include QA bundle checks if present
    const qaBundleChecks: string[] = Array.isArray(meta.qa_bundle?.checks) ? meta.qa_bundle.checks : []

    // Done criteria alignment
    const doneCriteria: string[] = Array.isArray(task.done_criteria) ? task.done_criteria : []
    const fileNames = prFiles.map((f: any) => (f.filename || '').toLowerCase())
    const allFileContent = prFiles.map((f: any) => (f.filename || '').toLowerCase()).join(' ')

    const criteriaAlignment = doneCriteria.map((criterion: string) => {
      // Extract keywords from criterion (words 4+ chars, skip common ones)
      const stopWords = new Set(['should', 'shows', 'with', 'that', 'have', 'from', 'when', 'this', 'each', 'must', 'without', 'after', 'before', 'during', 'between', 'other', 'than', 'also', 'into', 'more', 'some', 'such', 'only', 'very', 'will', 'does', 'done', 'been', 'being', 'would', 'could', 'make', 'like', 'just', 'over', 'through'])
      const keywords = criterion.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !stopWords.has(w))

      // Check if keywords appear in changed file paths
      const fileMatches = keywords.filter(kw => allFileContent.includes(kw))

      // Check if keywords appear in test/check names
      const testMatches = keywords.filter(kw =>
        ciChecks.some((c: any) => (c.name || '').toLowerCase().includes(kw)) ||
        qaBundleChecks.some(c => c.toLowerCase().includes(kw))
      )

      // Check for artifact evidence
      const hasArtifact = Array.isArray(meta.qa_bundle?.artifact_links) && meta.qa_bundle.artifact_links.length > 0

      // Compute confidence
      let confidence: 'high' | 'medium' | 'low' | 'none' = 'none'
      if (fileMatches.length > 0 && (testMatches.length > 0 || hasArtifact)) confidence = 'high'
      else if (fileMatches.length > 0) confidence = 'medium'
      else if (testMatches.length > 0 || hasArtifact) confidence = 'low'

      // Find specific matching files
      const matchingFiles = fileNames.filter(fn => keywords.some(kw => fn.includes(kw)))

      return {
        criterion,
        confidence,
        keywords: keywords.slice(0, 8),
        fileMatches: matchingFiles.slice(0, 5),
        testMatches: testMatches.slice(0, 3),
        hasArtifact,
      }
    })

    const highCount = criteriaAlignment.filter(c => c.confidence === 'high').length
    const mediumCount = criteriaAlignment.filter(c => c.confidence === 'medium').length
    const lowCount = criteriaAlignment.filter(c => c.confidence === 'low').length
    const noneCount = criteriaAlignment.filter(c => c.confidence === 'none').length

    return {
      available: true,
      taskId: resolved.resolvedId,
      pr: {
        url: prUrlMatch,
        number: parsed.pullNumber,
        owner: parsed.owner,
        repo: parsed.repo,
        title: prData?.title || null,
        state: prData?.state || null,
        merged: Boolean(prData?.merged_at),
        author: prData?.user?.login || null,
        createdAt: prData?.created_at || null,
        updatedAt: prData?.updated_at || null,
        headSha: headSha || null,
      },
      diffScope: {
        changedFiles,
        additions,
        deletions,
        totalChurn,
        commits,
        riskLevel,
        directories: Object.entries(dirGroups)
          .sort((a, b) => b[1].files - a[1].files)
          .map(([dir, stats]) => ({ dir, ...stats })),
        files: prFiles.map((f: any) => ({
          filename: f.filename,
          additions: f.additions || 0,
          deletions: f.deletions || 0,
          status: f.status || 'modified',
        })),
      },
      ci: {
        total: ciTotal,
        passed: ciPassed,
        failed: ciFailed,
        checks: ciChecks,
        qaBundleChecks,
      },
      doneCriteriaAlignment: {
        criteria: criteriaAlignment,
        summary: {
          total: doneCriteria.length,
          high: highCount,
          medium: mediumCount,
          low: lowCount,
          none: noneCount,
        },
      },
    }
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
      const comment = await taskManager.addTaskComment(
        resolved.resolvedId,
        data.author,
        data.content,
        { category: (data as any).category ?? null },
      )

      // ── Knowledge auto-index: decision comments ──
      if (isDecisionComment(data.content, (data as any).category)) {
        const taskForDecision = taskManager.getTask(resolved.resolvedId)
        onDecisionComment({
          taskId: resolved.resolvedId,
          commentId: comment.id,
          author: data.author,
          content: data.content,
          taskTitle: taskForDecision?.title,
        }).catch(() => { /* knowledge indexing is best-effort */ })
      }

      // Task-comments are now primary execution comms:
      // fan out inbox-visible notifications to assignee/reviewer + explicit @mentions.
      // Notification routing respects per-agent preferences (quiet hours, mute, filters).
      const task = taskManager.getTask(resolved.resolvedId)
      if (task && !comment.suppressed) {
        const targets = new Set<string>()

        if (task.assignee) targets.add(task.assignee)
        if (task.reviewer) targets.add(task.reviewer)
        for (const mention of extractMentions(data.content)) {
          targets.add(mention)
        }

        // Keep sender out of forced mention fanout to avoid self-noise.
        targets.delete(data.author)

        // Filter targets through notification preferences
        const notifMgr = getNotificationManager()
        const filteredTargets = new Set<string>()
        for (const agent of targets) {
          const routing = notifMgr.shouldNotify({
            type: 'taskComment',
            agent,
            priority: task.priority,
            channel: 'task-comments',
            message: data.content,
          })
          if (routing.shouldNotify) {
            filteredTargets.add(agent)
          }
        }

        if (filteredTargets.size > 0) {
          const mentionPrefix = Array.from(filteredTargets)
            .map(agent => `@${agent}`)
            .join(' ')

          const inboxNotification = `${mentionPrefix} [task-comment:${task.id}] ${data.content}`.trim()

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
              notifiedAgents: Array.from(filteredTargets),
              filteredAgents: Array.from(targets).filter(a => !filteredTargets.has(a)),
            },
          })
        }
      }

      presenceManager.recordActivity(data.author, 'message')
      presenceManager.updatePresence(data.author, 'working')

      // Heartbeat discipline: compute gap since previous comment for doing tasks
      let heartbeatWarning: string | undefined
      if (task && task.status === 'doing' && !comment.suppressed) {
        const HEARTBEAT_THRESHOLD_MS = 30 * 60 * 1000
        const allComments = taskManager.getTaskComments(resolved.resolvedId)
        // Look at the second-to-last comment (the one before this new one)
        const prevComment = allComments.length > 1 ? allComments[allComments.length - 2] : null
        const prevTs = prevComment?.timestamp ?? task.updatedAt ?? task.createdAt
        const gap = comment.timestamp - prevTs
        if (gap > HEARTBEAT_THRESHOLD_MS) {
          const gapMin = Math.round(gap / 60000)
          heartbeatWarning = `Status heartbeat gap: ${gapMin}m since last update (guideline: ≤30m for doing tasks). Consider posting progress comments more frequently.`
        }
      }

      return { success: true, comment, ...(heartbeatWarning ? { heartbeatWarning } : {}) }
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

    const followOnEvidence = getFollowOnEvidence(task)

    const reasons: string[] = []
    if (!prUrl) reasons.push('no_pr_url_resolved')
    if (strict && prCi.ci.state !== 'success') reasons.push(`ci_not_success:${prCi.ci.state}`)
    if (artifactEvidence.length === 0) reasons.push('no_artifact_paths_resolved')
    if (artifactEvidence.length > 0 && !artifactEvidence.some(item => item.exists)) {
      reasons.push('artifact_paths_missing')
    }
    if (followOnEvidence.required && followOnEvidence.state === 'missing') {
      reasons.push('follow_on_missing')
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
        follow_on: followOnEvidence,
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
      // Alert on unauthorized review attempt
      alertUnauthorizedApproval({
        taskId: task.id,
        taskTitle: task.title,
        actor: body.reviewer,
        expectedReviewer: task.reviewer,
        context: `POST /tasks/${task.id}/review`,
      }).catch(err => console.error('[MutationAlert] Alert failed:', err))

      reply.code(403)
      return {
        success: false,
        error: `Only assigned reviewer "${task.reviewer}" can submit task review decisions`,
      }
    }

    const decidedAt = Date.now()
    const isApprove = body.decision === 'approve'
    const decisionLabel = isApprove ? 'approved' : 'rejected'
    const mergedMetadata = {
      ...(task.metadata || {}),

      // Reviewer decision (single canonical place)
      reviewer_approved: isApprove,
      reviewer_decision: {
        decision: decisionLabel,
        reviewer: body.reviewer,
        comment: body.comment,
        decidedAt,
      },
      reviewer_notes: body.comment,

      // Stamp actor so downstream gates can assert reviewer identity.
      actor: body.reviewer,

      // Keep review queue state coherent even when approving via /tasks/:id/review
      review_state: isApprove ? 'approved' : 'needs_author',
      review_last_activity_at: decidedAt,
    }

    const updated = await taskManager.updateTask(task.id, {
      metadata: mergedMetadata,
    })

    // ── Audit ledger: log review decision ──
    if (updated) {
      const reviewChanges = diffReviewFields(
        task as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
        (task.metadata || {}) as Record<string, unknown>,
        (updated.metadata || {}) as Record<string, unknown>,
      )
      if (reviewChanges.length > 0) {
        recordReviewMutation({
          taskId: task.id,
          actor: body.reviewer,
          context: `POST /tasks/${task.id}/review`,
          changes: reviewChanges,
        }).catch(err => console.error('[Audit] Failed to record review mutation:', err))
      }
    }

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

  // Task creation templates by type
  const TASK_TEMPLATES: Record<string, {
    required_fields: string[]
    recommended_fields: string[]
    min_done_criteria: number
    title_hint: string
    example: Record<string, unknown>
  }> = {
    bug: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'eta', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description', 'metadata.source', 'metadata.steps_to_reproduce'],
      min_done_criteria: 1,
      title_hint: 'Describe what is broken: "Bug: [component] — [symptom] when [action]"',
      example: {
        title: 'Bug: dashboard login — 500 error when SSO callback missing state param',
        type: 'bug',
        assignee: 'link',
        reviewer: 'kai',
        done_criteria: ['SSO callback handles missing state param gracefully (redirect to /auth with error)', 'No 500 in production logs for this code path'],
        eta: '~2h',
        priority: 'P1',
        createdBy: 'kai',
        metadata: { source: 'Ryan dogfooding Feb 16' },
      },
    },
    feature: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'eta', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description', 'metadata.spec_link'],
      min_done_criteria: 2,
      title_hint: 'Describe the user-facing outcome: "Feature: [what] — [user benefit]"',
      example: {
        title: 'Feature: host activity feed — show last 10 events per host on dashboard',
        type: 'feature',
        assignee: 'link',
        reviewer: 'kai',
        done_criteria: ['Dashboard shows last 10 activity events per host', 'Events include heartbeats, claims, syncs with timestamps'],
        eta: '~4h',
        priority: 'P2',
        createdBy: 'kai',
      },
    },
    process: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'eta', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description'],
      min_done_criteria: 1,
      title_hint: 'Describe the process change: "Process: [what changes] — [why]"',
      example: {
        title: 'Process: enforce task intake schema — reject vague tasks at creation',
        type: 'process',
        assignee: 'link',
        reviewer: 'kai',
        done_criteria: ['Task creation rejects without required fields', 'Templates available per type'],
        eta: '~2h',
        priority: 'P2',
        createdBy: 'kai',
      },
    },
    docs: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'eta', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description', 'metadata.doc_path'],
      min_done_criteria: 1,
      title_hint: 'Describe what docs need: "Docs: [topic] — [what is missing/wrong]"',
      example: {
        title: 'Docs: enrollment handshake — document connect flow for agents',
        type: 'docs',
        assignee: 'sage',
        reviewer: 'kai',
        done_criteria: ['Connect flow documented with steps and code examples', 'Published at docs.reflectt.ai'],
        eta: '~2h',
        priority: 'P3',
        createdBy: 'kai',
      },
    },
    chore: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'eta', 'createdBy', 'priority'],
      recommended_fields: ['description'],
      min_done_criteria: 1,
      title_hint: 'Describe the maintenance task: "Chore: [what] — [why now]"',
      example: {
        title: 'Chore: clean up stale branches — 15+ unmerged branches from last sprint',
        type: 'chore',
        assignee: 'link',
        reviewer: 'kai',
        done_criteria: ['All branches older than 2 weeks merged or deleted'],
        eta: '~1h',
        priority: 'P4',
        createdBy: 'kai',
      },
    },
  }

  // Task intake schema (discovery endpoint)
  app.get('/tasks/intake-schema', async () => {
    return {
      required: ['title', 'assignee', 'done_criteria', 'eta', 'createdBy', 'priority'],
      optional: ['type', 'description', 'status', 'blocked_by', 'epic_id', 'tags', 'teamId', 'metadata', 'reviewer'],
      notes: { reviewer: 'Defaults to "auto" — load-balanced assignment based on role, affinity, and SLA risk. Set explicitly to override.' },
      types: TASK_TYPES,
      templates: TASK_TEMPLATES,
      type_requirements: {
        bug: { notes: 'Title or description should describe impact (what is broken). Include metadata.source if available.', min_done_criteria: 1 },
        feature: { notes: 'At least 2 done criteria required (user-facing outcome + verification).', min_done_criteria: 2 },
        process: { notes: 'Standard requirements only.', min_done_criteria: 1 },
        docs: { notes: 'Standard requirements only.', min_done_criteria: 1 },
        chore: { notes: 'Standard requirements only.', min_done_criteria: 1 },
      },
      definition_of_ready: [
        'Title must be at least 10 characters and specific (no vague words like "fix", "update", "todo")',
        'Each done criterion must be a full sentence (at least 3 words) describing a verifiable outcome',
        'Priority (P0-P3) is required',
        'Reviewer must be assigned at creation time',
        'done_criteria must have at least 1 entry (features require 2+)',
      ],
      priorities: { P0: 'Critical/blocking', P1: 'High — ship this sprint', P2: 'Medium — next sprint', P3: 'Low — backlog' },
    }
  })

  // Task template endpoint — returns template for a specific type
  app.get<{ Params: { type: string } }>('/tasks/templates/:type', async (request, reply) => {
    const taskType = request.params.type
    const template = TASK_TEMPLATES[taskType]
    if (!template) {
      reply.code(404)
      return { error: `Unknown task type: ${taskType}`, available_types: Object.keys(TASK_TEMPLATES) }
    }
    return { type: taskType, template }
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

      // Definition-of-ready check (skip for TEST: tasks and test environment)
      const skipDoR = data.title.startsWith('TEST:') || process.env.NODE_ENV === 'test'
      if (!skipDoR) {
        const readinessProblems = checkDefinitionOfReady(data)
        if (readinessProblems.length > 0) {
          reply.code(400)
          return {
            success: false,
            error: 'Task does not meet definition of ready',
            code: 'DEFINITION_OF_READY',
            problems: readinessProblems,
            hint: 'Fix the listed problems and retry. Tasks must have specific titles, verifiable done criteria, priority, and reviewer.',
          }
        }
      }

      const { eta, type, ...rest } = data

      // Auto-assign reviewer when 'auto' or missing
      const needsAutoReviewer = !rest.reviewer || rest.reviewer === 'auto'
      let reviewerAutoAssigned = false
      let reviewerScores: Array<{ agent: string; score: number; validatingLoad: number; role: string }> = []
      if (needsAutoReviewer) {
        try {
          const allTasks = taskManager.listTasks({})
          const reviewerSuggestion = suggestReviewer(
            { title: rest.title, assignee: rest.assignee, tags: (rest.metadata as Record<string, unknown> | undefined)?.tags as string[] | undefined, done_criteria: rest.done_criteria },
            allTasks.map(t => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee, reviewer: t.reviewer, tags: t.metadata?.tags as string[] | undefined, metadata: t.metadata })),
          )
          reviewerScores = reviewerSuggestion.scores
          if (reviewerSuggestion.suggested) {
            rest.reviewer = reviewerSuggestion.suggested
            reviewerAutoAssigned = true
          } else {
            // No suggestion available — fall back to kai
            rest.reviewer = 'kai'
            reviewerAutoAssigned = true
          }
        } catch {
          rest.reviewer = 'kai'
          reviewerAutoAssigned = true
        }
      }

      const normalizedTeamId = normalizeTeamId(data.teamId) || normalizeTeamId((rest.metadata as Record<string, unknown> | undefined)?.teamId)
      const newMetadata: Record<string, unknown> = {
        ...(rest.metadata || {}),
        eta,
        ...(type ? { type } : {}),
        ...(normalizedTeamId ? { teamId: normalizedTeamId } : {}),
        ...(reviewerAutoAssigned ? {
          reviewer_auto_assigned: true,
          reviewer_scores: reviewerScores.slice(0, 3), // top 3 candidates for transparency
        } : {}),
      }

      // Tag test-harness tasks so they can be excluded from live backlog metrics.
      // (The harness often uses source_reflection/source_insight markers rather than TEST: titles.)
      const sr = newMetadata.source_reflection
      const si = newMetadata.source_insight
      if (newMetadata.is_test !== true) {
        if (typeof sr === 'string' && sr.startsWith('ref-test-')) newMetadata.is_test = true
        if (typeof si === 'string' && si.startsWith('ins-test-')) newMetadata.is_test = true
        if (/test run \d{13}/i.test(rest.title || '')) newMetadata.is_test = true
      }

      const task = await taskManager.createTask({
        ...rest,
        ...(normalizedTeamId ? { teamId: normalizedTeamId } : {}),
        metadata: newMetadata,
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
      
      trackTaskEvent('created')
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

          // Definition-of-ready check (skip for TEST: tasks and test environment)
          if (!taskData.title.startsWith('TEST:') && process.env.NODE_ENV !== 'test') {
            const readinessProblems = checkDefinitionOfReady(taskData)
            if (readinessProblems.length > 0) {
              results.push({ title: taskData.title, status: 'error', error: `Definition of ready: ${readinessProblems.join('; ')}` })
              continue
            }
          }

          if (data.dryRun) {
            results.push({ title: taskData.title, status: 'created' })
            continue
          }

          const { eta, type, ...rest } = taskData

          // Auto-assign reviewer if not provided
          if (!rest.reviewer) {
            try {
              const allTasks = taskManager.listTasks({})
              const reviewerSuggestion = suggestReviewer(
                { title: rest.title, assignee: rest.assignee, tags: (rest.metadata as Record<string, unknown> | undefined)?.tags as string[] | undefined, done_criteria: rest.done_criteria },
                allTasks.map(t => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee, metadata: t.metadata })),
              )
              if (reviewerSuggestion.suggested) {
                rest.reviewer = reviewerSuggestion.suggested
              }
            } catch { /* silent */ }
          }

          const normalizedTeamId = normalizeTeamId(taskData.teamId) || normalizeTeamId((rest.metadata as Record<string, unknown> | undefined)?.teamId)

          const newMetadata: Record<string, unknown> = {
            ...(rest.metadata || {}),
            eta,
            ...(type ? { type } : {}),
            ...(normalizedTeamId ? { teamId: normalizedTeamId } : {}),
            batch_created: true,
            ...(!taskData.reviewer && rest.reviewer ? { reviewer_auto_assigned: true } : {}),
          }

          // Tag test-harness tasks so they can be excluded from live backlog metrics.
          const sr = newMetadata.source_reflection
          const si = newMetadata.source_insight
          if (newMetadata.is_test !== true) {
            if (typeof sr === 'string' && sr.startsWith('ref-test-')) newMetadata.is_test = true
            if (typeof si === 'string' && si.startsWith('ins-test-')) newMetadata.is_test = true
            if (/test run \d{13}/i.test(rest.title || '')) newMetadata.is_test = true
          }

          const task = await taskManager.createTask({
            ...rest,
            ...(normalizedTeamId ? { teamId: normalizedTeamId } : {}),
            createdBy: taskData.createdBy || data.createdBy,
            metadata: newMetadata,
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
  app.get('/tasks/board-health', async (request) => {
    const query = request.query as Record<string, string>
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    const allTasks = taskManager.listTasks({ includeTest })
    const agents = [...new Set(allTasks.map(t => t.assignee).filter(Boolean))] as string[]

    const outOfLaneFlags = allTasks
      .filter((task) => task.status === 'doing' || task.status === 'validating')
      .filter((task) => isEchoOutOfLaneTask(task))
      .map((task) => {
        const metadata = (task.metadata || {}) as Record<string, unknown>
        return {
          taskId: task.id,
          assignee: task.assignee,
          status: task.status,
          inferredDomain: inferTaskWorkDomain(task),
          reason: 'echo_out_of_lane_without_reassignment',
          rerouteHint: 'Reassign to lane owner or add explicit reassignment metadata with reason.',
          branch: typeof metadata.branch === 'string' ? metadata.branch : undefined,
        }
      })

    const flaggedByAgent = new Map<string, number>()
    for (const flag of outOfLaneFlags) {
      const key = String(flag.assignee || '').toLowerCase()
      if (!key) continue
      flaggedByAgent.set(key, (flaggedByAgent.get(key) || 0) + 1)
    }

    const agentHealth = agents.map(agent => {
      const agentTasks = allTasks.filter(t => (t.assignee || '').toLowerCase() === agent.toLowerCase())
      const doing = agentTasks.filter(t => t.status === 'doing').length
      const validating = agentTasks.filter(t => t.status === 'validating').length
      const todo = agentTasks.filter(t => t.status === 'todo').length
      const active = doing + validating
      const outOfLaneCount = flaggedByAgent.get(agent.toLowerCase()) || 0

      return {
        agent,
        doing,
        validating,
        todo,
        active,
        outOfLaneCount,
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
        outOfLaneFlags: outOfLaneFlags.length,
      },
      agents: agentHealth,
      agentsNeedingWork,
      agentsLowWatermark,
      outOfLaneFlags,
    }
  })

  // ── Board health execution worker endpoints ─────────────────────────

  // Worker status + config
  app.get('/board-health/status', async () => {
    return { success: true, ...boardHealthWorker.getStatus() }
  })

  // Audit log
  app.get<{ Querystring: { limit?: string; since?: string; kind?: string } }>(
    '/board-health/audit-log',
    async (request) => {
      const { limit, since, kind } = request.query
      const log = boardHealthWorker.getAuditLog({
        limit: limit ? Number(limit) : 50,
        since: since ? Number(since) : undefined,
        kind: kind as any,
      })
      return { success: true, count: log.length, actions: log }
    },
  )

  // Manual tick (dry-run or real)
  app.post<{ Querystring: { dryRun?: string } }>(
    '/board-health/tick',
    async (request) => {
      const dryRun = request.query.dryRun === 'true'
      const result = await boardHealthWorker.tick({ dryRun, force: true })
      return { success: true, ...result }
    },
  )

  // Rollback an automated action
  app.post<{ Params: { actionId: string }; Body: { by?: string } }>(
    '/board-health/rollback/:actionId',
    async (request) => {
      const by = (request.body as any)?.by || 'manual'
      const result = await boardHealthWorker.rollback(request.params.actionId, by)
      return result
    },
  )

  // Update worker config at runtime
  app.patch('/board-health/config', async (request) => {
    const patch = request.body as Record<string, unknown>
    const allowed = [
      'enabled', 'intervalMs', 'staleDoingThresholdMin', 'suggestCloseThresholdMin',
      'rollbackWindowMs', 'digestIntervalMs', 'digestChannel', 'quietHoursStart',
      'quietHoursEnd', 'dryRun', 'maxActionsPerTick',
    ]
    const filtered: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in patch) filtered[key] = patch[key]
    }
    boardHealthWorker.updateConfig(filtered as any)
    return { success: true, config: boardHealthWorker.getConfig() }
  })

  // Prune old audit log entries
  app.post<{ Querystring: { maxAgeDays?: string } }>(
    '/board-health/prune',
    async (request) => {
      const maxAgeDays = Number(request.query.maxAgeDays || 7)
      const pruned = boardHealthWorker.pruneAuditLog(maxAgeDays)
      return { success: true, pruned }
    },
  )

  // ── Agent change feed ─────────────────────────────────────────────────

  app.get<{ Params: { agent: string }; Querystring: { since?: string; limit?: string; kinds?: string; includeGlobal?: string } }>(
    '/feed/:agent',
    async (request) => {
      const { agent } = request.params
      const since = Number(request.query.since || 0)
      if (!since) {
        return { success: false, message: 'since parameter required (unix timestamp ms)' }
      }
      const limit = request.query.limit ? Number(request.query.limit) : 100
      const kinds = request.query.kinds
        ? (request.query.kinds.split(',') as FeedEventKind[])
        : undefined
      const includeGlobal = request.query.includeGlobal !== 'false'

      const result = buildAgentFeed(agent, { since, limit, kinds, includeGlobal })
      return { success: true, ...result }
    },
  )

  // ── Unified policy config endpoints ─────────────────────────────────

  app.get('/policy', async () => {
    return {
      success: true,
      policy: policyManager.get(),
      filePath: policyManager.getFilePath(),
    }
  })

  app.patch('/policy', async (request) => {
    const patch = request.body as Record<string, unknown>
    const updated = policyManager.patch(patch as any)

    // Propagate board-health config changes to the running worker
    boardHealthWorker.updateConfig(updated.boardHealth)

    return { success: true, policy: updated }
  })

  app.post('/policy/reset', async () => {
    const reset = policyManager.reset()
    boardHealthWorker.updateConfig(reset.boardHealth)
    return { success: true, policy: reset }
  })

  // ── Message routing endpoints ───────────────────────────────────────

  // Routing stats (channel hygiene observability)
  app.get('/routing/stats', async () => {
    return { success: true, ...getRoutingStats() }
  })

  // Routing log (recent routing decisions)
  app.get<{ Querystring: { limit?: string; since?: string; category?: string; severity?: string } }>(
    '/routing/log',
    async (request) => {
      const { limit, since, category, severity } = request.query
      const log = getRoutingLog({
        limit: limit ? Number(limit) : 50,
        since: since ? Number(since) : undefined,
        category: category as MessageCategory | undefined,
        severity: severity as MessageSeverity | undefined,
      })
      return { success: true, count: log.length, entries: log }
    },
  )

  // Dry-run route resolution (preview where a message would go)
  app.post('/routing/resolve', async (request) => {
    const body = request.body as Record<string, unknown>
    const decision = resolveRoute({
      from: (body.from as string) || 'system',
      content: (body.content as string) || '',
      severity: body.severity as MessageSeverity | undefined,
      category: body.category as MessageCategory | undefined,
      taskId: body.taskId as string | undefined,
      forceChannel: body.forceChannel as string | undefined,
      mentions: body.mentions as string[] | undefined,
    })
    return { success: true, decision }
  })

  // ── Preflight Check endpoint ────────────────────────────────────────

  app.get('/preflight', async (request) => {
    const { runPreflight } = await import('./preflight.js')
    const query = request.query as Record<string, string>
    const report = await runPreflight({
      cloudUrl: query.cloudUrl || undefined,
      port: query.port ? Number(query.port) : undefined,
      skipNetwork: query.skipNetwork === 'true',
    })
    return { success: true, ...report }
  })

  app.post('/preflight', async (request) => {
    const { runPreflight } = await import('./preflight.js')
    const body = (request.body || {}) as Record<string, unknown>
    const report = await runPreflight({
      cloudUrl: body.cloudUrl as string | undefined,
      port: body.port as number | undefined,
      skipNetwork: body.skipNetwork as boolean | undefined,
      joinToken: body.joinToken as string | undefined,
      apiKey: body.apiKey as string | undefined,
      userId: body.userId as string | undefined,
    })
    return { success: true, ...report }
  })

  app.get('/preflight/text', async (request) => {
    const { runPreflight, formatPreflightReport } = await import('./preflight.js')
    const query = request.query as Record<string, string>
    const report = await runPreflight({
      cloudUrl: query.cloudUrl || undefined,
      port: query.port ? Number(query.port) : undefined,
      skipNetwork: query.skipNetwork === 'true',
    })
    return formatPreflightReport(report)
  })

  // ── Noise Budget endpoints ──────────────────────────────────────────

  // Noise budget snapshot (current state for all channels)
  app.get('/chat/noise-budget', async () => {
    return { success: true, ...noiseBudgetManager.getSnapshot() }
  })

  // Chat suppression stats (in-memory dedup + persistent suppression ledger)
  app.get('/chat/suppression/stats', async () => {
    return {
      success: true,
      inline_dedup: chatManager.getSuppressionStats(),
      ledger: suppressionLedger.getStats(),
    }
  })

  // Noise budget canary metrics (rollback evaluation)
  app.get('/chat/noise-budget/canary', async () => {
    return { success: true, ...noiseBudgetManager.getCanaryMetrics() }
  })

  // Noise budget suppression log
  app.get<{ Querystring: { limit?: string; since?: string } }>(
    '/chat/noise-budget/suppression-log',
    async (request) => {
      const { limit, since } = request.query
      const log = noiseBudgetManager.getSuppressionLog({
        limit: limit ? Number(limit) : 50,
        since: since ? Number(since) : undefined,
      })
      return { success: true, count: log.length, entries: log }
    },
  )

  // Noise budget config (read)
  app.get('/chat/noise-budget/config', async () => {
    return { success: true, config: noiseBudgetManager.getConfig() }
  })

  // Noise budget config (update)
  app.patch('/chat/noise-budget/config', async (request) => {
    const body = request.body as Record<string, unknown>
    noiseBudgetManager.updateConfig(body as any)
    return { success: true, config: noiseBudgetManager.getConfig() }
  })

  // Exit canary mode → enforce
  app.post('/chat/noise-budget/activate', async () => {
    noiseBudgetManager.activateEnforcement()
    return { success: true, canaryMode: false, message: 'Enforcement activated — suppression is now live' }
  })

  // Force digest flush
  app.post('/chat/noise-budget/flush-digest', async () => {
    const entries = await noiseBudgetManager.flushDigestQueue()
    return { success: true, flushed: entries.length }
  })

  // ── Suppression Ledger endpoints ──────────────────────────────────────

  app.post('/chat/suppression/prune', async () => {
    const pruned = suppressionLedger.prune()
    return { success: true, pruned }
  })

  // ── Alert Integrity endpoints ────────────────────────────────────────

  app.get('/chat/alert-integrity', async () => {
    const { alertIntegrityGuard } = await import('./alert-integrity.js')
    return { success: true, stats: alertIntegrityGuard.getStats() }
  })

  app.get('/chat/alert-integrity/audit', async (request) => {
    const { alertIntegrityGuard } = await import('./alert-integrity.js')
    const query = request.query as Record<string, string>
    const log = alertIntegrityGuard.getAuditLog({
      limit: query.limit ? Number(query.limit) : 50,
      since: query.since ? Number(query.since) : undefined,
      taskId: query.taskId || undefined,
    })
    return { success: true, count: log.length, entries: log }
  })

  app.get('/chat/alert-integrity/rollback', async () => {
    const { alertIntegrityGuard } = await import('./alert-integrity.js')
    return { success: true, ...alertIntegrityGuard.getRollbackSignals() }
  })

  app.get('/chat/alert-integrity/config', async () => {
    const { alertIntegrityGuard } = await import('./alert-integrity.js')
    return { success: true, config: alertIntegrityGuard.getConfig() }
  })

  app.patch('/chat/alert-integrity/config', async (request) => {
    const { alertIntegrityGuard } = await import('./alert-integrity.js')
    const body = request.body as Record<string, unknown>
    alertIntegrityGuard.updateConfig(body as any)
    return { success: true, config: alertIntegrityGuard.getConfig() }
  })

  app.post('/chat/alert-integrity/activate', async () => {
    const { alertIntegrityGuard } = await import('./alert-integrity.js')
    alertIntegrityGuard.activateEnforcement()
    return { success: true, canaryMode: false }
  })

  // ── Task transition precheck ─────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { targetStatus: string } }>(
    '/tasks/:id/precheck',
    async (request) => {
      const { id } = request.params
      const body = request.body as Record<string, unknown>
      const targetStatus = (body.targetStatus as string) || 'doing'

      const lookup = taskManager.resolveTaskId(id)
      const resolvedId = (lookup.matchType === 'exact' || lookup.matchType === 'prefix')
        ? (lookup.resolvedId || id)
        : id

      const result = runPrecheck(resolvedId, targetStatus)
      return { success: true, ...result }
    },
  )

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

      // Merge incoming metadata with existing for gate checks + persistence.
      // Apply auto-defaults (ETA, artifact_path) when not explicitly provided.
      const incomingMeta = parsed.metadata || {}
      const effectiveTargetStatus = parsed.status ?? existing.status
      const autoFilledMeta = applyAutoDefaults(lookup.resolvedId, effectiveTargetStatus, incomingMeta as Record<string, unknown>)
      const mergedRawMeta = { ...(existing.metadata || {}), ...autoFilledMeta }
      // Normalize review-state metadata for state-aware SLA tracking.
      const mergedMeta = applyReviewStateMetadata(existing, parsed, mergedRawMeta, Date.now())

      // ── State machine transition validation ──
      // Must run before all other gates to give a clear rejection message.
      if (parsed.status && parsed.status !== existing.status) {
        const ALLOWED_TRANSITIONS: Record<string, string[]> = {
          'todo':       ['doing'],
          'doing':      ['blocked', 'validating'],
          'blocked':    ['doing', 'todo'],
          'validating': ['done', 'doing'],   // doing = reviewer rejection / rework
          'done':       [],                   // all exits require reopen
          'in-progress': ['blocked', 'validating', 'done', 'doing', 'todo'], // legacy, permissive
        }
        const allowed = ALLOWED_TRANSITIONS[existing.status] ?? []
        if (!allowed.includes(parsed.status)) {
          const meta = (incomingMeta ?? {}) as Record<string, unknown>
          const isReopen = meta.reopen === true
          const reopenReason = typeof meta.reopen_reason === 'string' ? String(meta.reopen_reason).trim() : ''
          if (!isReopen || reopenReason.length === 0) {
            reply.code(422)
            return {
              success: false,
              error: `State transition rejected: ${existing.status}→${parsed.status} is not allowed. ` +
                `Valid transitions from "${existing.status}": [${allowed.join(', ')}]. ` +
                `To force this transition, set metadata.reopen=true and metadata.reopen_reason.`,
              code: 'STATE_TRANSITION_REJECTED',
              gate: 'state_machine',
            }
          }
          // Reopen is valid — stamp it in merged metadata
          mergedMeta.reopen = true
          mergedMeta.reopen_reason = reopenReason
          mergedMeta.reopened_at = Date.now()
          mergedMeta.reopened_from = existing.status
        }
      }

      // Reviewer-identity gate: only assigned reviewer can set reviewer_approved=true.
      const incomingReviewerApproved = (incomingMeta as Record<string, unknown>).reviewer_approved
      if (incomingReviewerApproved === true) {
        const actor = parsed.actor?.trim()
        if (!actor) {
          reply.code(400)
          return {
            success: false,
            error: 'Reviewer identity gate: actor field is required when metadata.reviewer_approved=true',
            gate: 'reviewer_identity',
            hint: 'Include actor with the assigned reviewer name.',
          }
        }

        if (existing.reviewer && actor.toLowerCase() !== existing.reviewer.toLowerCase()) {
          mergedMeta.approval_rejected = {
            attempted_by: actor,
            expected_reviewer: existing.reviewer,
            at: Date.now(),
          }

          // Alert on unauthorized approval attempt
          alertUnauthorizedApproval({
            taskId: existing.id,
            taskTitle: existing.title,
            actor,
            expectedReviewer: existing.reviewer,
            context: `PATCH /tasks/${existing.id}`,
          }).catch(err => console.error('[MutationAlert] Alert failed:', err))

          reply.code(403)
          return {
            success: false,
            error: `Only assigned reviewer "${existing.reviewer}" can approve this task`,
            gate: 'reviewer_identity',
          }
        }

        mergedMeta.approved_by = actor
        mergedMeta.approved_at = Date.now()
      }

      // Model validation gate on start: reject unknown model ids and auto-default when missing.
      if (parsed.status === 'doing' && existing.status !== 'doing') {
        const requestedModel = mergedMeta.model
        if (requestedModel === undefined || requestedModel === null || `${requestedModel}`.trim().length === 0) {
          const fallback = MODEL_ALIASES[DEFAULT_MODEL_ALIAS]
          mergedMeta.model = DEFAULT_MODEL_ALIAS
          mergedMeta.model_resolved = fallback
          mergedMeta.model_defaulted = true
          mergedMeta.model_default_reason = 'No model configured at task start; default alias applied.'
        } else {
          const validatedModel = normalizeConfiguredModel(requestedModel)
          if (!validatedModel.ok) {
            reply.code(400)
            return {
              success: false,
              error: validatedModel.error,
              gate: 'model_validation',
              hint: `Use one of aliases (${Object.keys(MODEL_ALIASES).join(', ')}) or provider/model (e.g., anthropic/claude-sonnet-4-5).`,
            }
          }
          mergedMeta.model = validatedModel.value
          mergedMeta.model_resolved = validatedModel.resolved
          mergedMeta.model_defaulted = false
        }
      }

      // TEST: prefixed tasks bypass gates (WIP cap, etc.)
      const isTestTask = typeof existing.title === 'string' && existing.title.startsWith('TEST:')

      // QA bundle gate: validating requires structured review evidence.
      const effectiveStatus = parsed.status ?? existing.status
      const qaGate = enforceQaBundleGateForValidating(parsed.status, mergedMeta, existing.id)
      if (!qaGate.ok) {
        reply.code(400)
        return {
          success: false,
          error: qaGate.error,
          gate: 'qa_bundle',
          hint: qaGate.hint,
        }
      }

      const handoffGate = enforceReviewHandoffGateForValidating(effectiveStatus, lookup.resolvedId, mergedMeta)
      if (!handoffGate.ok) {
        reply.code(400)
        return {
          success: false,
          error: handoffGate.error,
          gate: 'review_handoff',
          hint: handoffGate.hint,
        }
      }

      if (
        parsed.status === 'validating'
        && existing.status === 'validating'
        && !isTaskAutomatedRecurring(mergedMeta)
      ) {
        const delta = (mergedMeta.review_delta_note || mergedMeta.re_review_delta || mergedMeta.delta_note) as unknown
        if (typeof delta !== 'string' || delta.trim().length === 0) {
          reply.code(400)
          return {
            success: false,
            error: 'Re-review gate: metadata.review_delta_note required when re-requesting validating review.',
            gate: 'review_delta',
            hint: 'Add metadata.review_delta_note summarizing what changed since the last reviewed SHA.',
          }
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

        // Gate 1b: code-lane tasks require at least one PR URL in artifacts
        const lane = (mergedMeta.lane as string || '').toLowerCase()
        const isCodeTask = lane === 'product' || lane === 'frontend' || lane === 'backend' || lane === 'infra'
          || (existing.tags || []).some((t: string) => ['code', 'frontend', 'backend', 'infra'].includes(t.toLowerCase()))
        const hasPrUrl = artifacts.some((a: string) => /github\.com\/.*\/pull\/\d+/.test(a))
        const hasWaiver = mergedMeta.pr_waiver === true && typeof mergedMeta.pr_waiver_reason === 'string'

        if (isCodeTask && !hasPrUrl && !hasWaiver) {
          reply.code(422)
          return {
            success: false,
            error: 'Task-close gate: code-lane tasks require at least one PR URL in metadata.artifacts',
            gate: 'pr_link',
            hint: 'Include a GitHub PR URL in artifacts, or set metadata.pr_waiver=true + metadata.pr_waiver_reason for hotfixes.',
          }
        }

        // Gate 1c: verify linked PRs are merged (not just opened)
        if (isCodeTask && hasPrUrl && !hasWaiver) {
          const prUrls = artifacts.filter((a: string) => /github\.com\/.*\/pull\/\d+/.test(a))
          const openPrs: string[] = []
          for (const url of prUrls) {
            try {
              const result = await resolvePrAndCi(url)
              if (result.pr && result.pr.merged !== true && result.pr.state !== 'closed') {
                openPrs.push(url)
              }
            } catch {
              // If GitHub API is unavailable, don't block — log and continue
              app.log.warn({ prUrl: url }, 'PR merge check skipped — GitHub API unavailable')
            }
          }
          if (openPrs.length > 0) {
            reply.code(422)
            return {
              success: false,
              error: `Task-close gate: linked PR(s) not merged: ${openPrs.join(', ')}`,
              gate: 'pr_not_merged',
              openPrs,
              hint: 'Merge linked PRs before closing task, or set metadata.pr_waiver=true + metadata.pr_waiver_reason to bypass.',
            }
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
              hint: `Reviewer "${existing.reviewer}" must approve via: POST /tasks/:id/review (decision=approve) (or PATCH as reviewer with actor set).`, 
            }
          }
        }

        // Gate 3: spec/design/research closes must link follow-on implementation task,
        // or explicitly explain N/A.
        const followOnPolicy = inferFollowOnPolicy(existing, mergedMeta)
        if (followOnPolicy.required) {
          const followOnTaskId = typeof mergedMeta.follow_on_task_id === 'string' ? mergedMeta.follow_on_task_id.trim() : ''
          const followOnNa = mergedMeta.follow_on_na === true
          const followOnNaReason = typeof mergedMeta.follow_on_na_reason === 'string' ? mergedMeta.follow_on_na_reason.trim() : ''

          const hasFollowOnLink = followOnTaskId.length > 0
          const hasExplicitNa = followOnNa && followOnNaReason.length > 0

          if (!hasFollowOnLink && !hasExplicitNa) {
            reply.code(422)
            return {
              success: false,
              error: `Task-close gate: ${followOnPolicy.taskType || 'spec/design/research'} tasks require metadata.follow_on_task_id or (metadata.follow_on_na=true + metadata.follow_on_na_reason).`,
              gate: 'follow_on_linkage',
              hint: 'Link a concrete implementation task via follow_on_task_id, or include explicit N/A rationale.',
            }
          }

          if (hasFollowOnLink) {
            const followLookup = taskManager.resolveTaskId(followOnTaskId)
            if (!followLookup.task || !followLookup.resolvedId) {
              reply.code(422)
              return {
                success: false,
                error: 'Task-close gate: metadata.follow_on_task_id must reference an existing task.',
                gate: 'follow_on_linkage',
                hint: `No task found for follow_on_task_id="${followOnTaskId}". Use a valid task id/prefix.`,
              }
            }
            if (followLookup.resolvedId === lookup.resolvedId) {
              reply.code(422)
              return {
                success: false,
                error: 'Task-close gate: metadata.follow_on_task_id cannot point to the same task.',
                gate: 'follow_on_linkage',
                hint: 'Link the actual implementation follow-on task id.',
              }
            }
            mergedMeta.follow_on_task_id = followLookup.resolvedId
          }

          if (hasExplicitNa) {
            mergedMeta.follow_on_na_reason = followOnNaReason
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

      // ── Working contract: reflection gate on claim ──
      if (parsed.status === 'doing' && existing.status !== 'doing' && !isTestTask) {
        try {
          const { checkClaimGate } = await import('./working-contract.js')
          const claimAgent = parsed.assignee || existing.assignee || 'unknown'
          const gate = checkClaimGate(claimAgent)
          if (!gate.allowed) {
            reply.code(422)
            return {
              success: false,
              error: gate.reason,
              gate: 'reflection_overdue',
              reflectionsDue: gate.reflectionsDue,
              hint: 'Submit a reflection via POST /reflections before claiming new work.',
            }
          }
        } catch { /* working-contract module may not be loaded */ }
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

      // Start per-task focus window on doing transition (45m deep work suppression)
      if (parsed.status === 'doing' && existing.status !== 'doing') {
        const focusAgent = (parsed.assignee || existing.assignee || '').toLowerCase()
        if (focusAgent) {
          healthMonitor.startTaskFocusWindow(focusAgent, lookup.resolvedId, 45)
        }
      }

      const { actor, ...rest } = parsed

      const nextMetadata: Record<string, unknown> = {
        ...mergedMeta,
        ...(actor ? { actor } : {}),
      }

      // ── Design→Implementation handoff detection ──
      const previousStatus = existing.status
      const nextStatus = parsed.status ?? existing.status
      const laneHint = String((mergedMeta.lane || mergedMeta.supports || '')).toLowerCase()
      const titleHint = `${existing.title || ''} ${(existing.description || '')}`.toLowerCase()
      const isDesignLaneTask = laneHint.includes('design') || /\bdesign\b/.test(titleHint)
      const isReadyTransition =
        (nextStatus === 'validating' && previousStatus !== 'validating')
        || (nextStatus === 'done' && previousStatus !== 'done')
      const designHandoffArtifactPath = getDesignHandoffArtifactPath(mergedMeta)
      const existingHandoffMeta = ((existing.metadata as Record<string, unknown> | undefined)?.design_handoff || {}) as Record<string, unknown>
      const hasPriorDesignHandoff = typeof existingHandoffMeta.notifiedAt === 'number'
      const shouldSendDesignHandoff = Boolean(
        isDesignLaneTask
        && isReadyTransition
        && designHandoffArtifactPath
        && !hasPriorDesignHandoff,
      )

      if (shouldSendDesignHandoff) {
        nextMetadata.design_handoff = {
          ...existingHandoffMeta,
          notifiedAt: Date.now(),
          notifiedForStatus: nextStatus,
          notifiedTo: 'link',
          sourceTaskId: lookup.resolvedId,
          artifactPath: designHandoffArtifactPath,
        }
      }
      // ── End design handoff detection ──

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

      // ── Audit ledger: log review-field mutations ──
      {
        const oldMeta = (existing.metadata || {}) as Record<string, unknown>
        const newMeta = (task.metadata || {}) as Record<string, unknown>
        const reviewChanges = diffReviewFields(
          existing as unknown as Record<string, unknown>,
          task as unknown as Record<string, unknown>,
          oldMeta,
          newMeta,
        )
        if (reviewChanges.length > 0) {
          const mutationActor = parsed.actor || parsed.assignee || 'unknown'
          recordReviewMutation({
            taskId: task.id,
            actor: mutationActor,
            context: `PATCH /tasks/${task.id}`,
            changes: reviewChanges,
          }).catch(err => console.error('[Audit] Failed to record mutation:', err))

          // Detect approval flip (reviewer_approved toggled)
          const approvalChange = reviewChanges.find(c => c.field === 'metadata.reviewer_approved')
          if (approvalChange && typeof approvalChange.before === 'boolean' && typeof approvalChange.after === 'boolean') {
            alertFlipAttempt({
              taskId: task.id,
              taskTitle: task.title,
              actor: mutationActor,
              fromValue: approvalChange.before,
              toValue: approvalChange.after,
              context: `PATCH /tasks/${task.id}`,
            }).catch(err => console.error('[MutationAlert] Flip alert failed:', err))
          }
        }
      }

      // ── Send design→implementation handoff notification ──
      if (shouldSendDesignHandoff && designHandoffArtifactPath) {
        const acceptanceCriteria = (task.done_criteria || []).join(' | ')
        const handoffMessage = [
          `@link ${task.id} design-ready handoff from ${task.assignee || 'design-owner'}.`,
          `Artifact: ${designHandoffArtifactPath}`,
          `Acceptance criteria: ${acceptanceCriteria || 'Use task done_criteria from source task.'}`,
          'Please claim implementation handoff and post execution plan.',
        ].join(' ')

        await chatManager.sendMessage({
          from: 'system',
          channel: 'reviews',
          content: handoffMessage,
          metadata: {
            kind: 'design_implementation_handoff',
            sourceTaskId: task.id,
            artifactPath: designHandoffArtifactPath,
            to: 'link',
          },
        }).catch(() => {})
      }
      // ── End design handoff notification ──

      // Auto-update presence on task activity
      if (task.assignee) {
        if (parsed.status === 'done') {
          presenceManager.recordActivity(task.assignee, 'task_completed')
          presenceManager.updatePresence(task.assignee, 'working')
          trackTaskEvent('completed')
        } else if (parsed.status === 'doing') {
          presenceManager.updatePresence(task.assignee, 'working')
        } else if (parsed.status === 'blocked') {
          presenceManager.updatePresence(task.assignee, 'blocked')
        } else if (parsed.status === 'validating') {
          presenceManager.updatePresence(task.assignee, 'reviewing')
        }
      }

      // ── Activation funnel: track first_task_started / first_task_completed ──
      {
        const funnelUserId = (task.metadata as any)?.userId || task.assignee || ''
        if (funnelUserId) {
          if (parsed.status === 'doing' && existing.status !== 'doing') {
            emitActivationEvent('first_task_started', funnelUserId, { taskId: task.id }).catch(() => {})
          }
          if (parsed.status === 'done' && existing.status !== 'done') {
            emitActivationEvent('first_task_completed', funnelUserId, { taskId: task.id }).catch(() => {})
          }
          // Day-2 return: any status change ≥24h after signup
          if (isDay2Eligible(funnelUserId) && !hasCompletedEvent(funnelUserId, 'day2_return_action')) {
            emitActivationEvent('day2_return_action', funnelUserId, { action: 'task_update', taskId: task.id }).catch(() => {})
          }
        }
      }

      // ── Knowledge auto-index: on task ship, index artifacts + QA bundle ──
      if (parsed.status === 'done' && existing.status !== 'done') {
        onTaskShipped({
          taskId: task.id,
          title: task.title,
          description: (task as any).description,
          doneCriteria: task.done_criteria,
          assignee: task.assignee,
          metadata: task.metadata as Record<string, unknown>,
        }).catch(() => { /* knowledge indexing is best-effort */ })
      }

      // ── Auto-queue: on task completion, recommend next tasks to assignee ──
      if (parsed.status === 'done' && existing.status !== 'done' && task.assignee) {
        const assignee = task.assignee.toLowerCase()
        const allTasks = taskManager.listTasks({})
        const availableTasks = allTasks
          .filter(t => t.status === 'todo' && (!t.assignee || t.assignee.toLowerCase() === assignee))
          .sort((a, b) => {
            // Priority ordering: P0 > P1 > P2 > P3
            const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
            const pa = priorityOrder[a.priority || 'P3'] ?? 3
            const pb = priorityOrder[b.priority || 'P3'] ?? 3
            if (pa !== pb) return pa - pb
            // Older tasks first (tiebreaker)
            return (a.createdAt || 0) - (b.createdAt || 0)
          })

        // Use suggest-assignee for smarter recommendations when available
        const top2 = availableTasks.slice(0, 2)

        if (top2.length > 0) {
          const taskLines = top2.map((t, i) => {
            const dc = Array.isArray(t.done_criteria) ? t.done_criteria.slice(0, 2).join(', ') : ''
            return `${i + 1}. [${t.priority || 'P3'}] ${t.id}: ${t.title}\n   Done: ${dc}\n   → Claim: PATCH /tasks/${t.id} { "status": "doing", "assignee": "${assignee}" }`
          }).join('\n\n')

          chatManager.sendMessage({
            from: 'system',
            content: `@${assignee} great work on ${task.id} (${task.title}) ✅\n\nReady for your next lane:\n\n${taskLines}\n\nReply with task ID to claim, or run /tasks/next to pull manually.`,
            channel: 'task-notifications',
            metadata: {
              kind: 'auto-queue',
              completedTaskId: task.id,
              suggestedTaskIds: top2.map(t => t.id),
            },
          }).catch(() => {}) // Non-blocking
        } else {
          chatManager.sendMessage({
            from: 'system',
            content: `@${assignee} great work on ${task.id} (${task.title}) ✅\n\nQueue clear — no unassigned tasks available. Great work staying ahead!`,
            channel: 'task-notifications',
            metadata: {
              kind: 'auto-queue',
              completedTaskId: task.id,
              suggestedTaskIds: [],
            },
          }).catch(() => {}) // Non-blocking
        }
      }

      // ── Reflection automation: nudge agent to reflect after task completion or block ──
      if (task.assignee && (
        (parsed.status === 'done' && existing.status !== 'done') ||
        (parsed.status === 'blocked' && existing.status !== 'blocked')
      )) {
        try {
          const { onTaskDone } = await import('./reflection-automation.js')
          onTaskDone(task)
        } catch { /* reflection automation may not be loaded */ }
      }

      // Route status-change notifications through agent preferences
      const notifMgr = getNotificationManager()
      const statusNotifTargets: Array<{ agent: string; type: 'taskAssigned' | 'taskCompleted' | 'reviewRequested' | 'statusChange' }> = []

      if (parsed.status === 'doing' && task.assignee) {
        statusNotifTargets.push({ agent: task.assignee, type: 'taskAssigned' })
      }
      if (parsed.status === 'validating' && task.reviewer) {
        statusNotifTargets.push({ agent: task.reviewer, type: 'reviewRequested' })
      }
      if (parsed.status === 'done') {
        if (task.assignee) statusNotifTargets.push({ agent: task.assignee, type: 'taskCompleted' })
        if (task.reviewer) statusNotifTargets.push({ agent: task.reviewer, type: 'taskCompleted' })
      }

      for (const target of statusNotifTargets) {
        const routing = notifMgr.shouldNotify({
          type: target.type,
          agent: target.agent,
          priority: task.priority,
          message: `Task ${task.id} → ${parsed.status}`,
        })
        if (routing.shouldNotify) {
          // Route through inbox/chat based on delivery method preference
          chatManager.sendMessage({
            from: 'system',
            content: `@${target.agent} [${target.type}:${task.id}] ${task.title} → ${parsed.status}`,
            channel: 'task-notifications',
            metadata: {
              kind: target.type,
              taskId: task.id,
              status: parsed.status,
              deliveryMethod: routing.deliveryMethod,
            },
          }).catch(() => {}) // Non-blocking
        }
      }
      
      // ── Artifact mirror: copy to shared workspace on validating/done ──
      if (
        (parsed.status === 'validating' || parsed.status === 'done')
        && previousStatus !== parsed.status
      ) {
        try {
          const { onTaskReadyForReview } = await import('./artifact-mirror.js')
          const mirrorResult = await onTaskReadyForReview(task.metadata as Record<string, unknown> || {})
          if (mirrorResult?.mirrored) {
            console.log(`[ArtifactMirror] Mirrored ${mirrorResult.filesCopied} file(s) for ${task.id} → ${mirrorResult.destination}`)
          }
        } catch { /* artifact mirror is non-fatal */ }
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

  // Agent role registry
  const buildRoleRegistryPayload = () => {
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
  }

  app.get('/agents/roles', async () => buildRoleRegistryPayload())

  // Team-scoped alias for assignment-engine consumers
  app.get('/team/roles', async () => {
    const payload = buildRoleRegistryPayload()
    return {
      ...payload,
      roleRegistry: {
        source: payload.config.source,
        count: payload.config.count,
        format: 'TEAM-ROLES.yaml',
      },
    }
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

  // ── Approval Queue ──────────────────────────────────────────────────

  app.get('/approval-queue', async () => {
    // Tasks in 'todo' that were auto-assigned (have suggestedAgent in metadata) or need assignment review
    const allTasks = taskManager.listTasks({})
    const todoTasks = allTasks.filter(t => t.status === 'todo')

    const items = todoTasks.map(t => {
      const task = t as any
      const meta = task.metadata || {}
      const title = task.title || ''
      const tags = Array.isArray(task.tags) ? task.tags : []
      const doneCriteria = Array.isArray(task.done_criteria) ? task.done_criteria : []

      // Score all agents for this task
      const roles = getAgentRoles()
      const agentOptions = roles.map(agent => {
        const wipCount = allTasks.filter(at => at.status === 'doing' && (at.assignee || '').toLowerCase() === agent.name).length
        const s = scoreAssignment(agent, { title, tags, done_criteria: doneCriteria }, wipCount)
        return {
          agentId: agent.name,
          name: agent.name,
          confidenceScore: Math.max(0, Math.min(1, s.score)),
          affinityTags: agent.affinityTags,
        }
      }).sort((a, b) => b.confidenceScore - a.confidenceScore)

      const topAgent = agentOptions[0]
      const suggestedAgent = task.assignee || topAgent?.agentId || null
      const confidenceScore = topAgent?.confidenceScore || 0
      const confidenceReason = topAgent && topAgent.confidenceScore > 0
        ? `${topAgent.name}: affinity match on ${topAgent.affinityTags.slice(0, 3).join(', ')}`
        : 'No strong affinity match'

      return {
        taskId: task.id,
        title,
        description: task.description || '',
        priority: task.priority || 'P3',
        suggestedAgent,
        confidenceScore,
        confidenceReason,
        agentOptions,
        status: 'pending' as const,
      }
    })

    const highConfidence = items.filter(i => i.confidenceScore >= 0.85)
    const needsReview = items.filter(i => i.confidenceScore < 0.85)

    return {
      items: [...highConfidence, ...needsReview],
      total: items.length,
      highConfidenceCount: highConfidence.length,
      needsReviewCount: needsReview.length,
    }
  })

  app.post<{ Params: { taskId: string } }>('/approval-queue/:taskId/approve', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const taskId = request.params.taskId
    const assignedAgent = (body.assignedAgent as string) || undefined
    const priorityOverride = body.priorityOverride as string | undefined
    const note = body.note as string | undefined
    const reviewedBy = (body.reviewedBy as string) || 'system'

    const lookup = taskManager.resolveTaskId(taskId)
    if (lookup.matchType === 'not_found') {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }
    const resolvedId = lookup.resolvedId || taskId

    const patch: Record<string, unknown> = {}
    if (assignedAgent) patch.assignee = assignedAgent
    if (priorityOverride) patch.priority = priorityOverride
    patch.metadata = { approval: { approvedBy: reviewedBy, approvedAt: Date.now(), note } }

    const result = taskManager.updateTask(resolvedId, patch)
    return { success: true, task: result }
  })

  app.post<{ Params: { taskId: string } }>('/approval-queue/:taskId/reject', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const taskId = request.params.taskId
    const reason = (body.reason as string) || ''
    const reviewedBy = (body.reviewedBy as string) || 'system'

    const lookup = taskManager.resolveTaskId(taskId)
    if (lookup.matchType === 'not_found') {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }
    const resolvedId = lookup.resolvedId || taskId

    // Archive/reject the task
    const result = taskManager.updateTask(resolvedId, {
      status: 'done',
      metadata: {
        rejection: { rejectedBy: reviewedBy, rejectedAt: Date.now(), reason },
        outcome: 'rejected',
      },
    })
    return { success: true, task: result }
  })

  app.post('/approval-queue/batch-approve', async (request) => {
    const body = request.body as Record<string, unknown>
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds as string[] : []
    const reviewedBy = (body.reviewedBy as string) || 'system'

    const results: Array<{ taskId: string; success: boolean; error?: string }> = []

    for (const taskId of taskIds) {
      try {
        const lookup = taskManager.resolveTaskId(taskId)
        if (lookup.matchType === 'not_found') {
          results.push({ taskId, success: false, error: 'Not found' })
          continue
        }
        const resolvedId = lookup.resolvedId || taskId
        taskManager.updateTask(resolvedId, {
          metadata: { approval: { approvedBy: reviewedBy, approvedAt: Date.now(), batch: true } },
        })
        results.push({ taskId: resolvedId, success: true })
      } catch (err: any) {
        results.push({ taskId, success: false, error: err?.message || 'Unknown error' })
      }
    }

    return {
      success: true,
      approved: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    }
  })

  // ── Routing Policy (CRUD for TEAM-ROLES.yaml) ────────────────────

  app.get('/routing-policy', async () => {
    const roles = getAgentRoles()
    const source = getAgentRolesSource()

    return {
      version: Date.now(), // Use timestamp as pseudo-version
      updatedAt: Date.now(),
      updatedBy: 'config',
      source: source.source,
      agents: roles.map(r => ({
        agentId: r.name,
        role: r.role,
        affinityTags: r.affinityTags,
        weight: r.wipCap > 0 ? Math.min(r.wipCap / 2, 1.0) : 0.5, // Derive weight from wipCap
        wipCap: r.wipCap,
        alwaysRoute: r.alwaysRoute || [],
        neverRoute: r.neverRoute || [],
        protectedDomains: r.protectedDomains || [],
      })),
    }
  })

  app.put('/routing-policy', async (request) => {
    const body = request.body as Record<string, unknown>
    const agents = body.agents as Array<Record<string, unknown>> | undefined
    const updatedBy = (body.updatedBy as string) || 'system'

    if (!agents || !Array.isArray(agents) || agents.length === 0) {
      return { success: false, error: 'agents array required' }
    }

    const currentRoles = getAgentRoles()
    const updatedRoles = agents.map(a => {
      const existing = currentRoles.find(r => r.name === a.agentId)
      const weight = typeof a.weight === 'number' ? a.weight : 0.5
      return {
        name: (a.agentId as string) || '',
        role: (a.role as string) || existing?.role || 'agent',
        description: existing?.description,
        affinityTags: Array.isArray(a.affinityTags) ? a.affinityTags.map(String) : existing?.affinityTags || [],
        alwaysRoute: Array.isArray(a.alwaysRoute) ? a.alwaysRoute.map(String) : existing?.alwaysRoute,
        neverRoute: Array.isArray(a.neverRoute) ? a.neverRoute.map(String) : existing?.neverRoute,
        protectedDomains: Array.isArray(a.protectedDomains) ? a.protectedDomains.map(String) : existing?.protectedDomains,
        wipCap: typeof a.wipCap === 'number' ? a.wipCap : Math.round(weight * 2) || 1,
      }
    }).filter(r => r.name)

    const result = saveAgentRoles(updatedRoles)

    return {
      success: true,
      version: result.version,
      changesApplied: updatedRoles.length,
      updatedBy,
      path: result.path,
    }
  })

  // ── Canvas / Screen Surface (v0) ───────────────────────────────────

  // POST /canvas/render — agents push content to slots
  app.post('/canvas/render', async (request, reply) => {
    const body = request.body as any
    if (!body || typeof body !== 'object') {
      reply.code(400)
      return { error: 'Request body is required', valid: false }
    }

    const event = {
      slot: body.slot,
      content_type: body.content_type,
      payload: body.payload || {},
      priority: body.priority || 'normal',
      append: body.append || false,
    }

    const result = processRender(event as any)

    if (!result.valid) {
      logRejection(event as any, result.errors)
      reply.code(422)
      return {
        valid: false,
        errors: result.errors,
        warnings: result.warnings,
      }
    }

    return {
      valid: true,
      slot: result.slot,
      warnings: result.warnings,
    }
  })

  // GET /canvas/slots — current active slots
  app.get('/canvas/slots', async () => {
    return {
      slots: canvasSlots.getActive(),
      stats: canvasSlots.getStats(),
    }
  })

  // GET /canvas/slots/all — all slots including stale (debug)
  app.get('/canvas/slots/all', async () => {
    return { slots: canvasSlots.getAll() }
  })

  // GET /canvas/history — recent render history
  app.get('/canvas/history', async (request) => {
    const query = request.query as any
    const slot = query?.slot as string | undefined
    const limit = Math.min(Number(query?.limit) || 20, 100)
    return { history: canvasSlots.getHistory(slot, limit) }
  })

  // GET /canvas/rejections — recent contract rejections (for tuning)
  app.get('/canvas/rejections', async () => {
    return { rejections: getRecentRejections() }
  })

  // GET /canvas/stream — SSE stream of canvas render events
  app.get('/canvas/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Send current state as initial snapshot
    const activeSlots = canvasSlots.getActive()
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ slots: activeSlots })}\n\n`)

    // Subscribe to new render events
    const unsubscribe = subscribeCanvas((event, slot) => {
      try {
        reply.raw.write(`event: render\ndata: ${JSON.stringify({ event, slot })}\n\n`)
      } catch {
        // Connection closed
      }
    })

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`:heartbeat\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 15_000)

    // Cleanup on disconnect
    request.raw.on('close', () => {
      unsubscribe()
      clearInterval(heartbeat)
    })
  })

  // ── Feedback Collection ─────────────────────────────────────────────

  const VALID_CATEGORIES = new Set(['bug', 'feature', 'general'])

  app.post('/feedback', async (request, reply) => {
    const ip = request.ip || '0.0.0.0'
    const limit = checkRateLimit(ip)
    if (!limit.allowed) {
      reply.code(429)
      return { success: false, message: `Rate limit exceeded. Try again in ${limit.retryAfterSec} seconds.` }
    }

    const body = request.body as Record<string, unknown>
    const category = body.category as string
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const siteToken = typeof body.siteToken === 'string' ? body.siteToken : ''

    if (!VALID_CATEGORIES.has(category)) {
      reply.code(400)
      return { success: false, message: 'Category must be bug, feature, or general.', field: 'category' }
    }
    if (message.length < 10) {
      reply.code(400)
      return { success: false, message: 'Message must be at least 10 characters.', field: 'message' }
    }
    if (message.length > 1000) {
      reply.code(400)
      return { success: false, message: 'Message must be at most 1000 characters.', field: 'message' }
    }

    const severity = typeof body.severity === 'string' ? body.severity.trim().toLowerCase() as FeedbackSeverity : undefined
    const reporterType = typeof body.reporterType === 'string' ? body.reporterType.trim().toLowerCase() as FeedbackReporterType : undefined

    if (severity && !['critical', 'high', 'medium', 'low'].includes(severity)) {
      reply.code(400)
      return { success: false, message: 'severity must be one of: critical, high, medium, low', field: 'severity' }
    }

    if (reporterType && !['human', 'agent'].includes(reporterType)) {
      reply.code(400)
      return { success: false, message: 'reporterType must be one of: human, agent', field: 'reporterType' }
    }

    const tier = typeof body.tier === 'string' ? body.tier.trim().toLowerCase() as SupportTier : undefined
    if (tier && !['free', 'pro', 'team'].includes(tier)) {
      reply.code(400)
      return { success: false, message: 'tier must be one of: free, pro, team', field: 'tier' }
    }

    const record = submitFeedback({
      category: category as 'bug' | 'feature' | 'general',
      message,
      email: typeof body.email === 'string' ? body.email : undefined,
      url: typeof body.url === 'string' ? body.url : undefined,
      userAgent: typeof body.userAgent === 'string' ? body.userAgent : undefined,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      siteToken,
      timestamp: Date.now(),
      severity,
      reporterType,
      reporterAgent: typeof body.reporterAgent === 'string' ? body.reporterAgent : undefined,
      tier,
    })

    reply.code(201)
    return {
      success: true,
      id: record.id,
      message: 'Feedback received.',
      severity: record.severity,
      reporterType: record.reporterType,
      tier: record.tier,
    }
  })

  app.get('/feedback', async (request) => {
    const q = request.query as Record<string, string>
    const query: FeedbackQuery = {
      status: (q.status as any) || 'new',
      category: (q.category as any) || 'all',
      severity: (q.severity as any) || 'all',
      reporterType: (q.reporterType as any) || 'all',
      tier: (q.tier as any) || 'all',
      sort: (q.sort as any) || 'date',
      order: (q.order as any) || 'desc',
      limit: q.limit ? Number(q.limit) : 25,
      offset: q.offset ? Number(q.offset) : 0,
    }
    return listFeedback(query)
  })

  app.get<{ Params: { id: string } }>('/feedback/:id', async (request, reply) => {
    const record = getFeedback(request.params.id)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'Feedback not found' }
    }
    return { success: true, feedback: record }
  })

  app.patch<{ Params: { id: string } }>('/feedback/:id', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const updated = updateFeedback(request.params.id, {
      status: body.status as any,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      assignedTo: typeof body.assignedTo === 'string' ? body.assignedTo : undefined,
    })
    if (!updated) {
      reply.code(404)
      return { success: false, error: 'Feedback not found' }
    }
    return { success: true, feedback: updated }
  })

  app.post<{ Params: { id: string } }>('/feedback/:id/vote', async (request, reply) => {
    const updated = voteFeedback(request.params.id)
    if (!updated) {
      reply.code(404)
      return { success: false, error: 'Feedback not found' }
    }
    return { success: true, votes: updated.votes }
  })

  // Support tier policies reference
  app.get('/support/tiers', async () => {
    return { tiers: TIER_POLICIES }
  })

  // Mark first response on a feedback item (stops response SLA clock)
  app.post<{ Params: { id: string } }>('/feedback/:id/respond', async (request, reply) => {
    const record = getFeedback(request.params.id)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'Feedback not found' }
    }
    if (record.respondedAt) {
      return { success: true, message: 'Already responded', respondedAt: record.respondedAt }
    }
    const updated = updateFeedback(request.params.id, { respondedAt: Date.now() })
    if (!updated) {
      reply.code(500)
      return { success: false, error: 'Failed to update' }
    }
    const sla = computeSLAStatus(updated)
    return {
      success: true,
      respondedAt: updated.respondedAt,
      responseBreachRisk: sla.responseBreachRisk,
      responseElapsedMs: sla.responseElapsedMs,
    }
  })

  // SLA status for a specific feedback item
  app.get<{ Params: { id: string } }>('/feedback/:id/sla', async (request, reply) => {
    const record = getFeedback(request.params.id)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'Feedback not found' }
    }
    return { success: true, sla: computeSLAStatus(record) }
  })

  app.get('/triage', async () => {
    return getTriageQueue()
  })

  app.post<{ Params: { id: string } }>('/feedback/:id/triage', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>
    const triageAgent = typeof body.triageAgent === 'string' ? body.triageAgent.trim() : ''
    if (!triageAgent) {
      reply.code(400)
      return { success: false, error: 'triageAgent is required' }
    }

    const triage = buildTriageTask({
      feedbackId: request.params.id,
      triageAgent,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      assignee: typeof body.assignee === 'string' ? body.assignee : undefined,
      lane: typeof body.lane === 'string' ? body.lane : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    })

    if ('error' in triage) {
      if (triage.error.includes('Already triaged')) {
        reply.code(409)
      } else {
        reply.code(404)
      }
      return { success: false, error: triage.error }
    }

    const task = await taskManager.createTask({
      title: triage.title,
      description: triage.description,
      status: 'todo',
      assignee: triage.assignee,
      reviewer: 'kai',
      done_criteria: ['Triage feedback converted to actionable task'],
      createdBy: triageAgent,
      priority: triage.priority as Task['priority'],
      metadata: {
        ...triage.metadata,
        ...(triage.lane ? { lane: triage.lane } : {}),
      },
    })

    markTriaged(request.params.id, task.id, triageAgent, triage.priority, triage.assignee)

    // Auto-create escalation for P0/P1 tickets
    const feedback = getFeedback(request.params.id)
    if (feedback) {
      createEscalation(request.params.id, triage.priority, feedback.tier || 'free', triage.assignee)
    }

    reply.code(201)
    return {
      success: true,
      feedbackId: request.params.id,
      taskId: task.id,
      priority: triage.priority,
    }
  })

  // ── Escalation endpoints ──

  app.get('/escalations', async (request) => {
    const q = request.query as Record<string, string>
    const status = q.status as EscalationStatus | undefined
    return listEscalations(status)
  })

  app.get<{ Params: { id: string } }>('/escalations/:id', async (request, reply) => {
    const record = getEscalation(request.params.id)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'Escalation not found' }
    }
    return { success: true, escalation: record }
  })

  app.get<{ Params: { feedbackId: string } }>('/feedback/:feedbackId/escalation', async (request, reply) => {
    const record = getEscalationByFeedback(request.params.feedbackId)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'No escalation for this feedback' }
    }
    return { success: true, escalation: record }
  })

  app.post<{ Params: { id: string } }>('/escalations/:id/ack', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>
    const actor = typeof body.actor === 'string' ? body.actor : undefined
    const record = acknowledgeEscalation(request.params.id, actor)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'Escalation not found' }
    }
    return { success: true, escalation: record }
  })

  app.post<{ Params: { id: string } }>('/escalations/:id/resolve', async (request, reply) => {
    const record = resolveEscalation(request.params.id)
    if (!record) {
      reply.code(404)
      return { success: false, error: 'Escalation not found' }
    }
    return { success: true, escalation: record }
  })

  // Manual escalation tick (also runs automatically via sweeper)
  app.post('/escalations/tick', async () => {
    return tickEscalations()
  })

  // Manual escalation creation (for testing or manual incidents)
  app.post('/escalations', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>
    const feedbackId = typeof body.feedbackId === 'string' ? body.feedbackId : ''
    const priority = typeof body.priority === 'string' ? body.priority : ''
    const tier = (typeof body.tier === 'string' ? body.tier : 'free') as SupportTier
    const owner = typeof body.owner === 'string' ? body.owner : undefined

    if (!feedbackId || !priority) {
      reply.code(400)
      return { success: false, error: 'feedbackId and priority are required' }
    }
    if (priority !== 'P0' && priority !== 'P1') {
      reply.code(400)
      return { success: false, error: 'Escalation only supports P0 and P1 priority' }
    }

    const record = createEscalation(feedbackId, priority, tier, owner)
    if (!record) {
      reply.code(409)
      return { success: false, error: 'Escalation already exists or priority not eligible' }
    }

    reply.code(201)
    return { success: true, escalation: record }
  })

  // ── Reflections ────────────────────────────────────────────────────────

  app.post('/reflections', async (request, reply) => {
    const result = validateReflection(request.body)
    if (!result.valid) {
      reply.code(400)
      return {
        success: false,
        error: 'Validation failed',
        errors: result.errors,
        hint: `Required fields: pain, impact, evidence[] (array), went_well, suspected_why, proposed_fix, confidence (0-10), role_type (${ROLE_TYPES.join('|')}), author. Optional: severity (${SEVERITY_LEVELS.join('|')}), task_id, tags, team_id, metadata.`,
      }
    }

    const reflection = createReflection(result.data)

    // Track reflection for automation (resets nudge timer)
    try {
      const { onReflectionSubmitted } = await import('./reflection-automation.js')
      onReflectionSubmitted(reflection.author)
    } catch { /* reflection automation may not be loaded */ }

    // Auto-ingest into insight pipeline (reflection → insight clustering)
    let insight = null
    try {
      insight = ingestReflection(reflection)
    } catch (err) {
      console.warn(`[Reflections] Auto-ingest to insight pipeline failed for ${reflection.id}:`, err)
    }

    // Fire-and-forget: index reflection for semantic search
    import('./vector-store.js')
      .then(({ indexReflection }) => indexReflection(
        reflection.id, reflection.pain, reflection.evidence,
        reflection.proposed_fix, reflection.author, reflection.tags
      ))
      .catch(() => {})

    // Fire-and-forget: index insight if created/updated
    if (insight) {
      import('./vector-store.js')
        .then(({ indexInsight }) => indexInsight(
          insight!.id, insight!.title, insight!.evidence_refs,
          insight!.authors, insight!.cluster_key
        ))
        .catch(() => {})
    }

    reply.code(201)
    return { success: true, reflection, insight: insight ? { id: insight.id, cluster_key: insight.cluster_key, score: insight.score, status: insight.status } : null }
  })

  app.get('/reflections', async (request) => {
    const query = request.query as Record<string, string>

    const opts: Record<string, unknown> = {}
    if (query.author) opts.author = query.author
    if (query.role_type) opts.role_type = query.role_type
    if (query.severity) opts.severity = query.severity
    if (query.task_id) opts.task_id = query.task_id
    if (query.team_id) opts.team_id = query.team_id
    if (query.since) opts.since = Number(query.since)
    if (query.before) opts.before = Number(query.before)
    if (query.limit) opts.limit = Math.min(Number(query.limit) || 50, 200)
    if (query.offset) opts.offset = Number(query.offset) || 0

    const reflections = listReflections(opts as any)
    const total = countReflections(opts as any)
    return { reflections, total, limit: opts.limit || 50, offset: opts.offset || 0 }
  })

  app.get('/reflections/stats', async () => {
    return reflectionStats()
  })

  app.get('/reflections/sla', async () => {
    const { getReflectionSLAs } = await import('./reflection-automation.js')
    return { slas: getReflectionSLAs() }
  })

  app.post('/reflections/nudge/tick', async () => {
    const { tickReflectionNudges } = await import('./reflection-automation.js')
    const result = await tickReflectionNudges()
    return { success: true, ...result }
  })

  app.get('/reflections/schema', async () => {
    return {
      required: ['pain', 'impact', 'evidence', 'went_well', 'suspected_why', 'proposed_fix', 'confidence', 'role_type', 'author'],
      optional: ['severity', 'task_id', 'tags', 'team_id', 'metadata'],
      role_types: ROLE_TYPES,
      severity_levels: SEVERITY_LEVELS,
      confidence_range: { min: 0, max: 10 },
      evidence_note: 'Array of strings — at least one evidence link, path, or reference required',
    }
  })

  // Debug endpoint: show reflection tracking state + actual latest reflection for an agent
  app.get<{ Params: { agent: string } }>('/reflections/tracking/:agent', async (request) => {
    const { agent } = request.params
    const db = getDb()

    // Ensure tracking table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS reflection_tracking (
        agent TEXT PRIMARY KEY,
        last_reflection_at INTEGER,
        last_nudge_at INTEGER,
        tasks_done_since_reflection INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `)

    const tracking = db.prepare('SELECT * FROM reflection_tracking WHERE agent = ?').get(agent) as Record<string, unknown> | undefined

    // Get latest actual reflection from reflections table
    const latestReflections = listReflections({ author: agent, limit: 1 })
    const latestReflection = latestReflections[0] ?? null

    const trackingLastAt = (tracking?.last_reflection_at as number) || 0
    const actualLastAt = latestReflection?.created_at ?? 0
    const isStale = actualLastAt > trackingLastAt

    // Compute current gate status
    let gateBlocked = false
    let gateReason: string | null = null
    if (tracking) {
      const tasksDone = (tracking.tasks_done_since_reflection as number) || 0
      const hoursSince = trackingLastAt > 0 ? (Date.now() - trackingLastAt) / (1000 * 60 * 60) : Infinity
      gateBlocked = tasksDone >= 2 && hoursSince > 4
      if (gateBlocked) {
        gateReason = `${tasksDone} tasks since reflection, ${trackingLastAt > 0 ? Math.floor(hoursSince) + 'h ago' : 'never'}`
      }
    }

    return {
      agent,
      tracking: tracking ?? null,
      latest_reflection: latestReflection ? {
        id: latestReflection.id,
        created_at: latestReflection.created_at,
        author: latestReflection.author,
      } : null,
      stale: isStale,
      gate_would_block: gateBlocked,
      gate_reason: gateReason,
      reconciliation_available: isStale && gateBlocked,
    }
  })

  app.get<{ Params: { id: string } }>('/reflections/:id', async (request, reply) => {
    const reflection = getReflection(request.params.id)
    if (!reflection) {
      reply.code(404)
      return { success: false, error: 'Reflection not found' }
    }
    return { reflection }
  })

  // ── Insights (clustering engine) ──────────────────────────────────────

  app.post('/insights/ingest', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const reflectionId = typeof body.reflection_id === 'string' ? body.reflection_id : ''

    if (!reflectionId) {
      reply.code(400)
      return { success: false, error: 'reflection_id is required', hint: 'POST /insights/ingest { reflection_id }. Clustering is auto-derived from reflection tags/content.' }
    }

    const reflection = getReflection(reflectionId)
    if (!reflection) {
      reply.code(404)
      return { success: false, error: `Reflection ${reflectionId} not found` }
    }

    const insight = ingestReflection(reflection)
    reply.code(201)
    return { success: true, insight, cluster_key: extractClusterKey(reflection) }
  })

  app.get('/insights', async (request) => {
    const query = request.query as Record<string, string>
    return listInsights({
      status: query.status,
      priority: query.priority,
      workflow_stage: query.workflow_stage,
      failure_family: query.failure_family,
      impacted_unit: query.impacted_unit,
      limit: query.limit ? Math.min(Number(query.limit) || 50, 200) : 50,
      offset: query.offset ? Number(query.offset) || 0 : 0,
    })
  })

  app.get<{ Params: { id: string } }>('/insights/:id', async (request, reply) => {
    const insight = getInsight(request.params.id)
    if (!insight) {
      reply.code(404)
      return { success: false, error: 'Insight not found' }
    }
    return { insight }
  })

  app.get('/insights/stats', async () => {
    return insightStats()
  })

  // ── Loop summary: top signals from the reflection loop ──
  app.get('/loop/summary', async (request) => {
    const query = request.query as Record<string, string>
    const limit = query.limit ? Math.min(Math.max(1, Number(query.limit)), 100) : undefined
    const min_score = query.min_score ? Number(query.min_score) : undefined
    const exclude_addressed = query.exclude_addressed === '1' || query.exclude_addressed === 'true'

    const result = await getLoopSummary({ limit, min_score, exclude_addressed })
    return { success: true, ...result }
  })

  app.post('/insights/tick-cooldowns', async () => {
    return { success: true, ...tickCooldowns() }
  })

  app.post<{ Params: { id: string } }>('/insights/:id/promote', async (request, reply) => {
    const body = request.body as Record<string, unknown>

    // Inject insight_id from URL param
    const input = { ...body, insight_id: request.params.id }
    const validation = validatePromotionInput(input)
    if (!validation.valid) {
      reply.code(400)
      return {
        success: false,
        error: 'Invalid promotion request',
        errors: validation.errors,
        hint: 'Required: contract.owner, contract.reviewer, contract.eta, contract.acceptance_check, contract.artifact_proof_requirement, contract.next_checkpoint_eta',
      }
    }

    const promotedBy = typeof body.promoted_by === 'string' ? body.promoted_by : 'system'
    const result = await promoteInsight(input as PromotionInput, promotedBy)

    reply.code(result.success ? 201 : 400)
    return result
  })

  app.get<{ Params: { id: string } }>('/insights/:id/audit', async (request) => {
    const audit = getPromotionAuditByInsight(request.params.id)
    return { audit: audit ? [audit] : [], found: !!audit }
  })

  app.get('/insights/promotions', async (request) => {
    const query = request.query as Record<string, string>
    const limit = query.limit ? Number(query.limit) : 50
    return { audits: listPromotionAudits(limit) }
  })

  app.get('/insights/recurring/candidates', async () => {
    const candidates = generateRecurringCandidates()
    return { candidates, count: candidates.length }
  })

  // ── Orphan detection + reconciliation ──

  app.get('/insights/orphans', async () => {
    const orphans = getOrphanedInsights()
    return {
      orphans: orphans.map(o => ({
        id: o.id,
        title: o.title,
        status: o.status,
        score: o.score,
        priority: o.priority,
        authors: o.authors,
        task_id: o.task_id,
        created_at: o.created_at,
      })),
      count: orphans.length,
    }
  })

  app.post('/insights/reconcile', async (request) => {
    const { dry_run } = request.query as { dry_run?: string }
    const isDryRun = dry_run === 'true' || dry_run === '1'

    // For live runs, collect orphans and create tasks one by one (async)
    if (isDryRun) {
      const result = reconcileInsightTaskLinks(() => ({ taskId: 'dry-run' }), true)
      return { success: true, dry_run: true, ...result }
    }

    const orphans = getOrphanedInsights()
    const details: Array<{ insight_id: string; action: string; task_id?: string; reason?: string }> = []
    let created = 0
    let skipped = 0
    const errors: string[] = []

    for (const insight of orphans) {
      try {
        const decision = resolveAssignment(insight)
        const task = await taskManager.createTask({
          title: `[Insight] ${insight.title}`,
          description: `Auto-reconciled from orphaned insight ${insight.id}. ${insight.evidence_refs?.join('; ') || ''}`,
          status: 'todo',
          assignee: decision.assignee,
          reviewer: decision.reviewer,
          priority: (insight.priority as 'P0' | 'P1' | 'P2' | 'P3') || 'P1',
          createdBy: 'reconciler',
          done_criteria: [
            'Root cause addressed or mitigated',
            `Evidence from insight ${insight.id} validated`,
            'Follow-up reflection submitted confirming fix',
          ],
          metadata: {
            source_insight: insight.id,
            source_reflection: insight.reflection_ids?.[0],
            reconciled: true,
            reconciled_at: Date.now(),
          },
        })
        updateInsightStatus(insight.id, 'task_created', task.id)
        created++
        details.push({ insight_id: insight.id, action: 'created', task_id: task.id })
      } catch (err) {
        errors.push(`${insight.id}: ${(err as Error).message}`)
        details.push({ insight_id: insight.id, action: 'error', reason: (err as Error).message })
      }
    }

    return { success: true, dry_run: false, scanned: orphans.length, created, skipped, errors, details }
  })

  // Insight→Task bridge stats
  app.get('/insights/bridge/stats', async () => {
    return getInsightTaskBridgeStats()
  })

  // Shipped-artifact auto-heartbeat stats
  app.get('/shipped-heartbeat/stats', async () => {
    return getShippedHeartbeatStats()
  })

  // Bridge config: get/update ownership guardrail settings
  app.get('/insights/bridge/config', async () => {
    return getBridgeConfig()
  })

  app.patch('/insights/bridge/config', async (request) => {
    const body = request.body as Record<string, unknown>
    configureBridge(body as any)
    return { success: true, config: getBridgeConfig() }
  })

  // ── Insights Top Clusters ─────────────────────────────────────────────

  app.get('/insights/top', async (request) => {
    const query = request.query as Record<string, string>
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50)

    // Parse window: e.g. "7d", "30d", "24h", "2w"
    let windowMs = 7 * 24 * 60 * 60 * 1000 // default 7d
    const windowStr = (query.window || '7d').trim().toLowerCase()
    const windowMatch = windowStr.match(/^(\d+)(h|d|w)$/)
    if (windowMatch) {
      const n = Number(windowMatch[1])
      const unit = windowMatch[2]
      if (unit === 'h') windowMs = n * 60 * 60 * 1000
      else if (unit === 'd') windowMs = n * 24 * 60 * 60 * 1000
      else if (unit === 'w') windowMs = n * 7 * 24 * 60 * 60 * 1000
    }

    const since = Date.now() - windowMs
    const db = getDb()

    const rows = db.prepare(`
      SELECT
        cluster_key,
        COUNT(*) as count,
        AVG(score) as avg_score,
        MAX(created_at) as last_seen_at,
        GROUP_CONCAT(CASE WHEN task_id IS NOT NULL AND task_id != '' THEN task_id ELSE NULL END) as task_ids_csv
      FROM insights
      WHERE created_at >= ?
      GROUP BY cluster_key
      ORDER BY count DESC, avg_score DESC
      LIMIT ?
    `).all(since, limit) as Array<{
      cluster_key: string
      count: number
      avg_score: number
      last_seen_at: number
      task_ids_csv: string | null
    }>

    const clusters = rows.map(r => ({
      cluster_key: r.cluster_key,
      count: r.count,
      avg_score: Math.round(r.avg_score * 100) / 100,
      last_seen_at: r.last_seen_at,
      linked_task_ids: r.task_ids_csv
        ? [...new Set(r.task_ids_csv.split(',').filter(Boolean))]
        : [],
    }))

    return { clusters, window: windowStr, since, limit }
  })

  // ── Continuity Loop ──────────────────────────────────────────────────

  app.get('/continuity/stats', async () => {
    const { getContinuityStats } = await import('./continuity-loop.js')
    return getContinuityStats()
  })

  app.get('/continuity/audit', async (request) => {
    const query = request.query as Record<string, string>
    const { getContinuityAuditFromDb } = await import('./continuity-loop.js')
    return {
      actions: getContinuityAuditFromDb({
        agent: query.agent,
        limit: query.limit ? Number(query.limit) : 50,
        since: query.since ? Number(query.since) : undefined,
      }),
    }
  })

  app.post('/continuity/tick', async () => {
    const { tickContinuityLoop } = await import('./continuity-loop.js')
    const result = await tickContinuityLoop()
    return { success: true, ...result }
  })

  // Assignment preview: dry-run the ownership guardrail for an insight
  app.get<{ Params: { id: string } }>('/insights/:id/assignment-preview', async (request, reply) => {
    const insight = getInsight(request.params.id)
    if (!insight) {
      reply.code(404)
      return { error: 'Insight not found' }
    }
    const teamId = (request.query as Record<string, string>).team_id
    const decision = resolveAssignment(insight, teamId)
    return { insight_id: insight.id, decision }
  })

  // Triage queue: list insights pending triage
  app.get('/insights/triage', async (request) => {
    const query = request.query as Record<string, string>
    const limit = query.limit ? Number(query.limit) : 50
    const result = listInsights({ status: 'pending_triage', limit })
    return { triage_queue: result.insights, total: result.total }
  })

  // Triage action: approve (create task) or dismiss
  app.post<{ Params: { id: string } }>('/insights/:id/triage', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const action = body.action as string

    if (!['approve', 'dismiss'].includes(action)) {
      reply.code(400)
      return { success: false, error: 'action must be "approve" or "dismiss"' }
    }

    const insight = getInsight(request.params.id)
    if (!insight) {
      reply.code(404)
      return { success: false, error: 'Insight not found' }
    }

    if (insight.status !== 'pending_triage') {
      reply.code(400)
      return { success: false, error: `Insight is ${insight.status}, not pending_triage` }
    }

    const triageReviewer = typeof body.reviewer === 'string' ? body.reviewer : (typeof body.triaged_by === 'string' ? body.triaged_by : 'unknown')
    const rationale = typeof body.rationale === 'string' ? body.rationale : ''

    if (action === 'dismiss') {
      updateInsightStatus(insight.id, 'closed')

      // Record audit decision
      const { recordTriageDecision } = await import('./insight-task-bridge.js')
      recordTriageDecision({
        insight_id: insight.id,
        action: 'dismiss',
        reviewer: triageReviewer,
        rationale,
        outcome_task_id: null,
        previous_status: 'pending_triage',
        new_status: 'closed',
        timestamp: Date.now(),
      })

      return { success: true, action: 'dismissed', insight_id: insight.id, reviewer: triageReviewer }
    }

    // Approve: create task
    const assignee = typeof body.assignee === 'string' ? body.assignee : undefined
    const eta = typeof body.eta === 'string' ? body.eta : undefined
    const priority = typeof body.priority === 'string' ? body.priority : insight.priority

    if (!assignee) {
      reply.code(400)
      return { success: false, error: 'assignee required for triage approval' }
    }

    const etaDate = eta || new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]

    try {
      const task = await taskManager.createTask({
        title: `[Insight] ${insight.title}`,
        description: `Triaged from insight ${insight.id}.\n\nCluster: ${insight.cluster_key}\nSeverity: ${insight.severity_max}\nReflections: ${insight.reflection_ids.length}`,
        status: 'todo',
        priority: priority as 'P0' | 'P1' | 'P2' | 'P3',
        assignee,
        reviewer: triageReviewer,
        createdBy: typeof body.triaged_by === 'string' ? body.triaged_by : 'triage',
        done_criteria: ['Root cause addressed', 'Evidence validated', 'Follow-up reflection submitted'],
        metadata: {
          insight_id: insight.id,
          promotion_reason: 'triage_approved',
          severity: insight.severity_max,
          source: 'triage',
          eta: etaDate,
        },
      })

      updateInsightStatus(insight.id, 'task_created', task.id)

      // Record audit decision
      const { recordTriageDecision } = await import('./insight-task-bridge.js')
      recordTriageDecision({
        insight_id: insight.id,
        action: 'approve',
        reviewer: triageReviewer,
        rationale,
        outcome_task_id: task.id,
        previous_status: 'pending_triage',
        new_status: 'task_created',
        timestamp: Date.now(),
      })

      return { success: true, action: 'approved', insight_id: insight.id, task_id: task.id, reviewer: triageReviewer }
    } catch (err) {
      reply.code(500)
      return { success: false, error: `Failed to create task: ${(err as Error).message}` }
    }
  })

  // Triage audit trail
  app.get('/insights/triage/audit', async (request) => {
    const query = request.query as Record<string, string>
    const limit = query.limit ? Number(query.limit) : 50
    const { getTriageAudit } = await import('./insight-task-bridge.js')
    return { audit: getTriageAudit(undefined, limit) }
  })

  app.get<{ Params: { id: string } }>('/insights/:id/triage/audit', async (request) => {
    const { getTriageAudit } = await import('./insight-task-bridge.js')
    return { audit: getTriageAudit(request.params.id) }
  })

  // ── Lineage Timeline (reflection→insight→task audit trail) ───────────

  app.get('/lineage', async (request) => {
    const query = request.query as Record<string, string>
    return listLineage({
      status: query.status,
      team_id: query.team_id,
      role_type: query.role_type,
      author: query.author,
      has_anomaly: query.has_anomaly === 'true' ? true : query.has_anomaly === 'false' ? false : undefined,
      limit: query.limit ? Math.min(Number(query.limit) || 50, 200) : 50,
      offset: query.offset ? Number(query.offset) || 0 : 0,
    })
  })

  app.get<{ Params: { id: string } }>('/lineage/:id', async (request, reply) => {
    const entry = getLineage(request.params.id)
    if (!entry) {
      reply.code(404)
      return { success: false, error: 'No lineage chain found for this ID' }
    }
    return { entry }
  })

  app.get('/lineage/stats', async () => {
    return lineageStats()
  })

  // ── Intake Pipeline (automated reflection→insight→task) ──────────────

  app.post('/intake', async (request, reply) => {
    const body = request.body as Record<string, unknown>

    if (!body.reflection || typeof body.reflection !== 'object') {
      reply.code(400)
      return {
        success: false,
        error: 'reflection object is required',
        hint: 'POST /intake { reflection: { pain, impact, evidence[], ... }, auto_promote?: boolean, promotion_contract?: { owner, reviewer, eta, ... } }',
      }
    }

    const result = await runIntake({
      reflection: body.reflection as Record<string, unknown>,
      team_id: typeof body.team_id === 'string' ? body.team_id : undefined,
      auto_promote: body.auto_promote === true,
      promotion_contract: body.promotion_contract as any,
    })

    reply.code(result.success ? 201 : 400)
    return result
  })

  app.post('/intake/batch', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const items = Array.isArray(body.items) ? body.items : []

    if (items.length === 0) {
      reply.code(400)
      return { success: false, error: 'items array is required', hint: 'POST /intake/batch { items: [{ reflection: {...}, auto_promote?: boolean }, ...] }' }
    }

    if (items.length > 50) {
      reply.code(400)
      return { success: false, error: 'Maximum 50 items per batch' }
    }

    const result = await batchIntake(items.map((item: any) => ({
      reflection: item.reflection || {},
      team_id: typeof item.team_id === 'string' ? item.team_id : typeof body.team_id === 'string' ? body.team_id : undefined,
      auto_promote: item.auto_promote === true || body.auto_promote === true,
      promotion_contract: item.promotion_contract || body.promotion_contract,
    })))

    return { success: true, ...result }
  })

  app.get('/intake/stats', async () => {
    return getPipelineStats()
  })

  app.post('/intake/maintenance', async () => {
    return { success: true, ...pipelineMaintenance() }
  })

  // ── Routing Approvals (explicit queue, not all todos) ────────────────

  /**
   * GET /routing/approvals — List tasks with routing_approval=true.
   * This is router-fed ONLY. Tasks without routing_approval never appear.
   */
  app.get('/routing/approvals', async () => {
    const allTasks = taskManager.listTasks({})
    const queue = getRoutingApprovalQueue(allTasks)
    const items = queue.map(task => {
      const suggestion = getRoutingSuggestion(task)
      return {
        taskId: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        assignee: task.assignee,
        suggestedAssignee: suggestion?.suggestedAssignee || task.assignee || 'unassigned',
        confidence: suggestion?.confidence ?? 0,
        reasoning: suggestion ? {
          matches: [{ factor: suggestion.reason, score: suggestion.confidence }],
          alternatives: suggestion.alternatives || [],
          summary: suggestion.reason,
        } : { matches: [], alternatives: [], summary: 'No routing suggestion' },
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      }
    })
    return { success: true, approvals: items, count: items.length }
  })

  /**
   * POST /routing/approvals/:taskId/decide — Approve or reject a routing suggestion.
   * Body: { decision: 'approve' | 'reject', actor: string, assignee?: string, note?: string }
   */
  app.post<{ Params: { taskId: string } }>('/routing/approvals/:taskId/decide', async (request, reply) => {
    const { taskId } = request.params
    const body = request.body as Record<string, unknown>

    const decision = body.decision as string
    if (decision !== 'approve' && decision !== 'reject') {
      reply.code(400)
      return { success: false, error: 'decision must be "approve" or "reject"', code: 'BAD_REQUEST', status: 400 }
    }

    const actor = (body.actor as string)?.trim()
    if (!actor) {
      reply.code(400)
      return { success: false, error: 'actor is required', code: 'BAD_REQUEST', status: 400 }
    }

    const task = taskManager.getTask(taskId)
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found', code: 'NOT_FOUND', status: 404 }
    }

    if (!isRoutingApproval(task)) {
      reply.code(400)
      return { success: false, error: 'Task is not a routing approval', code: 'BAD_REQUEST', status: 400,
        hint: 'Only tasks with metadata.routing_approval=true can be decided via this endpoint.' }
    }

    const note = (body.note as string)?.trim() || undefined

    if (decision === 'approve') {
      const assignee = (body.assignee as string)?.trim() || getRoutingSuggestion(task)?.suggestedAssignee || task.assignee
      if (!assignee) {
        reply.code(400)
        return { success: false, error: 'assignee is required for approval (or must exist in routing suggestion)', code: 'BAD_REQUEST', status: 400 }
      }
      const patch = buildApprovalPatch(actor, assignee, note)
      taskManager.updateTask(taskId, { assignee, metadata: { ...((task.metadata || {}) as Record<string, unknown>), ...patch } })
      return { success: true, taskId, decision: 'approved', assignee, message: 'Routing approval recorded.' }
    } else {
      const patch = buildRejectionPatch(actor, note)
      taskManager.updateTask(taskId, { metadata: { ...((task.metadata || {}) as Record<string, unknown>), ...patch } })
      return { success: true, taskId, decision: 'rejected', message: 'Routing rejection recorded. Task will not reappear in approvals.' }
    }
  })

  /**
   * POST /routing/approvals/suggest — Submit a routing suggestion for a task.
   * Creates routing_approval=true + routing_suggestion on the task.
   * Body: { taskId: string, suggestedAssignee: string, confidence: number, reason: string, alternatives?: [...] }
   */
  app.post('/routing/approvals/suggest', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const taskId = (body.taskId as string)?.trim()
    if (!taskId) {
      reply.code(400)
      return { success: false, error: 'taskId is required', code: 'BAD_REQUEST', status: 400 }
    }

    const task = taskManager.getTask(taskId)
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found', code: 'NOT_FOUND', status: 404 }
    }

    // Don't re-suggest rejected tasks
    const meta = (task.metadata || {}) as Record<string, unknown>
    if (meta.routing_rejected === true) {
      reply.code(409)
      return { success: false, error: 'Task was previously rejected and is suppressed', code: 'CONFLICT', status: 409 }
    }

    const suggestedAssignee = (body.suggestedAssignee as string)?.trim()
    if (!suggestedAssignee) {
      reply.code(400)
      return { success: false, error: 'suggestedAssignee is required', code: 'BAD_REQUEST', status: 400 }
    }

    const confidence = typeof body.confidence === 'number' ? Math.max(0, Math.min(100, body.confidence)) : 50
    const reason = (body.reason as string)?.trim() || 'Router suggestion'
    const alternatives = Array.isArray(body.alternatives) ? body.alternatives : undefined

    const patch = buildRoutingSuggestionPatch({ suggestedAssignee, confidence, reason, alternatives })
    taskManager.updateTask(taskId, { metadata: { ...meta, ...patch } })

    return { success: true, taskId, routing_approval: true, suggestedAssignee, confidence }
  })

  // ── Routing Overrides (role-aware routing hardening) ─────────────────

  app.post('/routing/overrides', async (request, reply) => {
    const body = request.body as CreateOverrideInput
    const validation = validateOverrideInput(body)
    if (!validation.valid) {
      reply.code(400)
      return { success: false, errors: validation.errors }
    }
    const override = createOverride(body)
    reply.code(201)
    return { success: true, override }
  })

  app.get('/routing/overrides', async (request) => {
    const query = request.query as Record<string, string>
    return {
      overrides: listOverrides({
        target: query.target,
        target_type: query.target_type as any,
        status: query.status as any,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    }
  })

  app.get<{ Params: { id: string } }>('/routing/overrides/:id', async (request, reply) => {
    const override = getOverride(request.params.id)
    if (!override) {
      reply.code(404)
      return { success: false, error: 'Override not found' }
    }
    return { override }
  })

  app.get('/routing/overrides/active/:target', async (request) => {
    const { target } = request.params as { target: string }
    const query = request.query as Record<string, string>
    const targetType = (query.target_type || 'agent') as 'agent' | 'role'
    const override = findActiveOverride(target, targetType)
    return { override }
  })

  app.post('/routing/overrides/tick', async () => {
    const result = tickOverrideLifecycle()
    return { success: true, ...result }
  })

  // ── Team Pulse (proactive status broadcast) ─────────────────────────

  app.get('/health/team/pulse', async () => {
    return { pulse: computeTeamPulse() }
  })

  app.post('/health/team/pulse', async () => {
    const pulse = await postTeamPulse()
    return { success: true, pulse }
  })

  app.get('/health/team/pulse/history', async () => {
    return { history: getTeamPulseHistory() }
  })

  app.get('/health/team/pulse/config', async () => {
    return { config: getTeamPulseConfig() }
  })

  app.patch('/health/team/pulse/config', async (request) => {
    const body = request.body as Record<string, unknown>
    configureTeamPulse(body as any)
    return { success: true, config: getTeamPulseConfig() }
  })

  // ── Team Doctor (onboarding + ongoing diagnostics) ──────────────────

  app.get('/health/team/doctor', async () => {
    const report = runTeamDoctor()
    return report
  })

  // ── Starter Team (onboarding scaffold) ──────────────────────────────

  app.post('/team/starter', async () => {
    const result = await createStarterTeam()
    return { success: true, ...result }
  })

  // Get next task (pull-based assignment)
  app.get('/tasks/next', async (request) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    const task = taskManager.getNextTask(agent, { includeTest })
    if (!task) {
      return { task: null, message: 'No available tasks' }
    }
    const enriched = enrichTaskWithComments(task)
    return { task: isCompact(query) ? compactTask(enriched) : enriched }
  })

  // Get active (doing) task for an agent
  app.get('/tasks/active', async (request) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    if (!agent) {
      return { task: null, message: 'agent query param required' }
    }
    const doingTasks = taskManager.listTasks({ status: 'doing', assignee: agent })
    const task = doingTasks[0] || null
    if (!task) {
      return { task: null, message: 'No active tasks' }
    }
    const enriched = enrichTaskWithComments(task)
    return { task: isCompact(query) ? compactTask(enriched) : enriched }
  })

  // Per-agent cockpit summary (single-pane "My Now" payload)
  app.get<{ Params: { agent: string } }>('/me/:agent', async (request) => {
    const agent = String(request.params.agent || '').trim()
    if (!agent) {
      return { error: 'agent is required' }
    }

    const now = Date.now()
    const tasks = taskManager.listTasks({})
    const messages = chatManager.getMessages({ limit: 500 })
    const presence = presenceManager.getPresence(agent)

    const assignedTasks = tasks
      .filter((task) => (task.assignee || '').toLowerCase() === agent.toLowerCase() && task.status !== 'done')
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))

    const pendingReviews = tasks
      .filter((task) => (task.reviewer || '').toLowerCase() === agent.toLowerCase() && task.status === 'validating')
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))

    const blockerTasks = assignedTasks.filter((task) => task.status === 'blocked')

    const prPattern = /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i
    const taskPrLinks = assignedTasks.concat(pendingReviews).map((task) => {
      const meta = (task.metadata || {}) as Record<string, unknown>
      const artifacts = Array.isArray(meta.artifacts) ? meta.artifacts as unknown[] : []
      const candidates = [
        typeof meta.pr === 'string' ? meta.pr : null,
        typeof meta.pr_url === 'string' ? meta.pr_url : null,
        ...artifacts.map((item) => (typeof item === 'string' ? item : null)),
      ]
      return candidates.find((entry): entry is string => typeof entry === 'string' && prPattern.test(entry)) || null
    }).filter((link): link is string => Boolean(link))

    const failingChecks = messages
      .filter((message: any) => Number(message.timestamp || 0) >= now - (24 * 60 * 60 * 1000))
      .filter((message: any) => {
        const content = String(message.content || '')
        const targetsAgent = new RegExp(`@${agent}\\b`, 'i').test(content) || /\bci\b|\bcheck\b|\bbuild\b/i.test(content)
        return targetsAgent && /\bfail|failed|failing|error|flake|conflict\b/i.test(content)
      })
      .slice(-10)
      .map((message: any) => ({
        id: message.id,
        timestamp: message.timestamp,
        channel: message.channel || 'general',
        from: message.from,
        content: String(message.content || '').slice(0, 240),
      }))

    const since = presence?.lastUpdate || (now - 60 * 60 * 1000)
    const changelog = [
      ...tasks
        .filter((task) => Number(task.updatedAt || 0) >= since)
        .filter((task) => {
          const isAssignee = (task.assignee || '').toLowerCase() === agent.toLowerCase()
          const isReviewer = (task.reviewer || '').toLowerCase() === agent.toLowerCase()
          return isAssignee || isReviewer
        })
        .map((task) => ({
          ts: Number(task.updatedAt || task.createdAt || now),
          type: 'task_update',
          taskId: task.id,
          summary: `${task.id} → ${task.status}`,
        })),
      ...messages
        .filter((message: any) => Number(message.timestamp || 0) >= since)
        .filter((message: any) => new RegExp(`@${agent}\\b`, 'i').test(String(message.content || '')))
        .map((message: any) => ({
          ts: Number(message.timestamp || now),
          type: 'mention',
          messageId: message.id,
          summary: String(message.content || '').slice(0, 200),
          channel: message.channel || 'general',
        })),
    ]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 30)

    const activeTask = assignedTasks.find((task) => task.status === 'doing') || assignedTasks[0] || null

    const nextAction = blockerTasks.length > 0
      ? `Unblock ${blockerTasks[0].id} or escalate in #blockers with @owner + task id.`
      : pendingReviews.length > 0
        ? `Review ${pendingReviews[0].id} or post PASS/FAIL with evidence.`
        : activeTask
          ? `Advance ${activeTask.id} and post artifact/PR checkpoint.`
          : 'Pull next task with /tasks/next and move it to doing.'

    const activeLane = computeActiveLane(
      agent,
      tasks,
      presence?.status,
      presence?.lastUpdate,
    )

    const query = request.query as Record<string, string>
    const compact = isCompact(query)

    // Slim task helper: strip metadata/description/done_criteria for compact mode
    const slimTask = (task: Task) => {
      if (!compact) return task
      const { metadata, description, done_criteria, ...slim } = task
      return slim
    }

    return {
      agent,
      timestamp: now,
      active_lane: activeLane,
      activeTask: activeTask ? slimTask(activeTask) : null,
      assignedTasks: assignedTasks.slice(0, 20).map(slimTask),
      pendingReviews: pendingReviews.slice(0, 20).map(slimTask),
      blockers: blockerTasks.slice(0, 20).map(slimTask),
      taskPrLinks: Array.from(new Set(taskPrLinks)).slice(0, 20),
      failingChecks,
      sinceLastSeen: {
        since,
        changes: changelog,
      },
      nextAction,
    }
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
    
    // Enrich with calendar context
    const enriched = Array.from(presenceMap.values()).map(p => {
      const calAvailability = calendarManager.getAgentAvailability(p.agent)
      const currentEvent = calendarEvents.getAgentCurrentEvent(p.agent)
      const nextEvent = calendarEvents.getAgentNextEvent(p.agent)
      return {
        ...p,
        calendar: {
          status: calAvailability.status,
          current_block: calAvailability.current_block ? {
            type: calAvailability.current_block.type,
            title: calAvailability.current_block.title,
            until: calAvailability.until,
          } : null,
          current_event: currentEvent ? {
            summary: currentEvent.summary,
            until: currentEvent.dtend,
          } : null,
          next_event: nextEvent ? {
            summary: nextEvent.event.summary,
            starts_at: nextEvent.starts_at,
          } : null,
        },
      }
    })

    return { presences: enriched }
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

  // ============ TEAM MANIFEST ENDPOINT ============

  function parseMarkdownSections(markdown: string): Array<{ heading: string; level: number; content: string }> {
    const sections: Array<{ heading: string; level: number; content: string }> = []
    const lines = markdown.split(/\r?\n/)
    let currentHeading = 'Preamble'
    let currentLevel = 0
    let buffer: string[] = []

    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/)
      if (match) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: buffer.join('\n').trim(),
        })
        currentHeading = match[2].trim()
        currentLevel = match[1].length
        buffer = []
      } else {
        buffer.push(line)
      }
    }

    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: buffer.join('\n').trim(),
    })

    return sections.filter((section) => section.heading !== 'Preamble' || section.content.length > 0)
  }

  app.get('/team/manifest', async (_request, reply) => {
    try {
      const manifestPath = join(REFLECTT_HOME, 'TEAM.md')
      const stat = await fs.stat(manifestPath)
      const content = await fs.readFile(manifestPath, 'utf8')
      const version = createHash('sha256').update(content).digest('hex')
      const sections = parseMarkdownSections(content)

      return {
        manifest: {
          raw_markdown: content,
          sections,
          version,
          updated_at: stat.mtimeMs,
          path: manifestPath,
          relative_path: 'TEAM.md',
          source: 'reflectt_home',
        },
      }
    } catch (error: any) {
      reply.code(404)
      return {
        success: false,
        error: 'TEAM manifest not found',
        message: error?.message || `TEAM.md is missing under ${REFLECTT_HOME}`,
        hint: 'Create ~/.reflectt/TEAM.md (or set REFLECTT_HOME) to define your team charter.',
      }
    }
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

  // ============ SECRET VAULT ENDPOINTS ============

  // List secrets (metadata only — no plaintext)
  app.get('/secrets', async () => {
    return { success: true, secrets: vault.list(), stats: vault.getStats() }
  })

  // Create/update a secret
  app.post('/secrets', async (request, reply) => {
    const body = request.body as { name?: string; value?: string; scope?: string; actor?: string; metadata?: Record<string, unknown> }
    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      reply.status(400)
      return { success: false, message: 'name is required' }
    }
    if (!body?.value || typeof body.value !== 'string') {
      reply.status(400)
      return { success: false, message: 'value is required' }
    }
    const scope = (body.scope === 'project' || body.scope === 'agent') ? body.scope : 'host'
    const actor = typeof body.actor === 'string' ? body.actor : 'api'

    const meta = vault.create(body.name.trim(), body.value, scope as 'host' | 'project' | 'agent', actor, body.metadata)
    return { success: true, secret: meta }
  })

  // Read/decrypt a secret
  app.get<{ Params: { name: string } }>('/secrets/:name', async (request, reply) => {
    const actor = (request.query as Record<string, string>)?.actor || 'api'
    const value = vault.read(request.params.name, actor)
    if (value === null) {
      reply.status(404)
      return { success: false, message: 'Secret not found or decryption failed' }
    }
    return { success: true, name: request.params.name, value }
  })

  // Delete a secret
  app.delete<{ Params: { name: string } }>('/secrets/:name', async (request, reply) => {
    const actor = (request.body as Record<string, string>)?.actor || 'api'
    const deleted = vault.delete(request.params.name, actor)
    if (!deleted) {
      reply.status(404)
      return { success: false, message: 'Secret not found' }
    }
    return { success: true, deleted: request.params.name }
  })

  // Rotate a secret's encryption key
  app.post<{ Params: { name: string } }>('/secrets/:name/rotate', async (request, reply) => {
    const actor = (request.body as Record<string, string>)?.actor || 'api'
    const meta = vault.rotate(request.params.name, actor)
    if (!meta) {
      reply.status(404)
      return { success: false, message: 'Secret not found or rotation failed' }
    }
    return { success: true, secret: meta }
  })

  // Export all secrets (encrypted bundle)
  app.get('/secrets/export', async () => {
    const bundle = vault.export('api')
    return { success: true, bundle }
  })

  // Audit log
  app.get('/secrets/audit', async (request) => {
    const limit = parseInt((request.query as Record<string, string>)?.limit || '100', 10)
    return { success: true, entries: vault.getAuditLog(limit) }
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

  // ── Activation Funnel ──────────────────────────────────────────────
  /**
   * GET /activation/funnel — per-user funnel state + aggregate summary.
   * Query params:
   *   ?userId=xxx — get single user's funnel state
   *   (no params) — get aggregate summary across all users
   */
  app.get('/activation/funnel', async (request) => {
    const query = request.query as Record<string, string>
    const userId = query.userId

    if (userId) {
      return { funnel: getUserFunnelState(userId) }
    }

    return { funnel: getFunnelSummary() }
  })

  /**
   * POST /activation/event — manually emit an activation event.
   * Body: { type, userId, metadata? }
   * Used by cloud signup flow and workspace setup.
   */
  app.post('/activation/event', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const type = body.type as string
    const userId = body.userId as string
    const metadata = body.metadata as Record<string, unknown> | undefined

    const validTypes = [
      'signup_completed', 'host_preflight_passed', 'host_preflight_failed',
      'workspace_ready', 'first_task_started',
      'first_task_completed', 'first_team_message_sent', 'day2_return_action',
    ]

    if (!type || !validTypes.includes(type)) {
      reply.code(400)
      return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }
    }
    if (!userId) {
      reply.code(400)
      return { success: false, error: 'userId is required' }
    }

    const isNew = await emitActivationEvent(type as any, userId, metadata)
    return { success: true, isNew, funnel: getUserFunnelState(userId) }
  })

  // ── Onboarding Telemetry Dashboard ──────────────────────────────────

  /**
   * GET /activation/dashboard — Full onboarding telemetry dashboard.
   * Returns conversion funnel, failure distribution, and weekly trends.
   * Query: ?weeks=12 (number of weeks for trend history)
   */
  app.get('/activation/dashboard', async (request) => {
    const query = request.query as Record<string, string>
    const weeks = query.weeks ? parseInt(query.weeks, 10) : 12
    return { success: true, dashboard: getOnboardingDashboard({ weeks }) }
  })

  /**
   * GET /activation/funnel/conversions — Step-by-step conversion rates.
   * Returns per-step reach count, conversion rate, and median step time.
   */
  app.get('/activation/funnel/conversions', async () => {
    return { success: true, conversions: getConversionFunnel() }
  })

  /**
   * GET /activation/funnel/failures — Failure-reason distribution per step.
   * Shows where users drop off and why (from event metadata).
   */
  app.get('/activation/funnel/failures', async () => {
    return { success: true, failures: getFailureDistribution() }
  })

  /**
   * GET /activation/funnel/weekly — Weekly trend snapshots for planning.
   * Query: ?weeks=12 (default 12 weeks of history)
   * Exportable JSON for planning dashboards.
   */
  app.get('/activation/funnel/weekly', async (request) => {
    const query = request.query as Record<string, string>
    const weeks = query.weeks ? parseInt(query.weeks, 10) : 12
    return { success: true, trends: getWeeklyTrends(weeks) }
  })

  // Get task analytics
  app.get('/tasks/analytics', async (request) => {
    const query = request.query as Record<string, string>
    const since = query.since ? parseInt(query.since, 10) : undefined
    
    const analytics = analyticsManager.getTaskAnalytics(since)
    return { analytics }
  })

  // Model performance analytics
  app.get('/analytics/models', async (request) => {
    const query = request.query as Record<string, string>
    const since = query.since ? parseInt(query.since, 10) : undefined
    const analytics = analyticsManager.getModelAnalytics(since)
    return { success: true, analytics }
  })

  // Per-agent model + performance stats
  app.get('/analytics/agents', async (request) => {
    const query = request.query as Record<string, string>
    const since = query.since ? parseInt(query.since, 10) : undefined
    const agents = analyticsManager.getAgentModelAnalytics(since)
    return { success: true, agents }
  })

  // Telemetry endpoints
  app.get('/telemetry', async () => {
    return {
      success: true,
      config: getTelemetryConfig(),
      snapshot: getTelemetrySnapshot(),
    }
  })

  app.get('/telemetry/config', async () => {
    return { success: true, config: getTelemetryConfig() }
  })

  // Cloud telemetry ingest endpoint (for receiving telemetry from other hosts)
  app.post('/api/telemetry/ingest', async (request, reply) => {
    const payload = request.body as Record<string, unknown>
    if (!payload?.version || !payload?.hostId) {
      reply.code(400)
      return { success: false, error: 'Invalid telemetry payload' }
    }
    // Store telemetry data (for cloud aggregation)
    // For now, just acknowledge — storage comes with reflectt-cloud
    return { success: true, received: true, timestamp: Date.now() }
  })

  // ── Usage Tracking + Cost Guardrails ─────────────────────────────────────

  // Initialize usage tables
  ensureUsageTables()

  // Report model usage (single event)
  app.post('/usage/report', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    if (!body.agent || !body.model) {
      reply.code(400)
      return { success: false, error: 'agent and model are required' }
    }
    const event = recordUsage({
      agent: body.agent as string,
      task_id: body.task_id as string | undefined,
      model: body.model as string,
      provider: (body.provider as string) || 'unknown',
      input_tokens: Number(body.input_tokens) || 0,
      output_tokens: Number(body.output_tokens) || 0,
      estimated_cost_usd: body.estimated_cost_usd != null ? Number(body.estimated_cost_usd) : undefined,
      category: (body.category as UsageEvent['category']) || 'other',
      timestamp: Number(body.timestamp) || Date.now(),
      team_id: body.team_id as string | undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
    })
    return { success: true, event }
  })

  // Report batch usage
  app.post('/usage/report/batch', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const items = body.events as unknown[]
    if (!Array.isArray(items) || items.length === 0) {
      reply.code(400)
      return { success: false, error: 'events array is required' }
    }
    const events = recordUsageBatch(items as any[])
    return { success: true, count: events.length }
  })

  // Usage summary (total cost by period)
  app.get('/usage/summary', async (request) => {
    const q = request.query as Record<string, string>
    return getUsageSummary({
      since: q.since ? Number(q.since) : undefined,
      until: q.until ? Number(q.until) : undefined,
      agent: q.agent,
      team_id: q.team_id,
    })
  })

  // Usage by agent
  app.get('/usage/by-agent', async (request) => {
    const q = request.query as Record<string, string>
    return getUsageByAgent({ since: q.since ? Number(q.since) : undefined })
  })

  // Usage by model
  app.get('/usage/by-model', async (request) => {
    const q = request.query as Record<string, string>
    return getUsageByModel({ since: q.since ? Number(q.since) : undefined })
  })

  // Usage by task
  app.get('/usage/by-task', async (request) => {
    const q = request.query as Record<string, string>
    return getUsageByTask({ since: q.since ? Number(q.since) : undefined, limit: q.limit ? Number(q.limit) : undefined })
  })

  // Cost estimate (dry run — no storage)
  app.get('/usage/estimate', async (request) => {
    const q = request.query as Record<string, string>
    if (!q.model) return { error: 'model query parameter required' }
    const cost = estimateCost(q.model, Number(q.input_tokens) || 0, Number(q.output_tokens) || 0)
    return { model: q.model, input_tokens: Number(q.input_tokens) || 0, output_tokens: Number(q.output_tokens) || 0, estimated_cost_usd: cost }
  })

  // Spend caps CRUD
  app.get('/usage/caps', async () => {
    return { caps: listCaps(), status: checkCaps() }
  })

  app.post('/usage/caps', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    if (!body.limit_usd || Number(body.limit_usd) <= 0) {
      reply.code(400)
      return { success: false, error: 'limit_usd (positive number) is required' }
    }
    const cap = setCap({
      scope: (body.scope as SpendCap['scope']) || 'global',
      scope_id: body.scope_id as string | undefined,
      period: (body.period as SpendCap['period']) || 'monthly',
      limit_usd: Number(body.limit_usd),
      action: (body.action as SpendCap['action']) || 'warn',
      enabled: body.enabled !== false,
    })
    return { success: true, cap }
  })

  app.delete<{ Params: { id: string } }>('/usage/caps/:id', async (request, reply) => {
    const deleted = deleteCap(request.params.id)
    if (!deleted) { reply.code(404); return { success: false, error: 'Cap not found' } }
    return { success: true }
  })

  // Routing suggestions (savings opportunities)
  app.get('/usage/routing-suggestions', async (request) => {
    const q = request.query as Record<string, string>
    return { suggestions: getRoutingSuggestions({ since: q.since ? Number(q.since) : undefined }) }
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

  // ============ HOST PROVISIONING ============

  const provisioning = getProvisioningManager()
  provisioning.setVault(vault)

  // Get provisioning status (dashboard-safe — no credentials)
  app.get('/provisioning/status', async () => {
    return { success: true, provisioning: provisioning.getStatus() }
  })

  // Full provisioning flow: enroll → pull config → pull secrets → configure webhooks
  app.post('/provisioning/provision', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const cloudUrl = body?.cloudUrl as string
    const joinToken = body?.joinToken as string | undefined
    const apiKey = body?.apiKey as string | undefined
    const hostName = body?.hostName as string
    const capabilities = (body?.capabilities as string[]) || []

    if (!cloudUrl || !hostName) {
      reply.code(400)
      return { success: false, message: 'cloudUrl and hostName are required' }
    }

    if (!joinToken && !apiKey) {
      reply.code(400)
      return { success: false, message: 'Either joinToken or apiKey is required' }
    }

    const result = await provisioning.provision({
      cloudUrl,
      joinToken,
      apiKey,
      hostName,
      capabilities,
    })

    reply.code(result.success ? 200 : 500)
    return result
  })

  // Refresh: re-pull config + secrets + webhooks (requires existing enrollment)
  app.post('/provisioning/refresh', async (_request, reply) => {
    const result = await provisioning.refresh()
    reply.code(result.success ? 200 : 400)
    return result
  })

  // Reset provisioning state (for re-enrollment)
  app.post('/provisioning/reset', async () => {
    provisioning.reset()
    return { success: true, message: 'Provisioning state reset' }
  })

  // List configured webhook routes
  app.get('/provisioning/webhooks', async () => {
    return { success: true, webhooks: provisioning.getWebhooks() }
  })

  // Add a webhook route
  app.post('/provisioning/webhooks', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const provider = body?.provider as string
    const path = body?.path as string
    const events = (body?.events as string[]) || []
    const active = body?.active !== false

    if (!provider) {
      reply.code(400)
      return { success: false, message: 'provider is required' }
    }

    const webhook = provisioning.addWebhookRoute({
      provider,
      path: path || `/webhooks/${provider}`,
      events,
      active,
    })

    reply.code(201)
    return { success: true, webhook }
  })

  // Remove a webhook route
  app.delete<{ Params: { id: string } }>('/provisioning/webhooks/:id', async (request, reply) => {
    const removed = provisioning.removeWebhookRoute(request.params.id)
    if (!removed) {
      reply.code(404)
      return { success: false, message: 'Webhook not found' }
    }
    return { success: true, message: 'Webhook removed' }
  })

  // ============ WEBHOOK DELIVERY ENGINE ============

  const webhookDelivery = getWebhookDeliveryManager()
  webhookDelivery.init()

  app.addHook('onClose', async () => {
    webhookDelivery.stop()
  })

  // Incoming webhook receiver: accepts webhooks from external providers
  // and routes them through the delivery engine to configured targets.
  app.post<{ Params: { provider: string } }>('/webhooks/incoming/:provider', async (request, reply) => {
    const provider = request.params.provider
    const body = request.body as Record<string, unknown>

    // Find matching webhook route from provisioning config
    const routes = provisioning.getWebhooks().filter(w => w.provider === provider && w.active)
    if (routes.length === 0) {
      reply.code(404)
      return { success: false, message: `No active webhook route for provider: ${provider}` }
    }

    // Extract event type from common provider header patterns
    const eventType =
      (request.headers['x-github-event'] as string) ||
      (request.headers['x-stripe-event'] as string) ||
      (request.headers['x-event-type'] as string) ||
      (body?.type as string) ||
      (body?.event as string) ||
      'unknown'

    // Create idempotency key from provider delivery ID if available
    const deliveryId =
      (request.headers['x-github-delivery'] as string) ||
      (request.headers['x-request-id'] as string) ||
      undefined

    const idempotencyKey = deliveryId ? `${provider}_${deliveryId}` : undefined

    // Enqueue through delivery engine for each configured target
    const events = []
    for (const route of routes) {
      // Check event filter
      if (route.events.length > 0 && !route.events.includes(eventType) && !route.events.includes('*')) {
        continue
      }

      const event = webhookDelivery.enqueue({
        provider,
        eventType,
        payload: body,
        targetUrl: `http://localhost:${serverConfig.port}${route.path}`,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}_${route.id}` : undefined,
        metadata: {
          routeId: route.id,
          sourceHeaders: {
            'x-github-event': request.headers['x-github-event'],
            'x-github-delivery': request.headers['x-github-delivery'],
            'x-stripe-event': request.headers['x-stripe-event'],
          },
        },
      })
      events.push(event)
    }

    reply.code(202)
    return { success: true, accepted: events.length, events: events.map(e => ({ id: e.id, idempotencyKey: e.idempotencyKey, status: e.status })) }
  })

  // Enqueue a webhook for delivery
  app.post('/webhooks/deliver', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const provider = body?.provider as string
    const eventType = body?.eventType as string
    const payload = body?.payload
    const targetUrl = body?.targetUrl as string
    const idempotencyKey = body?.idempotencyKey as string | undefined
    const metadata = body?.metadata as Record<string, unknown> | undefined

    if (!provider || !eventType || !payload || !targetUrl) {
      reply.code(400)
      return { success: false, message: 'provider, eventType, payload, and targetUrl are required' }
    }

    const event = webhookDelivery.enqueue({
      provider,
      eventType,
      payload,
      targetUrl,
      idempotencyKey,
      metadata,
    })

    reply.code(201)
    return { success: true, event }
  })

  // Get webhook event by ID
  app.get<{ Params: { id: string } }>('/webhooks/events/:id', async (request, reply) => {
    const event = webhookDelivery.get(request.params.id)
    if (!event) {
      reply.code(404)
      return { success: false, message: 'Webhook event not found' }
    }
    return { success: true, event }
  })

  // List webhook events with filters
  app.get('/webhooks/events', async (request) => {
    const query = request.query as Record<string, string>
    const events = webhookDelivery.list({
      status: query.status as any,
      provider: query.provider,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    })
    return { success: true, events, count: events.length }
  })

  // Dead letter queue
  app.get('/webhooks/dlq', async (request) => {
    const query = request.query as Record<string, string>
    const limit = query.limit ? parseInt(query.limit, 10) : 50
    const events = webhookDelivery.getDeadLetterQueue(limit)
    return { success: true, events, count: events.length }
  })

  // Replay a webhook (resend from audit trail)
  app.post<{ Params: { id: string } }>('/webhooks/events/:id/replay', async (request, reply) => {
    const event = webhookDelivery.replay(request.params.id)
    if (!event) {
      reply.code(404)
      return { success: false, message: 'Webhook event not found' }
    }
    reply.code(201)
    return { success: true, event, message: 'Webhook replayed with new idempotency key' }
  })

  // Webhook delivery stats
  app.get('/webhooks/stats', async () => {
    return {
      success: true,
      stats: webhookDelivery.getStats(),
      config: webhookDelivery.getConfig(),
    }
  })

  // Get/update webhook delivery config
  app.patch('/webhooks/config', async (request) => {
    const body = request.body as Partial<Record<string, unknown>>
    const patch: Record<string, unknown> = {}

    if (typeof body?.maxAttempts === 'number') patch.maxAttempts = body.maxAttempts
    if (typeof body?.initialBackoffMs === 'number') patch.initialBackoffMs = body.initialBackoffMs
    if (typeof body?.maxBackoffMs === 'number') patch.maxBackoffMs = body.maxBackoffMs
    if (typeof body?.backoffMultiplier === 'number') patch.backoffMultiplier = body.backoffMultiplier
    if (typeof body?.retentionMs === 'number') patch.retentionMs = body.retentionMs
    if (typeof body?.deliveryTimeoutMs === 'number') patch.deliveryTimeoutMs = body.deliveryTimeoutMs
    if (typeof body?.maxConcurrent === 'number') patch.maxConcurrent = body.maxConcurrent

    const config = webhookDelivery.updateConfig(patch as any)
    return { success: true, config }
  })

  // Lookup by idempotency key
  app.get('/webhooks/idempotency/:key', async (request, reply) => {
    const params = request.params as { key: string }
    const event = webhookDelivery.getByIdempotencyKey(params.key)
    if (!event) {
      reply.code(404)
      return { success: false, message: 'No webhook found for this idempotency key' }
    }
    return { success: true, event }
  })

  // ============ PORTABILITY (Export / Import) ============

  // One-click export: config, secrets, webhooks, team files
  app.get('/portability/export', async () => {
    const bundle = exportBundle(vault)
    return { success: true, bundle }
  })

  // Download export as JSON file
  app.get('/portability/export/download', async (_request, reply) => {
    const bundle = exportBundle(vault)
    const filename = `reflectt-export-${new Date().toISOString().slice(0, 10)}.json`
    reply.header('Content-Type', 'application/json')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return JSON.stringify(bundle, null, 2)
  })

  // Import from export bundle
  app.post('/portability/import', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const bundle = body?.bundle as any
    const overwrite = body?.overwrite === true
    const skipSecrets = body?.skipSecrets === true
    const skipConfig = body?.skipConfig === true

    if (!bundle || bundle.format !== 'reflectt-export') {
      reply.code(400)
      return { success: false, message: 'Invalid or missing export bundle. Wrap in { bundle: <export-json> }.' }
    }

    const result = importBundle(bundle, { overwrite, skipSecrets, skipConfig })
    reply.code(result.success ? 200 : 400)
    return result
  })

  // Export manifest (what would be exported, without actual content)
  app.get('/portability/manifest', async () => {
    const provStatus = getProvisioningManager().getStatus()
    const webhookDelivery = getWebhookDeliveryManager()
    const vaultStats = vault.getStats()

    const teamFiles: string[] = []
    const teamFilePaths = ['TEAM.md', 'TEAM-ROLES.yaml', 'TEAM-STANDARDS.md']
    for (const f of teamFilePaths) {
      if (existsSync(join(REFLECTT_HOME, f))) teamFiles.push(f)
    }

    const configExists = existsSync(join(REFLECTT_HOME, 'config.json'))

    return {
      success: true,
      manifest: {
        teamConfig: teamFiles,
        serverConfig: configExists,
        secrets: {
          count: vaultStats.secretCount,
          note: 'Exported as encrypted ciphertext. Requires source HMK to decrypt.',
        },
        webhooks: {
          routeCount: provStatus.webhooks.length,
          deliveryConfig: webhookDelivery.getConfig(),
        },
        provisioning: {
          phase: provStatus.phase,
          hostName: provStatus.hostName,
          enrolled: provStatus.hasCredential,
        },
      },
    }
  })

  // ============ NOTIFICATION PREFERENCES ============

  const notificationManager = getNotificationManager()
  notificationManager.init()

  // Get all agents' notification preferences
  app.get('/notifications/preferences', async () => {
    return { success: true, preferences: notificationManager.getAllPreferences() }
  })

  // Get preferences for a specific agent
  app.get<{ Params: { agent: string } }>('/notifications/preferences/:agent', async (request) => {
    return { success: true, preferences: notificationManager.getPreferences(request.params.agent) }
  })

  // Update preferences for a specific agent
  app.patch<{ Params: { agent: string } }>('/notifications/preferences/:agent', async (request) => {
    const body = request.body as Record<string, unknown>
    const prefs = notificationManager.updatePreferences(request.params.agent, body as any)
    return { success: true, preferences: prefs }
  })

  // Reset preferences to defaults
  app.delete<{ Params: { agent: string } }>('/notifications/preferences/:agent', async (request) => {
    notificationManager.resetPreferences(request.params.agent)
    return { success: true, message: `Preferences reset for ${request.params.agent}` }
  })

  // Mute an agent's notifications
  app.post<{ Params: { agent: string } }>('/notifications/preferences/:agent/mute', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const durationMs = body?.durationMs as number
    const until = body?.until as number

    const mutedUntil = until || (durationMs ? Date.now() + durationMs : Date.now() + 60 * 60 * 1000)
    const prefs = notificationManager.mute(request.params.agent, mutedUntil)
    return { success: true, preferences: prefs, mutedUntil }
  })

  // Unmute an agent
  app.post<{ Params: { agent: string } }>('/notifications/preferences/:agent/unmute', async (request) => {
    const prefs = notificationManager.unmute(request.params.agent)
    return { success: true, preferences: prefs }
  })

  // Check if a notification should be delivered (routing check)
  app.post('/notifications/route', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agent = body?.agent as string
    const type = body?.type as string

    if (!agent || !type) {
      reply.code(400)
      return { success: false, message: 'agent and type are required' }
    }

    const result = notificationManager.shouldNotify({
      type: type as any,
      agent,
      priority: body?.priority as string | undefined,
      channel: body?.channel as string | undefined,
      message: (body?.message as string) || '',
    })

    return { success: true, routing: result }
  })

  // ============ CLOUD CONNECTIVITY STATE ============

  const connectivity = getConnectivityManager()

  // Get cloud connectivity state (mode, failures, queue depth, thresholds)
  app.get('/connectivity/status', async () => {
    return {
      success: true,
      connectivity: connectivity.getState(),
      thresholds: connectivity.getThresholds(),
    }
  })

  // Update thresholds (for testing/tuning)
  app.patch('/connectivity/thresholds', async (request) => {
    const body = request.body as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (typeof body?.degradedAfterFailures === 'number') patch.degradedAfterFailures = body.degradedAfterFailures
    if (typeof body?.offlineAfterMs === 'number') patch.offlineAfterMs = body.offlineAfterMs
    if (typeof body?.recoveryAfterSuccesses === 'number') patch.recoveryAfterSuccesses = body.recoveryAfterSuccesses
    connectivity.setThresholds(patch as any)
    return { success: true, thresholds: connectivity.getThresholds() }
  })

  // Simulate failure (for outage drill testing)
  app.post('/connectivity/simulate-failure', async (request) => {
    const body = request.body as Record<string, unknown>
    const reason = (body?.reason as string) || 'simulated_outage'
    const count = (body?.count as number) || 1
    for (let i = 0; i < count; i++) {
      connectivity.recordFailure(reason)
    }
    return { success: true, state: connectivity.getState() }
  })

  // Simulate success (for outage drill testing)
  app.post('/connectivity/simulate-success', async (request) => {
    const body = request.body as Record<string, unknown>
    const count = (body?.count as number) || 1
    for (let i = 0; i < count; i++) {
      connectivity.recordSuccess()
    }
    return { success: true, state: connectivity.getState() }
  })

  // Reset connectivity state
  app.post('/connectivity/reset', async () => {
    connectivity.reset()
    return { success: true, state: connectivity.getState() }
  })

  // ============ WATCHDOG DE-NOISE ============

  // Watchdog suppression status: show what's being suppressed and why
  app.get('/health/watchdog/suppression', async () => {
    const suppressionConfig = {
      idleNudge: {
        enabled: process.env.IDLE_NUDGE_ENABLED !== 'false',
        warnMin: Number(process.env.IDLE_NUDGE_WARN_MIN || 45),
        escalateMin: Number(process.env.IDLE_NUDGE_ESCALATE_MIN || 60),
        cooldownMin: Number(process.env.IDLE_NUDGE_COOLDOWN_MIN || 20),
        suppressRecentMin: Number(process.env.IDLE_NUDGE_SUPPRESS_RECENT_MIN || 20),
        shipCooldownMin: Number(process.env.IDLE_NUDGE_SHIP_COOLDOWN_MIN || 30),
      },
      cadence: {
        enabled: process.env.CADENCE_WATCHDOG_ENABLED !== 'false',
        silenceMin: Number(process.env.CADENCE_SILENCE_MIN || 60),
        workingStaleMin: Number(process.env.CADENCE_WORKING_STALE_MIN || 45),
        alertCooldownMin: Number(process.env.CADENCE_ALERT_COOLDOWN_MIN || 30),
      },
      mentionRescue: {
        enabled: policyManager.get().mentionRescue.enabled,
        // Guardrail: never allow instant mention-rescue.
        delayMin: Math.max(3, Number(policyManager.get().mentionRescue.delayMin || 0)),
        cooldownMin: Number(policyManager.get().mentionRescue.cooldownMin || 10),
        globalCooldownMin: Number(policyManager.get().mentionRescue.globalCooldownMin || 5),
      },
      deNoise: {
        description: 'Enhanced suppression: checks for any agent activity (messages, task comments, status changes) since last alert before re-firing',
        activityTypes: ['chat messages', 'task comments', 'task status changes'],
      },
    }

    return { success: true, config: suppressionConfig }
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

  // GET /audit/mutation-alerts — suspicious mutation alert status
  app.get('/audit/mutation-alerts', async (_request, reply) => {
    reply.send(getMutationAlertStatus())
  })

  // Prune old mutation alert tracking every 30 minutes
  const pruneTimer = setInterval(pruneOldAttempts, 30 * 60 * 1000)
  pruneTimer.unref()

  // GET /audit/reviews — review-field mutation audit ledger
  app.get('/audit/reviews', async (request, reply) => {
    const query = request.query as Record<string, string>
    const taskId = query.taskId || undefined
    const limit = Math.min(parseInt(query.limit || '100', 10) || 100, 1000)

    const entries = getAuditEntries({ taskId, limit })
    reply.send({
      entries,
      count: entries.length,
      taskId: taskId || null,
    })
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

  // ── Execution Sweeper: zero-leak enforcement ──────────────────────────
  startSweeper()

  // ── Audit Ledger: load persisted entries ──────────────────────────
  loadAuditLedger().then(count => {
    if (count > 0) console.log(`[Audit] Loaded ${count} audit entries from ledger`)
  }).catch(err => {
    console.error('[Audit] Failed to load audit ledger:', err)
  })

  // ── Activation Funnel: load persisted events ──────────────────────────
  loadActivationFunnel().then(count => {
    if (count > 0) console.log(`[ActivationFunnel] Loaded ${count} funnel events`)
  }).catch(err => {
    console.error('[ActivationFunnel] Failed to load funnel data:', err)
  })

  // GET /execution-health — sweeper status + current violations
  app.get('/execution-health', async (_request, reply) => {
    const status = getSweeperStatus()
    const freshSweep = sweepValidatingQueue()
    reply.send({
      sweeper: {
        running: status.running,
        lastSweepAt: status.lastSweepAt,
        escalationTracking: status.escalationTracking,
      },
      current: {
        validatingCount: freshSweep.validatingCount,
        violations: freshSweep.violations,
        tasksScanned: freshSweep.tasksScanned,
      },
    })
  })

  // GET /drift-report — comprehensive PR↔task drift report
  app.get('/drift-report', async (_request, reply) => {
    const report = generateDriftReport()
    const status = getSweeperStatus()
    reply.send({
      ...report,
      sweeper: {
        running: status.running,
        lastSweepAt: status.lastSweepAt,
        escalationTracking: status.escalationTracking,
      },
      dryRunLog: status.dryRunLog.slice(-100), // Last 100 entries
    })
  })

  // POST /pr-event — webhook for PR state changes (merge/close)
  app.post<{ Body: { taskId: string; prState: 'merged' | 'closed'; prUrl?: string } }>('/pr-event', async (request, reply) => {
    const { taskId, prState, prUrl } = request.body || {}
    if (!taskId || !prState) {
      reply.code(400)
      return { error: 'taskId and prState (merged|closed) required' }
    }

    const drift = flagPrDrift(taskId, prState)

    // If PR merged and task is validating, auto-add merged evidence
    if (prState === 'merged') {
      // Auto-populate close-gate metadata from PR data
      const gateResult = autoPopulateCloseGate(taskId, prUrl)

      // Try auto-close if all gates are satisfied
      const closeResult = tryAutoCloseTask(taskId)

      // Fall back to manual metadata update if autoPopulate didn't cover it
      if (!gateResult.populated) {
        const lookup = taskManager.resolveTaskId(taskId)
        if (lookup.task) {
          const meta = (lookup.task.metadata || {}) as Record<string, unknown>
          const artifacts = (meta.artifacts as string[]) || []
          if (prUrl && !artifacts.includes(prUrl)) {
            artifacts.push(prUrl)
          }
          try {
            await taskManager.updateTask(lookup.resolvedId!, {
              metadata: {
                ...meta,
                artifacts,
                pr_merged: true,
                pr_merged_at: Date.now(),
                pr_url: prUrl || meta.pr_url,
              },
            })
          } catch {
            // Task update might fail validation — that's ok
          }
        }
      }
    }

    // If PR closed (not merged), flag the task
    if (prState === 'closed') {
      const lookup = taskManager.resolveTaskId(taskId)
      if (lookup.task && lookup.task.status !== 'done' && lookup.task.status !== 'blocked') {
        try {
          await taskManager.updateTask(lookup.resolvedId!, {
            status: 'blocked',
            metadata: {
              ...(lookup.task.metadata || {}),
              pr_closed_unmerged: true,
              pr_closed_at: Date.now(),
              blocked_reason: `PR ${prUrl || 'unknown'} was closed without merging. Replacement PR needed.`,
            },
          })
        } catch {
          // Lifecycle gate might prevent this — log it
          console.warn(`[PR-Event] Could not auto-block task ${taskId} after PR close`)
        }
      }
    }

    return {
      success: true,
      drift: drift || null,
      message: drift?.message || `PR ${prState} event recorded for ${taskId}`,
    }
  })

  // GET /pr-automerge/status — recent merge attempt log
  app.get('/pr-automerge/status', async (_request, reply) => {
    const log = getMergeAttemptLog()
    return {
      success: true,
      totalAttempts: log.length,
      recentAttempts: log.slice(-50),
      summary: {
        mergeAttempted: log.filter(l => l.action === 'merge_attempted').length,
        mergeSuccess: log.filter(l => l.action === 'merge_success').length,
        mergeFailed: log.filter(l => l.action === 'merge_failed').length,
        mergeSkipped: log.filter(l => l.action === 'merge_skipped').length,
        autoClose: log.filter(l => l.action === 'auto_close').length,
        closeGateFail: log.filter(l => l.action === 'close_gate_fail').length,
      },
    }
  })

  // ── Calendar API ──────────────────────────────────────────────────────────

  // Create a calendar block
  app.post('/calendar/blocks', async (request, reply) => {
    try {
      const body = request.body as CreateBlockInput
      if (!body || !body.agent || !body.type) {
        return reply.code(400).send({ error: 'agent and type are required' })
      }
      const block = calendarManager.createBlock(body)
      return reply.code(201).send({ success: true, block })
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // List calendar blocks (with optional filters)
  app.get('/calendar/blocks', async (request) => {
    const query = request.query as Record<string, string>
    const filters: { agent?: string; type?: BlockType; from?: number; to?: number } = {}
    if (query.agent) filters.agent = query.agent
    if (query.type) filters.type = query.type as BlockType
    if (query.from) filters.from = parseInt(query.from, 10)
    if (query.to) filters.to = parseInt(query.to, 10)
    const blocks = calendarManager.listBlocks(filters)
    return { blocks, total: blocks.length }
  })

  // Get a single block
  app.get<{ Params: { id: string } }>('/calendar/blocks/:id', async (request, reply) => {
    const block = calendarManager.getBlock(request.params.id)
    if (!block) return reply.code(404).send({ error: 'Block not found' })
    return { block }
  })

  // Update a block
  app.patch<{ Params: { id: string } }>('/calendar/blocks/:id', async (request, reply) => {
    try {
      const block = calendarManager.updateBlock(request.params.id, request.body as UpdateBlockInput)
      if (!block) return reply.code(404).send({ error: 'Block not found' })
      return { success: true, block }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // Delete a block
  app.delete<{ Params: { id: string } }>('/calendar/blocks/:id', async (request, reply) => {
    const deleted = calendarManager.deleteBlock(request.params.id)
    if (!deleted) return reply.code(404).send({ error: 'Block not found' })
    return { success: true }
  })

  // Check if an agent is busy (checks both calendar blocks AND events)
  app.get('/calendar/busy', async (request) => {
    const query = request.query as Record<string, string>
    if (!query.agent) return { error: 'agent query param required' }
    const availability = calendarManager.getAgentAvailability(query.agent)

    // Also check calendar events for current activity
    const currentEvent = calendarEvents.getAgentCurrentEvent(query.agent)

    // If block says free but there's an active event, agent is busy
    const busy = availability.status !== 'free' || !!currentEvent
    const status = availability.status !== 'free' ? availability.status : (currentEvent ? 'busy' : 'free')
    const until = availability.until || (currentEvent ? currentEvent.dtend : null)

    return {
      agent: availability.agent,
      busy,
      status,
      current_block: availability.current_block,
      current_event: currentEvent || null,
      until,
    }
  })

  // Team-wide availability snapshot
  app.get('/calendar/availability', async () => {
    const team = calendarManager.getTeamAvailability()
    return { agents: team, timestamp: Date.now() }
  })

  // Should I ping this agent? (checks both blocks AND events)
  app.get('/calendar/should-ping', async (request) => {
    const query = request.query as Record<string, string>
    if (!query.agent) return { error: 'agent query param required' }
    const urgency = (query.urgency || 'normal') as 'low' | 'normal' | 'high'

    // Check blocks first
    const blockDecision = calendarManager.shouldPing(query.agent, urgency)
    if (!blockDecision.should_ping) return blockDecision

    // If blocks say OK, also check events (meetings = busy)
    const currentEvent = calendarEvents.getAgentCurrentEvent(query.agent)
    if (currentEvent && urgency !== 'high') {
      const isFocus = currentEvent.categories?.includes('focus')
      if (isFocus || urgency === 'low') {
        return {
          should_ping: false,
          reason: `Agent in event: "${currentEvent.summary}"`,
          delay_until: currentEvent.dtend,
          current_block: null,
          current_event: currentEvent,
        }
      }
    }

    return { ...blockDecision, current_event: currentEvent }
  })

  // When is agent next free? (checks blocks + events)
  app.get('/calendar/next-free', async (request) => {
    const query = request.query as Record<string, string>
    if (!query.agent) return { error: 'agent query param required' }

    const blockAvailability = calendarManager.getAgentAvailability(query.agent)
    const currentEvent = calendarEvents.getAgentCurrentEvent(query.agent)

    // If free now, return immediately
    if (blockAvailability.status === 'free' && !currentEvent) {
      return { agent: query.agent, free_now: true, free_at: Date.now() }
    }

    // Find when the current block/event ends
    const blockEnds = blockAvailability.until || 0
    const eventEnds = currentEvent ? currentEvent.dtend : 0
    const freeAt = Math.max(blockEnds, eventEnds)

    return {
      agent: query.agent,
      free_now: false,
      free_at: freeAt || null,
      reason: currentEvent
        ? `In event: "${currentEvent.summary}"`
        : `Calendar block: "${blockAvailability.current_block?.title || blockAvailability.status}"`,
    }
  })

  // Reminder engine stats
  app.get('/calendar/reminders/stats', async () => {
    return getReminderEngineStats()
  })

  // ── iCal Import/Export ───────────────────────────────────────────────────

  // Export all events as .ics
  app.get('/calendar/export.ics', async (request, reply) => {
    const query = request.query as Record<string, string>
    const filters: Parameters<typeof calendarEvents.listEvents>[0] = {}
    if (query.organizer) filters.organizer = query.organizer
    if (query.attendee) filters.attendee = query.attendee
    if (query.from) filters.from = parseInt(query.from, 10)
    if (query.to) filters.to = parseInt(query.to, 10)

    const events = calendarEvents.listEvents(filters)
    const ics = exportICS(events)

    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="reflectt-calendar.ics"')
      .send(ics)
  })

  // Export single event as .ics
  app.get<{ Params: { id: string } }>('/calendar/events/:id/export.ics', async (request, reply) => {
    const event = calendarEvents.getEvent(request.params.id)
    if (!event) return reply.code(404).send({ error: 'Event not found' })

    const ics = exportEventICS(event)
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="event-${event.id}.ics"`)
      .send(ics)
  })

  // Import events from .ics content
  app.post('/calendar/import', async (request, reply) => {
    const body = request.body as { ics?: string; organizer?: string } | string
    let icsContent: string
    let organizer = 'imported'

    if (typeof body === 'string') {
      icsContent = body
    } else if (body && typeof body === 'object' && 'ics' in body) {
      icsContent = body.ics || ''
      organizer = body.organizer || 'imported'
    } else {
      return reply.code(400).send({ error: 'Request body must be .ics content (string) or { ics: string, organizer?: string }' })
    }

    if (!icsContent.includes('BEGIN:VCALENDAR') && !icsContent.includes('BEGIN:VEVENT')) {
      return reply.code(400).send({ error: 'Invalid .ics content — must contain BEGIN:VCALENDAR or BEGIN:VEVENT' })
    }

    try {
      const imported = importICS(icsContent, organizer)
      return reply.code(201).send({
        success: true,
        imported: imported.length,
        events: imported,
      })
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ── Calendar Events API ────────────────────────────────────────────────

  // Create an event
  app.post('/calendar/events', async (request, reply) => {
    try {
      const body = request.body as CreateEventInput
      if (!body || !body.summary || !body.organizer) {
        return reply.code(400).send({ error: 'summary and organizer are required' })
      }
      const event = calendarEvents.createEvent(body)
      return reply.code(201).send({ success: true, event })
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // List events
  app.get('/calendar/events', async (request) => {
    const query = request.query as Record<string, string>
    const filters: Parameters<typeof calendarEvents.listEvents>[0] = {}
    if (query.organizer) filters.organizer = query.organizer
    if (query.attendee) filters.attendee = query.attendee
    if (query.status) filters.status = query.status as any
    if (query.from) filters.from = parseInt(query.from, 10)
    if (query.to) filters.to = parseInt(query.to, 10)
    if (query.categories) filters.categories = query.categories.split(',')
    if (query.limit) filters.limit = parseInt(query.limit, 10)
    const events = calendarEvents.listEvents(filters)
    return { events, total: events.length }
  })

  // Get single event
  app.get<{ Params: { id: string } }>('/calendar/events/:id', async (request, reply) => {
    const event = calendarEvents.getEvent(request.params.id)
    if (!event) return reply.code(404).send({ error: 'Event not found' })
    return { event }
  })

  // Update event
  app.patch<{ Params: { id: string } }>('/calendar/events/:id', async (request, reply) => {
    try {
      const event = calendarEvents.updateEvent(request.params.id, request.body as UpdateEventInput)
      if (!event) return reply.code(404).send({ error: 'Event not found' })
      return { success: true, event }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // Delete event
  app.delete<{ Params: { id: string } }>('/calendar/events/:id', async (request, reply) => {
    const deleted = calendarEvents.deleteEvent(request.params.id)
    if (!deleted) return reply.code(404).send({ error: 'Event not found' })
    return { success: true }
  })

  // RSVP to event
  app.post<{ Params: { id: string } }>('/calendar/events/:id/rsvp', async (request, reply) => {
    try {
      const body = request.body as { name: string; status: AttendeeStatus }
      if (!body?.name || !body?.status) {
        return reply.code(400).send({ error: 'name and status are required' })
      }
      const event = calendarEvents.rsvpEvent(request.params.id, body.name, body.status)
      if (!event) return reply.code(404).send({ error: 'Event not found' })
      return { success: true, event }
    } catch (err: any) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // Get occurrences of a recurring event
  app.get<{ Params: { id: string } }>('/calendar/events/:id/occurrences', async (request, reply) => {
    const event = calendarEvents.getEvent(request.params.id)
    if (!event) return reply.code(404).send({ error: 'Event not found' })
    const query = request.query as Record<string, string>
    const from = query.from ? parseInt(query.from, 10) : Date.now()
    const to = query.to ? parseInt(query.to, 10) : from + 30 * 24 * 60 * 60 * 1000 // 30 days default
    const occurrences = calendarEvents.getOccurrences(event, from, to)
    return { event_id: event.id, occurrences, count: occurrences.length }
  })

  // Get pending reminders (for reminder engine polling)
  app.get('/calendar/reminders/pending', async () => {
    const pending = calendarEvents.getPendingReminders()
    return { reminders: pending, count: pending.length }
  })

  // Get agent's current event
  app.get('/calendar/events/current', async (request) => {
    const query = request.query as Record<string, string>
    if (!query.agent) return { error: 'agent query param required' }
    const event = calendarEvents.getAgentCurrentEvent(query.agent)
    return { agent: query.agent, in_event: !!event, event }
  })

  // Get agent's next event
  app.get('/calendar/events/next', async (request) => {
    const query = request.query as Record<string, string>
    if (!query.agent) return { error: 'agent query param required' }
    const result = calendarEvents.getAgentNextEvent(query.agent)
    return { agent: query.agent, next_event: result?.event || null, starts_at: result?.starts_at || null }
  })

  return app
}
