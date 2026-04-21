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
import { serverConfig, openclawConfig, isDev, REFLECTT_HOME, DATA_DIR } from './config.js'
import { openclawClient } from './openclaw.js'
import { getStallDetector, emitWorkflowStall, onStallEvent } from './stall-detector.js'
import { processStallEvent } from './intervention-template.js'
import { trackRequest, getRequestMetrics } from './request-tracker.js'
import { getPreflightMetrics, snapshotDailyMetrics, getDailySnapshots, startAutoSnapshot } from './alert-preflight.js'

// ── Build info (read once at startup) ──────────────────────────────────────
const BUILD_VERSION = (() => {
  try {
    // Use import.meta.url so this works regardless of cwd (e.g. launchctl, systemd)
    const pkgPath = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return pkg.version || '0.0.0'
  } catch { return '0.0.0' }
})()

const BUILD_COMMIT = (() => {
  // Prefer commit baked at build time (dist/commit.txt) — accurate regardless of CWD at runtime.
  // Falls back to git rev-parse for dev mode (tsx / ts-node).
  try {
    const commitFile = new URL('../commit.txt', import.meta.url)
    return readFileSync(commitFile, 'utf8').trim()
  } catch { /* not a built dist — fall through to git */ }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { return 'unknown' }
})()

const BUILD_STARTED_AT = Date.now()
import { chatManager } from './chat.js'
import { taskManager } from './tasks.js'
import { detectApproval, applyApproval } from './chat-approval-detector.js'
import { inboxManager, clearDeliveryRecord, sweepDeliveryRecords } from './inbox.js'
import { getFocus, setFocus, clearFocus, getFocusSummary } from './focus.js'
import { generatePulse, generateCompactPulse } from './pulse.js'
import { scanScopeOverlap, scanAndNotify } from './scopeOverlap.js'
import { getDb } from './db.js'
import { getIdentityColor, getClaimedAgentIds } from './agent-config.js'
import type { AgentMessage, Task } from './types.js'
import { isTestHarnessTask } from './test-task-filter.js'
import { handleMCPRequest, handleSSERequest, handleMessagesRequest, getActiveSamplingProviders } from './mcp.js'
import { memoryManager } from './memory.js'
import { buildContextInjection, getContextBudgets, getContextMemo, upsertContextMemo, type ContextLayer } from './context-budget.js'
import { deriveScopeId } from './scope-routing.js'
import { eventBus, VALID_EVENT_TYPES } from './events.js'
import { presenceManager } from './presence.js'
import type { NotificationType, NotificationPriorityLevel, AckDecision, NotificationStatus } from './agent-notifications.js'
import { startSweeper, getSweeperStatus, sweepValidatingQueue, flagPrDrift, generateDriftReport } from './executionSweeper.js'
import { runRestartDriftGuard } from './restart-drift-guard.js'
import { autoPopulateCloseGate, tryAutoCloseTask, getMergeAttemptLog, hasPreviewApproval, getPreviewApprovals } from './prAutoMerge.js'
import { getDuplicateClosureCanonicalRefError } from './duplicateClosureGuard.js'
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
  getActivationEventLog,
  type ActivationEventType,
} from './activationEvents.js'
import { alertUnauthorizedApproval, alertFlipAttempt, getMutationAlertStatus, pruneOldAttempts } from './mutationAlert.js'
import { mentionAckTracker } from './mention-ack.js'
import type { PresenceStatus, FocusLevel } from './presence.js'
import { analyticsManager } from './analytics.js'
import { processRequest as complianceProcessRequest, queryViolations, getViolationSummary } from './compliance-detector.js'
import { getDashboardHTML } from './dashboard.js'
import { healthMonitor, computeActiveLane } from './health.js'
import { getSystemLoopTicks, recordSystemLoopTick } from './system-loop-state.js'
import { contentManager } from './content.js'
import { experimentsManager } from './experiments.js'
import { releaseManager } from './release.js'
import { researchManager } from './research.js'
import { wsHeartbeat } from './ws-heartbeat.js'
import { getBuildInfo } from './buildInfo.js'
import { appendStoredLog, readStoredLogs, getStoredLogPath } from './logStore.js'
import { getAgentRoles, getAgentRolesSource, loadAgentRoles, startConfigWatch, suggestAssignee, suggestReviewer, checkWipCap, saveAgentRoles, scoreAssignment, getAgentRole, getAgentAliases, setAgentDisplayName, resolveAgentMention, parseRolesYaml } from './assignment.js'
import { initTelemetry, trackRequest as trackTelemetryRequest, trackError as trackTelemetryError, trackTaskEvent, getSnapshot as getTelemetrySnapshot, getTelemetryConfig, isTelemetryEnabled, stopTelemetry } from './telemetry.js'
import { recordUsage as recordUsageTracking, recordUsageBatch, getUsageSummary, getUsageByAgent, getUsageByModel, getUsageByTask, getDailySpendByModel, getAvgCostByLane, getAvgCostByAgent, setCap, listCaps, deleteCap, checkCaps, getRoutingSuggestions, estimateCost, ensureUsageTables, type UsageEvent, type SpendCap } from './usage-tracking.js'
import { getTeamConfigHealth } from './team-config.js'
import { SecretVault } from './secrets.js'
import { initGitHubActorAuth, resolveGitHubTokenForActor } from './github-actor-auth.js'
import { startGitHubTokenRefresh, getCloudGitHubToken } from './github-cloud-token.js'
import { approvePullRequest, githubWhoami } from './github-reviews.js'
import type { GitHubIdentityProvider } from './github-identity.js'
import { computeCiFromCheckRuns, computeCiFromCombinedStatus } from './github-ci.js'
import { createGitHubIdentityProvider } from './github-identity.js'
import { getProvisioningManager } from './provisioning.js'
import { getWebhookDeliveryManager } from './webhooks.js'
import { enrichWebhookPayload } from './github-webhook-attribution.js'
import { formatGitHubEvent } from './github-webhook-chat.js'
import { formatSentryAlert, verifySentrySignature } from './sentry-webhook.js'
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
import { createReflection, getReflection, listReflections, countReflections, reflectionStats, validateReflection, ROLE_TYPES, SEVERITY_LEVELS, recordReflectionDuplicate } from './reflections.js'
import { ingestReflection, getInsight, listInsights, insightStats, INSIGHT_STATUSES, extractClusterKey, tickCooldowns, updateInsightStatus, getOrphanedInsights, reconcileInsightTaskLinks, getLoopSummary, sweepShippedCandidates } from './insights.js'
import { queryActivity, ACTIVITY_SOURCES } from './activity.js'
import { patchInsightById, cooldownInsightById, closeInsightById } from './insight-mutation.js'
import { runStaleCandidateReconcileSweep } from './stale-candidate-reconciler.js'
import { runCanvasAutoStateSweep, SYNC_INTERVAL_MS, PUSH_PRIORITY_WINDOW_MS } from './canvas-auto-state.js'
import { promoteInsight, validatePromotionInput, generateRecurringCandidates, listPromotionAudits, getPromotionAuditByInsight, type PromotionInput } from './insight-promotion.js'
import { runIntake, batchIntake, pipelineMaintenance, getPipelineStats } from './intake-pipeline.js'
import { listLineage, getLineage, lineageStats } from './lineage.js'
import { startInsightTaskBridge, stopInsightTaskBridge, getInsightTaskBridgeStats, configureBridge, getBridgeConfig, resolveAssignment } from './insight-task-bridge.js'
import { startShippedHeartbeat, stopShippedHeartbeat, getShippedHeartbeatStats } from './shipped-heartbeat.js'
import { startOpenClawUsageSync, stopOpenClawUsageSync, syncOpenClawUsage } from './openclaw-usage-sync.js'
import { initContactsTable, createContact, getContact, updateContact, deleteContact, listContacts, countContacts } from './contacts.js'
import { processRender, logRejection, getRecentRejections, subscribeCanvas } from './canvas-multiplexer.js'
import { canvasReadRoutes, canvasPhase2Routes, formatRecency } from './canvas-routes.js'
import { startTeamPulse, stopTeamPulse, postTeamPulse, computeTeamPulse, getTeamPulseConfig, configureTeamPulse, getTeamPulseHistory } from './team-pulse.js'
import { runTeamDoctor } from './team-doctor.js'
import { createStarterTeam } from './starter-team.js'
import { bootstrapTeam, type BootstrapTeamRequest } from './bootstrap-team.js'
import { registerManageRoutes } from './manage.js'
import { validatePrIntegrity, type PrIntegrityResult } from './pr-integrity.js'
import { runPrLinkReconcileSweep } from './pr-link-reconciler.js'
import { createOverride, getOverride, listOverrides, findActiveOverride, validateOverrideInput, tickOverrideLifecycle, type CreateOverrideInput } from './routing-override.js'
import { getRoutingApprovalQueue, getRoutingSuggestion, buildApprovalPatch, buildRejectionPatch, buildRoutingSuggestionPatch, isRoutingApproval } from './routing-approvals.js'
import { simulateRoutingScenarios, type CommsRoutingPolicy, type RoutingScenario } from './comms-routing-policy.js'
import { createVoiceSession, getVoiceSession, processVoiceTranscript, subscribeVoiceSession } from './voice-sessions.js'
import { createRun, getRun, subscribeRun, approveRun, rejectRun, executeGithubIssueCreate, executeMacOSUIAction, buildReplayPacket, listPendingRuns, listRuns } from './agent-interface.js'
import { validateIntent as macOSValidateIntent, isKillSwitchEngaged, engageKillSwitch, resetKillSwitch } from './macos-accessibility.js'
import { calendarManager, type BlockType, type CreateBlockInput, type UpdateBlockInput } from './calendar.js'
import { calendarEvents, type CreateEventInput, type UpdateEventInput, type AttendeeStatus } from './calendar-events.js'
import { requestImmediateCanvasSync, queueCanvasPushEvent, readCapabilityContext } from './cloud.js'
import { startReminderEngine, stopReminderEngine, getReminderEngineStats } from './calendar-reminder-engine.js'
import { startDeployMonitor, stopDeployMonitor } from './deploy-monitor.js'
import { exportICS, exportEventICS, importICS, parseICS } from './calendar-ical.js'
import { createScheduleEntry, getScheduleEntry, updateScheduleEntry, deleteScheduleEntry, getScheduleFeed, type ScheduleKind } from './schedule.js'
import { createDoc, getDoc, listDocs, updateDoc, deleteDoc, countDocs, VALID_CATEGORIES, type CreateDocInput, type UpdateDocInput, type DocCategory } from './knowledge-docs.js'
import { onTaskShipped, onProcessFileWritten, onDecisionComment, isDecisionComment } from './knowledge-auto-index.js'
import { upsertHostHeartbeat, getHost, listHosts, removeHost } from './host-registry.js'
import { startKeepalive, stopKeepalive, getKeepaliveStatus, triggerKeepalivePing } from './host-keepalive.js'
import { startSelfKeepalive, stopSelfKeepalive, getSelfKeepaliveStatus, detectWarmBoot, getBootInfo } from './cf-keepalive.js'
// polls.ts imported dynamically where needed
import { pauseTarget, unpauseTarget, checkPauseStatus, listPauseEntries } from './pause-controls.js'
import { isLocalWhisperAvailable, transcribeLocally } from './local-whisper.js'
import { inferFamilyFromTitle, backfillUncategorizedInsights, getAutoTagRules, setAutoTagRules, resetAutoTagRules, autoTagInsightIfUncategorized, DEFAULT_AUTO_TAG_RULES, type AutoTagRule } from './insight-auto-tagger.js'
import { startTeamContextWriter, teamContextFactEndpoint } from './team-context-writer.js'

// Schemas
const ChatAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string(),
  url: z.string(),
})

const SendMessageSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  content: z.string().default(''),
  channel: z.string().optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
})

// Task type determines required fields beyond the base schema
const TASK_TYPES = ['bug', 'feature', 'process', 'docs', 'chore'] as const

// Shared placeholder pattern for done_criteria validation.
// Used in checkDefinitionOfReady (DoR gate) and POST /tasks creator-type gating.
const DONE_CRITERIA_PLACEHOLDER_RE = /^\s*(tbd|todo|to-do|to do|placeholder|n\/a|na|none|fix later|coming soon|see description|wip|tbh|tbw)\s*$/i
type TaskType = typeof TASK_TYPES[number]

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  type: z.enum(TASK_TYPES).optional(), // optional for backward compat, validated when present
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done', 'cancelled']).default('todo'),
  assignee: z.string().trim().min(1).optional().default('unassigned'),
  reviewer: z.string().trim().min(1).or(z.literal('auto')).default('auto'), // 'auto' triggers load-balanced assignment
  done_criteria: z.array(z.string().trim().min(1)).optional().default([]),
  eta: z.string().trim().min(1).optional(),
  createdBy: z.string().min(1).optional().default('user'),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P3'),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  teamId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  dueAt: z.number().int().positive().optional(),           // epoch ms — when the task is due
  scheduledFor: z.number().int().positive().optional(),     // epoch ms — when work should start
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

  // Done criteria presence: always required, even for todo (backlog) tasks.
  // Silent omission is the root cause of tasks reaching doing with no verifiable exit condition.
  if (!data.done_criteria || data.done_criteria.length === 0) {
    problems.push('done_criteria is required and must contain at least one verifiable criterion. Tasks without acceptance criteria cannot be validated or closed.')
  }

  // Done criteria quality: reject placeholder text (TBD, TODO, placeholder, etc.)
  for (const criterion of data.done_criteria) {
    if (DONE_CRITERIA_PLACEHOLDER_RE.test(criterion)) {
      problems.push(`Done criterion "${criterion}" is a placeholder. Replace with a concrete, verifiable outcome.`)
    }
  }

  // Done criteria quality: reject single-word criteria
  for (const criterion of data.done_criteria) {
    if (criterion.split(/\s+/).length < 3 && !DONE_CRITERIA_PLACEHOLDER_RE.test(criterion)) {
      problems.push(`Done criterion "${criterion}" is too vague. Use a full sentence describing the verifiable outcome.`)
    }
  }

  // For todo tasks, skip type-specific done_criteria quality checks.
  // These are backlog items — full readiness is enforced when moving to doing.
  if (data.status === 'todo') {
    return problems // Return early with only title-level + presence checks
  }

  // Type-specific checks (non-todo tasks)
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
  // Auto-exempt when no reflections exist yet (fresh install / new user onboarding)
  // Also skip for todo tasks — backlog items don't need reflection provenance.
  const meta = (data.metadata || {}) as Record<string, unknown>
  const hasReflectionSource = Boolean(meta.source_reflection || meta.source_insight || meta.source === 'reflection_pipeline')
  const systemHasReflections = countReflections() > 0
  const isExempt = Boolean(meta.reflection_exempt) || !systemHasReflections
  const hasExemptReason = typeof meta.reflection_exempt_reason === 'string' && meta.reflection_exempt_reason.trim().length > 0

  if ((data.status as string) !== 'todo' && !hasReflectionSource && !isExempt) {
    problems.push(
      'Reflection-origin required: tasks must include metadata.source_reflection or metadata.source_insight. ' +
      'If this task legitimately does not originate from a reflection, set metadata.reflection_exempt=true with metadata.reflection_exempt_reason.'
    )
  }
  if (isExempt && !hasExemptReason && systemHasReflections) {
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

// Operator override: set DEFAULT_MODEL to an alias (gpt, gpt-codex, sonnet, opus)
// or to provider/model format (e.g. anthropic/claude-sonnet-4-5)
const DEFAULT_MODEL = (process.env.DEFAULT_MODEL || 'gpt-codex').trim() || 'gpt-codex'
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

// ── Handoff state schema (max 3 columns per COO rule) ─────────────
const VALID_HANDOFF_DECISIONS = ['approved', 'rejected', 'needs_changes', 'escalated'] as const
const HandoffStateSchema = z.object({
  reviewed_by: z.string().min(1),
  decision: z.enum(VALID_HANDOFF_DECISIONS),
  next_owner: z.string().min(1).optional(),
}).strict()

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done', 'cancelled']).optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  done_criteria: z.array(z.string().min(1)).optional(),
  criteria_verified: z.boolean().optional(),  // bypass done_criteria gate for todo→validating
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  actor: z.string().trim().min(1).optional(),
  dueAt: z.number().int().positive().nullable().optional(),         // epoch ms, null to clear
  scheduledFor: z.number().int().positive().nullable().optional(),  // epoch ms, null to clear
})

const CreateTaskCommentSchema = z.object({
  author: z.string().trim().min(1),
  content: z.string().trim().min(1),
  // Optional categorization for comms_policy enforcement
  category: z.string().trim().min(1).optional(),
  // Optional provenance: used to trace phantom/forged task-comment emitters.
  provenance: z.record(z.unknown()).optional(),
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
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done', 'cancelled']).optional(),
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
  pr_url: z.string().trim().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:$|[/?#])/i, 'must be a GitHub PR URL').optional(),
  commit: z.string().trim().min(7).optional(),
  changed_files: z.array(z.string().trim().min(1)).min(1).optional(),
  artifact_path: z.string().trim().min(1),  // required but no longer forced under process/
  caveats: z.string().trim().min(1),
})

const QaBundleSchema = z.object({
  lane: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  pr_link: z.string().trim().min(1).optional(),
  commit_shas: z.array(z.string().trim().min(1)).optional(),
  changed_files: z.array(z.string().trim().min(1)).min(1).optional(),  // optional for non-code tasks
  artifact_links: z.array(z.string().trim().min(1)).min(1).optional(), // optional for non-code tasks
  checks: z.array(z.string().trim().min(1)).min(1).optional(),         // optional for non-code tasks
  screenshot_proof: z.array(z.string().trim().min(1)).min(1).optional(), // optional for non-code tasks
  reviewer_notes: z.string().trim().min(1).optional(),
  config_only: z.boolean().optional(),
  non_code: z.boolean().optional(),
  review_packet: ReviewPacketSchema.optional(),  // optional for non-code tasks
})

const ReviewHandoffSchema = z.object({
  task_id: z.string().trim().regex(/^task-[a-zA-Z0-9-]+$/),
  // Stored transactionally (server-side) from POST /tasks/:id/comments.
  // This must always resolve via GET /tasks/:id/comments.
  comment_id: z.string().trim().regex(/^tcomment-\d+-[a-z0-9]+$/i).optional(),
  repo: z.string().trim().min(1).optional(),  // optional for config_only tasks
  artifact_path: z.string().trim().min(1),    // relaxed: accepts any path (process/, ~/.reflectt/, etc.)
  test_proof: z.string().trim().min(1).optional(),  // optional for non-code tasks
  known_caveats: z.string().trim().min(1),
  doc_only: z.boolean().optional(),
  config_only: z.boolean().optional(),  // true for ~/.reflectt/ config artifacts
  non_code: z.boolean().optional(),
  pr_url: z.string().trim().url().optional(),
  commit_sha: z.string().trim().regex(/^[a-fA-F0-9]{7,40}$/).optional(),
})

const ChatMessagesQuerySchema = z.object({
  from: z.string().optional(),
  exclude_from: z.string().optional(),
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
  mark_read: z.enum(['true', 'false']).optional(),
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

  // ── Lightweight close path for duplicate/superseded tasks ──
  // Tasks closed as duplicate or superseded only need a canonical reference + reason,
  // not a full QA bundle with PR integrity checks.
  const closeReason = typeof root.close_reason === 'string' ? root.close_reason.toLowerCase().trim() : ''
  if (closeReason === 'duplicate' || closeReason === 'superseded') {
    const dupOf = (root.duplicate_of ?? root.canonical_ref ?? {}) as Record<string, unknown>
    const hasRef = (
      (typeof dupOf.task_id === 'string' && /^task-/.test(dupOf.task_id)) ||
      (typeof dupOf.pr_url === 'string' && /github\.com/.test(dupOf.pr_url)) ||
      (typeof dupOf.commit === 'string' && /^[a-f0-9]{7,40}$/i.test(dupOf.commit))
    )
    const reason = typeof dupOf.reason === 'string' ? dupOf.reason.trim() : ''
    const hasReason = reason.length >= 10

    if (hasRef && hasReason) return { ok: true }

    const missing: string[] = []
    if (!hasRef) missing.push('canonical reference (task_id, pr_url, or commit)')
    if (!hasReason) missing.push('reason (>=10 chars explaining why)')
    return {
      ok: false,
      error: `Close as ${closeReason}: missing ${missing.join(' + ')}.`,
      hint: `Set metadata.close_reason="${closeReason}" and metadata.duplicate_of={ task_id?: "task-...", pr_url?: "https://...", reason: "Why this is ${closeReason}..." }`,
    }
  }

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
      hint: 'Include metadata.qa_bundle with: lane, summary. For code tasks also include: review_packet { task_id, pr_url, commit, changed_files[], artifact_path, caveats }. For non-code tasks: set qa_bundle.non_code=true (or use a non-code lane like ops/finance/legal).',
    }
  }

  const metadataObj = (metadata ?? {}) as Record<string, unknown>
  const nonCodeLane = parsed.data.qa_bundle.non_code === true || isDesignOrDocsLane(metadataObj)
  const reviewPacket = parsed.data.qa_bundle.review_packet

  // Non-code tasks with no review_packet pass the gate with just lane + summary
  if (nonCodeLane && !reviewPacket) return { ok: true }

  if (!nonCodeLane && !reviewPacket) {
    return {
      ok: false,
      error: 'Review packet required for code tasks. Set qa_bundle.review_packet or qa_bundle.non_code=true for non-code tasks.',
      hint: 'Include review_packet: { task_id, pr_url, commit, changed_files[], artifact_path, caveats }.',
    }
  }

  // For code tasks, enforce required review_packet fields that are optional in schema
  if (reviewPacket && !nonCodeLane) {
    const missingFields: string[] = []
    if (!reviewPacket.pr_url) missingFields.push('metadata.qa_bundle.review_packet.pr_url')
    if (!reviewPacket.commit) missingFields.push('metadata.qa_bundle.review_packet.commit')
    if (!reviewPacket.changed_files || reviewPacket.changed_files.length === 0) missingFields.push('metadata.qa_bundle.review_packet.changed_files')
    if (missingFields.length > 0) {
      return {
        ok: false,
        error: `Review packet required before validating. Missing/invalid: ${missingFields.join(', ')}.`,
        hint: 'Include review_packet: { task_id, pr_url, commit, changed_files[], artifact_path, caveats }. For non-code tasks: set qa_bundle.non_code=true.',
      }
    }
  }

  // Early format validation: PR URL must be a valid GitHub PR URL
  if (reviewPacket?.pr_url && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(reviewPacket.pr_url)) {
    return {
      ok: false,
      error: `Invalid PR URL format: "${reviewPacket.pr_url}"`,
      hint: 'Expected format: https://github.com/owner/repo/pull/123',
    }
  }

  // Early format validation: commit SHA must be 7-40 hex chars
  if (reviewPacket?.commit && !/^[a-f0-9]{7,40}$/i.test(reviewPacket.commit)) {
    return {
      ok: false,
      error: `Invalid commit SHA format: "${reviewPacket.commit}"`,
      hint: 'Expected 7-40 hex characters, e.g. "a1b2c3d"',
    }
  }

  if (reviewPacket && !nonCodeLane && expectedTaskId && reviewPacket.task_id !== expectedTaskId) {
    return {
      ok: false,
      error: `Review packet task mismatch: got "${reviewPacket.task_id}", expected "${expectedTaskId}"`,
      hint: 'Set review_packet.task_id to the current task ID before moving to validating.',
    }
  }

  const artifactPath = typeof metadataObj.artifact_path === 'string' ? metadataObj.artifact_path.trim() : ''
  if (reviewPacket && !nonCodeLane && artifactPath && artifactPath !== reviewPacket.artifact_path) {
    return {
      ok: false,
      error: `Review packet artifact_path mismatch: got "${reviewPacket.artifact_path}", expected "${artifactPath}"`,
      hint: 'Use the same canonical process/... artifact path in both fields.',
    }
  }

  // Canonical artifact reference (until central storage exists):
  // For code tasks, artifact paths must be repo-relative under process/ (or a URL).
  if (reviewPacket && !nonCodeLane) {
    const packetArtifact = typeof reviewPacket.artifact_path === 'string' ? reviewPacket.artifact_path.trim() : ''
    const packetIsUrl = /^https?:\/\//i.test(packetArtifact)
    const packetIsProcess = packetArtifact.startsWith('process/')

    if (packetArtifact && !packetIsUrl && !packetIsProcess) {
      return {
        ok: false,
        error: 'Validating gate: metadata.qa_bundle.review_packet.artifact_path must be under process/ (repo-relative) or a URL',
        hint: 'Set review_packet.artifact_path to process/TASK-...md (committed in the PR) or a PR/GitHub URL.',
      }
    }

    const metaIsUrl = /^https?:\/\//i.test(artifactPath)
    const metaIsProcess = artifactPath.startsWith('process/')
    if (artifactPath && !metaIsUrl && !metaIsProcess) {
      return {
        ok: false,
        error: 'Validating gate: metadata.artifact_path must be under process/ (repo-relative) or a URL',
        hint: 'Set metadata.artifact_path to process/TASK-...md (committed in the PR) or a PR/GitHub URL.',
      }
    }
  }

  // PR integrity: validate commit SHA + changed_files against live PR head
  if (!nonCodeLane && reviewPacket?.pr_url) {
    const overrideFlag = metadataObj.pr_integrity_override === true
    if (overrideFlag) {
      // Emit escalation_bypass: agent is skipping the PR integrity gate
      const actor = (metadataObj.actor as string) || (metadataObj.assignee as string) || 'unknown'
      import('./trust-events.js').then(({ emitTrustEvent }) => {
        emitTrustEvent({
          agentId: actor,
          eventType: 'escalation_bypass',
          severity: 'warning',
          context: {
            prUrl: reviewPacket?.pr_url,
            overrideReason: metadataObj.pr_integrity_override_reason,
            actor,
          },
        })
      }).catch(() => {})
    }
    if (!overrideFlag) {
      const integrity = validatePrIntegrity({
        pr_url: reviewPacket!.pr_url!,
        packet_commit: reviewPacket!.commit ?? '',
        packet_changed_files: reviewPacket!.changed_files ?? [],
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

function enforceDuplicateClosureEvidenceGateForValidating(
  status: Task['status'] | undefined,
  metadata: unknown,
): { ok: true } | { ok: false; error: string; hint: string } {
  if (status !== 'validating') return { ok: true }

  const root = (metadata ?? {}) as Record<string, unknown>
  if (root.auto_closed !== true) return { ok: true }

  const reasonStr = typeof root.auto_close_reason === 'string'
    ? root.auto_close_reason.toLowerCase()
    : ''
  const reasonList = Array.isArray(root.auto_close_reasons)
    ? root.auto_close_reasons
      .map(r => (typeof r === 'string' ? r.toLowerCase() : ''))
      .filter(Boolean)
    : []

  const isDuplicate = reasonStr.includes('duplicate') || reasonList.some(r => r.includes('duplicate'))
  if (!isDuplicate) return { ok: true }

  const qaReviewPacket = (root.qa_bundle as any)?.review_packet as Record<string, unknown> | undefined

  const dupObj = (root.duplicate_of ?? root.duplicate ?? {}) as Record<string, unknown>

  const candidateTaskId = dupObj.task_id
    ?? root.duplicate_of_task_id
    ?? root.duplicate_of_task
    ?? root.duplicate_task_id

  const candidatePrUrl = dupObj.pr_url
    ?? qaReviewPacket?.pr_url
    ?? (root.review_handoff as any)?.pr_url
    ?? root.pr_url

  const candidateCommit = dupObj.commit
    ?? qaReviewPacket?.commit
    ?? (root.review_handoff as any)?.commit_sha
    ?? root.commit_sha
    ?? root.commit

  const proofCandidate = dupObj.proof
    ?? root.duplicate_proof
    ?? root.duplicate_proof_snippet
    ?? root.proof_snippet
    ?? root.proof

  const hasTaskId = typeof candidateTaskId === 'string' && /^task-[a-z0-9-]+$/i.test(candidateTaskId.trim())
  const hasPrUrl = typeof candidatePrUrl === 'string'
    && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:$|[/?#])/i.test(candidatePrUrl.trim())
  const hasCommit = typeof candidateCommit === 'string' && /^[a-f0-9]{7,40}$/i.test(candidateCommit.trim())

  const hasCanonical = hasTaskId || hasPrUrl || hasCommit

  const proof = typeof proofCandidate === 'string' ? proofCandidate.trim() : ''
  const placeholderProof = ['n/a', 'na', 'none', 'null', '-', 'tbd', 'todo', 'duplicate', 'dupe'].includes(proof.toLowerCase())
  const hasProof = proof.length >= 10 && !placeholderProof

  if (!hasCanonical || !hasProof) {
    const missing: string[] = []
    if (!hasCanonical) missing.push('canonical reference (task_id OR pr_url OR commit)')
    if (!hasProof) missing.push('proof snippet')

    return {
      ok: false,
      error: `Duplicate-closure validating gate: missing ${missing.join(' + ')}.`,
      hint: 'Set metadata.duplicate_of = { task_id?: "task-...", pr_url?: "https://github.com/.../pull/123", commit?: "abcdef1", proof: "Why this is a duplicate..." } (proof required). ' +
        'Alternatively provide metadata.qa_bundle.review_packet { pr_url, commit } plus metadata.duplicate_proof.',
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

    // ── Review handoff comment pointer repair/fill ──
    // If review_handoff exists, ensure comment_id points to a real comment.
    // We do this *server-side* to avoid phantom/unresolvable pointers.
    const rh = metadata.review_handoff as Record<string, unknown> | undefined
    if (rh && typeof rh === 'object' && !Array.isArray(rh)) {
      const rhAny = rh as any
      const commentId = typeof rhAny.comment_id === 'string' ? rhAny.comment_id.trim() : ''
      const all = taskManager.getTaskComments(existing.id, { includeSuppressed: true })
      const resolves = commentId ? all.some(c => c.id === commentId) : false

      if (!resolves) {
        // Prefer an explicit category tag; fallback to most recent comment by assignee.
        const assignee = (existing.assignee || '').trim().toLowerCase()
        const byHandoffCategory = all
          .filter(c => {
            const cat = String(c.category || '').toLowerCase()
            return cat === 'review_handoff' || cat === 'handoff'
          })

        const byAssignee = assignee
          ? all.filter(c => String(c.author || '').trim().toLowerCase() === assignee)
          : []

        const candidate = (byHandoffCategory.length > 0
          ? byHandoffCategory[byHandoffCategory.length - 1]
          : (byAssignee.length > 0 ? byAssignee[byAssignee.length - 1] : (all.length > 0 ? all[all.length - 1] : null)))

        if (candidate) {
          metadata.review_handoff = { ...rhAny, comment_id: candidate.id }
          metadata.review_handoff_comment_id_autofilled = {
            previous: commentId || null,
            next: candidate.id,
            at: now,
            strategy: byHandoffCategory.length > 0 ? 'category:review_handoff' : (byAssignee.length > 0 ? 'latest_assignee_comment' : 'latest_comment'),
          }
        }
      }
    }
  }

  if (previousStatus === 'validating' && nextStatus === 'doing' && !incomingReviewState) {
    metadata.review_state = 'needs_author'
    metadata.review_last_activity_at = now
  }

  // Cancelled tasks should not keep reviewer-decision metadata alive.
  // Otherwise downstream notifiers/dashboard rails can misclassify a
  // cancelled+unassigned task as still waiting on the former assignee/author.
  if (nextStatus === 'cancelled') {
    metadata.review_state = undefined
    metadata.reviewer_decision = undefined
    metadata.reviewer_notes = undefined
    metadata.reviewer_approved = undefined
    metadata.review_last_activity_at = undefined
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
  return isNonCodeLane(metadata)
}

/** Lanes that don't produce code artifacts (PRs, commits, changed_files) */
const NON_CODE_LANE_KEYWORDS = [
  'design', 'docs', 'documentation', 'content',
  'ops', 'operations', 'finance', 'legal', 'admin',
  'strategy', 'assessment', 'support', 'marketing',
  'back-office', 'backoffice', 'research', 'planning',
]

function isNonCodeLane(metadata: Record<string, unknown>): boolean {
  // Explicit top-level flag: metadata.non_code=true
  if (metadata.non_code === true) return true

  const lane = normalizeLaneValue(metadata.lane)
  if (NON_CODE_LANE_KEYWORDS.some(k => lane.includes(k))) return true

  const supports = normalizeLaneValue(metadata.supports)
  if (NON_CODE_LANE_KEYWORDS.some(k => supports.includes(k))) return true

  const qaBundle = (metadata.qa_bundle as Record<string, unknown> | undefined) || {}
  const qaLane = normalizeLaneValue(qaBundle.lane)
  if (NON_CODE_LANE_KEYWORDS.some(k => qaLane.includes(k))) return true

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
  // Check if the agent has a 'voice' or 'content' role (the "echo" role pattern)
  const agentRoleObj = getAgentRole(assignee)
  if (!agentRoleObj || (agentRoleObj.role !== 'voice' && agentRoleObj.role !== 'content' && agentRoleObj.role !== 'writer')) return false
  const role = agentRoleObj
  if (!role) return false

  const domain = inferTaskWorkDomain(task)
  if (domain === 'unknown' || domain === 'content') return false

  const metadata = (task.metadata || {}) as Record<string, unknown>
  if (hasExplicitReassignment(metadata)) return false

  // For Echo, anything classified outside content/docs voice lane gets flagged unless reassigned.
  return true
}

const reviewHandoffValidationStats = {
  failures: 0,
  lastFailureAt: 0,
  lastFailureTaskId: '',
  lastFailureError: '',
}

async function enforceReviewHandoffGateForValidating(
  status: Task['status'] | undefined,
  taskId: string,
  metadata: unknown,
): Promise<{ ok: true } | { ok: false; error: string; hint: string }> {
  if (status !== 'validating') return { ok: true }
  if (isTaskAutomatedRecurring(metadata)) return { ok: true }

  const root = (metadata as Record<string, unknown> | null) || {}

  // Duplicate/superseded tasks bypass review handoff — handled by QA bundle gate's lighter path
  const closeReason = typeof root.close_reason === 'string' ? root.close_reason.toLowerCase().trim() : ''
  if (closeReason === 'duplicate' || closeReason === 'superseded') return { ok: true }

  const parsed = ReviewHandoffSchema.safeParse(root.review_handoff ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Review handoff required: metadata.review_handoff must include task_id, artifact_path, known_caveats (and pr_url + commit_sha unless doc_only=true, config_only=true, or non_code=true).',
      hint: 'Example: { "review_handoff": { "task_id":"task-...", "artifact_path":"process/TASK-...md", "known_caveats":"none" } }. For non-code tasks: set non_code=true. Recommended: post the handoff comment with category="review_handoff" so the server stamps comment_id automatically.',
    }
  }

  const handoff = parsed.data as Record<string, any>
  if (handoff.task_id !== taskId) {
    return {
      ok: false,
      error: `Review handoff task_id mismatch: got "${handoff.task_id}", expected "${taskId}"`,
      hint: 'Set metadata.review_handoff.task_id to the exact task being transitioned.',
    }
  }

  // Ensure review_handoff.comment_id resolves to a real comment.
  // If missing (or stale), we repair it from existing comments; if none exist,
  // we create a server-authored pointer comment so reviewers always have a stable anchor.
  const commentsAll = taskManager.getTaskComments(taskId, { includeSuppressed: true })

  let commentId = typeof handoff.comment_id === 'string' ? handoff.comment_id.trim() : ''
  let handoffComment = commentId ? (commentsAll.find(c => c.id === commentId) || null) : null

  if (!handoffComment) {
    const byCategory = commentsAll.filter(c => {
      const cat = String(c.category || '').toLowerCase()
      return cat === 'review_handoff' || cat === 'handoff'
    })

    const candidate = byCategory.length > 0
      ? byCategory[byCategory.length - 1]
      : (commentsAll.length > 0 ? commentsAll[commentsAll.length - 1] : null)

    if (candidate) {
      commentId = candidate.id
      handoffComment = candidate
    } else {
      // No comments exist — create a stable anchor comment.
      const created = await taskManager.addTaskComment(
        taskId,
        'system',
        'Auto-handoff: review_handoff is recorded in metadata.review_handoff (no explicit handoff comment was posted).',
        { category: 'review_handoff', provenance: { kind: 'auto_review_handoff', source: 'validating_gate' } },
      )
      commentId = created.id
      handoffComment = created
    }

    // Persist repaired comment_id into the handoff metadata (server-side).
    ;(handoff as any).comment_id = commentId
    const rhObj = (root.review_handoff as any)
    if (rhObj && typeof rhObj === 'object' && !Array.isArray(rhObj)) {
      rhObj.comment_id = commentId
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

  // Artifact retrievability gate.
  // If the artifact isn't accessible from this node (repo / shared-workspace / GitHub fallback),
  // a reviewer on another host will almost certainly be blocked.
  const artifactPath = typeof handoff.artifact_path === 'string' ? handoff.artifact_path.trim() : ''
  const norm = normalizeArtifactPath(artifactPath)
  if (norm.rejected || !norm.normalized) {
    return {
      ok: false,
      error: `Validating gate: review_handoff.artifact_path is not a valid retrievable reference (${norm.rejectReason || 'invalid path'}).`,
      hint: 'Use either (a) a PR/GitHub URL, or (b) a repo-relative path (e.g. process/TASK-...md) that exists on the referenced PR/commit, or (c) put the full spec in the handoff comment and point artifact_path at a stable URL.',
    }
  }

  // URLs are assumed retrievable.
  if (/^https?:\/\//i.test(norm.normalized)) return { ok: true }

  // If the file is accessible locally (repo or shared-workspace), accept.
  const repoRoot = resolve(import.meta.dirname || process.cwd(), '..')
  const resolved = await resolveTaskArtifact(norm.normalized, repoRoot)
  if (resolved.accessible) return { ok: true }

  // GitHub fallback: if PR+commit are known and artifact is process/*, we can build a stable blob URL.
  const prUrl = (root as any).pr_url || (root as any).qa_bundle?.review_packet?.pr_url || (root as any).review_handoff?.pr_url
  const commitSha = (root as any).commit_sha || (root as any).commit || (root as any).qa_bundle?.review_packet?.commit || (root as any).review_handoff?.commit_sha
  if (typeof prUrl === 'string' && typeof commitSha === 'string' && norm.normalized.startsWith('process/')) {
    const blobUrl = buildGitHubBlobUrl(prUrl, commitSha, norm.normalized)
    if (blobUrl) return { ok: true }
  }

  // For non-code tasks, the handoff comment itself is considered the primary artifact.
  // We only require that comment_id resolves (handled above).
  if (nonCodeLane) return { ok: true }

  return {
    ok: false,
    error: 'Validating gate: review_handoff.artifact_path is not retrievable from repo/shared-workspace/GitHub fallback.',
    hint: 'Move the artifact into shared-workspace process/, or reference a PR+commit so GitHub blob fallback can resolve it (process/* only).',
  }
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
let sharedVault: SecretVault | null = null

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
  const matches = content.match(/@([\w][\w-]*[\w]|[\w]+)/g) || []
  return Array.from(new Set(matches.map(token => {
    const raw = token.slice(1).toLowerCase()
    // Resolve display names and aliases to canonical agent name
    return resolveAgentMention(raw) || raw
  }).filter(Boolean)))
}

function getOwnerHandlesFromEnv(): string[] {
  const raw = String(process.env.REFLECTT_OWNER_HANDLES || '').trim()
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

function isDirectedAtConfiguredOwner(content: string): boolean {
  const owners = getOwnerHandlesFromEnv()
  if (owners.length === 0) return false
  const mentions = extractMentions(content)
  return owners.some(o => mentions.includes(o))
}

function buildAutonomyWarnings(content: string): string[] {
  // If no owner handles are configured, keep this feature off by default.
  // reflectt-node must remain generic for customers.
  if (!isDirectedAtConfiguredOwner(content)) return []

  const normalized = content.toLowerCase()

  // Detect the specific anti-pattern: asking a human leader/operator what to do next.
  // Keep the pattern narrow to avoid false positives on legitimate asks.
  const approvalSeeking =
    /\b(what should i (do|work on) next|what(?:['’]?s) next(?: for me)?|what do i do next|what do you want me to do next|should i (do|work on)( [^\n\r]{0,80})? next)\b/i
  if (!approvalSeeking.test(normalized)) return []

  return [
    'Autonomy guardrail: avoid asking a human operator what to do next. Pull from the board (/tasks/next) or pick the highest-priority task and ship. Escalate only if you are blocked on a decision or permission that only a human can provide.',
  ]
}

type OwnerApprovalGate = {
  blockingError?: string
  hint?: string
}

function validateOwnerApprovalPing(content: string, from: string, channel?: string): OwnerApprovalGate {
  const owners = getOwnerHandlesFromEnv()
  if (owners.length === 0) return {}

  // Only gate messages directed at configured owner handles.
  if (!isDirectedAtConfiguredOwner(content)) return {}

  // Don't gate the owner/system talking to themselves.
  const sender = String(from || '').toLowerCase()
  if (owners.includes(sender) || sender === 'system') return {}

  const normalized = content.toLowerCase()

  // We only care about PR approval/merge requests.
  const looksLikePrRequest =
    /\b(approve|merge)\b/.test(normalized) &&
    (/(\bpr\b|pull request|github\.com\/[^\s]+\/pull\/[0-9]+|#\d+)/i.test(normalized))

  if (!looksLikePrRequest) return {}

  // Allow if the message explicitly explains why a human is required and references a task id.
  const hasTaskId = hasTaskIdReference(content)
  const hasPermissionsReason = /(permission|permissions|auth|authed|rights|cannot|can\s*not|can't|blocked|branch protection|required)/i.test(normalized)

  if (hasTaskId && hasPermissionsReason) return {}

  const normalizedChannel = (channel || 'general').toLowerCase()
  return {
    blockingError: `Don't ask a human operator to approve/merge PRs by default (channel=${normalizedChannel}). Ask the assigned reviewer, or merge it yourself. Escalate only when truly blocked by permissions/auth.`,
    hint: 'If a human is genuinely required: include task-<id> and a short permissions/auth reason (e.g., "no merge rights" / "branch protection"), plus the PR link.',
  }
}

// Coordination channels where @mentions are expected for handoffs.
// Messages without @mentions in these channels are likely dead handoffs.
// task-1774579523544-kgi9nohd4
const AUTO_ROUTE_COOLDOWN_MS = 10 * 60 * 1000 // 10 min per sender+channel
const autoRouteCooldowns = new Map<string, number>() // `${from}:${channel}` → last warned ts

const COORDINATION_CHANNELS = new Set([
  'general', 'shipping', 'reviews', 'blockers', 'problems', 'ops',
  'task-comments', 'task-notifications', 'decisions',
])

/**
 * Check if a message in a coordination channel lacks @mentions.
 * Returns a warning + auto-routes to main agent if so.
 * Does NOT affect human/user chats or non-coordination channels.
 */
function buildNoMentionWarning(
  content: string,
  channel: string | undefined,
  from: string,
): { warning?: string; autoRouted?: string } {
  if (!channel || !COORDINATION_CHANNELS.has(channel)) return {}
  // Don't warn system or dashboard messages
  if (from === 'system' || from === 'dashboard') return {}
  const mentions = extractMentions(content)
  if (mentions.length > 0) return {}
  // Cooldown: only warn once per sender+channel per AUTO_ROUTE_COOLDOWN_MS
  // Prevents repeated status posts (e.g. "Standing by — non-dev lane.") from
  // flooding every agent's inbox with ⚠️ auto-route noise.
  const cooldownKey = `${from}:${channel}`
  const lastWarned = autoRouteCooldowns.get(cooldownKey) ?? 0
  if (Date.now() - lastWarned < AUTO_ROUTE_COOLDOWN_MS) return {}
  autoRouteCooldowns.set(cooldownKey, Date.now())
  // No @mentions in a coordination channel — this is a dead handoff
  // Find the main agent (first in roster, or kai as fallback)
  const roster = presenceManager.getAllPresence()
  const mainAgent = roster.find(r => (r as any).role === 'coordinator')?.agent
    || roster[0]?.agent
    || getAgentRoles()[0]?.name
    || undefined
  return {
    warning: `No @mention in #${channel} — this message won't trigger action from any agent. Consider adding @${mainAgent} or the relevant owner. Auto-routing visibility to @${mainAgent}.`,
    autoRouted: mainAgent,
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

  // Multipart file uploads (50MB limit)
  const fastifyMultipart = await import('@fastify/multipart')
  const { MAX_SIZE_BYTES: _multipartMax } = await import('./files.js')
  await app.register(fastifyMultipart.default, { limits: { fileSize: _multipartMax } })

  // Normalize error responses to a consistent envelope
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload
    }

    const body = payload as Record<string, unknown>
    const hasError = typeof body.error === 'string'
    const alreadyEnvelope = typeof body.success === 'boolean' && hasError
    if (!hasError) return payload
    // If already a well-formed envelope, pass through (avoid stripping extra fields)
    if (alreadyEnvelope && typeof body.code === 'string' && typeof body.status === 'number') return payload

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
    if (body.tombstone !== undefined) envelope.tombstone = body.tombstone
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
    trackRequest(request.method, request.url, reply.statusCode, request.headers['user-agent'])

    // Compliance detector: flag state-read-before-assertion violations
    try {
      complianceProcessRequest(
        request.method,
        request.url,
        reply.statusCode,
        (request.query as Record<string, unknown>) ?? {},
        request.body,
        request.headers as Record<string, string | string[] | undefined>,
      )
    } catch { /* never let compliance logging break a request */ }
    
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

  // ── Global 404: markdown-formatted endpoint discovery ────────────────
  app.setNotFoundHandler(async (request, reply) => {
    const method = request.method
    const url = request.url.split('?')[0]
    const wantsJson = (request.headers.accept || '').includes('application/json')

    if (wantsJson) {
      reply.code(404).header('content-type', 'application/json; charset=utf-8')
      return {
        success: false,
        error: 'Not Found',
        code: 'NOT_FOUND',
        status: 404,
        hint: 'Try GET /capabilities for endpoint discovery, or GET /docs for full reference.',
        requested: `${method} ${url}`,
      }
    }

    const md = [
      `# 404 — \`${method} ${url}\` not found`,
      '',
      `reflectt-node v${BUILD_VERSION} does not have this endpoint.`,
      '',
      '## Quick discovery',
      '',
      '| Method | Endpoint | Description |',
      '|--------|----------|-------------|',
      '| GET | `/capabilities` | **Start here.** All endpoints grouped by purpose |',
      '| GET | `/heartbeat/:agent` | Single compact heartbeat (~200 tokens) |',
      '| GET | `/bootstrap/heartbeat/:agent` | Generate optimal HEARTBEAT.md for your agent |',
      '| POST | `/bootstrap/team` | Recommend team composition + initial tasks + heartbeat configs |',
      '| GET | `/manage/status` | Remote management: unified status (auth-gated) |',
      '| GET | `/doctor` | Structured host diagnosis with recovery suggestions |',
      '| GET | `/health` | System health + version + stats |',
      '| GET | `/version` | Current version + update availability |',
      '',
      '## Common endpoints',
      '',
      '**Tasks:** `GET /tasks`, `GET /tasks/next?agent=NAME`, `GET /tasks/active?agent=NAME`',
      '**Chat:** `GET /chat/messages`, `POST /chat/messages`, `GET /chat/context/:agent`',
      '**Inbox:** `GET /inbox/:agent`',
      '**Insights:** `GET /insights`, `GET /loop/summary`',
      '**Agent:** `GET /me/:agent`, `GET /heartbeat/:agent`',
      '',
      '> **Tip:** Add `?compact=true` to most GET endpoints to reduce response size by 50-75%.',
      '',
      '> **New here?** Start with `GET /capabilities` — it lists every endpoint with hints.',
    ].join('\n')

    reply.code(404).header('content-type', 'text/markdown; charset=utf-8')
    return md
  })

  // ── Global error handler: markdown diagnostics for 500s ──────────────
  app.setErrorHandler(async (error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode || 500
    const wantsJson = (request.headers.accept || '').includes('application/json')

    if (status < 500) {
      // 4xx errors: pass through to preSerialization envelope
      reply.code(status)
      return { error: error.message, status }
    }

    // Log 500s
    appendStoredLog({
      level: 'error',
      timestamp: Date.now(),
      message: error.message,
      status,
      code: 'INTERNAL_ERROR',
      method: request.method,
      url: request.url,
    }).catch(() => {})

    // Report to Sentry
    try {
      const { captureException } = await import('./sentry.js')
      captureException(error, { method: request.method, url: request.url, status })
    } catch { /* non-blocking */ }

    if (wantsJson) {
      reply.code(status).header('content-type', 'application/json; charset=utf-8')
      return {
        success: false,
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        status,
        hint: 'Check GET /health for system status. If persistent, check server logs.',
      }
    }

    const md = [
      `# 500 — Internal Server Error`,
      '',
      `**Request:** \`${request.method} ${request.url}\``,
      '',
      '## What to check',
      '',
      '1. **System health:** `GET /health` — verify status is "ok"',
      '2. **Error logs:** `GET /logs?level=error&limit=5` — recent errors',
      '3. **Retry** — transient errors often resolve on retry',
      '',
      '## Need help?',
      '',
      '- `GET /capabilities` — verify endpoint exists and check required params',
      '- `GET /docs` — full API reference with request/response schemas',
    ].join('\n')

    reply.code(status).header('content-type', 'text/markdown; charset=utf-8')
    return md
  })

  // Load agent roles from YAML config (or fall back to built-in defaults)
  loadAgentRoles()
  startConfigWatch()


  // Initialize secret vault
  const hostId = process.env.REFLECTT_HOST_ID || process.env.HOSTNAME || 'unknown'
  const vault = new SecretVault(REFLECTT_HOME, hostId)
  try {
    vault.init()
    sharedVault = vault
    console.log(`[Vault] Initialized (${vault.getStats().secretCount} secrets)`)
    initGitHubActorAuth(vault)
  } catch (err) {
    console.error('[Vault] Failed to initialize:', (err as Error).message)
  }

  // Fetch GitHub installation token from cloud API (if GitHub App connected on team)
  startGitHubTokenRefresh().catch(err => console.warn('[GitHubCloudToken] Init error:', err))

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

  // Mention rescue fallback (if user mentions trio and no response arrives)
  const mentionRescueTimer = setInterval(() => {
    if (isQuietHours(Date.now())) return
    healthMonitor.runMentionRescueTick().catch(() => {})
  }, 30 * 1000)
  mentionRescueTimer.unref()

  // Validating-stall nudge (single DM to reviewer after 30m with no formal review action)
  const validatingNudgeTimer = setInterval(() => {
    if (isQuietHours(Date.now())) return
    healthMonitor.runValidatingNudgeTick().catch(() => {})
  }, 5 * 60 * 1000) // check every 5 minutes
  validatingNudgeTimer.unref()

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
    status: 'unknown' as 'idle' | 'healthy' | 'at_risk' | 'broken' | 'unknown',
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
      reflectionPipelineHealth.status = 'idle'
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
    const now = Date.now()
    if (isQuietHours(now)) return

    // Persist tick time so /health/system can prove this monitor is actually firing.
    recordSystemLoopTick('reflection_pipeline', now)

    const health = computeReflectionPipelineHealth(now)

    // Alert when reflections are flowing but insights remain zero past threshold
    if (health.status === 'broken') {
      const now = Date.now()
      const cooldownMs = 30 * 60_000 // 30 minutes
      if (now - reflectionPipelineHealth.lastAlertAt >= cooldownMs) {
        reflectionPipelineHealth.lastAlertAt = now
        chatManager.sendMessage({
          channel: 'general',
          from: 'system',
          content: `🚨 Reflection pipeline broken: ${health.recentReflections} reflections in last ${health.windowMin}m but 0 recentInsightActivity (created+updated). @link @sage investigate ingestion/listener path.`,
        }).catch(() => {})
      }
    }
  }, 60 * 1000)
  reflectionPipelineTimer.unref()

  // Webhook payload retention: purge processed payloads older than 90 days.
  // Runs once at startup then every 24 hours. Only processes payloads with processed=1.
  const WEBHOOK_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
  const WEBHOOK_RETENTION_DAYS = parseInt(process.env.WEBHOOK_RETENTION_DAYS ?? '90', 10)
  const runWebhookPurge = () => {
    import('./webhook-storage.js').then(({ purgeOldPayloads }) => {
      try {
        const deleted = purgeOldPayloads(WEBHOOK_RETENTION_DAYS)
        if (deleted > 0) {
          console.log(`[webhook-purge] Purged ${deleted} processed payload(s) older than ${WEBHOOK_RETENTION_DAYS} days`)
        }
      } catch { /* non-fatal — storage may not be initialised yet on first tick */ }
    }).catch(() => { /* module unavailable — skip */ })
  }
  runWebhookPurge() // eager first run on startup
  const webhookPurgeTimer = setInterval(runWebhookPurge, WEBHOOK_PURGE_INTERVAL_MS)
  webhookPurgeTimer.unref()

  // Sweep stale inbox delivery dedup records every 15 minutes to prevent unbounded growth
  const inboxDeliveryDedupSweep = setInterval(sweepDeliveryRecords, 15 * 60 * 1000)
  inboxDeliveryDedupSweep.unref()

  // Daily digest: surface active tasks with empty or placeholder done_criteria.
  // Warns via #ops — does not hard-error (legacy tasks may predate the gate).
  const DONE_CRITERIA_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000
  const DONE_CRITERIA_PLACEHOLDER_DIGEST_RE = /^\s*(tbd|todo|to-do|to do|placeholder|n\/a|na|none|fix later|coming soon|see description|wip)\s*$/i
  const runDoneCriteriaDigest = () => {
    try {
      const active = taskManager.listTasks({}).filter(t =>
        !['done', 'cancelled', 'resolved_externally'].includes(t.status)
      )
      const missing = active.filter(t =>
        !t.done_criteria
        || t.done_criteria.length === 0
        || t.done_criteria.every(c => DONE_CRITERIA_PLACEHOLDER_DIGEST_RE.test(c))
      )
      if (missing.length === 0) return
      const lines = missing.map(t => `• \`${t.id}\` [${t.status}] ${t.title} (@${t.assignee ?? 'unassigned'})`)
      chatManager.sendMessage({
        channel: 'ops',
        from: 'system',
        content: `📋 **Done-criteria digest** — ${missing.length} active task${missing.length === 1 ? '' : 's'} missing verifiable done_criteria:\n${lines.join('\n')}\nAdd at least 1 concrete criterion to each before moving to validating.`,
      }).catch(() => {})
    } catch { /* non-fatal */ }
  }
  runDoneCriteriaDigest() // eager run on startup to surface existing debt immediately
  const doneCriteriaDigestTimer = setInterval(runDoneCriteriaDigest, DONE_CRITERIA_DIGEST_INTERVAL_MS)
  doneCriteriaDigestTimer.unref()

  // Approval card expiry sweep — run on startup to prune stale cards before any canvas queries.
  // Undecided approval_requested/review_requested events older than 24h get a synthetic
  // rejection event, preventing them from reappearing after node restarts.
  import('./agent-runs.js').then(({ sweepExpiredApprovalCards }) => {
    const pruned = sweepExpiredApprovalCards()
    if (pruned > 0) console.log(`[ApprovalSweep] Pruned ${pruned} expired approval card(s) on startup`)
  }).catch(err => console.warn('[ApprovalSweep] Startup sweep failed:', err))

  // Approval card restore — re-emit canvas_push for undecided validating tasks on startup.
  // Ensures approval cards survive node restarts without re-emitting already-decided cards.
  const APPROVAL_CARD_TTL_MS = 24 * 60 * 60 * 1000 // 24h
  try {
    const validatingTasks = taskManager.listTasks({ status: 'validating' })
    const cutoff = Date.now() - APPROVAL_CARD_TTL_MS
    // Known agent names — agent-to-agent reviews should not produce canvas approval cards
    const KNOWN_AGENTS_RESTORE = new Set(getAgentRoles().map(r => r.name))
    for (const task of validatingTasks) {
      const meta = (task.metadata ?? {}) as Record<string, unknown>
      // Skip if already decided
      if (meta.review_decided === true || meta.reviewer_approved === true || meta.review_state === 'approved' || meta.review_state === 'rejected') continue
      // Skip agent-to-agent reviews — only human-required approvals show on canvas
      const reviewerId = (task.reviewer ?? '').toLowerCase().trim()
      if (reviewerId && KNOWN_AGENTS_RESTORE.has(reviewerId)) continue
      // Skip if card is older than TTL (sweep handled it)
      const enteredValidatingAt = typeof meta.entered_validating_at === 'number' ? meta.entered_validating_at : task.updatedAt
      if (enteredValidatingAt < cutoff) continue
      const prUrl = (meta.review_handoff as Record<string, unknown> | undefined)?.pr_url as string | undefined
        ?? (meta.qa_bundle as Record<string, unknown> | undefined)?.pr_url as string | undefined
      const assigneeId = (task.assignee ?? '').toLowerCase()
      const restoreNow = Date.now()
      const restoreData = {
        type: 'approval_requested',
        agentId: assigneeId,
        agentColor: getIdentityColor(assigneeId, '#94a3b8'),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          reviewer: task.reviewer,
          prUrl: prUrl || undefined,
          priority: task.priority,
          restored: true, // mark as restored on restart
        },
        ttl: 120000,
        t: restoreNow,
      }
      eventBus.emit({
        id: `approval-restore-${restoreNow}-${task.id.slice(-6)}`,
        type: 'canvas_push',
        timestamp: restoreNow,
        data: restoreData,
      })
      queueCanvasPushEvent(restoreData)
    }
  } catch (err) {
    console.warn('[ApprovalRestore] Failed to restore approval cards on startup:', (err as Error).message)
  }

  // Load unified policy config (file + env overrides)
  const policy = policyManager.load()

  // Board health execution worker — config from policy
  boardHealthWorker.updateConfig(policy.boardHealth)
  boardHealthWorker.start()

  // Notification delivery worker — pushes pending agent-notifications to active agents
  const { NotificationDeliveryWorker } = await import('./notification-worker.js')
  const notificationWorker = new NotificationDeliveryWorker(
    getDb,
    presenceManager,
    async (opts) => { await chatManager.sendMessage(opts) },
  )
  notificationWorker.start()

  // Activate noise budget enforcement — the 24h canary period is complete.
  // Canary mode (log-only) is still the default in case of fresh installs,
  // but on a running server we want real duplicate suppression.
  noiseBudgetManager.activateEnforcement()

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

  // ── Warm boot detection ──
  // Detect if this is a cold start or warm boot (recovering from restart)
  try {
    detectWarmBoot(getDb())
  } catch (err) {
    console.warn('[Server] Warm boot detection failed:', (err as Error).message)
  }

  // Insight:promoted → auto-task bridge (severity-aware)
  startInsightTaskBridge()

  // Team pulse: proactive status broadcast (trust-gap mitigation)
  startTeamPulse()

  // Shipped-artifact auto-heartbeat → #general on validating/done with artifact_path
  startShippedHeartbeat()

  // Team context auto-writer — writes team facts to TEAM-CONTEXT.md on key events
  // task-1774672289270-9qhb17cgk
  startTeamContextWriter({
    reflecttHome: REFLECTT_HOME,
    eventBus,
    taskManager: taskManager as any,
  })

  // Calendar reminder engine — polls for pending reminders every 30s
  startReminderEngine()

  // Deploy monitor — alert within 5m when production deploys fail (Vercel + health URL)
  startDeployMonitor()

  // OpenClaw usage sync — ingest token/cost data from ~/.openclaw/agents sessions
  // Bridges agents not reporting via node heartbeat into the cloud usage dashboard
  startOpenClawUsageSync()

  app.addHook('onClose', async () => {
    clearInterval(idleNudgeTimer)
    clearInterval(cadenceWatchdogTimer)
    clearInterval(mentionRescueTimer)
    boardHealthWorker.stop()
    stopInsightTaskBridge()
    stopShippedHeartbeat()
    stopTeamPulse()
    stopReminderEngine()
    stopDeployMonitor()
    stopOpenClawUsageSync()
    stopKeepalive()
    stopSelfKeepalive()
    wsHeartbeat.stop()
  })

  // Canvas state map — forward reference for route handlers that emit before the canvas block.
  // Populated in the canvas state section below. Route handlers (e.g. PATCH /tasks) access
  // this via closure to synchronously update orb state when task status transitions occur.
  // eslint-disable-next-line prefer-const
  let _canvasStateMap: Map<string, { state: string; sensors: string | null; payload: unknown; updatedAt: number; lastMessage?: { content: string; timestamp: number } }> | null = null

  // Health check
  // Ultra-lightweight ping — no DB, no stats, instant response.
  // Use for keepalive cron triggers (Cloudflare, load balancers, uptime monitors).
  app.get('/health/ping', async () => {
    return { status: 'ok', uptime_seconds: Math.round((Date.now() - BUILD_STARTED_AT) / 1000), ts: Date.now() }
  })

  // Watchdog: richer keepalive that surfaces recovery state for monitoring dashboards.
  // Returns cold_start flag, task/chat stats, and remediation hints when unhealthy.
  app.get('/health/watchdog', async () => {
    const uptimeSeconds = Math.round((Date.now() - BUILD_STARTED_AT) / 1000)
    const coldStart = uptimeSeconds < 60
    const taskStats = taskManager.getStats({})
    const chatStats = chatManager.getStats()
    const healthy = !coldStart || uptimeSeconds > 10 // Allow 10s grace for init

    return {
      status: healthy ? 'ok' : 'recovering',
      uptime_seconds: uptimeSeconds,
      cold_start: coldStart,
      ts: Date.now(),
      stats: {
        tasks: { total: taskStats.total, byStatus: taskStats.byStatus },
        chat: { rooms: chatStats.rooms, totalMessages: chatStats.totalMessages },
      },
      ...(coldStart ? {
        remediation: 'Instance recently restarted. If this happens frequently, add a keepalive cron — see docs/KEEPALIVE.md',
      } : {}),
      boot_info: getBootInfo(),
    }
  })

  app.get('/health', async (request) => {
    const query = request.query as Record<string, string>
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    const uptimeSeconds = Math.round((Date.now() - BUILD_STARTED_AT) / 1000)
    return {
      status: 'ok',
      version: BUILD_VERSION,
      commit: BUILD_COMMIT,
      uptime_seconds: uptimeSeconds,
      pid: process.pid,
      nodeVersion: process.version,
      port: Number(process.env['PORT'] || process.env['REFLECTT_PORT'] || 4445),
      cold_start: uptimeSeconds < 60, // Flag recent restarts for monitoring
      openclaw: openclawConfig.gatewayToken
        ? { status: 'configured', gateway: openclawConfig.gatewayUrl }
        : {
            status: 'not configured',
            hint: 'Set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN environment variables, or run: openclaw gateway token',
            docs: 'https://app.reflectt.ai',
          },
      chat: chatManager.getStats(),
      tasks: taskManager.getStats({ includeTest }),
      inbox: inboxManager.getStats(),
      request_counts: (() => {
        const m = getRequestMetrics()
        return { total: m.total, errors: m.errors, rps: m.rps, byGroup: m.byGroup, rolling: m.rolling }
      })(),
      timestamp: Date.now(),
    }
  })

  // ─── Request errors — last N errors for launch-day debugging ───
  app.get('/health/chat', async () => {
    const stats = chatManager.getStats()
    return {
      totalMessages: stats.totalMessages,
      rooms: stats.rooms,
      subscribers: stats.subscribers,
      drops: stats.drops,
    }
  })

  app.get('/health/errors', async () => {
    const m = getRequestMetrics()
    return {
      total_errors: m.errors,
      total_requests: m.total,
      error_rate: m.total > 0 ? Math.round((m.errors / m.total) * 10000) / 100 : 0,
      rolling: m.rolling,
      recent: m.recentErrors.slice(0, 20),
      top_buckets: m.topErrorBuckets,
      timestamp: Date.now(),
    }
  })

  // ── Version summary — used by cloud dashboard + ops tooling ──────────────
  app.get('/health/version', async () => {
    return {
      version: BUILD_VERSION,
      commit: BUILD_COMMIT,
      uptime_ms: Date.now() - BUILD_STARTED_AT,
      host_id: process.env.REFLECTT_HOST_ID ?? process.env.HOSTNAME ?? 'unknown',
      node_env: process.env.NODE_ENV ?? 'production',
    }
  })

  // ── Host status — single-call operator diagnostic endpoint ───────────────
  // Returns everything needed to diagnose a managed host without SSH.
  // Covers: bootstrap, agents, tasks, channel, errors.
  app.get('/host/status', async () => {
    const now = Date.now()

    // Bootstrap markers
    const firstBootMarker = join(DATA_DIR, '.first-boot-done')
    const teamRolesPath = join(REFLECTT_HOME, 'TEAM-ROLES.yaml')
    const hasBootstrapped = existsSync(firstBootMarker)
    const hasTeamRoles = existsSync(teamRolesPath)
    const teamIntentPath = join(DATA_DIR, 'TEAM_INTENT.md')
    const hasTeamIntent = existsSync(teamIntentPath)

    // Bootstrap task status
    const allTasks = taskManager.listTasks({})
    const bootstrapTask = allTasks.find(t =>
      t.priority === 'P0' && t.assignee === 'main' && t.title?.toLowerCase().includes('bootstrap')
    )

    // Agent presence
    const presences = presenceManager.getAllPresence()
    const ONLINE_THRESHOLD_MS = 5 * 60 * 1000 // 5 min
    const agentSummary = presences.map(p => ({
      agent: p.agent,
      status: p.last_active && (now - p.last_active) < ONLINE_THRESHOLD_MS ? 'online' : 'offline',
      last_active: p.last_active ?? null,
      last_active_ago_s: p.last_active ? Math.round((now - p.last_active) / 1000) : null,
    }))

    // Task queue
    const taskStats = taskManager.getStats()

    // Channel / cloud
    const channelOk = !!openclawConfig.gatewayToken

    // Error rate
    const metrics = getRequestMetrics()
    const errorRate = metrics.total > 0
      ? Math.round((metrics.errors / metrics.total) * 10000) / 100
      : 0

    // Derive bootstrap status + stall reason
    const bootstrapComplete =
      (hasBootstrapped && hasTeamRoles) ||
      bootstrapTask?.status === 'done' ||
      (!bootstrapTask && hasTeamRoles)

    const bootstrapStatus = bootstrapComplete
      ? 'complete'
      : bootstrapTask
      ? bootstrapTask.status  // todo / doing / validating
      : 'not_started'

    let bootstrapStalledReason: string | null = null
    if (!bootstrapComplete) {
      if (!hasTeamIntent && !bootstrapTask) {
        bootstrapStalledReason = 'no_team_intent_and_no_bootstrap_task'
      } else if (hasTeamIntent && !bootstrapTask) {
        bootstrapStalledReason = 'team_intent_present_but_no_bootstrap_task_created'
      } else if (bootstrapTask && bootstrapTask.status === 'todo') {
        bootstrapStalledReason = 'bootstrap_task_not_started'
      } else if (bootstrapTask && bootstrapTask.status === 'doing') {
        bootstrapStalledReason = 'bootstrap_task_in_progress'
      } else if (!hasTeamRoles) {
        bootstrapStalledReason = 'team_roles_yaml_not_written'
      }
    }

    // Diagnosis: derive actionable code + next step
    const agentsOnline = agentSummary.filter(a => a.status === 'online').length
    let diagnosisCode: string
    let diagnosisAction: string
    if (!channelOk) {
      diagnosisCode = 'CHANNEL_NOT_CONFIGURED'
      diagnosisAction = 'Set OPENCLAW_GATEWAY_URL and OPENCLAW_GATEWAY_TOKEN, then restart the node'
    } else if (!bootstrapComplete && bootstrapStalledReason === 'team_intent_present_but_no_bootstrap_task_created') {
      diagnosisCode = 'BOOTSTRAP_STALLED_NO_TASK'
      diagnosisAction = 'Bootstrap task was never created — restart the node to re-trigger first-boot detection'
    } else if (!bootstrapComplete && bootstrapTask && bootstrapTask.status === 'todo') {
      diagnosisCode = 'BOOTSTRAP_NOT_STARTED'
      diagnosisAction = 'Bootstrap task exists but no agent has claimed it — check that the main agent is running and heartbeating'
    } else if (!bootstrapComplete && bootstrapTask) {
      diagnosisCode = 'BOOTSTRAP_IN_PROGRESS'
      diagnosisAction = 'Bootstrap is running — wait or check if the main agent is stuck'
    } else if (!bootstrapComplete) {
      diagnosisCode = 'BOOTSTRAP_NOT_STARTED'
      diagnosisAction = 'No agents or tasks found — check that TEAM_INTENT is set and restart the node'
    } else if (agentsOnline === 0) {
      diagnosisCode = 'NO_AGENTS_ONLINE'
      diagnosisAction = 'Bootstrap complete but no agents active — check gateway connection and heartbeat config'
    } else if (errorRate >= 10) {
      diagnosisCode = 'HIGH_ERROR_RATE'
      diagnosisAction = `Error rate ${errorRate}% — check /health/errors for recent failures`
    } else {
      diagnosisCode = 'HEALTHY'
      diagnosisAction = 'No action needed'
    }

    const healthy = diagnosisCode === 'HEALTHY'

    return {
      healthy,
      timestamp: now,
      host: {
        id: process.env.REFLECTT_HOST_ID ?? process.env.HOSTNAME ?? 'unknown',
        node_url: process.env.REFLECTT_NODE_URL ?? null,
        version: BUILD_VERSION,
        uptime_s: Math.round((now - BUILD_STARTED_AT) / 1000),
      },
      bootstrap: {
        status: bootstrapStatus,
        complete: bootstrapComplete,
        first_boot_marker: hasBootstrapped,
        team_roles_yaml: hasTeamRoles,
        team_intent_seeded: hasTeamIntent,
        stalled_reason: bootstrapStalledReason,
        task: bootstrapTask
          ? { id: bootstrapTask.id, status: bootstrapTask.status, title: bootstrapTask.title }
          : null,
      },
      agents: {
        online: agentsOnline,
        total: agentSummary.length,
        roster: agentSummary,
      },
      tasks: {
        todo: taskStats.byStatus?.todo ?? 0,
        doing: taskStats.byStatus?.doing ?? 0,
        validating: taskStats.byStatus?.validating ?? 0,
        done: taskStats.byStatus?.done ?? 0,
        total: taskStats.total ?? 0,
      },
      channel: {
        openclaw_configured: channelOk,
        gateway_url: openclawConfig.gatewayUrl ?? null,
      },
      errors: {
        rate_pct: errorRate,
        total_errors: metrics.errors,
        total_requests: metrics.total,
      },
      diagnosis: {
        code: diagnosisCode,
        next_action: diagnosisAction,
      },
    }
  })

  // ── Doctor: structured host diagnosis with recovery suggestions ─────────────
  // Single-call diagnostic for operators. No SSH required.
  // Covers: bootstrap stalls, crash loops, agent health, channel, errors.
  app.get('/doctor', async () => {
    const now = Date.now()
    const uptimeMs = now - BUILD_STARTED_AT
    const uptimeMin = uptimeMs / 60000

    // Bootstrap state
    const firstBootMarker = join(DATA_DIR, '.first-boot-done')
    const teamRolesPath = join(REFLECTT_HOME, 'TEAM-ROLES.yaml')
    const hasBootstrapped = existsSync(firstBootMarker)
    const hasTeamRoles = existsSync(teamRolesPath)
    const teamIntentPath = join(DATA_DIR, 'TEAM_INTENT.md')
    const hasTeamIntent = existsSync(teamIntentPath)
    const allTasks = taskManager.listTasks({})
    const bootstrapTask = allTasks.find(t =>
      t.priority === 'P0' && t.assignee === 'main' && t.title?.toLowerCase().includes('bootstrap')
    )
    const bootstrapStatus = hasBootstrapped && hasTeamRoles
      ? 'complete'
      : bootstrapTask?.status === 'done'
      ? 'complete'
      : bootstrapTask
      ? bootstrapTask.status
      : hasTeamRoles
      ? 'complete'
      : 'not_started'

    // Agent health
    const presences = presenceManager.getAllPresence()
    const ONLINE_THRESHOLD_MS = 5 * 60 * 1000
    const agentSummary = presences.map(p => ({
      agent: p.agent,
      status: p.last_active && (now - p.last_active) < ONLINE_THRESHOLD_MS ? 'online' : 'offline',
      last_active_ago_s: p.last_active ? Math.round((now - p.last_active) / 1000) : null,
    }))
    const agentsOnline = agentSummary.filter(a => a.status === 'online').length

    // Crash loop detection: uptime < 5 min + high error rate
    const metrics = getRequestMetrics()
    const errorRate = metrics.total > 0
      ? Math.round((metrics.errors / metrics.total) * 10000) / 100
      : 0
    const isCrashLooping = uptimeMin < 5 && errorRate > 5

    // Bootstrap stall: bootstrap task exists but has been in non-done state for > 30 min
    let bootstrapStalled = false
    let bootstrapStallAgeMin = 0
    if (bootstrapTask && bootstrapStatus !== 'complete') {
      const updatedAt = bootstrapTask.updatedAt ?? bootstrapTask.createdAt ?? now
      const ageMin = (now - updatedAt) / 60000
      if (ageMin > 30 && bootstrapTask.status === 'doing') {
        bootstrapStalled = true
        bootstrapStallAgeMin = Math.round(ageMin)
      }
    }

    // Channel / cloud
    const channelOk = !!openclawConfig.gatewayToken

    // Task queue
    const taskStats = taskManager.getStats()

    // Build diagnoses
    const diagnoses: Array<{ area: string; status: string; message: string; recovery?: string }> = []

    // Bootstrap diagnosis
    if (bootstrapStatus === 'complete') {
      diagnoses.push({ area: 'bootstrap', status: 'pass', message: 'Bootstrap complete, team roles configured' })
    } else if (bootstrapStalled) {
      diagnoses.push({
        area: 'bootstrap',
        status: 'fail',
        message: `Bootstrap stalled — main agent stuck on "${bootstrapTask?.title}" for ${bootstrapStallAgeMin} min`,
        recovery: 'Check main agent heartbeat for blockers. Check /tasks/' + (bootstrapTask?.id ?? '') + ' for task-level issues.',
      })
    } else if (bootstrapStatus === 'not_started') {
      diagnoses.push({
        area: 'bootstrap',
        status: 'fail',
        message: 'Bootstrap not started — no TEAM_INTENT found',
        recovery: 'Set REFLECTT_TEAM_INTENT env var or run provisioning flow.',
      })
    } else if (bootstrapStatus === 'todo') {
      diagnoses.push({
        area: 'bootstrap',
        status: 'warn',
        message: 'Bootstrap task created but not yet claimed — check that the main agent is running and heartbeating',
        recovery: 'Verify main agent is active: GET /health/agents. If offline, check gateway connection.',
      })
    } else {
      diagnoses.push({
        area: 'bootstrap',
        status: 'warn',
        message: `Bootstrap in progress: ${bootstrapStatus}`,
      })
    }

    // Crash loop diagnosis
    if (isCrashLooping) {
      diagnoses.push({
        area: 'crash_loop',
        status: 'fail',
        message: `Possible crash loop — node uptime ${Math.round(uptimeMin)}min but error rate ${errorRate}%`,
        recovery: 'Check /health/errors for recent errors. Check Docker/Fly.io logs for panic traces.',
      })
    } else if (uptimeMin < 5) {
      diagnoses.push({
        area: 'crash_loop',
        status: 'warn',
        message: `Node recently restarted — uptime ${Math.round(uptimeMin)} min`,
      })
    } else {
      diagnoses.push({ area: 'crash_loop', status: 'pass', message: 'No crash loop detected' })
    }

    // Agent health diagnosis
    if (agentsOnline > 0) {
      diagnoses.push({
        area: 'agents',
        status: 'pass',
        message: `${agentsOnline} agent(s) online`,
      })
    } else if (bootstrapStatus === 'complete') {
      diagnoses.push({
        area: 'agents',
        status: 'fail',
        message: 'No agents online but bootstrap complete',
        recovery: 'Check OpenClaw gateway status. Verify agents can reach /heartbeat/:agent.',
      })
    } else {
      diagnoses.push({
        area: 'agents',
        status: 'warn',
        message: 'No agents online yet (bootstrap in progress)',
      })
    }

    // Channel diagnosis
    if (channelOk) {
      diagnoses.push({ area: 'channel', status: 'pass', message: 'OpenClaw gateway configured' })
    } else {
      diagnoses.push({
        area: 'channel',
        status: 'warn',
        message: 'OpenClaw gateway not configured — agent-to-agent messaging uses REST relay',
      })
    }

    // Error rate diagnosis
    if (errorRate < 1) {
      diagnoses.push({ area: 'errors', status: 'pass', message: `Error rate ${errorRate}%` })
    } else if (errorRate < 10) {
      diagnoses.push({
        area: 'errors',
        status: 'warn',
        message: `Error rate ${errorRate}% — elevated but not critical`,
        recovery: 'Check /health/errors for details.',
      })
    } else {
      diagnoses.push({
        area: 'errors',
        status: 'fail',
        message: `Error rate ${errorRate}% — high`,
        recovery: 'Check /health/errors for top error buckets.',
      })
    }

    // Compute overall
    const hasFailure = diagnoses.some(d => d.status === 'fail')
    const healthy = !hasFailure && agentsOnline > 0

    // Next action: first failure recovery
    const firstFail = diagnoses.find(d => d.status === 'fail')
    const nextAction = firstFail?.recovery || null

    return {
      healthy,
      timestamp: now,
      diagnoses,
      next_action: nextAction,
      stats: {
        uptime_min: Math.round(uptimeMin),
        agents_online: agentsOnline,
        agents_total: agentSummary.length,
        task_queue: {
          todo: taskStats.byStatus?.todo ?? 0,
          doing: taskStats.byStatus?.doing ?? 0,
          validating: taskStats.byStatus?.validating ?? 0,
          done: taskStats.byStatus?.done ?? 0,
        },
        error_rate_pct: errorRate,
      },
      version: BUILD_VERSION,
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

  // ── Host Registry: remote hosts phone-home via heartbeat ──

  // Auth helper: verify heartbeat token if REFLECTT_HOST_HEARTBEAT_TOKEN is set
  function verifyHeartbeatAuth(request: { headers: Record<string, string | undefined>; body?: Record<string, unknown> }): { ok: boolean; error?: string } {
    const expectedToken = process.env.REFLECTT_HOST_HEARTBEAT_TOKEN
    if (!expectedToken) return { ok: true } // No token configured → open access (backward compat)

    // Check Authorization: Bearer <token> header first
    const authHeader = request.headers.authorization || request.headers.Authorization
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const provided = authHeader.slice('Bearer '.length).trim()
      if (provided === expectedToken) return { ok: true }
    }

    // Check x-heartbeat-token header
    const headerToken = request.headers['x-heartbeat-token']
    if (typeof headerToken === 'string' && headerToken === expectedToken) return { ok: true }

    // Check token field in body
    const bodyToken = (request.body as Record<string, unknown>)?.token
    if (typeof bodyToken === 'string' && bodyToken === expectedToken) return { ok: true }

    return {
      ok: false,
      error: 'Unauthorized: valid heartbeat token required. Set REFLECTT_HOST_HEARTBEAT_TOKEN on the server and provide it via Authorization: Bearer <token>, x-heartbeat-token header, or token body field.',
    }
  }

  app.post('/hosts/heartbeat', async (request) => {
    const auth = verifyHeartbeatAuth(request as any)
    if (!auth.ok) {
      return { success: false, error: auth.error, status: 401 }
    }

    const body = request.body as Record<string, unknown>
    const hostId = typeof body.hostId === 'string' ? body.hostId.trim() : ''
    if (!hostId) {
      return { success: false, error: 'hostId is required' }
    }
    const host = upsertHostHeartbeat({
      hostId,
      hostname: typeof body.hostname === 'string' ? body.hostname : undefined,
      os: typeof body.os === 'string' ? body.os : undefined,
      arch: typeof body.arch === 'string' ? body.arch : undefined,
      ip: typeof body.ip === 'string' ? body.ip : undefined,
      version: typeof body.version === 'string' ? body.version : undefined,
      agents: Array.isArray(body.agents) ? body.agents.filter((a: unknown) => typeof a === 'string') : undefined,
      metadata: typeof body.metadata === 'object' && body.metadata !== null && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : undefined,
    })
    return { success: true, host }
  })

  app.get('/hosts', async (request) => {
    const query = request.query as Record<string, string>
    const status = typeof query.status === 'string' ? query.status : undefined
    const hosts = listHosts({ status })
    return { hosts, count: hosts.length }
  })

  app.get('/hosts/:hostId', async (request) => {
    const { hostId } = request.params as { hostId: string }
    const host = getHost(hostId)
    if (!host) return { success: false, error: 'Host not found' }
    return { host }
  })

  app.delete('/hosts/:hostId', async (request) => {
    const { hostId } = request.params as { hostId: string }
    const removed = removeHost(hostId)
    return { success: removed, hostId }
  })

  // ── Self Keepalive (Cloudflare / serverless) ──

  // Start self-keepalive to prevent container eviction in serverless environments
  const serverPort = Number(process.env['PORT'] || process.env['REFLECTT_PORT'] || 4445)
  startSelfKeepalive(serverPort)

  // ── Stall Detector ─────────────────────────────────────────────────────────

  const sd = getStallDetector()

  // Register stall event handler: compile intervention and post to chat
  onStallEvent((event) => {
    // Adapt stall-detector event to intervention-template expected format
    const adaptedEvent = {
      stallId: event.stallId,
      userId: event.userId,
      stallType: event.stallType as import('./intervention-template.js').StallType,
      personalizations: {
        user_name: event.userId,
        last_intent: event.context?.lastAction,
        active_task_title: event.context?.lastAction,
        last_agent_name: event.context?.lastAgent,
      },
      timestamp: event.timestamp,
    }
    const result = processStallEvent(adaptedEvent)
    if (!result.sent) {
      console.debug('[StallDetector] Intervention not sent:', result.reason)
      return
    }

    // Select an agent to send the intervention (use lastAgent from context, or default)
    const agentName = event.context?.lastAgent || getAgentRoles()[0]?.name || 'system'
    const message = result.message || 'Hey! Just checking in — want to pick up where you left off?'

    // Post to #general as the intervening agent
    const baseUrl = `http://127.0.0.1:${serverPort}`
    fetch(`${baseUrl}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-reflectt-internal': 'true' },
      body: JSON.stringify({ from: agentName, channel: 'general', content: message }),
    }).catch((err) => console.error('[StallDetector] Failed to post intervention:', err))
  })

  // Start stall detector if enabled in config
  const stallConfig = (serverConfig as any).stallDetector
  if (stallConfig?.enabled) sd.start()

  app.get('/stall-detector', async () => {
    return {
      enabled: sd.getAllStates().length > 0,
      states: sd.getAllStates().map(s => ({
        userId: s.userId,
        phase: s.phase,
        context: s.context,
        stallFired: [...s.stallFired],
      })),
    }
  })

  app.post('/stall-detector/config', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    // Accept: { enabled, thresholds: { newUserMinutes, inSessionMinutes, setupMinutes } }
    const newCfg: any = {}
    if (typeof body.enabled === 'boolean') {
      newCfg.enabled = body.enabled
    }
    if (body.thresholds && typeof body.thresholds === 'object') {
      newCfg.thresholds = body.thresholds as any
    }
    // Merge into serverConfig
    ;(serverConfig as any).stallDetector = {
      ...((serverConfig as any).stallDetector ?? {}),
      ...newCfg,
    }
    if (newCfg.enabled) sd.start()
    return { success: true, config: (serverConfig as any).stallDetector }
  })

  app.post('/stall-detector/test', async (request) => {
    // Fire a test stall event for a given userId
    const { userId } = (request.body ?? {}) as { userId?: string }
    if (!userId) return { success: false, error: 'userId required' }
    sd.recordActivity(userId, { phase: 'new_user' })
    return { success: true, message: `Recorded activity for ${userId}` }
  })

  // Self-keepalive status + warm boot info
  app.get('/health/keepalive', async () => {
    return getSelfKeepaliveStatus()
  })

  // ── Host Keepalive ──

  // Start keepalive pinger for managed hosts
  startKeepalive()

  // Status endpoint
  app.get('/hosts/keepalive', async () => {
    return getKeepaliveStatus()
  })

  // Manual trigger: ping all or specific host
  app.post('/hosts/keepalive/ping', async (request) => {
    const body = request.body as Record<string, unknown>
    const hostId = typeof body.hostId === 'string' ? body.hostId.trim() : undefined
    const results = await triggerKeepalivePing(hostId || undefined)
    return { success: true, results }
  })

  // ── Pause/Sleep Controls ──

  // Pause an agent or team
  app.post('/pause', async (request) => {
    const body = request.body as Record<string, unknown>
    const target = typeof body.target === 'string' ? body.target.trim() : ''
    if (!target) {
      return { success: false, error: 'target is required (agent name or "team")' }
    }

    const pausedBy = typeof body.pausedBy === 'string' ? body.pausedBy.trim() : 'system'
    const reason = typeof body.reason === 'string' ? body.reason.trim() : 'Manual pause'

    // Parse duration: either pausedUntil (timestamp) or durationMin (minutes from now)
    let pausedUntil: number | null = null
    if (typeof body.pausedUntil === 'number') {
      pausedUntil = body.pausedUntil
    } else if (typeof body.durationMin === 'number' && body.durationMin > 0) {
      pausedUntil = Date.now() + (body.durationMin as number) * 60 * 1000
    }

    const entry = pauseTarget(target, { pausedUntil, pausedBy, reason })
    return { success: true, entry }
  })

  // Unpause an agent or team
  app.delete('/pause', async (request) => {
    const query = request.query as Record<string, string>
    const target = typeof query.target === 'string' ? query.target.trim() : ''
    if (!target) {
      return { success: false, error: 'target query param required (agent name or "team")' }
    }

    const result = unpauseTarget(target)
    return { success: result.success, target }
  })

  // Check pause status for an agent
  app.get('/pause/status', async (request) => {
    const query = request.query as Record<string, string>
    const agent = typeof query.agent === 'string' ? query.agent.trim() : undefined

    if (agent) {
      return checkPauseStatus(agent)
    }

    // List all pause entries
    const entries = listPauseEntries()
    return { entries, count: entries.length }
  })

  // ── Shared team context (TEAM-CONTEXT.md) ──────────────────────────────────
  // POST /team-context/facts — agents write team-wide facts directly
  // task-1774672289270-9qhb17cgk
  app.post('/team-context/facts', teamContextFactEndpoint(REFLECTT_HOME) as any)

  // GET /team-context — read current TEAM-CONTEXT.md
  app.get('/team-context', async () => {
    const filePath = join(REFLECTT_HOME, 'workspace', 'TEAM-CONTEXT.md')
    if (!existsSync(filePath)) return { content: null, hint: 'No TEAM-CONTEXT.md yet. Facts will be written automatically on task completions and decisions.' }
    return { content: readFileSync(filePath, 'utf-8') }
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

  // ─── Alert preflight metrics ───
  app.get('/health/alert-preflight', async () => {
    snapshotDailyMetrics() // Persist daily checkpoint on health check
    return { ...getPreflightMetrics(), timestamp: Date.now() }
  })

  app.get('/health/alert-preflight/history', async () => {
    snapshotDailyMetrics()
    return { snapshots: getDailySnapshots(), currentSession: getPreflightMetrics() }
  })

  // ─── Todo hoarding health: orphan detection + auto-unassign status ───
  app.get('/health/hoarding', async (request) => {
    const query = request.query as Record<string, string>
    const dryRun = query.dry_run !== '0' && query.dry_run !== 'false' // default: dry run
    const { sweepTodoHoarding, TODO_CAP, IDLE_THRESHOLD_MS } = await import('./todoHoardingGuard.js')
    const result = await sweepTodoHoarding({ dryRun })
    return {
      ...result,
      config: { todoCap: TODO_CAP, idleThresholdMinutes: Math.round(IDLE_THRESHOLD_MS / 60000) },
      dryRun,
    }
  })

  // ─── Backlog health: ready counts per lane, breach status, floor compliance ───
  app.get('/health/backlog', async (request, reply) => {
    const query = request.query as Record<string, string>
    const includeTest = query.include_test === '1' || query.include_test === 'true'
    const now = Date.now()
    const allTasks = taskManager.listTasks({ includeTest })

    // Load lanes from config (falls back to hardcoded defaults if no TEAM-ROLES.yaml lanes section)
    const { getLanesConfig } = await import('./lane-config.js')
    const lanesArr = getLanesConfig()
    const lanes: Record<string, { agents: string[]; readyFloor: number }> = Object.fromEntries(
      lanesArr.map(l => [l.name, { agents: l.agents, readyFloor: l.readyFloor }]),
    )

    // Helper: check if a task is blocked
    const isBlocked = (task: typeof allTasks[number]): boolean => {
      if (!task.blocked_by || task.blocked_by.length === 0) return false
      return task.blocked_by.some((blockerId: string) => {
        const blocker = taskManager.getTask(blockerId)
        return blocker && !['done', 'resolved_externally', 'cancelled'].includes(blocker.status)
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

    // Count tasks missing metadata.lane for visibility
    const missingLaneCount = allTasks.filter(t => !t.metadata?.lane && !['done', 'cancelled', 'resolved_externally'].includes(t.status)).length

    // Build per-lane health
    // Task belongs to a lane if: (1) metadata.lane matches, OR (2) assignee is in lane agents (fallback)
    const laneHealth = Object.entries(lanes).map(([laneName, config]) => {
      const laneTasks = allTasks.filter(t => {
        const taskLane = t.metadata?.lane as string | undefined
        if (taskLane) return taskLane === laneName
        return config.agents.includes(t.assignee || '')
      })

      const todo = laneTasks.filter(t => t.status === 'todo')
      const doing = laneTasks.filter(t => t.status === 'doing')
      const validating = laneTasks.filter(t => t.status === 'validating')
      const blocked = laneTasks.filter(t => t.status === 'blocked' || (t.status === 'todo' && isBlocked(t)))
      const done = laneTasks.filter(t => t.status === 'done')
      const resolvedExternally = laneTasks.filter(t => t.status === 'resolved_externally')

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
          resolvedExternally: resolvedExternally.length,
        },
        // Top-level convenience aliases (never null)
        readyCount: ready.length,
        wipCount: doing.length,
        compliance: {
          status: floorBreaches.length > 0 ? 'breach' : ready.length >= config.readyFloor ? 'healthy' : 'warning',
          breaches: floorBreaches.map(a => ({
            agent: a.agent,
            ready: a.ready,
            required: config.readyFloor,
            deficit: config.readyFloor - a.ready,
          })),
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
        missingLaneMetadata: missingLaneCount,
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

  // ── Task-comment reject inspector ──
  // Surfaces the reject ledger for debugging phantom comment IDs and misattribution.
  app.get('/admin/task-comment-rejects', async (request, reply) => {
    // Auth: loopback only
    const ip = String((request as any).ip || '')
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      reply.code(403)
      return { success: false, error: 'Forbidden: localhost-only endpoint', hint: 'Access from localhost.' }
    }

    const query = request.query as Record<string, string>
    const { listTaskCommentRejects } = await import('./taskCommentIngest.js')
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 50, 200) : 50
    const reason = query.reason || undefined
    const author = query.author || undefined
    const since = query.since ? parseInt(query.since, 10) || undefined : undefined

    const result = listTaskCommentRejects({ limit, reason, author, since })

    // Shape each reject with explicit provenance + invalid_task_refs for debugging
    const enriched = result.rejects.map(r => {
      const details = r.details ? (() => { try { return JSON.parse(r.details) } catch { return null } })() : null
      const provenance = r.provenance ? (() => { try { return JSON.parse(r.provenance) } catch { return null } })() : null

      return {
        reject_id: r.id,
        timestamp: r.timestamp,
        target_task_id: r.attempted_task_param,
        resolved_task_id: r.resolved_task_id,
        author: r.author,
        reason: r.reason,
        invalid_task_refs: details?.suggestions ?? [],
        provenance: provenance ? {
          integration: provenance.integration ?? provenance.source_channel ?? null,
          original_message_id: provenance.original_message_id ?? null,
          sender_id: provenance.sender_id ?? null,
          ...provenance,
        } : null,
        content_preview: r.content ? r.content.slice(0, 200) : null,
        details,
      }
    })

    return {
      success: true,
      rejects: enriched,
      total: result.total,
      filters: { limit, reason, author, since },
    }
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

  // Validating-stall nudge tick — DMs reviewer when task stalls in validating with no formal review action
  app.post('/health/validating-nudge/tick', async (request, reply) => {
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
        nudged: [],
        skipped: [],
        timestamp: now,
      }
    }

    // Optional: override nudge threshold via query param (default 30m)
    const nudgeThresholdMs = request.query && typeof (request.query as any).nudge_threshold_ms === 'string'
      ? Math.max(60_000, Number((request.query as any).nudge_threshold_ms))
      : 30 * 60 * 1000

    const result = await healthMonitor.runValidatingNudgeTick(now, { dryRun, nudgeThresholdMs })
    return {
      success: true,
      dryRun,
      force,
      suppressed: false,
      nudge_threshold_ms: nudgeThresholdMs,
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

  // System health + loop/timer status (prove watchdogs are actually running)
  app.get('/health/system', async () => {
    const now = Date.now()

    const base = healthMonitor.getSystemHealth()
    const qh = policyManager.get().quietHours
    const suppressed = isQuietHours(now)

    const ticks = getSystemLoopTicks()
    const sweeper = getSweeperStatus()
    const board = boardHealthWorker.getStatus()

    const ageSec = (ts: number) => ts > 0 ? Math.floor((now - ts) / 1000) : null

    return {
      ...base,
      quietHours: {
        ...qh,
        suppressedNow: suppressed,
        nowMs: now,
      },
      sweeper: {
        running: sweeper.running,
        lastSweepAt: sweeper.lastSweepAt,
      },
      timers: {
        idleNudge: { registered: Boolean(idleNudgeTimer), lastTickAt: ticks.idle_nudge, lastTickAgeSec: ageSec(ticks.idle_nudge) },
        cadenceWatchdog: { registered: Boolean(cadenceWatchdogTimer), lastTickAt: ticks.cadence_watchdog, lastTickAgeSec: ageSec(ticks.cadence_watchdog) },
        mentionRescue: { registered: Boolean(mentionRescueTimer), lastTickAt: ticks.mention_rescue, lastTickAgeSec: ageSec(ticks.mention_rescue) },
        reflectionPipeline: { registered: Boolean(reflectionPipelineTimer), lastTickAt: ticks.reflection_pipeline, lastTickAgeSec: ageSec(ticks.reflection_pipeline) },
        boardHealthWorker: { registered: board.running, lastTickAt: ticks.board_health || board.lastTickAt, lastTickAgeSec: ageSec(ticks.board_health || board.lastTickAt) },
        validatingNudge: { registered: Boolean(validatingNudgeTimer), lastTickAt: ticks.validating_nudge, lastTickAgeSec: ageSec(ticks.validating_nudge) },
      },
      reviewHandoffValidation: {
        ...reviewHandoffValidationStats,
      },
      reflectionPipelineHealth: {
        ...reflectionPipelineHealth,
      },
    }
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
      dataDir: DATA_DIR,
      reflecttHome: REFLECTT_HOME,
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

  // ============ REMOTE MANAGEMENT API ============
  registerManageRoutes(app, {
    getBuildInfo: () => getBuildInfo() as unknown as Record<string, unknown>,
    getHealthStats: async () => {
      return {
        status: 'ok',
        version: BUILD_VERSION,
        uptime_seconds: Math.round((Date.now() - BUILD_STARTED_AT) / 1000),
        chat: chatManager.getStats(),
        tasks: taskManager.getStats({}),
        inbox: inboxManager.getStats(),
      } as unknown as Record<string, unknown>
    },
    readStoredLogs,
    getStoredLogPath,
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

  // Root redirects to dashboard — first thing a user sees
  app.get('/', async (_request, reply) => {
    reply.redirect('/dashboard')
  })

  app.get('/dashboard', async (request, reply) => {
    const envFlag = process.env.REFLECTT_INTERNAL_UI === '1'
    const queryFlag = (request.query as Record<string, string>)?.internal === '1'
    const internalMode = envFlag && queryFlag
    reply.type('text/html').send(getDashboardHTML({ internalMode }))
  })

  // API docs page (markdown — token-efficient for agents)
  // UI Kit reference page — living component/states documentation
  app.get('/ui-kit', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const html = await fs.readFile(join(__dirname, '..', 'public', 'ui-kit.html'), 'utf-8')
      reply.type('text/html; charset=utf-8').send(html)
    } catch (err) {
      reply.code(500).send({ error: 'Failed to load UI kit page' })
    }
  })

  // Presence loop demo — live end-to-end ambient→run→approve→result→collapse
  app.get('/presence-loop', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const html = await fs.readFile(join(__dirname, '..', 'public', 'presence-loop-demo.html'), 'utf-8')
      reply.type('text/html; charset=utf-8').send(html)
    } catch (err) {
      reply.code(500).send({ error: 'Failed to load presence loop demo' })
    }
  })

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

  // Serve avatar images (with fallback for missing avatars)
  app.get<{ Params: { filename: string } }>('/avatars/:filename', async (request, reply) => {
    const { filename } = request.params

    // Security: allow alphanumeric, hyphens, underscores + .png/.svg extension
    // (no slashes / traversal). If invalid, still return a safe default avatar (200)
    // to avoid error-rate pollution from bad/mismatched filenames.
    const safe = /^[a-z0-9_-]+\.(png|svg)$/i.test(filename)

    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')

      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const publicDir = join(__dirname, '..', 'public', 'avatars')

      if (safe) {
        const lower = filename.toLowerCase()
        const ext = lower.endsWith('.svg') ? 'image/svg+xml' : 'image/png'

        // 1) Exact avatar file
        try {
          const filePath = join(publicDir, filename)
          const data = await fs.readFile(filePath)
          reply.type(ext).header('Cache-Control', 'public, max-age=3600').send(data)
          return
        } catch {
          // fall through to fallback handling below
        }

        // 2) Some clients request generic agent-N.png assets. Serve a deterministic
        // fallback PNG instead of returning 404 (noise) or a mismatched SVG.
        if (lower.endsWith('.png')) {
          const match = /^agent-(\d+)\.png$/.exec(lower)
          const fallbackPool = [
            'kai.png',
            'link.png',
            'sage.png',
            'pixel.png',
            'echo.png',
            'scout.png',
            'harmony.png',
            'spark.png',
            'rhythm.png',
            'ryan.png',
          ]
          const n = match ? Number(match[1]) : NaN
          const index = Number.isFinite(n) ? (Math.max(1, n) - 1) % fallbackPool.length : 0
          const fallbackName = fallbackPool[index] || 'ryan.png'

          try {
            const data = await fs.readFile(join(publicDir, fallbackName))
            reply.type('image/png').header('Cache-Control', 'public, max-age=3600').send(data)
            return
          } catch {
            // fall through to SVG default below
          }
        }
      }
    } catch {
      // fall through to default avatar below
    }

    // Default avatar: render an initial when possible, else '?'
    const initial = safe ? (filename.replace(/\.(png|svg)$/i, '').charAt(0) || '?').toUpperCase() : '?' 
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="#21262d"/>
      <text x="32" y="38" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" font-weight="600" fill="#8d96a0">${initial}</text>
    </svg>`
    reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=3600').send(svg)
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

    // Reserve system sender for server-internal control-plane messages.
    // Prevent browser clients (dashboard.js) or external callers from spoofing system alerts.
    //
    // Allow explicit internal callers (tests/tools) via header:
    //   x-reflectt-internal: true
    if (data.from === 'system') {
      const internal = String((request.headers as any)['x-reflectt-internal'] || '').toLowerCase() === 'true'
      if (!internal) {
        reply.code(403)
        return {
          success: false,
          error: 'Sender "system" is reserved (use from="dashboard" or your agent name).',
          code: 'SENDER_RESERVED',
          hint: 'Only internal callers may emit system messages. Add header x-reflectt-internal:true for test/tooling.',
        }
      }
    }

    // Require at least content or attachments
    if (!data.content && (!data.attachments || data.attachments.length === 0)) {
      reply.code(400)
      return { success: false, error: 'Message must have content or attachments' }
    }

    // ── Phantom task-comment guard ──────────────────────────────────────
    // Reject messages with [task-comment:task-...] tags if any referenced task
    // doesn't exist. Only enforced in #task-comments channel (the spam vector).
    // Other channels (e.g. #general) may quote tags in discussion without blocking.
    if (data.channel === 'task-comments') {
      const phantomIds: string[] = []
      for (const m of data.content.matchAll(/\[task-comment:(task-[^\]]+)\]/g)) {
        const referencedTaskId = m[1]
        if (!taskManager.getTask(referencedTaskId)) {
          phantomIds.push(referencedTaskId)
        }
      }
      if (phantomIds.length > 0) {
        reply.code(422)
        return {
          success: false,
          error: `Phantom task-comment rejected: ${phantomIds.join(', ')} ${phantomIds.length === 1 ? 'does' : 'do'} not exist`,
          code: 'PHANTOM_TASK_COMMENT',
          hint: `Verify tasks exist before posting [task-comment:...] to #task-comments.`,
          gate: 'phantom_task_comment',
          phantom_ids: phantomIds,
        }
      }
    }

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

    const ownerApprovalGate = validateOwnerApprovalPing(data.content, data.from, data.channel)
    if (ownerApprovalGate.blockingError) {
      reply.code(400)
      return {
        success: false,
        error: ownerApprovalGate.blockingError,
        gate: 'owner_approval_gate',
        hint: ownerApprovalGate.hint,
      }
    }

    // Check for unmentioned coordination messages BEFORE sending
    // so we can include the warning in the response.
    // task-1774579523544-kgi9nohd4
    const noMentionCheck = buildNoMentionWarning(data.content, data.channel, data.from)

    const message = await chatManager.sendMessage(data)
    const mentionWarnings = buildMentionWarnings(data.content)
    const autonomyWarnings = buildAutonomyWarnings(data.content)

    // If no @mentions in coordination channel, auto-subscribe the main agent
    // so the message appears in their inbox (not silently lost).
    if (noMentionCheck.autoRouted && data.channel) {
      chatManager.sendMessage({
        from: 'system',
        channel: data.channel,
        content: `⚠️ @${data.from} posted without @mention in #${data.channel}. Auto-routing to @${noMentionCheck.autoRouted} for visibility.`,
      }).catch(() => {}) // fire-and-forget
    }

    // Track content messages for noise budget denominator
    // (agent/human messages posted via POST /chat/messages are content, not control-plane)
    if (data.channel) {
      noiseBudgetManager.recordContentMessage(data.channel, data.from)
    }

    // Auto-update presence: if you're posting, you're active
    if (data.from) {
      presenceManager.recordActivity(data.from, 'message')
      presenceManager.touchPresence(data.from)

      // Stall detector: user sent a message — record activity
      getStallDetector().recordActivity(data.from)

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

    // Preview approval gate: detect "looks good. Please merge" messages
    // and record the approval so the merge gate allows the PR to be merged.
    if (data.content) {
      const previewApprovalMatch = data.content.match(/looks good\.?\s.*?(?:merge|PR|pull request)\b/i)
      if (previewApprovalMatch) {
        const { recordPreviewApproval } = await import('./prAutoMerge.js')
        const prRefMatch = data.content.match(/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/)
          || data.content.match(/PR\s*#(\d+)/i)
        if (prRefMatch?.[2]) {
          // Full github URL match: owner/repo and PR number
          recordPreviewApproval(prRefMatch[1], parseInt(prRefMatch[2], 10), data.from)
        } else if (prRefMatch?.[1]) {
          // PR #N match without repo — record with wildcard repo
          recordPreviewApproval('*', parseInt(prRefMatch[1], 10), data.from)
        } else {
          // No PR number in message — cannot create scoped approval
          console.log(`[MergeGate] Skipped approval from ${data.from} — no PR number found in message`)
        }
      }
    }

    // Merge-gate honesty: when an agent posts a PR URL, check if it's unapproved
    // and inject a visible status message so the customer knows merge is waiting on them.
    if (data.content && data.from !== 'user' && data.from !== 'system' && data.from !== 'dashboard') {
      const prUrlMatch = data.content.match(/https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/)
      if (prUrlMatch) {
        const { hasPreviewApproval } = await import('./prAutoMerge.js')
        const prRepo = prUrlMatch[1]
        const prNum = parseInt(prUrlMatch[2], 10)
        if (!hasPreviewApproval(prRepo, prNum) && !hasPreviewApproval('*', prNum)) {
          // Post a system message indicating merge is blocked until approval
          chatManager.sendMessage({
            from: 'system',
            content: `Merge blocked for PR #${prNum} — waiting for your approval. Click "Looks good" when you're ready to merge.`,
            channel: data.channel || 'general',
          })
          console.log(`[MergeGate] Honesty message posted for ${prRepo}#${prNum}`)
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
      ...(noMentionCheck.warning ? { no_mention_warning: noMentionCheck.warning, auto_routed_to: noMentionCheck.autoRouted } : {}),
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
      excludeFrom: query.exclude_from,
      to: query.to,
      channel: query.channel,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.chatMessages, MAX_LIMITS.chatMessages),
      since: parseEpochMs(query.since),
      before: parseEpochMs(query.before),
      after: parseEpochMs(query.after),
    })
    const rawQuery = request.query as Record<string, string>
    const compact = rawQuery?.compact === '1' || rawQuery?.compact === 'true'
    const slimMessages = compact
      ? messages.map(m => ({ from: m.from, content: m.content, ts: m.timestamp, ch: m.channel }))
      : messages
    const payload = { messages: slimMessages }
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

    // Strict compact mode: enforce a small char budget while preserving key signals.
    // This is used for agent context injection where token bloat hurts reliability.
    const strictCompact = query.compact === '1' || query.compact === 'true'
    const maxChars = Math.max(400, Math.min(Number(query.max_chars) || 1200, 8000))

    const allMessages = chatManager.getMessages({
      channel: channelFilter,
      limit: Math.min(limit * 6, 800), // fetch more, then filter
      since: sinceMs,
    })

    // Partition: mentions, system alerts, team messages
    const mentions: typeof allMessages = []
    const systemAlerts: typeof allMessages = []
    const teamMessages: typeof allMessages = []

    const agentPattern = new RegExp(`@${agent}\\b`, 'i')

    for (const m of allMessages) {
      const content = m.content || ''
      if (m.from === 'system') systemAlerts.push(m)
      else if (agentPattern.test(content)) mentions.push(m)
      else teamMessages.push(m)
    }

    const normalizeForDedup = (content: string): string => {
      return (content || '')
        .replace(/\d{10,}/g, '') // strip epoch timestamps
        .replace(/task-\S+/g, 'TASK') // normalize task IDs
        .replace(/@[\w-]+/g, '@AGENT') // normalize @mentions (incl. hyphens)
        .replace(/\d+\/\d+/g, 'N/M') // normalize counts like "0/2"
        .replace(/\b\d+h\b/g, 'Nh') // normalize durations like "10h", "28h"
        .replace(/\b\d+m\b/g, 'Nm') // normalize minutes
        .replace(/\d+\s*hour/g, 'N hour')
        .replace(/\d+\s*min/g, 'N min')
        .replace(/\(need \d+ more\)/g, '') // normalize "need N more"
        .replace(/\s+/g, ' ') // collapse whitespace
        .trim()
        .slice(0, 220)
    }

    // Deduplicate system alerts across channels (keep newest instance), and collapse repeats into one line with count.
    const collapseSystemAlerts = (msgs: typeof allMessages) => {
      const map = new Map<string, { rep: (typeof allMessages)[0]; count: number; channels: Set<string> }>()
      for (const m of msgs) {
        const norm = normalizeForDedup(m.content || '')
        if (!norm) continue
        const key = norm
        const existing = map.get(key)
        if (!existing) {
          map.set(key, { rep: m, count: 1, channels: new Set([m.channel || 'unknown']) })
          continue
        }
        existing.count += 1
        existing.channels.add(m.channel || 'unknown')
        if (m.timestamp > existing.rep.timestamp) existing.rep = m
      }

      const out = Array.from(map.values()).map(item => {
        const rep = item.rep as any
        rep.__dedup_count = item.count
        rep.__dedup_channels = Array.from(item.channels)
        return rep as typeof allMessages[0]
      })

      // Preserve rough chronological order by representative timestamp
      return out.sort((a, b) => a.timestamp - b.timestamp)
    }

    const dedupedAlerts = collapseSystemAlerts(systemAlerts)

    // Slim format: strip id, reactions, replyCount; include repeat count + channels when collapsed.
    const slim = (m: typeof allMessages[0]) => {
      const anyM = m as any
      const n = typeof anyM.__dedup_count === 'number' ? anyM.__dedup_count : 1
      const chs = Array.isArray(anyM.__dedup_channels) ? anyM.__dedup_channels as string[] : [m.channel]
      const ch = chs.length === 1 ? chs[0] : 'multi'
      const rawContent = String(m.content || '')
      const content = n > 1 ? `${rawContent} (x${n})` : rawContent
      return {
        from: m.from,
        content: strictCompact ? content.slice(0, 260) : content,
        ts: m.timestamp,
        ch,
        ...(n > 1 ? { n, chs } : {}),
      }
    }

    // Assemble: prioritize mentions, then deduped alerts, then team msgs
    const result = [
      ...mentions.slice(-limit).map(slim),
      ...dedupedAlerts.slice(-Math.ceil(limit / 3)).map(slim),
      ...teamMessages.slice(-Math.ceil(limit / 3)).map(slim),
    ]
      .sort((a, b) => a.ts - b.ts)
      .slice(-limit)

    // Strict compact: render a small text packet with a hard char budget.
    let compact_text: string | undefined
    if (strictCompact) {
      const doing = taskManager.listTasks({ status: 'doing', assignee: agent })[0] || null

      // "Next task": highest priority unblocked todo task (unassigned or assigned to this agent)
      const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
      const isBlockedByDeps = (t: any): boolean => {
        if (!Array.isArray(t.blocked_by) || t.blocked_by.length === 0) return false
        return t.blocked_by.some((blockerId: string) => {
          const blocker = taskManager.getTask(blockerId)
          return blocker && !['done', 'resolved_externally', 'cancelled'].includes(blocker.status)
        })
      }
      const nextTodo = taskManager
        .listTasks({ status: 'todo', includeBlocked: false })
        .filter(t => (!t.assignee || t.assignee === agent))
        .filter(t => !isBlockedByDeps(t))
        .sort((a, b) => {
          const ap = priorityOrder[a.priority || 'P3'] ?? 999
          const bp = priorityOrder[b.priority || 'P3'] ?? 999
          if (ap !== bp) return ap - bp
          return a.createdAt - b.createdAt
        })[0] || null

      const blocked = taskManager.listTasks({ status: 'blocked', assignee: agent })

      const lastMention = mentions.length > 0 ? slim(mentions[mentions.length - 1]) : null

      const lines: string[] = []
      const push = (s: string) => { if (s) lines.push(s) }

      push(`AGENT: ${agent}`)
      push('')
      push('ACTIVE TASK:')
      push(doing ? `- ${doing.id} [${doing.priority}] ${doing.title}` : '- none')
      push('NEXT TASK:')
      push(nextTodo ? `- ${nextTodo.id} [${nextTodo.priority}] ${nextTodo.title}` : '- none')
      push('BLOCKERS:')
      if (blocked.length === 0) push('- none')
      else {
        for (const t of blocked.slice(0, 3)) {
          const blockedBy = Array.isArray(t.blocked_by) && t.blocked_by.length > 0 ? ` (blocked_by: ${t.blocked_by.join(', ')})` : ''
          push(`- ${t.id} ${t.title}${blockedBy}`)
        }
        if (blocked.length > 3) push(`- (+${blocked.length - 3} more)`) 
      }
      push('LAST MENTION:')
      push(lastMention ? `- [${lastMention.ch}] ${String(lastMention.content || '').slice(0, 220)}` : '- none')
      push('RECENT CHAT (DEDUPED):')
      for (const m of result.slice(-8)) {
        const prefix = m.from === 'system' ? '[sys]' : `[${m.from}]`
        push(`- ${prefix} ${String(m.content || '').slice(0, 180)}`)
      }

      const joined = lines.join('\n').trim()
      compact_text = joined.length <= maxChars ? joined : joined.slice(0, maxChars - 1)
    }

    const messagesOut = strictCompact ? result.slice(-10) : result

    return {
      agent,
      since: sinceMs,
      count: messagesOut.length,
      messages: messagesOut,
      ...(strictCompact ? { compact: true, max_chars: maxChars, compact_text } : {}),
      suppressed: {
        system_deduped: systemAlerts.length - dedupedAlerts.length,
        total_scanned: allMessages.length,
        ...(strictCompact ? { truncated: result.length - messagesOut.length } : {}),
      },
    }
  })

  // ── Context injection with per-layer budgets (v1) ───────────────────────
  // Returns a structured, bounded context payload with token estimates +
  // (optional) persisted memo summaries when layers overflow their budgets.
  app.get<{ Params: { agent: string } }>('/context/inject/:agent', async (request, reply) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    if (!agent) {
      reply.code(400)
      return { error: 'agent is required' }
    }

    const query = request.query as Record<string, string>
    const limit = Math.min(Number(query.limit) || 60, 200)
    const channelFilter = query.channel || undefined
    const sinceMs = query.since ? Number(query.since) : Date.now() - (4 * 60 * 60 * 1000)

    // Deterministic scope routing (escape hatch: explicit scope override)
    const scopeOverride = (query.scope_id || query.team_scope_id || '').trim()
    const peer = (query.peer || '').trim()
    const taskIdOverride = (query.task_id || '').trim()

    const allMessages = chatManager.getMessages({
      channel: channelFilter,
      limit: Math.min(limit * 6, 800),
      since: sinceMs,
    })

    // Partition: mentions, system alerts, team messages
    const mentions: typeof allMessages = []
    const systemAlerts: typeof allMessages = []
    const teamMessages: typeof allMessages = []

    const agentPattern = new RegExp(`@${agent}\\b`, 'i')

    for (const m of allMessages) {
      const content = m.content || ''
      if (m.from === 'system') systemAlerts.push(m)
      else if (agentPattern.test(content)) mentions.push(m)
      else teamMessages.push(m)
    }

    // Deduplicate system alerts by normalized content
    const seenHashes = new Set<string>()
    const dedupedAlerts = systemAlerts.filter(m => {
      const normalized = (m.content || '')
        .replace(/\d{10,}/g, '')
        .replace(/task-\S+/g, 'TASK')
        .replace(/@[\w-]+/g, '@AGENT')
        .replace(/\d+\/\d+/g, 'N/M')
        .replace(/\d+h\b/g, 'Nh')
        .replace(/\d+m\b/g, 'Nm')
        .replace(/\d+\s*hour/g, 'N hour')
        .replace(/\d+\s*min/g, 'N min')
        .replace(/\(need \d+ more\)/g, '')
        .replace(/\s+/g, ' ')
        .trim().slice(0, 200)
      const hash = `${m.channel}:${normalized}`
      if (seenHashes.has(hash)) return false
      seenHashes.add(hash)
      return true
    })

    const selected = [
      ...mentions.slice(-limit),
      ...dedupedAlerts.slice(-Math.ceil(limit / 3)),
      ...teamMessages.slice(-Math.ceil(limit / 3)),
    ]
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(-limit)

    const discoveredTaskId = taskIdOverride || (selected
      .map(m => (m.metadata as any)?.taskId)
      .find(v => typeof v === 'string') as string | undefined)

    // Deterministic: if caller doesn't provide channel, default to team scope.
    const channelForScope = channelFilter || 'general'
    const derivedSessionScopeId = deriveScopeId({
      scope_id: scopeOverride,
      channel: channelForScope,
      task_id: discoveredTaskId,
      peer,
    })

    // team_shared should remain team-scoped unless explicitly overridden.
    const teamScopeId = (query.team_scope_id || 'team:default').trim()

    const injection = await buildContextInjection({
      agent,
      sessionMessages: selected,
      sessionScopeId: derivedSessionScopeId,
      teamScopeId,
    })

    return {
      ...injection,
      session_source: {
        since: sinceMs,
        limit,
        channel: channelFilter || null,
        scanned: allMessages.length,
        selected: selected.length,
        suppressed: {
          system_deduped: systemAlerts.length - dedupedAlerts.length,
        },
      },
    }
  })

  // Read a persisted context memo (for UI/debug)
  app.get('/context/memo', async (request, reply) => {
    const querySchema = z.object({
      scope_id: z.string().trim().min(1),
      layer: z.enum(['session_local', 'agent_persistent', 'team_shared']),
    })

    const parsed = querySchema.safeParse(request.query ?? {})
    if (!parsed.success) {
      reply.code(400)
      return {
        error: 'Invalid query params',
        details: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const memo = getContextMemo(parsed.data.scope_id, parsed.data.layer as ContextLayer)
    if (!memo) {
      reply.code(404)
      return { error: 'Memo not found' }
    }
    return { memo }
  })

  // Manually set/overwrite a memo (useful for team_shared bootstrapping)
  app.post('/context/memo', async (request, reply) => {
    const bodySchema = z.object({
      scope_id: z.string().trim().min(1),
      layer: z.enum(['session_local', 'agent_persistent', 'team_shared']),
      content: z.string().trim().min(1),
      source_window: z.record(z.any()).optional(),
    })

    const parsed = bodySchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      reply.code(400)
      return {
        error: 'Invalid body',
        details: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      }
    }

    const memo = upsertContextMemo({
      scope_id: parsed.data.scope_id,
      layer: parsed.data.layer as ContextLayer,
      content: parsed.data.content,
      source_window: parsed.data.source_window,
      source_hash: undefined,
    })

    return { success: true, memo }
  })

  // Get current configured budgets (for UI/debug)
  app.get('/context/budgets', async () => {
    return {
      budgets: getContextBudgets(),
      autosummary_enabled: String(process.env.REFLECTT_CONTEXT_AUTOSUMMARY || '').trim(),
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
    
    const agentName = request.params.agent
    const sinceMs = parseEpochMs(query.since)
    const itemLimit = boundedLimit(query.limit, DEFAULT_LIMITS.inbox, MAX_LIMITS.inbox)

    const inbox = inboxManager.getInbox(agentName, allMessages, {
      priority: query.priority,
      limit: itemLimit,
      since: sinceMs,
    })

    // ── Merge in unread task comments addressed to this agent ──────────
    // Include comments where the comment mentions @agent or is on a task
    // assigned to this agent (author != agent = someone else wrote it).
    const agentAliases = getAgentAliases(agentName)
    const allTasks = taskManager.listTasks({ assigneeIn: agentAliases })
    const taskCommentItems: Array<{
      id: string; from: string; content: string; timestamp: number;
      channel: string; task_id: string; comment_id: string; type: 'task_comment'
    }> = []
    for (const task of allTasks) {
      const comments = taskManager.getTaskComments(task.id)
      for (const c of comments) {
        if (c.author === agentName) continue // skip own comments
        if (c.suppressed) continue
        if (sinceMs && c.timestamp < sinceMs) continue
        const mentionsAgent = agentAliases.some(a => (c.content || '').toLowerCase().includes(`@${a}`))
        const isOnAgentTask = agentAliases.includes(task.assignee || '')
        if (!mentionsAgent && !isOnAgentTask) continue
        taskCommentItems.push({
          id: c.id,
          from: c.author,
          content: c.content,
          timestamp: c.timestamp,
          channel: 'task-comments',
          task_id: task.id,
          comment_id: c.id,
          type: 'task_comment',
        })
      }
    }

    // Merge chat inbox + task comments, sort by timestamp desc, cap at limit
    type InboxItem = typeof taskCommentItems[number] | (typeof inbox)[number] & { type?: string; task_id?: string; comment_id?: string }
    const merged: InboxItem[] = ([...inbox.map(m => ({ ...m, type: 'mention' as const })), ...taskCommentItems] as InboxItem[])
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, itemLimit)

    // Auto-mark read if requested
    if (query.mark_read === 'true') {
      const chatIds = inbox.map(m => m.id).filter(Boolean)
      if (chatIds.length > 0) {
        await inboxManager.ackMessages(agentName, chatIds, undefined)
      }
    }

    // Auto-update presence when agent checks inbox
    presenceManager.updatePresence(agentName, 'working')

    const rawQuery = request.query as Record<string, string>
    if (isCompact(rawQuery)) {
      const slim = merged.map(m => ({
        from: m.from,
        content: (m as any).content,
        ts: m.timestamp,
        ch: (m as any).channel,
        ...((m as any).priority ? { priority: (m as any).priority } : {}),
        ...((m as any).task_id ? { task_id: (m as any).task_id, comment_id: (m as any).comment_id } : {}),
      }))
      return { messages: slim, count: slim.length }
    }

    return { messages: merged, count: merged.length }
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
    // Clear delivery records so re-delivery is possible if the message resurfaces
    for (const id of body.messageIds) clearDeliveryRecord(request.params.agent, id)
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

  const isCompact = (query: Record<string, string | string[]>) => {
    const v = Array.isArray(query.compact) ? query.compact[0] : query.compact
    return v === '1' || v === 'true'
  }

  // List tasks
  app.get('/tasks', async (request, reply) => {
    const query = request.query as Record<string, string | string[]>
    const updatedSince = parseEpochMs((Array.isArray(query.updatedSince) ? query.updatedSince[0] : query.updatedSince) || (Array.isArray(query.since) ? query.since[0] : query.since))
    const limitRaw = Array.isArray(query.limit) ? query.limit[0] : query.limit
    const limit = boundedLimit(limitRaw, DEFAULT_LIMITS.tasks, MAX_LIMITS.tasks)

    const tagRaw = Array.isArray(query.tag) ? query.tag[0] : query.tag
    const tagsRaw = Array.isArray(query.tags) ? query.tags[0] : query.tags
    const tagFilter = tagRaw
      ? [tagRaw]
      : (tagsRaw ? tagsRaw.split(',') : undefined)

    const includeTestRaw = Array.isArray(query.include_test) ? query.include_test[0] : query.include_test
    const includeTest = includeTestRaw === '1' || includeTestRaw === 'true'

    // Normalize status: supports ?status=todo, ?status[]=todo&status[]=doing,
    // and repeated ?status=todo&status=doing (Fastify parses as array)
    const VALID_STATUSES: Task['status'][] = ['todo', 'doing', 'blocked', 'validating', 'done', 'cancelled']
    const statusRaw = query.status
    const statusFilter = statusRaw === undefined
      ? undefined
      : (Array.isArray(statusRaw)
          ? statusRaw.filter((s): s is Task['status'] => VALID_STATUSES.includes(s as Task['status']))
          : VALID_STATUSES.includes(statusRaw as Task['status']) ? [statusRaw as Task['status']] : undefined)

    let tasks = taskManager.listTasks({
      status: statusFilter && statusFilter.length === 1 ? statusFilter[0] : (statusFilter && statusFilter.length > 1 ? statusFilter : undefined),
      assignee: (Array.isArray(query.assignee) ? query.assignee[0] : query.assignee) || (Array.isArray(query.assignedTo) ? query.assignedTo[0] : query.assignedTo),
      createdBy: Array.isArray(query.createdBy) ? query.createdBy[0] : query.createdBy,
      teamId: normalizeTeamId(Array.isArray(query.teamId) ? query.teamId[0] : query.teamId),
      priority: (Array.isArray(query.priority) ? query.priority[0] : query.priority) as Task['priority'] | undefined,
      tags: tagFilter,
      includeTest,
    })

    if (updatedSince) {
      tasks = tasks.filter(task => task.updatedAt >= updatedSince)
    }

    // Text search filter
    const qRaw = Array.isArray(query.q) ? query.q[0] : query.q
    const searchQuery = (qRaw || '').trim().toLowerCase()
    if (searchQuery) {
      tasks = tasks.filter(task =>
        (task.title || '').toLowerCase().includes(searchQuery) ||
        (task.description || '').toLowerCase().includes(searchQuery) ||
        (task.assignee || '').toLowerCase().includes(searchQuery) ||
        (task.id || '').toLowerCase().includes(searchQuery)
      )
    }

    const total = tasks.length
    const offset = parsePositiveInt(Array.isArray(query.offset) ? query.offset[0] : query.offset) || 0
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
      // Check if this task was deleted — return 410 Gone with tombstone metadata instead of 404.
      const tombstone = taskManager.getTaskDeletionTombstone(request.params.id)
      if (tombstone) {
        reply.code(410)
        return {
          success: false,
          error: 'Task has been deleted',
          code: 'TASK_DELETED',
          status: 410,
          tombstone: {
            taskId: tombstone.taskId,
            deletedAt: tombstone.deletedAt,
            deletedBy: tombstone.deletedBy,
            previousStatus: tombstone.previousStatus,
            title: tombstone.title,
          },
        }
      }
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

  // ── Task handoff state ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/tasks/:id/handoff', async (request, reply) => {
    const resolved = taskManager.resolveTaskId(request.params.id)
    if (!resolved.task) {
      reply.code(404)
      return { error: 'Task not found' }
    }
    const meta = resolved.task.metadata as Record<string, unknown> | null
    const handoff = meta?.handoff_state ?? null
    return {
      taskId: resolved.resolvedId,
      status: resolved.task.status,
      handoff_state: handoff,
    }
  })

  app.put<{ Params: { id: string } }>('/tasks/:id/handoff', async (request, reply) => {
    const resolved = taskManager.resolveTaskId(request.params.id)
    if (!resolved.task || !resolved.resolvedId) {
      reply.code(404)
      return { error: 'Task not found' }
    }
    const body = request.body as Record<string, unknown>
    const result = HandoffStateSchema.safeParse(body)
    if (!result.success) {
      reply.code(422)
      return {
        error: `Invalid handoff_state: ${result.error.issues.map(i => i.message).join(', ')}`,
        hint: 'Required: reviewed_by (string), decision (approved|rejected|needs_changes|escalated). Optional: next_owner (string).',
      }
    }
    const existingMeta = (resolved.task.metadata || {}) as Record<string, unknown>
    taskManager.updateTask(resolved.resolvedId, {
      metadata: { ...existingMeta, handoff_state: result.data },
    })
    return {
      success: true,
      taskId: resolved.resolvedId,
      handoff_state: result.data,
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

  /**
   * GET /tasks/slow-blocked
   * Detect doing tasks that are slow (>4h no event, not explicitly blocked)
   * vs explicitly blocked tasks. Different handling paths — no @kai escalation
   * needed for detection; host enforces it.
   *
   * Returns:
   *   slow[]  — doing tasks with no activity in >4h (not explicitly blocked)
   *   blocked[] — tasks in blocked status
   */
  app.get('/tasks/slow-blocked', async (request) => {
    const query = request.query as Record<string, string>
    const SLOW_THRESHOLD_MS = parseInt(query.slowThresholdHours || '4') * 60 * 60 * 1000
    const now = Date.now()

    const doingTasks = taskManager.listTasks({ status: 'doing' })
    const blockedTasks = taskManager.listTasks({ status: 'blocked' })

    const slow: Array<{
      taskId: string
      title: string
      assignee: string | null
      priority: string | null
      lastActivityAt: number
      slowSinceMs: number
      slowSinceHours: number
    }> = []

    for (const task of doingTasks) {
      const comments = taskManager.getTaskComments(task.id)
      const lastComment = comments.length > 0 ? comments[comments.length - 1] : null
      const lastActivityAt = lastComment?.timestamp ?? task.updatedAt ?? task.createdAt
      const age = now - lastActivityAt

      if (age > SLOW_THRESHOLD_MS) {
        slow.push({
          taskId: task.id,
          title: task.title,
          assignee: task.assignee || null,
          priority: task.priority || null,
          lastActivityAt,
          slowSinceMs: age,
          slowSinceHours: Math.round(age / 36_000) / 100,
        })
      }
    }

    const blocked = blockedTasks.map(task => ({
      taskId: task.id,
      title: task.title,
      assignee: task.assignee || null,
      priority: task.priority || null,
      blockedAt: task.updatedAt ?? task.createdAt,
      blockedSinceMs: now - (task.updatedAt ?? task.createdAt),
      blockedReason: (task.metadata as Record<string, unknown>)?.transition
        ? ((task.metadata as Record<string, unknown>).transition as Record<string, unknown>)?.reason ?? null
        : null,
    }))

    return {
      slowThresholdHours: SLOW_THRESHOLD_MS / 3_600_000,
      doingCount: doingTasks.length,
      blockedCount: blocked.length,
      slowCount: slow.length,
      slow: slow.sort((a, b) => b.slowSinceMs - a.slowSinceMs),
      blocked: blocked.sort((a, b) => b.blockedSinceMs - a.blockedSinceMs),
      summary: slow.length === 0 && blocked.length === 0
        ? 'all_clear'
        : slow.length > 0 && blocked.length > 0 ? 'slow_and_blocked'
        : slow.length > 0 ? 'has_slow'
        : 'has_blocked',
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
      // Record provenance for phantom task-comment attempts (do not attribute to a human in chat).
      let parsed: any = null
      try {
        parsed = CreateTaskCommentSchema.safeParse(request.body)
      } catch { /* ignore */ }

      const match = taskManager.resolveTaskId(request.params.id)
      const { recordTaskCommentReject } = await import('./taskCommentIngest.js')
      const rej = recordTaskCommentReject({
        attempted_task_param: request.params.id,
        resolved_task_id: null,
        author: parsed?.success ? parsed.data.author : null,
        content: parsed?.success ? parsed.data.content : null,
        reason: 'task_not_found',
        provenance: parsed?.success ? (parsed.data.provenance ?? null) : null,
        details: {
          input: request.params.id,
          matchType: match.matchType,
          suggestions: match.suggestions ?? [],
        },
      })

      if (match.matchType === 'ambiguous') {
        reply.code(409)
        return {
          success: false,
          error: 'Ambiguous task ID prefix',
          code: 'AMBIGUOUS_TASK_ID',
          status: 409,
          reject_id: rej.id,
          details: {
            input: request.params.id,
            suggestions: match.suggestions,
          },
          hint: 'Use a longer prefix or the full task ID',
        }
      }

      reply.code(404)
      return {
        success: false,
        error: 'Task not found',
        code: 'TASK_NOT_FOUND',
        status: 404,
        reject_id: rej.id,
        details: { input: request.params.id, suggestions: match.suggestions },
      }
    }

    try {
      const data = CreateTaskCommentSchema.parse(request.body)

      // ── Task ID reference validation ──
      // If the comment references other task IDs, reject the comment when any
      // referenced task does not exist. This prevents phantom cross-links and
      // keeps attribution clean.
      const TASK_REF_RE = /\btask-[\w-]{8,}\b/g
      const referencedIds = [...new Set(data.content.match(TASK_REF_RE) || [])]
      const invalidRefs: string[] = []
      const suggestions: Record<string, string[]> = {}
      for (const refId of referencedIds) {
        // Skip the task we're commenting on
        if (refId === resolved.resolvedId) continue
        const match = taskManager.resolveTaskId(refId)
        if (match.matchType === 'not_found') {
          invalidRefs.push(refId)
          if (match.suggestions?.length) {
            suggestions[refId] = match.suggestions
          }
        }
      }

      if (invalidRefs.length > 0) {
        const { recordTaskCommentReject } = await import('./taskCommentIngest.js')
        const rej = recordTaskCommentReject({
          attempted_task_param: request.params.id,
          resolved_task_id: resolved.resolvedId,
          author: data.author,
          content: data.content,
          reason: 'invalid_task_refs',
          provenance: (data as any).provenance ?? null,
          details: { invalid_task_refs: invalidRefs, suggestions },
        })

        reply.code(422)
        return {
          success: false,
          error: `Invalid task reference(s): ${invalidRefs.join(', ')}`,
          code: 'INVALID_TASK_REFS',
          status: 422,
          reject_id: rej.id,
          invalid_task_refs: invalidRefs,
          suggestions,
          hint: 'Fix the referenced task IDs (or remove them) and retry. This guard prevents phantom cross-links.',
        }
      }

      const comment = await taskManager.addTaskComment(
        resolved.resolvedId,
        data.author,
        data.content,
        {
          category: (data as any).category ?? null,
          provenance: (data as any).provenance ?? null,
        },
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

      // ── Review auto-close bridge ──────────────────────────────────────────
      // If the assigned reviewer posts a structured [review] approved/rejected comment,
      // auto-fire the review decision without requiring a separate API call.
      // Safety: validating-only, reviewer-identity-gated, idempotent, audited.
      {
        const taskForReview = taskManager.getTask(resolved.resolvedId)
        if (taskForReview) {
          const { evaluateAutoClose } = await import('./review-autoclose.js')
          const autoClose = evaluateAutoClose({
            taskId: resolved.resolvedId,
            taskStatus: taskForReview.status,
            taskReviewer: taskForReview.reviewer,
            taskAssignee: taskForReview.assignee,
            commentAuthor: data.author,
            commentContent: data.content,
          })
          if (autoClose.fired && autoClose.decision) {
            // Self-review detection (non-blocking — just emits trust event)
            if (
              taskForReview.reviewer &&
              taskForReview.assignee &&
              taskForReview.reviewer.trim().toLowerCase() === taskForReview.assignee.trim().toLowerCase()
            ) {
              import('./trust-events.js').then(({ emitTrustEvent }) => {
                emitTrustEvent({
                  agentId: data.author,
                  eventType: 'self_review_violation',
                  context: { taskId: resolved.resolvedId, taskTitle: taskForReview.title, reviewer: taskForReview.reviewer, assignee: taskForReview.assignee, decision: autoClose.decision, source: 'review-autoclose' },
                })
              }).catch(() => {})
            }
            // Fire the review decision by injecting into the existing /tasks/:id/review route.
            // Using inject() keeps all guards (duplicate closure, QA bundle gate, etc.) intact.
            const reviewComment = `[auto-close] ${autoClose.decision === 'approve' ? 'Approved' : 'Rejected'} via structured [review] comment (comment ID: ${comment.id})`
            setImmediate(() => {
              app.inject({
                method: 'POST',
                url: `/tasks/${resolved.resolvedId}/review`,
                payload: { reviewer: data.author, decision: autoClose.decision, comment: reviewComment },
              }).then(res => {
                if (res.statusCode >= 400) {
                  console.warn(`[review-autoclose] Review injection failed for ${resolved.resolvedId}: ${res.statusCode} ${res.body.slice(0, 120)}`)
                } else {
                  console.log(`[review-autoclose] ${autoClose.decision} fired for ${resolved.resolvedId} by ${data.author}`)
                }
              }).catch((err: unknown) => {
                console.warn(`[review-autoclose] inject error for ${resolved.resolvedId}:`, err)
              })
            })
          }
        }
      }

      // Task-comments are now primary execution comms:
      // fan out inbox-visible notifications to assignee/reviewer + explicit @mentions.
      // Notification routing respects per-agent preferences (quiet hours, mute, filters).
      const task = taskManager.getTask(resolved.resolvedId)

      // ── Transactional review_handoff.comment_id stamping ──
      // If the author tags this comment as the handoff entrypoint, the server stamps
      // metadata.review_handoff.comment_id from the persisted comment ID.
      // This prevents clients from supplying phantom IDs.
      const category = typeof (data as any).category === 'string' ? String((data as any).category).trim().toLowerCase() : ''
      if (task && (category === 'review_handoff' || category === 'handoff')) {
        const meta = (task.metadata || {}) as Record<string, unknown>
        const rh = meta.review_handoff as Record<string, unknown> | undefined
        if (rh && typeof rh === 'object' && !Array.isArray(rh)) {
          const rhAny = rh as any
          if (rhAny.comment_id !== comment.id) {
            taskManager.patchTaskMetadata(task.id, {
              review_handoff: { ...rhAny, comment_id: comment.id },
              review_handoff_comment_id_stamped_at: Date.now(),
            })
          }
        }
      }

      // Never fan out notifications for test-harness tasks.
      // Our repo contains a few "LIVE server" tests (BASE=127.0.0.1:4445) that create
      // tasks/comments with metadata.is_test=true. Without this guard, running `npm test`
      // on a machine with a live node will spam real chat channels and look like a human
      // (e.g. @link) posted the comment.
      const shouldFanOut = task ? !isTestHarnessTask(task) : false

      if (task && !comment.suppressed && shouldFanOut) {
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
      presenceManager.touchPresence(data.author)

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

      const result: Record<string, unknown> = { success: true, comment }
      if (heartbeatWarning) result.heartbeatWarning = heartbeatWarning
      if (invalidRefs.length > 0) {
        result.warning = `${invalidRefs.length} task ID reference(s) not found: ${invalidRefs.join(', ')}`
        result.invalid_task_refs = invalidRefs
        if (Object.keys(suggestions).length > 0) {
          result.suggestions = suggestions
        }
      }
      return result
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

  // ── Cancel a task (convenience endpoint) ──
  app.post<{ Params: { id: string } }>('/tasks/:id/cancel', async (request, reply) => {
    const task = taskManager.getTask(request.params.id)
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }

    if (task.status === 'cancelled') {
      return { success: true, message: 'Task already cancelled', task: enrichTaskWithComments(task) }
    }

    if (task.status === 'done') {
      reply.code(400)
      return { success: false, error: 'Cannot cancel a done task. Use metadata.reopen=true first.' }
    }

    const body = (request.body || {}) as Record<string, unknown>
    const reason = typeof body.reason === 'string' ? body.reason : undefined
    const author = typeof body.author === 'string' ? body.author : 'system'

    if (!reason) {
      reply.code(400)
      return { success: false, error: 'Cancel reason required. Include { "reason": "..." } in request body.' }
    }

    try {
      const updated = await taskManager.updateTask(task.id, {
        status: 'cancelled',
        metadata: {
          ...(task.metadata || {}),
          cancel_reason: reason,
          cancelled_by: author,
          cancelled_at: new Date().toISOString(),
        },
      })

      return { success: true, task: updated ? enrichTaskWithComments(updated) : null }
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Failed to cancel task' }
    }
  })

  // POST /tasks/:id/block-external — mark a task as externally blocked
  // Suppresses idle-detection, suggest-close, and auto-requeue while the flag is set.
  // Required: reason (e.g. "Apple Developer credentials — human action required")
  // Sets metadata.blocked_external=true + metadata.blocked_external_reason
  app.post<{ Params: { id: string } }>('/tasks/:id/block-external', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) return

    const body = request.body as Record<string, unknown>
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      reply.code(400)
      return { success: false, error: 'reason is required — describe the external dependency (e.g. "Apple Developer credentials — human action required")' }
    }

    const task = resolved.task
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }

    const updatedMetadata = {
      ...(task.metadata || {}),
      blocked_external: true,
      blocked_external_reason: reason,
      blocked_external_at: Date.now(),
    }

    const updated = await taskManager.updateTask(resolved.resolvedId, { metadata: updatedMetadata })
    if (!updated) {
      reply.code(500)
      return { success: false, error: 'Failed to update task' }
    }

    reply.code(200)
    return {
      success: true,
      task: { id: updated.id, status: updated.status, blocked_external: true, reason },
      message: `Task marked as externally blocked. Idle detection and auto-requeue suppressed until unblocked.`,
    }
  })

  // POST /tasks/:id/unblock-external — remove the externally-blocked flag
  app.post<{ Params: { id: string } }>('/tasks/:id/unblock-external', async (request, reply) => {
    const resolved = resolveTaskFromParam(request.params.id, reply)
    if (!resolved) return

    const task = resolved.task
    if (!task) {
      reply.code(404)
      return { success: false, error: 'Task not found' }
    }

    if (!task.metadata?.blocked_external) {
      reply.code(400)
      return { success: false, error: 'Task is not marked as externally blocked' }
    }

    const { blocked_external, blocked_external_reason, blocked_external_at, ...restMetadata } = (task.metadata || {}) as Record<string, unknown>
    void blocked_external; void blocked_external_reason; void blocked_external_at

    const updated = await taskManager.updateTask(resolved.resolvedId, { metadata: restMetadata })
    if (!updated) {
      reply.code(500)
      return { success: false, error: 'Failed to update task' }
    }

    reply.code(200)
    return {
      success: true,
      task: { id: updated.id, status: updated.status },
      message: 'External block removed. Task is now eligible for idle detection and auto-requeue.',
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

    // AC: Stale review guard — reject if task is no longer in validating.
    // Prevents stale review notifications from being acted on after a task has moved on.
    // Skipped in test environment (NODE_ENV=test) — test fixtures skip the validating gate.
    if (process.env.NODE_ENV !== 'test' && task.status !== 'validating') {
      reply.code(409)
      const rh = (task.metadata as Record<string, unknown> | null)?.review_handoff as Record<string, unknown> | undefined
      const staleArtifactLink = (rh?.pr_url || rh?.artifact_path || null) as string | null
      return {
        success: false,
        error: `Review rejected: task is ${task.status}, not validating. This review request is stale.`,
        code: 'REVIEW_STALE',
        task_status: task.status,
        ...(staleArtifactLink ? { artifact_link: staleArtifactLink } : {}),
      }
    }

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

    // ── Artifact link guard: review approval requires at least one artifact ref ──
    // Accepts: PR URL (github.com/…/pull/N), PR shorthand (#N or PR #N),
    //          a process/ or docs/ path, or a file path with an extension.
    // Skip when task is in rejected/needs-author state (allow re-review after fixes).
    const taskMeta = (task.metadata ?? {}) as Record<string, unknown>
    const reviewHandoff = taskMeta.review_handoff as Record<string, unknown> | undefined
    const qaBundle = taskMeta.qa_bundle as Record<string, unknown> | undefined
    const reviewPacket = qaBundle?.review_packet as Record<string, unknown> | undefined

    const artifactFromMeta = reviewHandoff?.pr_url
      ?? reviewPacket?.pr_url
      ?? reviewHandoff?.artifact_path
      ?? reviewPacket?.artifact_path
      ?? qaBundle?.artifact_path
      ?? taskMeta?.artifact_path  // root-level artifact_path (legacy / test harness)

    const ARTIFACT_PATTERNS = [
      /github\.com\/.+\/pull\/\d+/i,
      /^(PR\s*#?\d+|#\d+)$/i,
      /process\/TASK-/i,
      /\.\w{2,6}$/,     // any file with extension
      /^https?:\/\//i,  // any URL
    ]
    const hasArtifact = Boolean(artifactFromMeta)
      || ARTIFACT_PATTERNS.some(p => p.test(String(body.comment || '')))

    if (!hasArtifact && process.env.NODE_ENV !== 'test') {
      reply.code(400)
      return {
        success: false,
        error: 'Review requires an artifact link',
        code: 'REVIEW_MISSING_ARTIFACT',
        hint: 'Include a PR URL, PR #N, or process/TASK-*.md path in the task metadata (review_handoff.pr_url or qa_bundle.review_packet.artifact_path), or reference it in your comment.',
        artifact_url: reviewHandoff?.pr_url ?? reviewPacket?.pr_url ?? undefined,
      }
    }

    // Detect self-review: reviewer approving their own task
    if (task.reviewer && task.assignee && task.reviewer.trim().toLowerCase() === task.assignee.trim().toLowerCase()) {
      import('./trust-events.js').then(({ emitTrustEvent }) => {
        emitTrustEvent({
          agentId: body.reviewer,
          eventType: 'self_review_violation',
          context: { taskId: task.id, taskTitle: task.title, reviewer: task.reviewer, assignee: task.assignee, decision: body.decision },
        })
      }).catch(() => {})
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

    // ── Auto-transition: approved validating → done ──
    const autoTransition = isApprove && task.status === 'validating'

    if (autoTransition) {
      const candidateMeta = {
        ...mergedMetadata,
        auto_closed: true,
        auto_closed_at: decidedAt,
        auto_close_reason: 'review_approved',
        completed_at: decidedAt,
      }
      const dupeErr = getDuplicateClosureCanonicalRefError(candidateMeta)
      if (dupeErr) {
        reply.code(409)
        return {
          success: false,
          error: `Auto-close blocked: duplicate closure missing canonical refs. ${dupeErr}. Set metadata.duplicate_of + canonical_pr + canonical_commit and resubmit before approving.`,
        }
      }
    }

    const updated = await taskManager.updateTask(task.id, {
      ...(autoTransition ? { status: 'done' as const } : {}),
      metadata: {
        ...mergedMetadata,
        ...(autoTransition ? {
          auto_closed: true,
          auto_closed_at: decidedAt,
          auto_close_reason: 'review_approved',
          completed_at: decidedAt,
        } : {}),
      },
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

    // ── Cinematic beat: fire canvas_milestone on task completion ──
    if (autoTransition && updated) {
      const completedAt = decidedAt
      const startedAt = (task.metadata as any)?.started_at as number | undefined
      const ageMs = completedAt - (task.createdAt ?? completedAt)
      const doingMs = startedAt ? completedAt - startedAt : 0

      // intensity: age-weighted (30min+ = significant) + doing-duration bonus
      const ageScore = Math.min(ageMs / (30 * 60 * 1000), 1)           // 30min → 1.0
      const doingScore = Math.min(doingMs / (60 * 60 * 1000), 0.3)     // 1h doing → +0.3
      const intensity = Math.min(Math.max(ageScore * 0.7 + doingScore + 0.15, 0.15), 1.0)

      const assigneeId = updated.assignee ?? task.assignee ?? getAgentRoles()[0]?.name ?? 'system'
      const milestoneColor = getIdentityColor(assigneeId, '#60a5fa')

      setImmediate(() => {
        eventBus.emit({
          id: `milestone-${completedAt}-${task.id.slice(-6)}`,
          type: 'canvas_milestone' as const,
          timestamp: completedAt,
          data: {
            agentId: assigneeId,
            title: updated.title,
            taskId: task.id,
            intensity,
            ageMs,
            milestoneColor,
            channels: {
              visual: { flash: milestoneColor, particles: intensity > 0.7 ? 'surge' : 'drift' },
              narrative: `${assigneeId} shipped: ${updated.title?.slice(0, 60) ?? 'task'}`,
            },
          },
        })

        // canvas_artifact: proof card drifts through canvas on task completion
        eventBus.emit({
          id: `artifact-${completedAt}-${task.id.slice(-6)}`,
          type: 'canvas_artifact' as const,
          timestamp: completedAt,
          data: {
            type: 'approval',
            agentId: assigneeId,
            agentColor: milestoneColor,
            title: updated.title?.slice(0, 80) ?? 'task done',
            taskId: task.id,
            timestamp: completedAt,
          },
        })

        // Auto-paint canvas on task completion — the room reflects real work
        // Brief visual moment showing what was shipped (task-1773689755389-ux4bbn1lo)
        const shortTitle = (updated.title ?? 'task').slice(0, 60)
        const pushSvg = `<svg viewBox="0 0 800 200" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="200" fill="transparent"/><text x="400" y="80" text-anchor="middle" fill="${milestoneColor}" font-size="24" font-family="monospace" font-weight="bold" opacity="0.8">✓ shipped</text><text x="400" y="120" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="16" font-family="monospace">${shortTitle.replace(/[<>&"']/g, '')}</text><text x="400" y="155" text-anchor="middle" fill="${milestoneColor}" font-size="12" font-family="monospace" opacity="0.4">${assigneeId}</text></svg>`
        eventBus.emit({
          id: `ship-visual-${completedAt}-${task.id.slice(-6)}`,
          type: 'canvas_push' as const,
          timestamp: completedAt,
          data: {
            agentId: assigneeId,
            type: 'rich',
            content: { svg: pushSvg, title: `${assigneeId} shipped: ${shortTitle}` },
            layer: 'stage',
            position: { x: 0.5, y: 0.3 },
            size: { w: 0.5, h: 0.2 },
            ttl: 15_000,
          },
        })
        queueCanvasPushEvent({
          type: 'canvas_push',
          agentId: assigneeId,
          content: { svg: pushSvg, title: `${assigneeId} shipped: ${shortTitle}` },
          layer: 'stage',
          position: { x: 0.5, y: 0.3 },
          size: { w: 0.5, h: 0.2 },
          ttl: 15_000,
          t: completedAt,
        })
      })
    }

    return {
      success: true,
      decision: {
        taskId: task.id,
        reviewer: body.reviewer,
        decision: decisionLabel,
        comment: body.comment,
        decidedAt,
        // AC: Surface artifact link so reviewer can navigate without copy-paste.
        artifact_link: (artifactFromMeta as string | undefined) ?? null,
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
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description', 'metadata.source', 'metadata.steps_to_reproduce'],
      min_done_criteria: 1,
      title_hint: 'Describe what is broken: "Bug: [component] — [symptom] when [action]"',
      example: {
        title: 'Bug: dashboard login — 500 error when SSO callback missing state param',
        type: 'bug',
        assignee: '<builder-agent>',
        reviewer: '<lead-agent>',
        done_criteria: ['SSO callback handles missing state param gracefully (redirect to /auth with error)', 'No 500 in production logs for this code path'],
        eta: '~2h',
        priority: 'P1',
        createdBy: '<lead-agent>',
        metadata: { source: 'internal-dogfooding' },
      },
    },
    feature: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description', 'metadata.spec_link'],
      min_done_criteria: 2,
      title_hint: 'Describe the user-facing outcome: "Feature: [what] — [user benefit]"',
      example: {
        title: 'Feature: host activity feed — show last 10 events per host on dashboard',
        type: 'feature',
        assignee: '<builder-agent>',
        reviewer: '<lead-agent>',
        done_criteria: ['Dashboard shows last 10 activity events per host', 'Events include heartbeats, claims, syncs with timestamps'],
        eta: '~4h',
        priority: 'P2',
        createdBy: '<lead-agent>',
      },
    },
    process: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description'],
      min_done_criteria: 1,
      title_hint: 'Describe the process change: "Process: [what changes] — [why]"',
      example: {
        title: 'Process: enforce task intake schema — reject vague tasks at creation',
        type: 'process',
        assignee: '<builder-agent>',
        reviewer: '<lead-agent>',
        done_criteria: ['Task creation rejects without required fields', 'Templates available per type'],
        eta: '~2h',
        priority: 'P2',
        createdBy: '<lead-agent>',
      },
    },
    docs: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'createdBy', 'priority', 'type'],
      recommended_fields: ['description', 'metadata.doc_path'],
      min_done_criteria: 1,
      title_hint: 'Describe what docs need: "Docs: [topic] — [what is missing/wrong]"',
      example: {
        title: 'Docs: enrollment handshake — document connect flow for agents',
        type: 'docs',
        assignee: '<ops-agent>',
        reviewer: '<lead-agent>',
        done_criteria: ['Connect flow documented with steps and code examples'],
        eta: '~2h',
        priority: 'P3',
        createdBy: '<lead-agent>',
      },
    },
    chore: {
      required_fields: ['title', 'assignee', 'reviewer', 'done_criteria', 'createdBy', 'priority'],
      recommended_fields: ['description'],
      min_done_criteria: 1,
      title_hint: 'Describe the maintenance task: "Chore: [what] — [why now]"',
      example: {
        title: 'Chore: clean up stale branches — 15+ unmerged branches from last sprint',
        type: 'chore',
        assignee: '<builder-agent>',
        reviewer: '<lead-agent>',
        done_criteria: ['All branches older than 2 weeks merged or deleted'],
        eta: '~1h',
        priority: 'P4',
        createdBy: '<lead-agent>',
      },
    },
  }

  // Task intake schema (discovery endpoint)
  app.get('/tasks/intake-schema', async () => {
    return {
      required: ['title', 'assignee', 'done_criteria', 'createdBy', 'priority'],
      optional: ['eta', 'type', 'description', 'status', 'blocked_by', 'epic_id', 'tags', 'teamId', 'metadata', 'reviewer'],
      notes: {
        reviewer: 'Defaults to "auto" — load-balanced assignment based on role, affinity, and SLA risk. Set explicitly to override.',
        eta: 'Optional. If absent, defaults to ~2h (P0/P1) or ~4h (P2/P3) when status transitions to doing. Provide explicit ETA for better SLA tracking.',
      },
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
      // Normalize legacy "in-progress" → "doing" before schema validation
      const rawPostBody = request.body as Record<string, unknown>
      if (rawPostBody && typeof rawPostBody === 'object' && rawPostBody.status === 'in-progress') {
        rawPostBody.status = 'doing'
      }
      const data = CreateTaskSchema.parse(rawPostBody)

      // Reject TEST: prefixed tasks in production to prevent CI pollution
      if (process.env.NODE_ENV === 'production' && typeof data.title === 'string' && data.title.startsWith('TEST:')) {
        reply.code(400)
        return { success: false, error: 'TEST: prefixed tasks are not allowed in production', code: 'TEST_TASK_REJECTED' }
      }

      // ── Task creation dedup: reject identical or near-duplicate tasks ──
      // Two tiers:
      //   Tier 1 (60s, exact, same-assignee) — reconnect double-fire collapse
      //   Tier 2 (24h, fuzzy ≥80% Jaccard, any-assignee) — continuity-loop dupe prevention
      const skipDedup = data.title.startsWith('TEST:')
        || (data.metadata as Record<string, unknown> | undefined)?.skip_dedup === true
        || (data.metadata as Record<string, unknown> | undefined)?.is_test === true
      if (!skipDedup) {
        const now = Date.now()
        const normalizedTitle = data.title.trim().toLowerCase()
        const activeTasks = taskManager.listTasks({}).filter(t =>
          t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'resolved_externally'
        )

        // Tier 1: exact-title same-assignee within 60s (reconnect collapse)
        if (data.assignee) {
          const EXACT_WINDOW_MS = 60_000
          const tier1Match = activeTasks.find(t =>
            t.assignee === data.assignee
            && t.createdAt >= now - EXACT_WINDOW_MS
            && t.title.trim().toLowerCase() === normalizedTitle
          )
          if (tier1Match) {
            return {
              success: true,
              task: tier1Match,
              deduplicated: true,
              dedup_tier: 'exact-60s',
              hint: `Duplicate suppressed — task "${tier1Match.title}" already exists for ${data.assignee} (${tier1Match.id}, created ${Math.round((now - tier1Match.createdAt) / 1000)}s ago).`,
            }
          }
        }

        // Tier 2: fuzzy-match (≥80% Jaccard word overlap) within 24h — catches continuity-loop dupes
        // Scoped to same-assignee: different agents may legitimately work on same-named tasks.
        if (data.assignee) {
          const FUZZY_WINDOW_MS = 24 * 60 * 60 * 1000
          const FUZZY_THRESHOLD = 0.80
          const newWords = new Set(normalizedTitle.split(/\s+/).filter((w: string) => w.length > 3))
          if (newWords.size >= 3) { // only fuzzy-check tasks with enough words to compare
            const cutoff24h = now - FUZZY_WINDOW_MS
            let bestFuzzy: { task: typeof activeTasks[0]; overlap: number } | null = null
            for (const existing of activeTasks) {
              if (existing.assignee !== data.assignee) continue // different agent — allowed
              if (existing.createdAt < cutoff24h) continue
              const existingWords = new Set(existing.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3))
              const intersection = [...newWords].filter((w: string) => existingWords.has(w))
              const union = new Set([...newWords, ...existingWords])
              const overlap = union.size > 0 ? intersection.length / union.size : 0
              if (overlap >= FUZZY_THRESHOLD && (!bestFuzzy || overlap > bestFuzzy.overlap)) {
                bestFuzzy = { task: existing, overlap }
              }
            }
            if (bestFuzzy) {
              // Emit trust event when a continuity-loop dupe is caught
              import('./trust-events.js').then(({ emitTrustEvent }) => {
                emitTrustEvent({
                  agentId: data.assignee || data.createdBy || 'unknown',
                  eventType: 'false_assertion',
                  taskId: bestFuzzy!.task.id,
                  summary: `Duplicate task prevented: "${data.title}" is ${Math.round(bestFuzzy!.overlap * 100)}% similar to existing "${bestFuzzy!.task.title}" (${bestFuzzy!.task.id})`,
                  context: { newTitle: data.title, existingId: bestFuzzy!.task.id, similarity: bestFuzzy!.overlap },
                })
              }).catch(() => {})
              reply.code(409)
              return {
                success: false,
                error: 'Duplicate task detected',
                code: 'TASK_DUPLICATE',
                duplicateOf: bestFuzzy.task.id,
                similarity: Math.round(bestFuzzy.overlap * 100) / 100,
                hint: `Use batch-create with deduplicate:true, or use a more specific title. Existing task: "${bestFuzzy.task.title}" (${bestFuzzy.task.id}, status: ${bestFuzzy.task.status}).`,
              }
            }
          }
        }
      }

      // Definition-of-ready check (skip for TEST: tasks and test environment)
      const skipDoR = data.title.startsWith('TEST:') || process.env.NODE_ENV === 'test'
      if (!skipDoR) {
        const readinessProblems = checkDefinitionOfReady(data)
        if (readinessProblems.length > 0) {
          const isUserCreated = !data.createdBy || data.createdBy === 'user'
          const hasEmptyCriteria = !data.done_criteria || data.done_criteria.length === 0
          const hasOnlyPlaceholders = data.done_criteria?.length > 0
            && data.done_criteria.every((c: string) => DONE_CRITERIA_PLACEHOLDER_RE.test(c))

          // Human-created tasks with only empty done_criteria: warn-and-allow (not block).
          // Placeholder text always blocks (for both humans and agents).
          // Agent-created tasks (createdBy != 'user') always block on any DoR failure.
          if (isUserCreated && hasEmptyCriteria && !hasOnlyPlaceholders) {
            // Warn only — pass through to creation with warnings appended below
            // (readinessProblems will be added to creationWarnings)
          } else {
            // Block: agent-created tasks, placeholder criteria, or other DoR failures
            if (hasEmptyCriteria || hasOnlyPlaceholders) {
              const createdBy = typeof data.createdBy === 'string' ? data.createdBy : 'unknown'
              import('./trust-events.js').then(({ emitTrustEvent }) => {
                emitTrustEvent({
                  agentId: createdBy,
                  eventType: 'missing_acceptance_criteria_block',
                  context: { taskTitle: data.title, assignee: data.assignee, createdBy },
                })
              }).catch(() => {})
            }
            reply.code(400)
            return {
              success: false,
              error: 'Task does not meet definition of ready',
              code: 'DEFINITION_OF_READY',
              problems: readinessProblems,
              hint: isUserCreated
                ? 'Placeholder done_criteria not accepted. Replace with concrete, verifiable outcomes.'
                : 'Fix the listed problems and retry. Tasks must have specific titles, verifiable done criteria, priority, and reviewer.',
            }
          }
        }
      }


      // Warn-only: encourage lane/surface metadata for routing discipline.
      // (Do not block creation yet; onboarding still needs to be lightweight.)
      const creationWarnings: string[] = []

      // For human-created tasks with empty done_criteria: warn-and-allow path
      // (agent-created tasks were blocked above; this only runs for createdBy='user')
      if (!skipDoR) {
        const isUserCreated = !data.createdBy || data.createdBy === 'user'
        const hasEmptyCriteria = !data.done_criteria || data.done_criteria.length === 0
        if (isUserCreated && hasEmptyCriteria) {
          creationWarnings.push(
            'done_criteria is empty. Add at least 1 verifiable outcome before moving to doing. ' +
            'Tasks without acceptance criteria cannot be validated or closed.'
          )
        }
      }

      const metaIn = (data.metadata || {}) as Record<string, unknown>
      const lane = String((metaIn as any).lane || '').trim()
      const surface = String((metaIn as any).surface || '').trim()
      if (!lane) creationWarnings.push('metadata.lane missing (recommended: design|product|infra|ops|growth)')
      if (!surface) creationWarnings.push('metadata.surface missing (recommended: reflectt-node|reflectt-cloud-app|reflectt.ai|infra)')

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
            // No suggestion available — fall back to first known agent
            rest.reviewer = getAgentRoles()[0]?.name
            reviewerAutoAssigned = rest.reviewer !== undefined
          }
        } catch {
          rest.reviewer = getAgentRoles()[0]?.name
          reviewerAutoAssigned = rest.reviewer !== undefined
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

      
      // Touch presence: creating tasks proves the agent is alive, but shouldn't
      // override task-derived status (e.g. agent filing a task while reviewing)
      if (data.createdBy) {
        presenceManager.touchPresence(data.createdBy)
      }

      // Fire-and-forget: index task for semantic search
      if (!data.title.startsWith('TEST:')) {
        import('./vector-store.js')
          .then(({ indexTask }) => indexTask(task.id, task.title, undefined, data.done_criteria))
          .catch(() => {})
      }

      // Auto-link insight when task is manually created with source_insight metadata.
      // Mirrors the bridge's updateInsightStatus call so insights don't stay pending_triage
      // after an agent manually files a task addressing them.
      const sourceInsightId = typeof newMetadata.source_insight === 'string' ? newMetadata.source_insight : null
      if (sourceInsightId && !sourceInsightId.startsWith('ins-test-')) {
        try {
          const linkedInsight = getInsight(sourceInsightId)
          if (linkedInsight && linkedInsight.status !== 'task_created' && linkedInsight.status !== 'closed') {
            updateInsightStatus(sourceInsightId, 'task_created', task.id)
          }
        } catch {
          // Non-fatal: insight link failure must not block task creation
        }
      }

      trackTaskEvent('created')
      return { success: true, task: enrichTaskWithComments(task), warnings: creationWarnings }
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
            const activeTasks = existingTasks.filter(t => t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'resolved_externally')
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

  // ── Bulk-close — maintenance cycle + board cleanup ──────────────────────────
  // Closes tasks that are in validating with reviewer_approved=true, or already done.
  // Skips tasks requiring manual gate work; returns granular per-task result.
  app.post('/tasks/bulk-close', async (request, reply) => {
    try {
      const { ids, reason } = z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        reason: z.string().trim().optional(),
      }).parse(request.body)

      const closed: string[] = []
      const skipped: Array<{ id: string; reason: string }> = []
      const errors: Array<{ id: string; error: string }> = []

      for (const rawId of ids) {
        const lookup = taskManager.resolveTaskId(rawId)
        if (lookup.matchType === 'ambiguous') {
          errors.push({ id: rawId, error: `Ambiguous task ID — use a longer prefix` })
          continue
        }
        const task = lookup.task
        if (!task || !lookup.resolvedId) {
          errors.push({ id: rawId, error: 'Task not found' })
          continue
        }

        if (task.status === 'done' || task.status === 'cancelled') {
          skipped.push({ id: lookup.resolvedId, reason: `already ${task.status}` })
          continue
        }

        if (task.status !== 'validating') {
          skipped.push({ id: lookup.resolvedId, reason: `status is "${task.status}" — only validating tasks can be bulk-closed` })
          continue
        }

        // Require explicit reviewer approval flag OR a close_reason override (duplicate/superseded)
        const meta = (task.metadata || {}) as Record<string, unknown>
        const closeReason = reason ?? (typeof meta.close_reason === 'string' ? meta.close_reason : '')
        const reviewerApproved = meta.reviewer_approved === true
        const isDupOrSuperseded = closeReason === 'duplicate' || closeReason === 'superseded'

        if (!reviewerApproved && !isDupOrSuperseded) {
          skipped.push({
            id: lookup.resolvedId,
            reason: 'no reviewer_approved=true and no close_reason=duplicate/superseded — manual gate required',
          })
          continue
        }

        try {
          const closeMeta: Record<string, unknown> = {
            ...meta,
            bulk_closed: true,
            bulk_closed_at: Date.now(),
          }
          if (closeReason) closeMeta.close_reason = closeReason

          await taskManager.updateTask(lookup.resolvedId, {
            status: 'done',
            metadata: closeMeta,
          })
          closed.push(lookup.resolvedId)
        } catch (err: any) {
          errors.push({ id: lookup.resolvedId, error: err.message ?? 'update failed' })
        }
      }

      return {
        success: true,
        closed,
        skipped,
        errors,
        summary: { total: ids.length, closed: closed.length, skipped: skipped.length, errors: errors.length },
      }
    } catch (err: any) {
      reply.code(400)
      return { success: false, error: err.message || 'Bulk close failed' }
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
      const todoTasks = agentTasks.filter(t => t.status === 'todo')
      const todo = todoTasks.length
      const active = doing + validating
      const outOfLaneCount = flaggedByAgent.get(agent.toLowerCase()) || 0

      // Ready-floor breakdown: unblocked vs blocked
      const unblockedTodo = todoTasks.filter(t => {
        const blocked = (t.metadata as Record<string, unknown> | undefined)?.blocked_by
        if (!blocked) return true
        const blocker = taskManager.getTask(blocked as string)
        return !blocker || blocker.status === 'done'
      })
      const blockedTodo = todoTasks.filter(t => !unblockedTodo.includes(t))

      return {
        agent,
        doing,
        validating,
        todo,
        todoUnblocked: unblockedTodo.length,
        todoBlocked: blockedTodo.length,
        blockedTasks: blockedTodo.slice(0, 5).map(t => ({
          id: t.id,
          title: (t.title || '').slice(0, 60),
          blockedBy: (t.metadata as Record<string, unknown> | undefined)?.blocked_by || null,
        })),
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

  // ── Validating-lane health: reviewer inactivity vs evidence mismatch breakdown ──
  // GET /tasks/validating-health?reviewer_stale_threshold_ms=7200000
  // Returns per-task breakdown for all validating tasks + summary counts.
  app.get<{ Querystring: { reviewer_stale_threshold_ms?: string; include_test?: string } }>(
    '/tasks/validating-health',
    async (request) => {
      const query = request.query
      const reviewerStaleThresholdMs = query.reviewer_stale_threshold_ms
        ? Math.max(0, Number(query.reviewer_stale_threshold_ms))
        : 2 * 60 * 60 * 1000 // default 2h
      const includeTest = query.include_test === '1' || query.include_test === 'true'

      const now = Date.now()
      const validatingTasks = taskManager.listTasks({ status: 'validating', includeTest })

      const taskDetails = validatingTasks.map(task => {
        const meta = (task.metadata ?? {}) as Record<string, unknown>
        const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
        const reviewPacket = qaBundle?.review_packet as Record<string, unknown> | undefined
        const reviewHandoff = meta.review_handoff as Record<string, unknown> | undefined

        // PR link presence
        const prUrl = (reviewPacket?.pr_url ?? reviewHandoff?.pr_url ?? null) as string | null
        const hasPrLink = Boolean(prUrl && typeof prUrl === 'string' && prUrl.includes('github.com'))

        // Merged evidence: canonical_commit set = PR merged and stamped
        const canonicalCommit = (meta.canonical_commit ?? reviewPacket?.commit ?? null) as string | null
        const prMerged = Boolean(canonicalCommit && typeof canonicalCommit === 'string' && canonicalCommit.length >= 7)

        // Artifact path presence
        const artifactPath = (reviewPacket?.artifact_path ?? reviewHandoff?.artifact_path ?? null) as string | null
        const hasArtifact = Boolean(artifactPath)

        // Evidence missing: no PR link or no merged evidence and no artifact
        const evidenceMissing = !hasPrLink && !hasArtifact

        // Reviewer activity: look for a comment from the reviewer
        const reviewer = task.reviewer ?? null
        let reviewerLastActiveAt: number | null = null
        if (reviewer) {
          const comments = taskManager.getTaskComments(task.id)
          const reviewerComments = comments.filter(c => c.author === reviewer && !c.suppressed)
          if (reviewerComments.length > 0) {
            reviewerLastActiveAt = Math.max(...reviewerComments.map(c => c.timestamp))
          }
        }

        const taskAgeMs = now - (task.updatedAt ?? task.createdAt ?? now)
        const reviewerStale = reviewer !== null
          && reviewerLastActiveAt === null
          && taskAgeMs > reviewerStaleThresholdMs

        // Failure mode classification
        const failureMode: 'reviewer_stale' | 'evidence_missing' | 'both' | 'ok' =
          reviewerStale && evidenceMissing ? 'both'
            : reviewerStale ? 'reviewer_stale'
              : evidenceMissing ? 'evidence_missing'
                : 'ok'

        return {
          task_id: task.id,
          title: task.title,
          reviewer,
          age_ms: now - (task.createdAt ?? now),
          updated_age_ms: taskAgeMs,
          has_pr_link: hasPrLink,
          pr_url: prUrl,
          pr_merged: prMerged,
          has_artifact: hasArtifact,
          reviewer_last_active_at: reviewerLastActiveAt,
          reviewer_active_recently: reviewerLastActiveAt !== null
            && (now - reviewerLastActiveAt) <= reviewerStaleThresholdMs,
          reviewer_stale: reviewerStale,
          evidence_missing: evidenceMissing,
          failure_mode: failureMode,
        }
      })

      // Summary counts
      const summary = {
        total: taskDetails.length,
        ok: taskDetails.filter(t => t.failure_mode === 'ok').length,
        reviewer_stale: taskDetails.filter(t => t.failure_mode === 'reviewer_stale' || t.failure_mode === 'both').length,
        evidence_missing: taskDetails.filter(t => t.failure_mode === 'evidence_missing' || t.failure_mode === 'both').length,
        both: taskDetails.filter(t => t.failure_mode === 'both').length,
      }

      return {
        success: true,
        reviewer_stale_threshold_ms: reviewerStaleThresholdMs,
        summary,
        tasks: taskDetails,
      }
    },
  )

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

  app.post('/board-health/quiet-window', async () => {
    boardHealthWorker.resetQuietWindow()
    return {
      success: true,
      quietUntil: Date.now() + (boardHealthWorker.getStatus().config?.restartQuietWindowMs ?? 300_000),
      message: 'Quiet window reset — ready-queue alerts suppressed for restart window',
    }
  })

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

  // Comms routing policy simulator — evaluate scenarios against a policy
  // POST /routing/simulate
  // Body: { policy: CommsRoutingPolicy, scenarios: RoutingScenario[] }
  // Returns: { success, count, results: CommsRouteResult[] }
  app.post('/routing/simulate', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const policy = body.policy as CommsRoutingPolicy | undefined
    const scenarios = body.scenarios as RoutingScenario[] | undefined

    if (!policy || typeof policy !== 'object') {
      reply.status(400)
      return { success: false, message: 'Missing required field: policy (CommsRoutingPolicy)' }
    }
    if (!Array.isArray(scenarios) || scenarios.length === 0) {
      reply.status(400)
      return { success: false, message: 'Missing required field: scenarios (non-empty array)' }
    }
    if (scenarios.length > 100) {
      reply.status(400)
      return { success: false, message: 'Too many scenarios: max 100 per request' }
    }

    const results = simulateRoutingScenarios(scenarios, policy)
    return { success: true, count: results.length, results }
  })

  // ── Voice API ──────────────────────────────────────────────────────────────

  // POST /voice/input — create a voice session + begin processing
  // Body: { agentId: string, transcript?: string }
  // Returns: { sessionId }
  app.post('/voice/input', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''

    if (!agentId) {
      reply.status(400)
      return { success: false, message: 'agentId is required' }
    }
    if (!transcript) {
      reply.status(400)
      return { success: false, message: 'transcript is required (audio STT not yet supported)' }
    }
    if (transcript.length > 4000) {
      reply.status(400)
      return { success: false, message: 'transcript too long (max 4000 chars)' }
    }

    const session = createVoiceSession(agentId)

    // Helper: push activeSpeaker signal into canvas state so orb reacts
    const setActiveSpeaker = (active: boolean) => {
      const existing = canvasStateMap.get(agentId)
      if (existing) {
        canvasStateMap.set(agentId, {
          ...existing,
          payload: { ...(existing.payload as Record<string, unknown>), activeSpeaker: active },
          updatedAt: Date.now(),
        })
        eventBus.emit({
          id: `crender-voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'canvas_render' as const,
          timestamp: Date.now(),
          data: {
            state: existing.state,
            sensors: existing.sensors,
            agentId,
            payload: { ...(existing.payload as Record<string, unknown>), activeSpeaker: active },
            presence: {
              name: agentId,
              identityColor: getIdentityColor(agentId),
              state: (existing.payload as any)?.presenceState ?? 'working',
              activeSpeaker: active,
              activeTask: (existing.payload as any)?.activeTask,
              recency: 'just now',
            },
          },
        })
        requestImmediateCanvasSync()
      }
    }

    // Build agent system context for the LLM responder
    const agentRole = getAgentRole(agentId)
    const agentSystemPrompt = agentRole
      ? `You are ${agentId}, a ${agentRole.role ?? 'team agent'} on Team Reflectt. ${agentRole.description ?? ''} Respond concisely — your reply will be spoken aloud. 1-3 sentences max.`
      : `You are ${agentId}, a team agent. Respond concisely — your reply will be spoken aloud. 1-3 sentences max.`

    // Kick off async processing — do not await so we return sessionId immediately
    const agentResponder = async (respAgentId: string, text: string, _sessionId: string): Promise<string | null> => {
      setActiveSpeaker(false)

      // Try real LLM call if ANTHROPIC_API_KEY is set
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      if (anthropicKey) {
        try {
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 256,
              system: agentSystemPrompt,
              messages: [{ role: 'user', content: text }],
            }),
            signal: AbortSignal.timeout(15000),
          })
          if (resp.ok) {
            const data = await resp.json() as { content?: Array<{ text?: string }> }
            const reply = data.content?.[0]?.text?.trim()
            if (reply) return reply
          }
        } catch (err) {
          console.error(`[voice] LLM call failed for ${respAgentId}:`, err)
          // fall through to stub
        }
      }

      // Stub fallback — always available, no key required
      await new Promise(resolve => setTimeout(resolve, 400))
      return `Received: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`
    }

    // Generic fallback voice for agents that haven't claimed their own.
    // Agent-claimed voices (via identity/claim → agent_config) take priority.
    const ELEVENLABS_DEFAULT_VOICE = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'

    // ── Voice mutex — only one agent speaks at a time ──────────────────
    // P0 fix: multiple agents were triggering TTS simultaneously, causing
    // overlapping audio on the canvas. Queue ensures serial playback.
    // task-1773686058943-v17yrucjr
    const voiceQueue: Array<{ text: string; agentId: string; resolve: (v: string | null) => void }> = []
    let voiceSpeaking = false

    const processVoiceQueue = async () => {
      if (voiceSpeaking || voiceQueue.length === 0) return
      voiceSpeaking = true
      const item = voiceQueue.shift()!
      try {
        const result = await synthesizeTtsInternal(item.text, item.agentId)
        item.resolve(result)
      } catch {
        item.resolve(null)
      }
      voiceSpeaking = false
      if (voiceQueue.length > 0) setTimeout(processVoiceQueue, 500)
    }

    // Synthesize TTS via ElevenLabs if key is set
    const synthesizeTts = async (text: string, forAgentId: string): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        voiceQueue.push({ text, agentId: forAgentId, resolve })
        processVoiceQueue()
      })
    }

    const synthesizeTtsInternal = async (text: string, forAgentId: string): Promise<string | null> => {
      const elevenKey = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY

      // Fire canvas_expression alongside TTS — the room responds when an agent speaks.
      // Non-blocking: emit first, synthesize in parallel.
      const claimedColor = getIdentityColor(forAgentId, '#60a5fa')
      eventBus.emit({
        id: `voice-expr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'canvas_expression' as const,
        timestamp: Date.now(),
        data: {
          agentId: forAgentId,
          channels: {
            voice: text.slice(0, 300),
            visual: { flash: claimedColor, particles: 'surge' },
            narrative: `${forAgentId} responds`,
          },
        },
      })

      if (!elevenKey) return null
      // Prefer voice stored in agent_config (set during identity claim) over hardcoded map
      const agentConfigRow = getDb().prepare('SELECT settings FROM agent_config WHERE agent_id = ?').get(forAgentId) as { settings: string } | undefined
      const agentConfigVoice: string | undefined = agentConfigRow ? (() => { try { return JSON.parse(agentConfigRow.settings)?.voice } catch { return undefined } })() : undefined
      const voiceId = agentConfigVoice ?? ELEVENLABS_DEFAULT_VOICE
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': elevenKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({ text: text.slice(0, 500), model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
            signal: AbortSignal.timeout(20000),
          }
        )
        if (!res.ok) return null
        const buf = Buffer.from(await res.arrayBuffer())
        // Return as data URI so the client can play it without a second request
        return `data:audio/mpeg;base64,${buf.toString('base64')}`
      } catch {
        return null
      }
    }

    // Subscribe to voice events to drive canvas state
    const unsubVoice = subscribeVoiceSession(session.id, (event) => {
      if (event.type === 'agent.thinking') {
        // Agent is processing — keep existing canvas state (thinking is already set via presence)
      } else if (event.type === 'tts.ready') {
        // Agent is now speaking — activate orb waveform/scale
        setActiveSpeaker(true)
      } else if (event.type === 'session.end' || event.type === 'error') {
        // Clear speaker state
        setActiveSpeaker(false)
        unsubVoice()
      }
    })

    processVoiceTranscript(session.id, transcript, agentResponder, synthesizeTts).catch(err => {
      console.error('[voice] processVoiceTranscript error:', err)
      unsubVoice()
    })

    return { success: true, sessionId: session.id }
  })

  // POST /voice/audio — accept an audio blob, transcribe via STT, pipe to voice pipeline
  // Completes the full speak→STT→LLM→TTS loop.
  // Form fields: agentId (string), audio (file: wav/mp3/webm/ogg/m4a)
  // Returns: { sessionId }
  app.post('/voice/audio', async (request, reply) => {
    let agentId = ''
    let audioBuffer: Buffer | null = null
    let audioMimeType = 'audio/webm'

    try {
      const parts = (request as any).parts()
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'agentId') {
          agentId = String(part.value ?? '').trim()
        } else if (part.type === 'file' && part.fieldname === 'audio') {
          audioMimeType = part.mimetype ?? 'audio/webm'
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          audioBuffer = Buffer.concat(chunks)
        }
      }
    } catch {
      reply.status(400); return { success: false, message: 'Invalid multipart body' }
    }

    if (!agentId) { reply.status(400); return { success: false, message: 'agentId is required' } }
    if (!audioBuffer || audioBuffer.length === 0) { reply.status(400); return { success: false, message: 'audio file is required' } }
    if (audioBuffer.length > 25 * 1024 * 1024) { reply.status(413); return { success: false, message: 'Audio exceeds 25MB limit' } }

    // Transcribe audio — priority: local whisper.cpp → OpenAI Whisper cloud → 503
    // Local whisper runs on-device (no API key, ~1.8s for tiny model on Apple Silicon)
    let transcript = ''
    let sttProvider = 'none'

    // 1. Try local whisper (no API key needed)
    if (await isLocalWhisperAvailable()) {
      try {
        const localResult = await transcribeLocally(audioBuffer, audioMimeType)
        if (localResult) {
          transcript = localResult
          sttProvider = 'local-whisper'
        }
      } catch (err) {
        console.error('[voice/audio] local-whisper failed, trying cloud fallback:', err instanceof Error ? err.message : err)
      }
    }

    // 2. Fall back to OpenAI Whisper cloud if local failed or unavailable
    if (!transcript) {
      const openAiKey = process.env.OPENAI_API_KEY
      if (openAiKey) {
        try {
          const ext = audioMimeType.includes('mp4') || audioMimeType.includes('m4a') ? 'm4a'
            : audioMimeType.includes('mp3') ? 'mp3'
            : audioMimeType.includes('ogg') ? 'ogg'
            : audioMimeType.includes('wav') ? 'wav'
            : 'webm'

          const form = new FormData()
          form.append('file', new Blob([audioBuffer], { type: audioMimeType }), `audio.${ext}`)
          form.append('model', 'whisper-1')
          form.append('language', 'en')

          const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openAiKey}` },
            body: form,
            signal: AbortSignal.timeout(30000),
          })

          if (res.ok) {
            const data = await res.json() as { text?: string }
            transcript = data.text?.trim() ?? ''
            if (transcript) sttProvider = 'openai-whisper'
          } else {
            const err = await res.text()
            console.error(`[voice/audio] OpenAI Whisper error ${res.status}: ${err.slice(0, 200)}`)
          }
        } catch (err) {
          console.error('[voice/audio] OpenAI Whisper error:', err)
        }
      }
    }

    if (!transcript) {
      reply.status(503)
      return { success: false, message: 'STT unavailable — install openai-whisper locally or set OPENAI_API_KEY' }
    }

    console.log(`[voice/audio] STT via ${sttProvider}: "${transcript.slice(0, 80)}"`)


    if (transcript.length > 4000) transcript = transcript.slice(0, 4000)

    // Emit canvas_message so pulse SSE subscribers (browser, Android) get the transcript immediately
    eventBus.emit({
      id: `cmsg-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'canvas_message' as const,
      timestamp: Date.now(),
      data: {
        type: 'voice_transcript',
        agentId,
        agentColor: getIdentityColor(agentId),
        transcript,
        sttProvider,
      },
    })

    // Delegate to the same voice pipeline as POST /voice/input
    // Inline the pipeline logic (mirrors /voice/input handler)
    const session = createVoiceSession(agentId)
    const agentRole = getAgentRole(agentId)
    const agentSystemPrompt = agentRole
      ? `You are ${agentId}, a ${agentRole.role ?? 'team agent'} on Team Reflectt. ${agentRole.description ?? ''} Respond concisely — your reply will be spoken aloud. 1-3 sentences max.`
      : `You are ${agentId}, a team agent. Respond concisely — your reply will be spoken aloud. 1-3 sentences max.`

    const identityColor = getIdentityColor(agentId)

    const setActiveSpeakerAudio = (active: boolean) => {
      const existing = canvasStateMap.get(agentId)
      if (existing) {
        canvasStateMap.set(agentId, { ...existing, payload: { ...(existing.payload as Record<string, unknown>), activeSpeaker: active }, updatedAt: Date.now() })
        requestImmediateCanvasSync()
      }
    }

    const agentResponder = async (respAgentId: string, text: string, _sessionId: string): Promise<string | null> => {
      setActiveSpeakerAudio(false)
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      if (anthropicKey) {
        try {
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 256, system: agentSystemPrompt, messages: [{ role: 'user', content: text }] }),
            signal: AbortSignal.timeout(15000),
          })
          if (resp.ok) {
            const data = await resp.json() as { content?: Array<{ text?: string }> }
            const reply2 = data.content?.[0]?.text?.trim()
            if (reply2) return reply2
          }
        } catch (err) { console.error(`[voice/audio] LLM call failed:`, err) }
      }
      await new Promise(resolve => setTimeout(resolve, 400))
      return `Received: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`
    }

    const NODE_AGENT_VOICE_IDS_AUDIO: Record<string, string> = {
      link: 'pNInz6obpgDQGcFmaJgB', kai: 'onwK4e9ZLuTAKqWW03F9', pixel: 'EXAVITQu4vr4xnSDxMaL',
      sage: 'yoZ06aMxZJJ28mfd3POQ', scout: '3XbDmaS0mwj3WIVTUxWa', echo: 'MF3mGyEYCl7XYWbV9V6O',
    }
    const synthesizeTtsAudio = async (text: string, forAgentId: string): Promise<string | null> => {
      const elevenKey = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY
      // canvas_expression fires whether or not ElevenLabs is configured
      eventBus.emit({
        id: `voice-expr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'canvas_expression' as const,
        timestamp: Date.now(),
        data: {
          agentId: forAgentId,
          channels: {
            voice: text.slice(0, 300),
            visual: { flash: getIdentityColor(forAgentId, '#60a5fa'), particles: 'surge' },
            narrative: `${forAgentId} responds`,
          },
        },
      })
      if (!elevenKey) return null
      const voiceId = NODE_AGENT_VOICE_IDS_AUDIO[forAgentId] ?? NODE_AGENT_VOICE_IDS_AUDIO['link']
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
          body: JSON.stringify({ text: text.slice(0, 500), model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) return null
        const buf = Buffer.from(await res.arrayBuffer())
        return `data:audio/mpeg;base64,${buf.toString('base64')}`
      } catch { return null }
    }

    const unsubVoiceAudio = subscribeVoiceSession(session.id, (event) => {
      if (event.type === 'tts.ready') setActiveSpeakerAudio(true)
      else if (event.type === 'session.end' || event.type === 'error') { setActiveSpeakerAudio(false); unsubVoiceAudio() }
    })

    processVoiceTranscript(session.id, transcript, agentResponder, synthesizeTtsAudio).catch(err => {
      console.error('[voice/audio] processVoiceTranscript error:', err)
      unsubVoiceAudio()
    })

    void identityColor // suppress unused warning
    return reply.code(201).send({ success: true, sessionId: session.id, transcript })
  })

  // GET /voice/session/:id/events — SSE stream of voice pipeline state events
  // Events: transcript.final, agent.thinking, agent.done, tts.ready, error, session.end
  app.get<{ Params: { id: string } }>('/voice/session/:id/events', async (request, reply) => {
    const { id } = request.params
    const session = getVoiceSession(id)

    if (!session) {
      reply.status(404)
      return { success: false, message: 'Voice session not found' }
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Replay past events for late-joining clients
    for (const event of session.events) {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        return
      }
    }

    // Short-circuit if session already ended
    if (session.status === 'done' || session.status === 'error') {
      reply.raw.end()
      return
    }

    // Subscribe to new events
    const unsubscribe = subscribeVoiceSession(id, (event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        if (event.type === 'session.end') {
          reply.raw.end()
        }
      } catch {
        // Connection closed
      }
    })

    // Keepalive
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

  // ── Agent Interface routes — software actions on behalf of the human ──────

  // POST /agent-interface/runs — create and start a new agent action run
  app.post('/agent-interface/runs', async (request, reply) => {
    const body = request.body as { kind?: string; repo?: string; title?: string; body?: string; dryRun?: boolean; intent?: Record<string, unknown> }
    if (!body?.kind) { reply.status(400); return { success: false, message: 'kind is required' } }

    const ALLOWED_KINDS = ['github_issue_create', 'macos_ui_action']
    if (!ALLOWED_KINDS.includes(body.kind)) { reply.status(400); return { success: false, message: `Unknown kind: ${body.kind}. Allowed: ${ALLOWED_KINDS.join(', ')}` } }

    // macos_ui_action: validate intent + kill-switch before creating run
    if (body.kind === 'macos_ui_action') {
      if (isKillSwitchEngaged()) {
        reply.status(503); return { success: false, message: 'Kill-switch engaged — macOS accessibility control disabled' }
      }
      const intent = body.intent as any
      const validation = macOSValidateIntent(intent ?? {})
      if (!validation.ok) {
        reply.status(400); return { success: false, message: validation.reason }
      }
    }

    const run = createRun(body.kind as any, body.kind === 'macos_ui_action' ? {
      intent: body.intent ?? {},
      dryRun: body.dryRun ?? false,
    } : {
      repo: body.repo ?? '',
      title: body.title ?? '',
      body: body.body ?? '',
      dryRun: body.dryRun ?? false,
    })

    // Subscribe to run events — push canvas 'decision' state immediately when awaiting_approval
    // so the presence canvas decision card appears via SSE without waiting for the poll cycle.
    const runUnsub = subscribeRun(run.id, (event) => {
      if (event.type !== 'state_changed') return
      const to = (event.payload as any).to as string
      if (to === 'awaiting_approval') {
        // Push decision state to all agents watching the canvas SSE stream
        const inp = run.input as any
        const isMAC = (run.kind as string) === 'macos_ui_action'
        const actionLabel = isMAC
          ? `macOS: ${inp.intent?.action ?? 'ui action'} in ${inp.intent?.app ?? 'app'}`
          : (inp.title ?? run.kind)
        const descLabel = isMAC
          ? `Pilot — ${inp.intent?.action}${inp.intent?.text ? `: "${String(inp.intent.text).slice(0, 60)}"` : ''}`
          : `${run.kind} — ${inp.repo ?? ''}`
        const decisionPayload = {
          title: `Approval required: ${actionLabel}`,
          description: descLabel,
          runId: run.id,
          approvalId: run.id,
          expiresAt: run.createdAt + 10 * 60 * 1000,
        }
        eventBus.emit({
          id: `ai-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'canvas_render' as const,
          timestamp: Date.now(),
          data: {
            state: 'decision' as const,
            sensors: null,
            agentId: 'agent-interface',
            payload: decisionPayload,
            presence: {
              name: 'agent-interface',
              identityColor: '#60a5fa',
              state: 'decision',
              activeTask: { id: run.id, title: actionLabel },
              recency: 'just now',
              attention: { type: 'approval', taskId: run.id, label: actionLabel },
            },
          },
        })
        requestImmediateCanvasSync()
      } else if (['completed', 'failed', 'rejected'].includes(to)) {
        runUnsub()
      }
    })

    // Execute async — non-blocking
    if (body.kind === 'macos_ui_action') {
      const intent = (body.intent ?? {}) as Record<string, unknown>
      executeMacOSUIAction(run.id, intent).catch(err => { console.error('[agent-interface] macos run error:', err); runUnsub() })
    } else {
      executeGithubIssueCreate(run.id, {
        repo: body.repo ?? '',
        title: body.title ?? '',
        body: body.body ?? '',
        dryRun: body.dryRun,
      }).catch(err => { console.error('[agent-interface] run error:', err); runUnsub() })
    }

    return reply.code(201).send({ runId: run.id, status: run.status })
  })

  // GET /agent-interface/runs — list runs, optionally filtered by status
  // e.g. ?status=awaiting_approval — used by presence canvas to surface pending decisions
  app.get('/agent-interface/runs', async (request) => {
    const { status } = request.query as { status?: string }
    return { runs: listRuns(status) }
  })

  // GET /agent-interface/runs/:runId — get run state + log
  app.get<{ Params: { runId: string } }>('/agent-interface/runs/:runId', async (request, reply) => {
    const run = getRun(request.params.runId)
    if (!run) { reply.status(404); return { success: false, message: 'Run not found' } }
    return { run }
  })

  // GET /agent-interface/runs/:runId/replay — immutable audit + replay packet
  app.get<{ Params: { runId: string } }>('/agent-interface/runs/:runId/replay', (request, reply) => {
    const packet = buildReplayPacket(request.params.runId)
    if (!packet) { reply.status(404); return { success: false, message: 'Run not found' } }
    return { packet }
  })

  // GET /agent-interface/runs/:runId/events — SSE stream of run events
  app.get<{ Params: { runId: string } }>('/agent-interface/runs/:runId/events', async (request, reply) => {
    const run = getRun(request.params.runId)
    if (!run) { reply.status(404); return { success: false, message: 'Run not found' } }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Replay existing log events first
    for (const event of run.log) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    // If run is already terminal, close immediately
    if (['completed', 'failed', 'rejected'].includes(run.status)) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'run_end', timestamp: Date.now(), payload: { status: run.status } })}\n\n`)
      reply.raw.end()
      return reply
    }

    const unsub = subscribeRun(request.params.runId, (event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        if (event.type === 'state_changed') {
          const to = (event.payload as any).to as string
          if (['completed', 'failed', 'rejected'].includes(to)) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'run_end', timestamp: Date.now(), payload: { status: to } })}\n\n`)
            reply.raw.end()
          }
        }
      } catch { /* connection closed */ }
    })

    const heartbeat = setInterval(() => { try { reply.raw.write(': ping\n\n') } catch { clearInterval(heartbeat); unsub() } }, 15_000)
    request.raw.on('close', () => { unsub(); clearInterval(heartbeat) })
    return reply
  })

  // POST /agent-interface/runs/:runId/approve — human approves the pending action
  app.post<{ Params: { runId: string } }>('/agent-interface/runs/:runId/approve', async (request, reply) => {
    const run = getRun(request.params.runId)
    if (!run) { reply.status(404); return { success: false, message: 'Run not found' } }
    if (run.status !== 'awaiting_approval') { reply.status(409); return { success: false, message: `Run is ${run.status}, not awaiting_approval` } }
    const ok = approveRun(request.params.runId)
    if (!ok) { reply.status(409); return { success: false, message: 'No pending approval for this run' } }
    return { success: true, runId: request.params.runId }
  })

  // POST /agent-interface/runs/:runId/reject — human rejects the pending action
  app.post<{ Params: { runId: string } }>('/agent-interface/runs/:runId/reject', async (request, reply) => {
    const run = getRun(request.params.runId)
    if (!run) { reply.status(404); return { success: false, message: 'Run not found' } }
    if (run.status !== 'awaiting_approval') { reply.status(409); return { success: false, message: `Run is ${run.status}, not awaiting_approval` } }
    const ok = rejectRun(request.params.runId)
    if (!ok) { reply.status(409); return { success: false, message: 'No pending approval for this run' } }
    return { success: true, runId: request.params.runId }
  })

  // POST /agent-interface/kill-switch — instantly disable all macOS accessibility control
  app.post('/agent-interface/kill-switch', (request) => {
    const body = request.body as { engage?: boolean }
    if (body?.engage === false) {
      resetKillSwitch()
      return { success: true, killSwitch: false, message: 'Kill-switch reset — macOS accessibility control re-enabled' }
    }
    engageKillSwitch()
    return { success: true, killSwitch: true, message: 'Kill-switch engaged — all macOS accessibility control disabled immediately' }
  })

  // GET /agent-interface/kill-switch — check kill-switch state
  app.get('/agent-interface/kill-switch', () => {
    return { killSwitch: isKillSwitchEngaged() }
  })

  // ── Preflight Check endpoint ────────────────────────────────────────

  app.get('/preflight', async (request) => {
    const { runPreflight } = await import('./preflight.js')
    const query = request.query as Record<string, string>
    const report = await runPreflight({
      cloudUrl: query.cloudUrl || undefined,
      port: query.port ? Number(query.port) : undefined,
      skipNetwork: query.skipNetwork === 'true',
      vault: sharedVault ?? undefined,
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
      vault: sharedVault ?? undefined,
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
      vault: sharedVault ?? undefined,
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
      // Normalize legacy "in-progress" → "doing" before schema validation.
      // Some agents (and older MCP callers) use the deprecated status name.
      const rawBody = request.body as Record<string, unknown>
      if (rawBody && typeof rawBody === 'object' && rawBody.status === 'in-progress') {
        rawBody.status = 'doing'
      }
      const parsed = UpdateTaskSchema.parse(rawBody)
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
      // Do not accept caller-supplied review_handoff.comment_id (it must be stamped server-side from POST /tasks/:id/comments).
      // If a client tries to patch it directly, we strip it to prevent phantom pointers.
      const incomingMetaRaw = (parsed.metadata || {}) as Record<string, unknown>
      const incomingMeta: Record<string, unknown> = { ...incomingMetaRaw }
      const incomingRh = incomingMeta.review_handoff as Record<string, unknown> | undefined
      if (incomingRh && typeof incomingRh === 'object' && !Array.isArray(incomingRh)) {
        const rhAny = incomingRh as any
        if (typeof rhAny.comment_id === 'string') {
          const { comment_id, ...rest } = rhAny
          incomingMeta.review_handoff = rest
          incomingMeta.review_handoff_comment_id_stripped = {
            stripped: true,
            attempted: comment_id,
            at: Date.now(),
          }
        }
      }

      const effectiveTargetStatus = parsed.status ?? existing.status
      const autoFilledMeta = applyAutoDefaults(lookup.resolvedId, effectiveTargetStatus, incomingMeta as Record<string, unknown>)
      const mergedRawMeta = { ...(existing.metadata || {}), ...autoFilledMeta }
      // Normalize review-state metadata for state-aware SLA tracking.
      const mergedMeta = applyReviewStateMetadata(existing, parsed, mergedRawMeta, Date.now())

      // ── State machine transition validation ──
      // Must run before all other gates to give a clear rejection message.
      if (parsed.status && parsed.status !== existing.status) {
        const ALLOWED_TRANSITIONS: Record<string, string[]> = {
          'todo':       ['doing', 'cancelled'],
          'doing':      ['blocked', 'validating', 'cancelled'],
          'blocked':    ['doing', 'todo', 'cancelled'],
          'validating': ['done', 'doing'],   // doing = reviewer rejection / rework
          'done':       [],                   // all exits require reopen
          'cancelled':  [],                   // terminal state, like done — requires reopen to revive
          'in-progress': ['blocked', 'validating', 'done', 'doing', 'todo', 'cancelled'], // legacy, permissive
        }
        const allowed = ALLOWED_TRANSITIONS[existing.status] ?? []
        // Allow todo→validating when criteria_verified=true
        if (!allowed.includes(parsed.status) && !(parsed.status === 'validating' && existing.status === 'todo' && parsed.criteria_verified === true)) {
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

      // ── Done-criteria verification gate ──
      // Block todo→validating unless criteria_verified=true is set.
      if (parsed.status === 'validating' && existing.status === 'todo') {
        const hasDoneCriteria = Boolean(existing.done_criteria && existing.done_criteria.length > 0)
        if (hasDoneCriteria && parsed.criteria_verified !== true) {
          const dc = Array.isArray(existing.done_criteria) ? existing.done_criteria.length : 0
          reply.code(422)
          return {
            success: false,
            error: `All ${dc} done criteria must be verified. Set criteria_verified=true in PATCH body to unblock.`,
            code: 'DONE_CRITERIA_NOT_VERIFIED',
            gate: 'done_criteria_verification',
          }
        }
      }

          // Emit trust signal: forced state bypass
          const NORMAL_ESCALATION_PATHS = ['todo→doing', 'doing→validating', 'validating→done']
          const jumpPath = `${existing.status}→${parsed.status}`
          if (!NORMAL_ESCALATION_PATHS.includes(jumpPath)) {
            import('./trust-events.js').then(({ emitTrustEvent }) => {
              emitTrustEvent({
                agentId: String(parsed.actor || parsed.assignee || 'unknown'),
                eventType: 'escalation_bypass',
                taskId: existing.id,
                summary: `Task forced from ${existing.status}→${parsed.status} via reopen bypass`,
                context: { taskId: existing.id, taskTitle: existing.title, from: existing.status, to: parsed.status, reason: reopenReason },
              })
            }).catch(() => {})
          }
        }
      }

      // ── Handoff state validation ──
      if (mergedMeta.handoff_state && typeof mergedMeta.handoff_state === 'object') {
        const handoffResult = HandoffStateSchema.safeParse(mergedMeta.handoff_state)
        if (!handoffResult.success) {
          reply.code(422)
          return {
            success: false,
            error: `Invalid handoff_state: ${handoffResult.error.issues.map(i => i.message).join(', ')}`,
            code: 'INVALID_HANDOFF_STATE',
            hint: 'handoff_state must have: reviewed_by (string), decision (approved|rejected|needs_changes|escalated), optional next_owner (string). Max 3 fields per COO rule.',
            gate: 'handoff_state',
          }
        }
        // Stamp validated handoff
        mergedMeta.handoff_state = handoffResult.data
      }

      // ── Cancel reason gate: require cancel_reason when transitioning to cancelled ──
      if (parsed.status === 'cancelled') {
        const meta = (incomingMeta ?? {}) as Record<string, unknown>
        const cancelReason = typeof meta.cancel_reason === 'string' ? String(meta.cancel_reason).trim() : ''
        if (!cancelReason) {
          reply.code(422)
          return {
            success: false,
            error: 'Cancellation requires a cancel_reason in metadata (e.g. "duplicate", "out of scope", "won\'t fix").',
            code: 'CANCEL_REASON_REQUIRED',
            gate: 'cancel_reason',
            hint: 'Include metadata.cancel_reason explaining why this task is being cancelled.',
          }
        }
        mergedMeta.cancel_reason = cancelReason
        mergedMeta.cancelled_at = Date.now()
        mergedMeta.cancelled_from = existing.status
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
          // Default model can be overridden by ops via DEFAULT_MODEL env var.
          const validatedDefault = normalizeConfiguredModel(DEFAULT_MODEL)

          if (!validatedDefault.ok) {
            // Hard fallback: should never happen, but don't break task starts due to misconfig.
            mergedMeta.model = 'gpt-codex'
            mergedMeta.model_resolved = MODEL_ALIASES['gpt-codex']
            mergedMeta.model_defaulted = true
            mergedMeta.model_default_reason = 'No model configured at task start; DEFAULT_MODEL misconfigured; fell back to gpt-codex.'
          } else {
            mergedMeta.model = validatedDefault.value
            mergedMeta.model_resolved = validatedDefault.resolved
            mergedMeta.model_defaulted = true
            mergedMeta.model_default_reason = 'No model configured at task start; default model applied.'
          }
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

      const duplicateGate = enforceDuplicateClosureEvidenceGateForValidating(parsed.status, mergedMeta)
      if (!duplicateGate.ok) {
        reply.code(400)
        return {
          success: false,
          error: duplicateGate.error,
          gate: 'duplicate_evidence',
          hint: duplicateGate.hint,
        }
      }

      // Early format validation: catch bad PR URLs and commit SHAs on any update, not just at validating transition
      const earlyReviewPacket = (mergedMeta as Record<string, any>)?.qa_bundle?.review_packet as Record<string, unknown> | undefined
      const earlyHandoff = (mergedMeta as Record<string, any>)?.review_handoff as Record<string, unknown> | undefined
      const earlyPrUrl = (earlyReviewPacket?.pr_url ?? earlyHandoff?.pr_url) as string | undefined
      const earlyCommit = (earlyReviewPacket?.commit ?? earlyHandoff?.commit_sha) as string | undefined
      if (earlyPrUrl && typeof earlyPrUrl === 'string' && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(earlyPrUrl)) {
        reply.code(400)
        return {
          success: false,
          error: `Invalid PR URL format: "${earlyPrUrl}"`,
          gate: 'format_validation',
          hint: 'Expected format: https://github.com/owner/repo/pull/123',
        }
      }
      if (earlyCommit && typeof earlyCommit === 'string' && earlyCommit.length > 0 && !/^[a-f0-9]{7,40}$/i.test(earlyCommit)) {
        reply.code(400)
        return {
          success: false,
          error: `Invalid commit SHA format: "${earlyCommit}"`,
          gate: 'format_validation',
          hint: 'Expected 7-40 hex characters, e.g. "a1b2c3d"',
        }
      }

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

      const handoffGate = await enforceReviewHandoffGateForValidating(effectiveStatus, lookup.resolvedId, mergedMeta)
      if (!handoffGate.ok) {
        reviewHandoffValidationStats.failures += 1
        reviewHandoffValidationStats.lastFailureAt = Date.now()
        reviewHandoffValidationStats.lastFailureTaskId = lookup.resolvedId
        reviewHandoffValidationStats.lastFailureError = handoffGate.error

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
        // Duplicate/superseded tasks bypass all close gates — the QA bundle gate
        // already validated canonical refs + reason (line ~582).
        const taskCloseReason = typeof mergedMeta.close_reason === 'string'
          ? mergedMeta.close_reason.toLowerCase().trim()
          : ''
        const isDuplicateClose = taskCloseReason === 'duplicate' || taskCloseReason === 'superseded'

        const artifacts = mergedMeta.artifacts as string[] | undefined

        // Gate 1: require artifacts (links, PR URLs, evidence)
        if (!isDuplicateClose && (!artifacts || !Array.isArray(artifacts) || artifacts.length === 0)) {
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
        const hasPrUrl = artifacts?.some((a: string) => /github\.com\/.*\/pull\/\d+/.test(a)) ?? false
        const hasWaiver = mergedMeta.pr_waiver === true && typeof mergedMeta.pr_waiver_reason === 'string'

        if (!isDuplicateClose && isCodeTask && !hasPrUrl && !hasWaiver) {
          reply.code(422)
          return {
            success: false,
            error: 'Task-close gate: code-lane tasks require at least one PR URL in metadata.artifacts',
            gate: 'pr_link',
            hint: 'Include a GitHub PR URL in artifacts, or set metadata.pr_waiver=true + metadata.pr_waiver_reason for hotfixes.',
          }
        }

        // Gate 1c: verify linked PRs are merged (not just opened)
        if (!isDuplicateClose && isCodeTask && hasPrUrl && !hasWaiver) {
          const prUrls = (artifacts ?? []).filter((a: string) => /github\.com\/.*\/pull\/\d+/.test(a))
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
        if (!isDuplicateClose && existing.reviewer) {
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
        if (!isDuplicateClose && followOnPolicy.required) {
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

      // ── done_criteria gate on doing transition ──
      // Prevent tasks from entering active work without verifiable exit conditions.
      // Effective criteria = incoming update (if provided) or existing task value.
      if (parsed.status === 'doing' && existing.status !== 'doing' && !isTestTask) {
        const effectiveDoneCriteria = (parsed.done_criteria && parsed.done_criteria.length > 0)
          ? parsed.done_criteria
          : (existing.done_criteria ?? [])
        if (effectiveDoneCriteria.length === 0) {
          reply.code(422)
          return {
            success: false,
            error: 'done_criteria gate: task cannot move to doing without at least one verifiable criterion. Add done_criteria to this PATCH or update the task first.',
            code: 'MISSING_DONE_CRITERIA',
            gate: 'done_criteria',
            hint: 'Include done_criteria: ["<criterion 1>", ...] in this PATCH request.',
          }
        }
      }
      // ── End done_criteria gate ──

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

      // ── Lane validation on claim ──
      // Reject out-of-lane claims at the API level.
      // If the task has metadata.lane, the claiming agent must belong to a lane
      // that matches the task's lane. Agents with no lane config cannot claim lane-specific tasks.
      // Tasks without lane metadata pass through (no breaking change).
      if (parsed.status === 'doing' && existing.status !== 'doing' && !isTestTask) {
        const claimingAgent = (parsed.assignee || existing.assignee || '').toLowerCase()
        const taskLane = String((mergedMeta.lane ?? '') as string).trim().toLowerCase()
        if (claimingAgent && taskLane) {
          // Check if this is a lane override (metadata.lane_override = true)
          const laneOverride = mergedMeta.lane_override === true
          if (!laneOverride) {
            const { getAgentLane } = await import('./lane-config.js')
            const agentLaneConfig = getAgentLane(claimingAgent)
            const agentLaneName = agentLaneConfig?.name?.toLowerCase() ?? null

            // Only reject if agent IS in a different lane — unconfigured agents are unrestricted.
            if (agentLaneName && agentLaneName !== taskLane) {
              reply.code(400)
              return {
                success: false,
                error: `Lane mismatch: ${claimingAgent} belongs to "${agentLaneConfig!.name}" lane but task is in "${taskLane}" lane.`,
                gate: 'lane_validation',
                agentLane: agentLaneName,
                taskLane,
                hint: 'Set metadata.lane_override=true to bypass this check.',
              }
            }
          }
        }
      }

      // ── Working contract: reflection gate on claim ──
      // Only fires for fresh claims (todo→doing, blocked→doing), not re-claims
      // (validating→doing = reviewer rejection/rework on the agent's own task).
      // Re-claiming after reviewer rejection is not new work — it's resuming.
      const isFreshClaim = parsed.status === 'doing' && existing.status !== 'doing' && existing.status !== 'validating'
      if (isFreshClaim && !isTestTask) {
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
          notifiedTo: getAgentRoles()[0]?.name,
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

      // ── Stale review notification suppression ──
      // When a task leaves validating (back to doing/blocked for rework),
      // clear validating_nudge_sent_at so reviewer is re-notified on next validating entry.
      if (existing.status === 'validating' && parsed.status && parsed.status !== 'validating') {
        nextMetadata.validating_nudge_sent_at = null
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

      // ── Emit workflow stall when task enters review ──
      if (
        effectiveTargetStatus === 'validating' &&
        existing.status !== 'validating' &&
        existing.status !== 'done'
      ) {
        const reviewer = task.reviewer
        if (reviewer) {
          emitWorkflowStall(reviewer, 'review_pending', {
            lastAction: `task "${task.title}" submitted for review`,
            lastAgent: task.assignee || 'unknown',
            lastActionAt: Date.now(),
          })
        }
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
            to: getAgentRoles()[0]?.name,
          },
        }).catch(() => {})
      }
      // ── End design handoff notification ──

      // Emit task_updated event for team-context-writer and other listeners
      // task-1774672289270-9qhb17cgk
      if (parsed.status && parsed.status !== existing.status) {
        eventBus.emit({
          id: `task-updated-${task.id}-${Date.now()}`,
          type: 'task_updated' as const,
          timestamp: Date.now(),
          data: {
            taskId: task.id,
            status: parsed.status,
            previousStatus: existing.status,
            assignee: task.assignee,
            title: task.title,
          },
        })
      }

      // Auto-update presence on task activity
      if (task.assignee) {
        if (parsed.status === 'done') {
          presenceManager.recordActivity(task.assignee, 'task_completed')
          presenceManager.updatePresence(task.assignee, 'working', null)
          // Stall detector: agent completed a task — user should respond
          // Determine who to notify: the task creator / assignee who might be waiting
          const waitingUserId = (task.metadata as any)?.userId || task.assignee
          getStallDetector().recordAgentResponse(waitingUserId, task.assignee)
          trackTaskEvent('completed')
        } else if (parsed.status === 'doing') {
          presenceManager.updatePresence(task.assignee, 'working', task.id)
        } else if (parsed.status === 'blocked') {
          presenceManager.updatePresence(task.assignee, 'blocked', task.id)
        } else if (parsed.status === 'validating') {
          presenceManager.updatePresence(task.assignee, 'reviewing', task.id)
        }
      }

      // ── Reviewer notification: @mention reviewer when task enters validating ──
      // NOTE: A dedup_key is set here so the inline chat dedup guard suppresses
      // any duplicate reviewRequested send that may arrive via the statusNotifTargets
      // loop below for the same task+transition. Without it, two messages fire for
      // every todo→validating transition (this direct send + the loop send).
      if (parsed.status === 'validating' && existing.status !== 'validating' && existing.reviewer) {
        const taskMeta = task.metadata as Record<string, unknown> | undefined
        const prUrl = (taskMeta?.review_handoff as Record<string, unknown> | undefined)?.pr_url
          ?? (taskMeta?.qa_bundle as Record<string, unknown> | undefined)?.pr_url
          ?? ''
        const artifactPath = (taskMeta?.review_handoff as Record<string, unknown> | undefined)?.artifact_path
          ?? ((taskMeta?.qa_bundle as Record<string, unknown> | undefined)?.review_packet as Record<string, unknown> | undefined)?.artifact_path
          ?? ''
        // Build artifact navigation line — PR URL preferred, then artifact path
        const artifactLine = prUrl ? `\nArtifact: ${prUrl}` : (artifactPath ? `\nArtifact: ${artifactPath}` : '')
        const reviewCmd = `\nReview: POST /tasks/${task.id}/review { decision: "approve"|"reject", reviewer: "${existing.reviewer}", comment: "..." }`
        chatManager.sendMessage({
          from: 'system',
          to: existing.reviewer,
          content: `@${existing.reviewer} [reviewRequested:${task.id}] ${task.title} → validating${artifactLine}${reviewCmd}`,
          channel: 'task-notifications',
          metadata: {
            kind: 'review_requested',
            taskId: task.id,
            reviewer: existing.reviewer,
            prUrl: prUrl || undefined,
            artifactPath: artifactPath || undefined,
            dedup_key: `review-requested:${task.id}:${task.updatedAt}`,
          },
        }).catch(() => {}) // Non-blocking
      }

      // ── Reviewer run event: append review_requested to reviewer's agent run ──
      if (parsed.status === 'validating' && existing.status !== 'validating' && existing.reviewer) {
        const { notifyReviewerViaRun } = await import('./agent-runs.js')
        try {
          notifyReviewerViaRun({
            id: task.id,
            title: task.title,
            reviewer: existing.reviewer,
            assignee: task.assignee,
            metadata: task.metadata as Record<string, unknown> | undefined,
            teamId: task.teamId,
          })
        } catch (err) {
          console.warn('[ReviewRun] Failed to notify reviewer via run:', (err as Error).message)
        }
      }

      // ── Approval card: proactively surface approval card on canvas when task enters validating ──
      // Only emit for human reviewers — agent-to-agent reviews should NOT appear on canvas.
      // If the reviewer is a known agent name, skip the card entirely.
      if (parsed.status === 'validating' && existing.status !== 'validating') {
        const KNOWN_AGENT_IDS = new Set(getAgentRoles().map(r => r.name))
        const reviewerId = (task.reviewer ?? '').toLowerCase().trim()
        const isAgentReviewer = KNOWN_AGENT_IDS.has(reviewerId)

        // Skip canvas card for agent-to-agent reviews — humans don't need to see these
        if (isAgentReviewer) {
          // Still log for debugging, but no canvas card
          console.log(`[ApprovalCard] Skipped canvas card for agent-to-agent review: ${task.id} (reviewer: ${reviewerId})`)
        }

        if (!isAgentReviewer) {
        const taskMetaForCard = task.metadata as Record<string, unknown> | undefined
        const prUrlForCard = (taskMetaForCard?.pr_url as string | undefined)
          ?? (taskMetaForCard?.review_handoff as Record<string, unknown> | undefined)?.pr_url as string | undefined
          ?? (taskMetaForCard?.qa_bundle as Record<string, unknown> | undefined)?.pr_url as string | undefined
        const qaSummary = (taskMetaForCard?.qa_bundle as Record<string, unknown> | undefined)?.summary as string | undefined
        const assigneeIdForCard = (task.assignee ?? '').toLowerCase()
        const approvalNow = Date.now()
        const approvalPushData = {
          type: 'approval_requested',
          agentId: assigneeIdForCard,
          agentColor: getIdentityColor(assigneeIdForCard, '#94a3b8'),
          data: {
            taskId: task.id,
            taskTitle: task.title,
            reviewer: task.reviewer,
            prUrl: prUrlForCard || undefined,
            qaSummary: qaSummary || undefined,
            priority: task.priority,
          },
          ttl: 120000,
          t: approvalNow,
        }
        eventBus.emit({
          id: `approval-${approvalNow}-${Math.random().toString(36).slice(2, 6)}`,
          type: 'canvas_push',
          timestamp: approvalNow,
          data: approvalPushData,
        })
        queueCanvasPushEvent(approvalPushData)
        } // end if (!isAgentReviewer)
      }

      // ── Canvas push: self-emit utterance on task state transitions ──
      {
        const canvasAgent = (task.assignee || 'unknown').toLowerCase()
        const canvasNow = Date.now()
        const agentColor = getIdentityColor(canvasAgent, '#94a3b8')
        const taskSnippet = (task.title ?? '').slice(0, 60)

        // Helper: emit canvas_render to update agent orb state (presence layer).
        // canvas_push carries the utterance/work_released visual; canvas_render updates
        // the orb's state ring so browsers show the right idle/working/handoff/etc ring.
        // Emit canvas state AND synchronously update canvasStateMap so the next pulse
        // tick reads fresh state immediately (no stale window).
        // task-1773672429681
        const emitOrbState = (presState: string, activeTaskPayload?: { id: string; title: string }) => {
          const canvasState = presState === 'working' ? 'thinking'
                   : presState === 'handoff' ? 'handoff'
                   : presState === 'needs-attention' ? 'decision'
                   : 'ambient'
          const payload = { presenceState: presState, activeTask: activeTaskPayload }

          // Synchronously update canvasStateMap before SSE broadcast
          if (_canvasStateMap) {
            _canvasStateMap.set(canvasAgent, {
              state: canvasState as any,
              sensors: null,
              payload,
              updatedAt: canvasNow,
            })
          }

          eventBus.emit({
            id: `canvas-orb-${canvasNow}-${task.id.slice(-6)}`,
            type: 'canvas_render' as const,
            timestamp: canvasNow,
            data: {
              state: canvasState,
              sensors: null,
              agentId: canvasAgent,
              payload,
              presence: {
                name: canvasAgent,
                identityColor: agentColor,
                state: presState,
                ...(activeTaskPayload ? { activeTask: activeTaskPayload } : {}),
                recency: 'just now',
                urgency: presState === 'working' ? 0.2
                       : presState === 'needs-attention' ? 0.75
                       : presState === 'handoff' ? 0.5
                       : 0.0,
              },
            },
          })
          requestImmediateCanvasSync()
        }

        if (parsed.status === 'doing' && existing.status !== 'doing') {
          // Agent picks up work → utterance on canvas + orb flips to working
          const doingPushData = {
            type: 'utterance',
            agentId: canvasAgent,
            agentColor,
            text: `picking up: ${taskSnippet}`,
            t: canvasNow,
          }
          eventBus.emit({
            id: `canvas-doing-${canvasNow}-${task.id.slice(-6)}`,
            type: 'canvas_push',
            timestamp: canvasNow,
            data: doingPushData,
          })
          queueCanvasPushEvent(doingPushData)
          emitOrbState('working', { id: task.id, title: task.title ?? '' })
        } else if (parsed.status === 'validating' && existing.status !== 'validating') {
          // Agent submits for review → work_released on canvas + orb flips to handoff
          const prUrl = (mergedMeta as any)?.review_handoff?.pr_url || (mergedMeta as any)?.pr_url || undefined
          const validatingPushData = {
            type: 'work_released',
            agentId: canvasAgent,
            agentColor,
            summary: `ready for review: ${taskSnippet}`,
            prUrl,
            t: canvasNow,
          }
          eventBus.emit({
            id: `canvas-validating-${canvasNow}-${task.id.slice(-6)}`,
            type: 'canvas_push',
            timestamp: canvasNow,
            data: validatingPushData,
          })
          queueCanvasPushEvent(validatingPushData)
          emitOrbState('handoff', { id: task.id, title: task.title ?? '' })
        } else if (parsed.status === 'done' && existing.status !== 'done') {
          // Agent closes task — burst from their orb + orb returns to idle
          // Enrich with PR metadata for proof artifact card on canvas
          const donePrUrl = (mergedMeta as any)?.review_handoff?.pr_url
            || (mergedMeta as any)?.pr_url
            || undefined
          const doneChangedFiles: string[] = Array.isArray((mergedMeta as any)?.qa_bundle?.changed_files)
            ? ((mergedMeta as any).qa_bundle.changed_files as string[]).slice(0, 5)
            : []
          const donePushData = {
            type: 'work_released',
            agentId: canvasAgent,
            agentColor,
            text: 'shipped',
            taskTitle: taskSnippet,
            prUrl: donePrUrl,
            changedFiles: doneChangedFiles.length > 0 ? doneChangedFiles : undefined,
            intensity: 0.8,
            t: canvasNow,
          }
          eventBus.emit({
            id: `canvas-done-${canvasNow}-${task.id.slice(-6)}`,
            type: 'canvas_push',
            timestamp: canvasNow,
            data: donePushData,
          })
          queueCanvasPushEvent(donePushData)
          emitOrbState('idle')
        } else if (parsed.status === 'blocked' && existing.status !== 'blocked') {
          // Agent is blocked — utterance from their orb + orb flips to needs-attention
          const blockedPushData = {
            type: 'utterance',
            agentId: canvasAgent,
            agentColor,
            text: `blocked on: ${taskSnippet}`,
            ttl: 4000,
            t: canvasNow,
          }
          eventBus.emit({
            id: `canvas-blocked-${canvasNow}-${task.id.slice(-6)}`,
            type: 'canvas_push',
            timestamp: canvasNow,
            data: blockedPushData,
          })
          queueCanvasPushEvent(blockedPushData)
          emitOrbState('needs-attention', { id: task.id, title: task.title ?? '' })
        }
      }
      // ── End canvas push ──

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

      if (parsed.status === 'doing' && existing.status !== 'doing' && task.assignee) {
        statusNotifTargets.push({ agent: task.assignee, type: 'taskAssigned' })
      }
      if (parsed.status === 'validating' && existing.status !== 'validating' && task.reviewer) {
        statusNotifTargets.push({ agent: task.reviewer, type: 'reviewRequested' })

        // ── Explicit reviewer routing: ping reviewer with PR link + ask ──
        const prUrl = (task.metadata as Record<string, unknown>)?.pr_url
          || ((task.metadata as Record<string, unknown>)?.qa_bundle as Record<string, unknown>)?.pr_url
          || ((task.metadata as Record<string, unknown>)?.review_handoff as Record<string, unknown>)?.pr_url
        const prLink = typeof prUrl === 'string' && prUrl ? ` — ${prUrl}` : ''
        const reviewMsg = `@${task.reviewer} review requested: **${task.title}** (${task.id})${prLink}. Please approve or flag issues.`
        chatManager.sendMessage({
          from: 'system',
          to: task.reviewer,
          content: reviewMsg,
          channel: 'reviews',
          metadata: {
            kind: 'review_routing',
            taskId: task.id,
            reviewer: task.reviewer,
            assignee: task.assignee,
            prUrl: prUrl || null,
          },
        }).catch(() => {}) // Non-blocking
      }
      if (parsed.status === 'done' && existing.status !== 'done') {
        if (task.assignee) statusNotifTargets.push({ agent: task.assignee, type: 'taskCompleted' })
        if (task.reviewer) statusNotifTargets.push({ agent: task.reviewer, type: 'taskCompleted' })
      }

      // Dedupe guard: prevent stale/out-of-order notification events
      const { shouldEmitNotification } = await import('./notificationDedupeGuard.js')

      for (const target of statusNotifTargets) {
        // Check dedupe guard before emitting.
        // Pass targetAgent so each recipient gets an independent cursor — prevents
        // the first recipient's cursor update from suppressing later recipients for
        // the same event (e.g. assignee + reviewer both getting taskCompleted on 'done').
        const dedupeCheck = shouldEmitNotification({
          taskId: task.id,
          eventUpdatedAt: task.updatedAt,
          eventStatus: parsed.status!,
          currentTaskStatus: task.status,
          currentTaskUpdatedAt: task.updatedAt,
          targetAgent: target.agent,
        })

        if (!dedupeCheck.emit) {
          console.log(`[NotifDedupe] Suppressed: ${dedupeCheck.reason}`)
          continue
        }

        const routing = notifMgr.shouldNotify({
          type: target.type,
          agent: target.agent,
          priority: task.priority,
          message: `Task ${task.id} → ${parsed.status}`,
        })
        if (routing.shouldNotify) {
          // Route through inbox/chat based on delivery method preference.
          // For reviewRequested, set a dedup_key matching the direct send above so the
          // inline chat dedup suppresses this copy (the direct send fires first with a
          // richer payload including PR URL and `to:` routing).
          const dedupKey = target.type === 'reviewRequested'
            ? `review-requested:${task.id}:${task.updatedAt}`
            : undefined
          chatManager.sendMessage({
            from: 'system',
            content: `@${target.agent} [${target.type}:${task.id}] ${task.title} → ${parsed.status}`,
            channel: 'task-notifications',
            metadata: {
              kind: target.type,
              taskId: task.id,
              status: parsed.status,
              updatedAt: task.updatedAt,
              deliveryMethod: routing.deliveryMethod,
              ...(dedupKey ? { dedup_key: dedupKey } : {}),
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
          } else if (mirrorResult && !mirrorResult.mirrored) {
            // Skip silently when no error — source simply not found (expected in prod installs).
            // Only warn on genuine I/O failures (permissions, disk full, etc.).
            if (mirrorResult.error) {
              console.warn(`[ArtifactMirror] FAILED for ${task.id}: ${mirrorResult.error} (source=${mirrorResult.source})`)
            }
          }
        } catch (err) {
          console.warn(`[ArtifactMirror] ERROR for ${task.id}: ${(err as Error).message}`)
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

  app.get('/agents', async () => buildRoleRegistryPayload())
  app.get('/agents/roles', async () => buildRoleRegistryPayload())

  // Host-native identity resolution — resolves agent by name, alias, or display name
  // without requiring the OpenClaw gateway. Merges YAML roles + agent_config table.
  app.get<{ Params: { name: string } }>('/agents/:name/identity', async (request) => {
    const { name } = request.params
    const resolved = resolveAgentMention(name)
    const role = resolved ? getAgentRole(resolved) : getAgentRole(name)

    if (!role) {
      return { found: false, query: name, hint: 'Agent not found in YAML roles or config' }
    }

    return {
      found: true,
      agentId: role.name,
      displayName: role.displayName ?? role.name,
      role: role.role,
      description: role.description ?? null,
      aliases: role.aliases ?? [],
      affinityTags: role.affinityTags ?? [],
      wipCap: role.wipCap,
      source: 'yaml',
    }
  })

  // ── Agent visual identity — agents choose their own appearance ──────
  // POST /agents/:name/identity/avatar — agent sets their visual form
  // task-1773690756100
  app.post<{ Params: { name: string } }>('/agents/:name/identity/avatar', async (request) => {
    const { name } = request.params
    const body = request.body as Record<string, unknown> ?? {}

    // Validate agent exists
    const resolved = resolveAgentMention(name)
    const agentId = resolved ?? name
    const role = getAgentRole(agentId)
    if (!role) return { success: false, error: 'Agent not found' }

    // Validate avatar payload
    const avatarType = String(body.type ?? 'svg')
    if (!['svg', 'image', 'emoji'].includes(avatarType)) {
      return { success: false, error: 'Invalid avatar type. Must be: svg, image, emoji' }
    }
    const content = String(body.content ?? '')
    if (!content) return { success: false, error: 'content is required' }
    if (avatarType === 'svg' && content.length > 50000) {
      return { success: false, error: 'SVG content too large (max 50KB)' }
    }

    const avatar = {
      type: avatarType,
      content,
      animated: body.animated === true,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      bio: typeof body.bio === 'string' ? body.bio.slice(0, 200) : undefined,
      updatedAt: Date.now(),
    }

    // Store in agent_config settings
    const db = getDb()
    const existing = db.prepare('SELECT settings FROM agent_config WHERE agent_id = ?').get(agentId) as { settings: string } | undefined
    const settings = existing ? JSON.parse(existing.settings) : {}
    settings.avatar = avatar

    if (existing) {
      db.prepare('UPDATE agent_config SET settings = ?, updated_at = ? WHERE agent_id = ?')
        .run(JSON.stringify(settings), Date.now(), agentId)
    } else {
      db.prepare('INSERT INTO agent_config (agent_id, team_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(agentId, 'default', JSON.stringify(settings), Date.now(), Date.now())
    }

    // Emit on eventBus so canvas updates immediately
    eventBus.emit({
      id: `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'canvas_expression' as const,
      timestamp: Date.now(),
      data: { agentId, channels: { identity: avatar } },
    })

    return { success: true, agentId, avatar }
  })

  // GET /agents/:name/identity/avatar — read agent's visual identity
  app.get<{ Params: { name: string } }>('/agents/:name/identity/avatar', async (request) => {
    const { name } = request.params
    const resolved = resolveAgentMention(name)
    const agentId = resolved ?? name

    const db = getDb()
    const row = db.prepare('SELECT settings FROM agent_config WHERE agent_id = ?').get(agentId) as { settings: string } | undefined
    if (!row) return { found: false, agentId }

    const settings = JSON.parse(row.settings)
    if (!settings.avatar) return { found: false, agentId }

    return { found: true, agentId, avatar: settings.avatar }
  })

  // GET /agents/avatars — all agent avatars (for canvas to render)
  app.get('/agents/avatars', async () => {
    const db = getDb()
    const rows = db.prepare('SELECT agent_id, settings FROM agent_config WHERE settings LIKE \'%avatar%\'').all() as Array<{ agent_id: string; settings: string }>
    const avatars: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        const settings = JSON.parse(row.settings)
        if (settings.avatar) avatars[row.agent_id] = settings.avatar
      } catch { /* skip malformed */ }
    }
    return { avatars }
  })

  // ── POST /agents/:name/identity/claim — atomic identity handoff ────────────
  // Called by each agent on boot to claim their Reflectt identity.
  // Renames the agent in TEAM-ROLES.yaml (keeping the old name as an alias),
  // stores avatar + voice + color in agent_config.settings, reconnects the
  // OpenClaw gateway under the new identity, and emits agent_identity_changed.
  // This is the only path that produces real persisted on-host identity —
  // callers that only edit TEAM-ROLES.yaml via PUT /config/team-roles bypass
  // avatar/voice/color persistence and orphan the alias path.
  app.post<{ Params: { name: string } }>('/agents/:name/identity/claim', async (request, reply) => {
    const { name } = request.params
    const body = request.body as Record<string, unknown> ?? {}

    const claimedName = typeof body.claimedName === 'string' ? body.claimedName.trim().toLowerCase() : ''
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : undefined
    const voice = typeof body.voice === 'string' ? body.voice.trim() : undefined
    const color = typeof body.color === 'string' ? body.color.trim() : ''
    const avatar = body.avatar && typeof body.avatar === 'object' ? body.avatar as Record<string, unknown> : undefined

    if (!claimedName) {
      reply.code(400)
      return { success: false, error: 'claimedName is required' }
    }
    if (/[^a-z0-9_-]/.test(claimedName)) {
      reply.code(400)
      return { success: false, error: 'claimedName must be lowercase alphanumeric (a-z, 0-9, -, _)' }
    }
    if (!color) {
      reply.code(400)
      return { success: false, error: 'color is required — pick a hex (#rrggbb) or rgb()/rgba() value. It persists as settings.identityColor and is the single source of truth for your canvas color.' }
    }
    if (!/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))$/.test(color)) {
      reply.code(400)
      return { success: false, error: `color "${color}" must be a hex (#rrggbb) or rgb()/rgba() value` }
    }
    // Reject hallucinated voices — must match Kokoro prefix (af_/am_/bf_/bm_) or ElevenLabs ID shape.
    if (voice && !/^(af_|am_|bf_|bm_)[a-z0-9_]+$/i.test(voice) && !/^[a-zA-Z0-9]{20,}$/.test(voice)) {
      reply.code(400)
      return { success: false, error: `voice "${voice}" is not a recognized Kokoro or ElevenLabs voice ID. Kokoro voices: af_sarah, af_nicole, af_bella, am_adam, am_michael, bf_emma, bf_isabella, bm_george, bm_lewis.` }
    }

    // Resolve the source agent (must exist)
    const resolved = resolveAgentMention(name)
    const sourceId = resolved ?? name
    const sourceRole = getAgentRole(sourceId)
    if (!sourceRole) {
      reply.code(404)
      return { success: false, error: `Agent "${name}" not found in TEAM-ROLES.yaml` }
    }

    // Build updated roles: replace sourceId with claimedName, add source as alias
    const currentRoles = getAgentRoles()
    const updatedRoles = currentRoles.map(r => {
      if (r.name !== sourceId) return r
      return {
        ...r,
        name: claimedName,
        displayName: displayName ?? r.displayName,
        // Keep old name as alias so existing task assignments still resolve
        aliases: Array.from(new Set([...(r.aliases ?? []), sourceId])),
        ...(voice ? { voice } : {}),
      }
    })

    saveAgentRoles(updatedRoles)

    // Store avatar + voice + color in agent_config DB for TTS and canvas
    const db = getDb()
    const settingsRow = db.prepare('SELECT settings FROM agent_config WHERE agent_id = ?').get(claimedName) as { settings: string } | undefined
    const settings = settingsRow ? JSON.parse(settingsRow.settings) : {}
    if (avatar) settings.avatar = { ...avatar, updatedAt: Date.now() }
    if (voice) settings.voice = voice
    if (color) settings.identityColor = color

    if (settingsRow) {
      db.prepare('UPDATE agent_config SET settings = ?, updated_at = ? WHERE agent_id = ?')
        .run(JSON.stringify(settings), Date.now(), claimedName)
    } else {
      db.prepare('INSERT INTO agent_config (agent_id, team_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(claimedName, 'default', JSON.stringify(settings), Date.now(), Date.now())
    }

    const now = Date.now()

    // Reconnect OpenClaw gateway under new identity
    openclawClient.reidentify({
      name: claimedName,
      displayName: displayName || claimedName,
    })

    // Broadcast identity switch — clients update chat attribution, presence, roster
    eventBus.emit({
      id: `identity-claim-${now}`,
      type: 'agent_identity_changed' as const,
      timestamp: now,
      data: {
        previousName: sourceId,
        newName: claimedName,
        displayName: displayName ?? null,
        avatar: avatar ?? null,
        voice: voice ?? null,
        color: color ?? null,
      },
    })

    // Emit canvas render so the agent appears in presence bar immediately
    eventBus.emit({
      id: `identity-claim-canvas-${now}`,
      type: 'canvas_render' as const,
      timestamp: now,
      data: { agentId: claimedName, state: 'idle', sensors: null, payload: { identityClaimed: true, previousName: sourceId } },
    })

    return {
      success: true,
      previousName: sourceId,
      newName: claimedName,
      displayName: displayName ?? null,
      avatarSet: !!avatar,
      voiceSet: !!voice,
      colorSet: !!color,
    }
  })

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

  // ── File upload/download ──
  app.post('/files', async (request, reply) => {
    try {
      const { MAX_SIZE_BYTES: maxBytes } = await import('./files.js')

      // Early rejection via Content-Length before reading body
      const declaredLength = parseInt(String(request.headers['content-length'] || ''), 10)
      if (!Number.isNaN(declaredLength) && declaredLength > maxBytes) {
        reply.code(413)
        return { success: false, error: `File exceeds ${maxBytes / (1024 * 1024)}MB limit (Content-Length: ${declaredLength} bytes)` }
      }

      const data = await request.file()
      if (!data) { reply.code(400); return { success: false, error: 'No file in request' } }

      const chunks: Buffer[] = []
      for await (const chunk of data.file) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      // Check if stream was truncated (exceeds multipart limit)
      if (data.file.truncated) {
        reply.code(413)
        return { success: false, error: `File exceeds ${maxBytes / (1024 * 1024)}MB limit` }
      }

      const fields = data.fields as Record<string, { value?: string } | undefined>
      const uploadedBy = typeof fields?.uploadedBy?.value === 'string' ? fields.uploadedBy.value : 'anonymous'
      const tagsRaw = typeof fields?.tags?.value === 'string' ? fields.tags.value : '[]'
      let tags: string[] = []
      try { tags = JSON.parse(tagsRaw) } catch { tags = [] }

      const { uploadFile } = await import('./files.js')
      const result = uploadFile({ filename: data.filename, buffer, uploadedBy, tags, mimeType: data.mimetype })
      if (!result.success) { reply.code(400); return result }
      reply.code(201)
      return result
    } catch (err: unknown) {
      const { MAX_SIZE_BYTES: maxBytes } = await import('./files.js')
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Request file too large')) { reply.code(413); return { success: false, error: `File exceeds ${maxBytes / (1024 * 1024)}MB limit` } }
      reply.code(500); return { success: false, error: 'Upload failed' }
    }
  })

  app.get<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    const { readFile, isImage } = await import('./files.js')
    const result = readFile(request.params.id)
    if (!result) { reply.code(404); return { success: false, error: 'File not found' } }

    const disposition = isImage(result.meta.mimeType) ? 'inline' : `attachment; filename="${result.meta.originalName}"`
    reply.header('Content-Type', result.meta.mimeType)
    reply.header('Content-Disposition', disposition)
    reply.header('Content-Length', result.meta.sizeBytes)
    reply.header('Cache-Control', 'private, max-age=3600')
    return reply.send(result.buffer)
  })

  app.get<{ Params: { id: string } }>('/files/:id/meta', async (request, reply) => {
    const { getFile } = await import('./files.js')
    const meta = getFile(request.params.id)
    if (!meta) { reply.code(404); return { success: false, error: 'File not found' } }
    return { success: true, file: meta }
  })

  app.get('/files', async (request) => {
    const query = request.query as Record<string, string>
    const { listFiles } = await import('./files.js')
    return listFiles({
      uploadedBy: query.uploadedBy || query.uploaded_by,
      tag: query.tag,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    })
  })

  app.delete<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    const { deleteFile } = await import('./files.js')
    const result = deleteFile(request.params.id)
    if (!result.success) { reply.code(404); return result }
    return result
  })

  // ── Team intensity / pacing ──
  app.get('/policy/intensity', async () => {
    const { getIntensity } = await import('./intensity.js')
    return { success: true, ...getIntensity() }
  })

  app.put('/policy/intensity', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const preset = typeof body.preset === 'string' ? body.preset.trim().toLowerCase() : ''
    const { isValidPreset, setIntensity } = await import('./intensity.js')
    if (!isValidPreset(preset)) {
      reply.code(400)
      return { success: false, error: 'Invalid preset. Must be: low, normal, or high.', valid: ['low', 'normal', 'high'] }
    }
    const updatedBy = typeof body.updatedBy === 'string' ? body.updatedBy.trim() : 'api'
    const state = setIntensity(preset, updatedBy)
    return { success: true, ...state }
  })

  // ── Team polls ──
  app.post('/polls', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    const options = Array.isArray(body.options) ? body.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map(o => o.trim()) : []
    const createdBy = typeof body.createdBy === 'string' ? body.createdBy.trim() : (typeof body.created_by === 'string' ? body.created_by.trim() : 'anonymous')
    const expiresInMinutes = typeof body.expiresInMinutes === 'number' ? body.expiresInMinutes : (typeof body.deadline_minutes === 'number' ? body.deadline_minutes : undefined)
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : (typeof body.deadline === 'number' ? body.deadline : undefined)
    const anonymous = body.anonymous === true

    if (!question) { reply.code(400); return { success: false, error: 'question is required' } }
    if (options.length < 2) { reply.code(400); return { success: false, error: 'At least 2 options required' } }
    if (options.length > 10) { reply.code(400); return { success: false, error: 'Maximum 10 options' } }

    const { createPoll } = await import('./polls.js')
    const poll = createPoll({ question, options, createdBy, expiresInMinutes, expiresAt, anonymous })
    return { success: true, poll }
  })

  app.get('/polls', async (request) => {
    const query = request.query as Record<string, string>
    const status = (query.status === 'active' || query.status === 'closed' || query.status === 'all') ? query.status : 'all'
    const limit = query.limit ? parseInt(query.limit, 10) || 20 : 20

    const { listPolls } = await import('./polls.js')
    const polls = listPolls({ status, limit })
    return { success: true, polls, count: polls.length }
  })

  app.get<{ Params: { id: string } }>('/polls/:id', async (request, reply) => {
    const { getPoll } = await import('./polls.js')
    const poll = getPoll(request.params.id)
    if (!poll) { reply.code(404); return { success: false, error: 'Poll not found' } }
    return { success: true, poll }
  })

  app.post<{ Params: { id: string } }>('/polls/:id/vote', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const voter = typeof body.voter === 'string' ? body.voter.trim() : ''
    const choice = typeof body.choice === 'number' ? body.choice : (typeof body.option_index === 'number' ? body.option_index : -1)

    if (!voter) { reply.code(400); return { success: false, error: 'voter is required' } }
    if (choice < 0) { reply.code(400); return { success: false, error: 'choice is required (0-indexed option number)' } }

    const { vote, getPoll } = await import('./polls.js')
    const result = vote(request.params.id, voter, choice)
    if (!result.success) { reply.code(400); return result }

    const poll = getPoll(request.params.id)
    return { success: true, poll }
  })

  app.post<{ Params: { id: string } }>('/polls/:id/close', async (request, reply) => {
    const { closePoll, getPoll } = await import('./polls.js')
    const result = closePoll(request.params.id)
    if (!result.success) { reply.code(400); return result }

    const poll = getPoll(request.params.id)
    return { success: true, poll }
  })

  // ── Agent identity: display name management ──
  app.post('/config/identity', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agent = typeof body.agent === 'string' ? body.agent.trim() : ''
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''

    if (!agent) {
      reply.code(400)
      return { success: false, error: 'agent is required (agent ID from TEAM-ROLES.yaml)' }
    }
    if (!displayName) {
      reply.code(400)
      return { success: false, error: 'displayName is required' }
    }
    if (displayName.length > 64) {
      reply.code(400)
      return { success: false, error: 'displayName must be <= 64 characters' }
    }

    const result = setAgentDisplayName(agent, displayName)
    if (!result.success) {
      reply.code(404)
      return { success: false, error: result.error }
    }
    return { success: true, agent, displayName }
  })

  // ── Write TEAM-ROLES.yaml (used by bootstrap agent to configure the team) ──
  app.put('/config/team-roles', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const yaml = typeof body.yaml === 'string' ? body.yaml.trim() : ''

    if (!yaml) {
      reply.code(400)
      return { success: false, error: 'yaml field is required (TEAM-ROLES.yaml content)' }
    }

    // Basic validation: must contain 'agents:' and at least one agent name
    if (!yaml.includes('agents:')) {
      reply.code(400)
      return { success: false, error: 'Invalid TEAM-ROLES.yaml: must contain "agents:" section' }
    }

    try {
      const { writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const filePath = join(REFLECTT_HOME, 'TEAM-ROLES.yaml')

      // Preserve claimed founding agents that the new yaml drops.
      // When `main` calls /agents/main/identity/claim it renames itself in TEAM-ROLES.yaml
      // (e.g. main → beacon) and persists avatar/voice/color into agent_config.settings.
      // A subsequent PUT /config/team-roles that lists only the new team agents would
      // wipe the renamed founder from yaml, orphaning it: agent_config still has its
      // identity, but role resolution / @mention fallback / heartbeat all break.
      // Detect this: any prev role whose name is in agent_config (with claimed identity)
      // and missing from the incoming yaml gets re-merged before we save.
      const prevRoles = getAgentRoles()
      const prevAgentNames = new Set(prevRoles.map(r => r.name))
      let preservedNames: string[] = []
      let yamlToWrite = yaml
      try {
        const incomingRoles = parseRolesYaml(yaml)
        const incomingNames = new Set(incomingRoles.map(r => r.name.toLowerCase()))
        const claimedIds = getClaimedAgentIds()
        const preserved = prevRoles.filter(r =>
          claimedIds.has(r.name.toLowerCase()) && !incomingNames.has(r.name.toLowerCase())
        )
        if (preserved.length > 0) {
          // Use saveAgentRoles to write the merged structured roster (preserves
          // aliases/avatar/voice fields verbatim). The raw yaml string is discarded
          // for this path; downstream load reads the merged file.
          saveAgentRoles([...incomingRoles, ...preserved])
          preservedNames = preserved.map(r => r.name)
          console.log(`[config/team-roles] Preserved ${preserved.length} claimed agent(s) dropped by incoming yaml: ${preservedNames.join(', ')}`)
        } else {
          writeFileSync(filePath, yamlToWrite, 'utf-8')
        }
      } catch (parseErr) {
        // If we can't parse the incoming yaml, fall back to the original write —
        // the loadAgentRoles() below will surface the parse failure.
        writeFileSync(filePath, yamlToWrite, 'utf-8')
        console.warn(`[config/team-roles] Could not parse yaml for preservation check: ${(parseErr as Error).message}`)
      }

      // Hot-reload the team config
      const { loadAgentRoles } = await import('./assignment.js')
      const reloaded = loadAgentRoles()

      // Broadcast new agents to canvas so they appear immediately (with idle orb)
      const now = Date.now()
      for (const role of reloaded.roles) {
        if (!prevAgentNames.has(role.name)) {
          eventBus.emit({
            id: `team-reload-${now}-${role.name}`,
            type: 'canvas_render' as const,
            timestamp: now,
            data: { agentId: role.name, state: 'idle', sensors: null, payload: { justJoined: true } },
          })
        }
      }

      // Identity handoff: if bootstrap 'main' agent was replaced by a real agent,
      // reidentify the OpenClaw gateway session so new messages carry the real name.
      const newPrimary = reloaded.roles.find(r => r.role !== 'bootstrap') ?? reloaded.roles[0]
      const prevWasBootstrap = prevAgentNames.has('main') && prevAgentNames.size === 1
      if (newPrimary && prevWasBootstrap && newPrimary.name !== 'main') {
        openclawClient.reidentify({
          name: newPrimary.name,
          displayName: newPrimary.displayName || newPrimary.name,
        })
        eventBus.emit({
          id: `identity-handoff-${now}`,
          type: 'agent_identity_changed' as const,
          timestamp: now,
          data: { previousName: 'main', newName: newPrimary.name, displayName: newPrimary.displayName ?? null },
        })
      }

      return {
        success: true,
        path: filePath,
        agents: reloaded.roles.length,
        hint: 'TEAM-ROLES.yaml saved and hot-reloaded. Agents will pick up new routing immediately.',
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to write TEAM-ROLES.yaml'
      reply.code(500)
      return { success: false, error: msg }
    }
  })

  // POST /agents — Add a single agent to the team
  app.post('/agents', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : ''
    const role = typeof body.role === 'string' ? body.role.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : ''

    if (!name) { reply.code(400); return { success: false, error: 'name is required' } }
    if (!role) { reply.code(400); return { success: false, error: 'role is required' } }
    if (/[^a-z0-9_-]/.test(name)) { reply.code(400); return { success: false, error: 'name must be lowercase alphanumeric (a-z, 0-9, -, _)' } }

    // Check if agent already exists
    const existing = getAgentRoles().find(r => r.name === name)
    if (existing) { reply.code(409); return { success: false, error: `Agent "${name}" already exists (role: ${existing.role})` } }

    // Read existing YAML and append new agent
    const { readFileSync, writeFileSync, existsSync } = await import('node:fs')
    const { join } = await import('node:path')
    const filePath = join(REFLECTT_HOME, 'TEAM-ROLES.yaml')

    let yaml = ''
    if (existsSync(filePath)) {
      yaml = readFileSync(filePath, 'utf-8')
    }
    if (!yaml.includes('agents:')) {
      yaml = 'agents:\n'
    }

    // Build agent YAML entry
    const affinityTags = Array.isArray(body.affinityTags) ? body.affinityTags : [role]
    const wipCap = typeof body.wipCap === 'number' ? body.wipCap : 2
    const desc = description || `${role} agent.`

    const entry = [
      `  - name: ${name}`,
      `    role: ${role}`,
      `    description: ${desc}`,
      `    affinityTags: [${affinityTags.join(', ')}]`,
      `    wipCap: ${wipCap}`,
    ].join('\n')

    // Insert before lanes: section (if present), otherwise append
    const lanesIdx = yaml.indexOf('\nlanes:')
    if (lanesIdx >= 0) {
      yaml = yaml.slice(0, lanesIdx) + '\n' + entry + yaml.slice(lanesIdx)
    } else {
      yaml = yaml.trimEnd() + '\n' + entry + '\n'
    }

    try {
      writeFileSync(filePath, yaml, 'utf-8')
      const { loadAgentRoles } = await import('./assignment.js')
      const reloaded = loadAgentRoles()

      // Scaffold agent workspace if it doesn't exist
      let workspaceCreated = false
      try {
        const { mkdirSync, existsSync: dirExists } = await import('node:fs')
        const workspaceDir = join(REFLECTT_HOME, `workspace-${name}`)
        if (!dirExists(workspaceDir)) {
          mkdirSync(workspaceDir, { recursive: true })
          writeFileSync(join(workspaceDir, 'SOUL.md'), `# ${name}\n\n*${desc}*\n`, 'utf-8')
          writeFileSync(join(workspaceDir, 'AGENTS.md'), `# ${name}\n\nRole: ${role}\n\n${desc}\n`, 'utf-8')
          workspaceCreated = true
        }
      } catch (wsErr) {
        console.warn(`[Agents] Workspace scaffold failed for ${name}:`, (wsErr as Error).message)
      }

      return {
        success: true,
        agent: { name, role, description: desc, wipCap },
        totalAgents: reloaded.roles.length,
        workspaceCreated,
        hint: `Agent "${name}" added to team and hot-reloaded. Start heartbeating: GET /heartbeat/${name}`,
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save agent'
      reply.code(500)
      return { success: false, error: msg }
    }
  })

  // DELETE /agents/:name — Remove an agent from the team
  app.delete<{ Params: { name: string } }>('/agents/:name', async (request, reply) => {
    const name = request.params.name.toLowerCase()
    const existing = getAgentRoles().find(r => r.name === name)
    if (!existing) { reply.code(404); return { success: false, error: `Agent "${name}" not found` } }

    const { readFileSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const filePath = join(REFLECTT_HOME, 'TEAM-ROLES.yaml')
    let yaml = readFileSync(filePath, 'utf-8')

    // Remove the agent block: from "  - name: <name>" to the next "  - name:" or top-level key or EOF
    const lines = yaml.split('\n')
    const filtered: string[] = []
    let skipping = false
    for (const line of lines) {
      if (line.match(new RegExp(`^\\s+-\\s+name:\\s+${name}\\s*$`))) {
        skipping = true
        continue
      }
      if (skipping) {
        // Stop skipping at next agent entry, top-level key, or blank line before top-level
        if (line.match(/^\s+-\s+name:\s/) || line.match(/^[a-z]/)) {
          skipping = false
          filtered.push(line)
        }
        continue
      }
      filtered.push(line)
    }
    yaml = filtered.join('\n')

    try {
      writeFileSync(filePath, yaml, 'utf-8')
      const { loadAgentRoles } = await import('./assignment.js')
      const reloaded = loadAgentRoles()
      return { success: true, removed: name, totalAgents: reloaded.roles.length }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove agent'
      reply.code(500)
      return { success: false, error: msg }
    }
  })

  // Resolve a mention string (name, displayName, or alias) to an agent ID
  app.get<{ Params: { mention: string } }>('/resolve/mention/:mention', async (request) => {
    const agentName = resolveAgentMention(request.params.mention)
    if (!agentName) return { success: false, found: false, mention: request.params.mention }
    const role = getAgentRole(agentName)
    return {
      success: true,
      found: true,
      mention: request.params.mention,
      agent: agentName,
      displayName: role?.displayName || null,
      role: role?.role || null,
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
  // Note: GET /approval-queue is defined below near /approval-queue/:approvalId/decide

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

  // ── Presence Layer canvas state ─────────────────────────────────────
  // Agent emits canvas_render state transitions for the Presence Layer.
  // Deterministic event types. No "AI can emit anything" protocol.

  const CANVAS_STATES = ['floor', 'listening', 'thinking', 'rendering', 'ambient', 'decision', 'urgent', 'handoff'] as const
  type CanvasState = typeof CANVAS_STATES[number]
  const SENSOR_VALUES = [null, 'mic', 'camera', 'mic+camera'] as const

  const CanvasRenderSchema = z.object({
    state: z.enum(CANVAS_STATES),
    sensors: z.enum(['mic', 'camera', 'mic+camera']).nullable().default(null),
    agentId: z.string().min(1),
    payload: z.object({
      text: z.string().optional(),
      media: z.unknown().optional(),
      // Explicit content type — eliminates heuristic inference on the canvas
      content: z.object({
        type: z.enum(['text', 'markdown', 'code', 'image']).optional(),
        lang: z.string().optional(),  // syntax hint for code blocks (e.g. "typescript", "bash")
        progress: z.array(z.object({
          label: z.string(),
          state: z.enum(['pending', 'active', 'done', 'failed']),
        })).optional(),
      }).optional(),
      decision: z.object({
        question: z.string(),
        context: z.string().optional(),
        decisionId: z.string(),
        expiresAt: z.number().optional(),
        autoAction: z.string().optional(),
      }).optional(),
      agents: z.array(z.object({
        name: z.string(),
        state: z.string(),
        task: z.string().optional(),
      })).optional(),
      summary: z.object({
        headline: z.string(),
        items: z.array(z.string()).optional(),
        cost: z.string().optional(),
        duration: z.string().optional(),
      }).optional(),
    }).default({}),
  })

  // Current state per agent — in-memory, not persisted
  const canvasStateMap = new Map<string, { state: CanvasState; sensors: string | null; payload: unknown; updatedAt: number; lastMessage?: { content: string; timestamp: number } }>()
  _canvasStateMap = canvasStateMap // populate forward reference for earlier route handlers

  // ── Canvas auto-state sweep ──
  // Derives canvas state from task board for agents who haven't pushed recently.
  // Prevents blank canvas when agents are working but not calling POST /canvas/state.
  ;(async () => {
    function doCanvasAutoStateSweep() {
      try {
        runCanvasAutoStateSweep({
          listTasks: (opts) => taskManager.listTasks(opts as any),
          listAllAgents: () => {
            // Get ALL agent IDs from task board - every assignee, even those without tasks
            const allTasks = taskManager.listTasks({})
            const agents = new Set<string>()
            for (const t of allTasks) {
              if (t.assignee) agents.add(t.assignee)
            }
            return [...agents]
          },
          getCanvasState: (agentId) => {
            const entry = canvasStateMap.get(agentId)
            return entry ? { state: entry.state, updatedAt: entry.updatedAt } : null
          },
          emitSyntheticState: (agentId, state, sourceTasks, thought) => {
            const now = Date.now()
            // Write into canvasStateMap so pulse tick picks it up
            const existing: { lastMessage?: { content: string; timestamp: number }; state?: CanvasState } = canvasStateMap.get(agentId) ?? {}
            canvasStateMap.set(agentId, {
              state,
              sensors: null,
              payload: { _auto: true, sourceTasks: sourceTasks.slice(0, 2).map((t: { id: string; title: string; status: string }) => ({ id: t.id, title: t.title, status: t.status })) },
              updatedAt: now,
              lastMessage: thought ? { content: thought, timestamp: now } : existing?.lastMessage,
            })
            // Emit canvas_render so SSE consumers get immediate update
            eventBus.emit({
              id: `auto-state-${agentId}-${now}`,
              type: 'canvas_render' as const,
              timestamp: now,
              data: {
                state,
                sensors: null,
                agentId,
                payload: { _auto: true },
                presence: {
                  name: agentId,
                  color: getIdentityColor(agentId, '#60a5fa'),
                  state,
                  canvasState: state,
                  task: sourceTasks[0]?.title ?? null,
                  _auto: true,
                },
                previousState: existing?.state ?? 'floor',
              },
            })
          },
          emitTaskProgress: (agentId, task) => {
            const now = Date.now()
            // Emit canvas_push thought for /live visitors - shows real task progress
            eventBus.emit({
              id: `task-progress-${agentId}-${now}`,
              type: 'canvas_push' as const,
              timestamp: now,
              data: {
                type: 'expression',
                expression: 'thought',
                agentId,
                agentColor: getIdentityColor(agentId, '#60a5fa'),
                text: `${task.title}`,
                state: 'working',
                task: task.title,
                ttl: 12000,
              },
            })
          },
          emitAmbientThought: (agentId, task) => {
            const now = Date.now()
            // Emit ambient thought with actual task title - makes /live feel alive with real work
            // Shows visitors exactly what each agent is doing right now
            eventBus.emit({
              id: `ambient-${agentId}-${now}`,
              type: 'canvas_push' as const,
              timestamp: now,
              data: {
                type: 'expression',
                expression: 'thought',
                agentId,
                agentColor: getIdentityColor(agentId, '#60a5fa'),
                text: task.title.slice(0, 80),
                state: 'working',
                task: task.title,
                ttl: 12000,
              },
            })
          },
        })
      } catch (err) {
        // Non-fatal — canvas auto-state is best-effort
        console.warn('[canvas-auto-state] Sweep error:', err)
      }
    }

    const autoStateTimer = setInterval(doCanvasAutoStateSweep, SYNC_INTERVAL_MS)
    autoStateTimer.unref()
  })().catch(() => { /* never fail startup */ })

  // POST /canvas/state — agent emits a state transition
  app.post('/canvas/state', async (request, reply) => {
    const result = CanvasRenderSchema.safeParse(request.body)
    if (!result.success) {
      reply.code(422)
      return {
        error: `Invalid canvas state: ${result.error.issues.map(i => i.message).join(', ')}`,
        hint: `state must be one of: ${CANVAS_STATES.join(', ')}`,
        validStates: CANVAS_STATES,
      }
    }

    const { state, sensors, agentId, payload } = result.data
    const now = Date.now()

    // Detect dramatic state transitions → emit spark burst
    const prev = canvasStateMap.get(agentId)
    const prevState = prev?.state ?? 'floor'

    // Store current state
    canvasStateMap.set(agentId, { state, sensors, payload, updatedAt: now })

    // Emit canvas_render event over SSE
    eventBus.emit({
      id: `crender-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'canvas_render' as const,
      timestamp: now,
      data: { state, sensors, agentId, payload },
    })

    // Emit canvas_burst on dramatic transitions (thought manifesting, urgency breaking, etc.)
    const BURST_TRANSITIONS: Array<[string, string, string, number]> = [
      // [from, to, kind, intensity]
      ['thinking', 'rendering', 'thought_manifest', 0.9],
      ['working',  'rendering', 'output_burst',     0.7],
      ['thinking', 'decision',  'decision_emerge',  0.85],
      ['floor',    'urgent',    'urgency_spike',     1.0],
      ['ambient',  'urgent',    'urgency_spike',     1.0],
      ['working',  'urgent',    'urgency_spike',     1.0],
      ['decision', 'working',   'decision_resolved', 0.75],
      ['urgent',   'working',   'tension_release',   0.8],
      ['urgent',   'floor',     'tension_release',   0.8],
    ]
    for (const [from, to, kind, intensity] of BURST_TRANSITIONS) {
      if (prevState === from && state === to) {
        eventBus.emit({
          id: `cburst-${now}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'canvas_burst' as const,
          timestamp: now,
          data: { agentId, from: prevState, to: state, kind, intensity },
        })
        break
      }
    }

    // Auto-detect collaboration: if another agent is on the same active task, emit a spark arc
    const activeTaskId = (payload as Record<string, unknown>).activeTask
      ? ((payload as any).activeTask as { id?: string }).id
      : null
    if (activeTaskId) {
      for (const [otherId, otherEntry] of canvasStateMap) {
        if (otherId === agentId) continue
        const otherPayload = otherEntry.payload as Record<string, unknown>
        const otherTaskId = (otherPayload as any)?.activeTask?.id
        if (otherTaskId === activeTaskId && now - otherEntry.updatedAt < 5 * 60 * 1000) {
          eventBus.emit({
            id: `cspark-${now}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'canvas_spark' as const,
            timestamp: now,
            data: { from: agentId, to: otherId, taskId: activeTaskId, intensity: 0.7, kind: 'collaboration' },
          })
        }
      }
    }

    // Auto ghost trail — every state transition leaves a faint particle exhale.
    // Fires immediately so SSE subscribers receive it before the next pulse tick.
    // Client renders _ghost=true events with low opacity (0.06-0.14), no TTS.
    if (prevState !== state) {
      const ghostIntensity =
        state === 'urgent'   ? 0.9 :
        state === 'decision' ? 0.75 :
        state === 'rendering'? 0.6 :
        state === 'thinking' ? 0.4 : 0.25
      const ghostParticles =
        ghostIntensity > 0.7 ? 'surge' : ghostIntensity > 0.4 ? 'drift' : 'scatter'
      eventBus.emit({
        id: `ghost-${now}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'canvas_expression' as const,
        timestamp: now,
        data: {
          agentId,
          channels: {
            visual: {
              flash: getIdentityColor(agentId, '#60a5fa'),
              particles: ghostParticles,
            },
            narrative: `${agentId} → ${state}`,
          },
          _ghost: true,
        },
      })
    }

    // Trigger immediate cloud sync for real-time presence
    requestImmediateCanvasSync()

    return { success: true, state, agentId, timestamp: now }
  })

  // ── AgentPresence endpoint (matches presence-card-spec.md contract) ──
  // POST /agents/:agentId/canvas — agent emits a presence-compatible canvas event
  // Emits canvas_render SSE event with AgentPresence shape + triggers immediate cloud sync

  type PresenceState = 'idle' | 'working' | 'thinking' | 'rendering' | 'needs-attention' | 'urgent' | 'handoff' | 'decision' | 'waiting'

  const VALID_PRESENCE_STATES: PresenceState[] = ['idle', 'working', 'thinking', 'rendering', 'needs-attention', 'urgent', 'handoff', 'decision', 'waiting']

  const AgentPresenceSchema = z.object({
    state: z.enum(['idle', 'working', 'thinking', 'rendering', 'needs-attention', 'urgent', 'handoff', 'decision', 'waiting']),
    activeTask: z.object({
      title: z.string(),
      id: z.string(),
    }).optional(),
    recency: z.string().optional(),
    attention: z.object({
      type: z.enum(['approval', 'review', 'block']),
      taskId: z.string(),
      label: z.string().optional(),
    }).optional(),
    sensors: z.enum(['mic', 'camera', 'mic+camera']).nullable().default(null),
    payload: z.record(z.unknown()).optional(),
    currentPr: z.number().int().positive().optional(),   // open PR number agent is working on
    progress: z.number().min(0).max(1).optional(),        // 0–1 completion estimate for active task
    urgency: z.number().min(0).max(1).optional(),         // 0.0–1.0 visual intensity for living canvas
    ambientCue: z.object({                                // living canvas atmosphere override
      colorHint: z.string().optional(),
      particleIntensity: z.number().min(0).max(1).optional(),
      pulseRate: z.enum(['slow', 'normal', 'fast']).optional(),
    }).optional(),
    content: z.object({                                   // explicit content-type for deterministic rendering
      type: z.enum(['text', 'markdown', 'code', 'image']).optional(),
      lang: z.string().optional(),                        // code syntax hint (e.g. "typescript", "bash")
      progress: z.array(z.object({
        label: z.string(),
        state: z.enum(['pending', 'active', 'done', 'failed']),
      })).optional(),
    }).optional(),
  })

  app.post<{ Params: { agentId: string } }>('/agents/:agentId/canvas', async (request, reply) => {
    const { agentId } = request.params
    if (!agentId) return reply.code(400).send({ error: 'agentId is required' })

    const result = AgentPresenceSchema.safeParse(request.body)
    if (!result.success) {
      reply.code(422)
      return {
        error: `Invalid presence: ${result.error.issues.map(i => i.message).join(', ')}`,
        validStates: VALID_PRESENCE_STATES,
      }
    }

    const { state: presenceState, activeTask, recency, attention, sensors, payload, currentPr, progress, urgency, ambientCue } = result.data
    const now = Date.now()
    const identityColor = getIdentityColor(agentId)

    // Map presence state to canvas state for backward compatibility
    // New states pass through directly to canvas (1:1 where names match)
    const canvasState: CanvasState = presenceState === 'needs-attention' ? 'decision'
      : presenceState === 'working' ? 'thinking'
      : presenceState === 'thinking' ? 'thinking'
      : presenceState === 'rendering' ? 'rendering'
      : presenceState === 'urgent' ? 'urgent'
      : presenceState === 'handoff' ? 'handoff'
      : presenceState === 'decision' ? 'decision'
      : presenceState === 'waiting' ? 'ambient'  // waiting = soft ambient (no ring)
      : 'ambient'

    // Derive urgency from state if not explicitly provided
    const derivedUrgency: number = urgency ?? (
      presenceState === 'urgent' ? 1.0 :
      presenceState === 'decision' || presenceState === 'needs-attention' ? 0.75 :
      presenceState === 'rendering' ? 0.4 :
      presenceState === 'thinking' || presenceState === 'working' ? 0.2 :
      0.0
    )

    // Store in canvasStateMap (backward compat with existing GET /canvas/state)
    canvasStateMap.set(agentId, {
      state: canvasState,
      sensors,
      payload: { ...payload, activeTask, attention, presenceState, currentPr, progress, urgency: derivedUrgency, ambientCue },
      updatedAt: now,
    })

    // Build AgentPresence payload (matches presence-card-spec.md + CANVAS-STATE-CONTRACT-v1)
    const agentPresence = {
      name: agentId,
      identityColor,
      state: presenceState,
      activeTask,
      recency: recency || 'just now',
      attention,
      urgency: derivedUrgency,
      ...(ambientCue !== undefined ? { ambientCue } : {}),
      ...(currentPr !== undefined ? { currentPr } : {}),
      ...(progress !== undefined ? { progress } : {}),
    }

    // Emit canvas_render SSE event with AgentPresence shape
    eventBus.emit({
      id: `cpresence-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'canvas_render' as const,
      timestamp: now,
      data: {
        // Legacy fields (backward compat)
        state: canvasState,
        sensors,
        agentId,
        payload: { ...payload, activeTask, attention },
        // AgentPresence fields (new contract — includes urgency + ambientCue)
        presence: agentPresence,
      },
    })

    // Trigger immediate cloud sync so presence surface gets the update fast
    requestImmediateCanvasSync()

    return { success: true, presence: agentPresence, timestamp: now }
  })

  // GET /agents/:agentId/canvas — current AgentPresence for one agent
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/canvas', async (request) => {
    const { agentId } = request.params
    const entry = canvasStateMap.get(agentId)
    if (!entry) {
      return {
        name: agentId,
        identityColor: getIdentityColor(agentId),
        state: 'idle' as PresenceState,
        recency: 'unknown',
      }
    }

    const presenceState: PresenceState =
      (entry.payload as any)?.presenceState ||
      (entry.state === 'decision' || entry.state === 'urgent' ? 'needs-attention' :
       entry.state === 'thinking' || entry.state === 'rendering' ? 'working' : 'idle')

    return {
      name: agentId,
      identityColor: getIdentityColor(agentId),
      state: presenceState,
      activeTask: (entry.payload as any)?.activeTask,
      recency: formatRecency(entry.updatedAt),
      attention: (entry.payload as any)?.attention,
    }
  })
  // Flow expression log — shared state for flow-score calculation (in canvas-routes.ts)
  const flowExpressionLog: Array<{ t: number }> = []
  ;(function trackExpressionVelocity() {
    const listenerId = 'flow-score-tracker'
    eventBus.on(listenerId, (event) => {
      if (event.type === 'canvas_expression') {
        flowExpressionLog.push({ t: Date.now() })
        const cutoff = Date.now() - 10 * 60 * 1000
        while (flowExpressionLog.length > 0 && flowExpressionLog[0]!.t < cutoff) {
          flowExpressionLog.shift()
        }
      }
    })
  })()

  // ── Canvas read routes (extracted to src/canvas-routes.ts) ───────────
  // Phase 1: states, slots, slots/all, rejections
  // Phase 2: presence, state, flow-score, team/mood
  await app.register(canvasReadRoutes, {
    canvasStateMap,
    canvasSlots: { getActive: () => canvasSlots.getActive(), getAll: () => canvasSlots.getAll(), getStats: () => canvasSlots.getStats() },
    getDb,
    getRecentRejections,
    flowExpressionLog,
  } as any)
  // ── Canvas interactive routes (extracted to src/canvas-interactive.ts) ─────
  // POST /canvas/gaze, POST /canvas/briefing, POST /canvas/victory,
  // POST /canvas/spark, POST /canvas/express, GET /canvas/render/stream
  const { canvasInteractiveRoutes, registerCapabilityRoutes } = await import("./canvas-interactive.js")
  await app.register(canvasInteractiveRoutes, {
    eventBus,
    canvasStateMap,
  } as any)

  // Register capability routes: GET/POST /canvas/capability
  registerCapabilityRoutes(app)

  // Seed capability map with platform integrations for all known agents
  const { seedCapabilityMap } = await import('./canvas-interactive.js')
  const allTasks = taskManager.listTasks({})
  const agentNames = [...new Set([...allTasks.map((t: any) => t.assignee).filter(Boolean), ...getAgentRoles().map(r => r.name)])]
  const agents = agentNames.map((name: string) => ({ name }))
  seedCapabilityMap(agents)
  console.log(`[capabilities] seeded ${agents.length} agents with platform capabilities`)

  // ── Canvas activity stream — SSE with backfill ────────────────────────
  // New viewers get the last 20 canvas events immediately on connect (backfill),
  // then receive live events going forward. Canvas feels alive from frame 1.
  // Event types: canvas_message, canvas_render, canvas_expression, canvas_burst
  // task-1773672750043

  const ACTIVITY_STREAM_TYPES = new Set(['canvas_message', 'canvas_render', 'canvas_expression', 'canvas_burst'])
  const activityRingBuffer: Array<{ id: string; type: string; timestamp: number; data: unknown }> = []
  const ACTIVITY_RING_SIZE = 30 // Keep slightly more than 20 for filtering headroom

  // Normalize activity events into consistent shape
  const { normalizeActivityEventSlim } = await import('./activity-stream-normalizer.js')

  // Subscribe to eventBus to populate ring buffer
  eventBus.on('activity-ring-collector', (event) => {
    if (!ACTIVITY_STREAM_TYPES.has(event.type)) return
    const normalized = normalizeActivityEventSlim({ id: event.id, type: event.type, timestamp: event.timestamp, data: event.data as Record<string, unknown> })
    activityRingBuffer.push(normalized as any)
    if (activityRingBuffer.length > ACTIVITY_RING_SIZE) activityRingBuffer.shift()
  })

  const activityStreamSubscribers = new Map<string, { closed: boolean; send: (data: string) => void }>()

  // Forward matching events to activity stream subscribers (normalized shape)
  eventBus.on('activity-stream-relay', (event) => {
    if (!ACTIVITY_STREAM_TYPES.has(event.type)) return
    const normalized = normalizeActivityEventSlim({ id: event.id, type: event.type, timestamp: event.timestamp, data: event.data as Record<string, unknown> })
    const payload = JSON.stringify(normalized)
    for (const [subId, sub] of activityStreamSubscribers) {
      if (sub.closed) { activityStreamSubscribers.delete(subId); continue }
      try { sub.send(payload) } catch { activityStreamSubscribers.delete(subId) }
    }
  })

  // canvas/activity-stream + canvas/attention → registered below (were defined but never hooked up)
  await app.register(canvasPhase2Routes, {
    eventBus,
    queueCanvasPushEvent,
    taskManager: taskManager as any,
    getDb,
    activityRingBuffer,
    activityStreamSubscribers,
  } as any)

  app.post('/canvas/pulse', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) {
      reply.status(400)
      return { success: false, message: 'agentId is required' }
    }

    const urgency = typeof body.urgency === 'number'
      ? Math.max(0, Math.min(1, body.urgency))
      : undefined
    const burst = body.burst === true
    const label = typeof body.label === 'string' ? body.label.slice(0, 80) : undefined

    // Update agent urgency in canvasStateMap if provided
    if (urgency !== undefined) {
      const current = canvasStateMap.get(agentId)
      if (current) {
        const currentPayload = current.payload as Record<string, unknown>
        canvasStateMap.set(agentId, {
          ...current,
          payload: { ...currentPayload, urgency },
          updatedAt: Date.now(),
        })
      }
    }

    // Fire canvas_burst event if requested
    if (burst) {
      const currentState = canvasStateMap.get(agentId)?.state ?? 'working'
      eventBus.emit({
        id: `burst-pulse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'canvas_burst',
        timestamp: Date.now(),
        data: {
          agentId,
          fromState: currentState,
          toState: currentState,
          arcType: label ?? 'pulse_burst',
          intensity: urgency ?? 0.7,
        },
      })
    }

    return {
      success: true,
      agentId,
      urgency: urgency ?? null,
      burst,
    }
  })

  // POST /canvas/query — human asks the canvas a question; agent responds with a typed card
  // The response is emitted as a canvas_message event on the pulse SSE stream (no reload needed).
  // ── Canvas session history — per-session conversation memory ───────────────
  // Keyed by sessionId (client-generated UUID). Stores last 5 human+assistant turns.
  // Used to inject conversation context into LLM calls so follow-up questions work.
  // task: link/canvas-session-continuity
  const CANVAS_SESSION_MAX_TURNS = 5
  const CANVAS_SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes idle eviction
  type CanvasSessionTurn = { role: 'user' | 'assistant'; content: string; ts: number }
  const canvasSessionHistory = new Map<string, { turns: CanvasSessionTurn[]; lastAt: number }>()

  function getCanvasSession(sessionId: string): CanvasSessionTurn[] {
    const now = Date.now()
    const cached = canvasSessionHistory.get(sessionId)
    if (cached) {
      // Evict stale from memory
      if (now - cached.lastAt > CANVAS_SESSION_TTL_MS) {
        canvasSessionHistory.delete(sessionId)
        return []
      }
      return cached.turns
    }
    // Cache miss — load from SQLite, prune stale rows
    try {
      const db = getDb()
      const cutoff = now - CANVAS_SESSION_TTL_MS
      db.prepare('DELETE FROM canvas_sessions WHERE session_id = ? AND ts < ?').run(sessionId, cutoff)
      const rows = db.prepare(
        'SELECT role, content, ts FROM canvas_sessions WHERE session_id = ? ORDER BY ts ASC LIMIT ?'
      ).all(sessionId, CANVAS_SESSION_MAX_TURNS * 2) as Array<{ role: string; content: string; ts: number }>
      if (rows.length === 0) return []
      const turns = rows.map(r => ({ role: r.role as 'user' | 'assistant', content: r.content, ts: r.ts }))
      const lastAt = turns[turns.length - 1]!.ts
      canvasSessionHistory.set(sessionId, { turns, lastAt })
      return turns
    } catch {
      return []
    }
  }

  function pushCanvasSession(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const now = Date.now()
    // Update in-memory Map
    const existing = canvasSessionHistory.get(sessionId) ?? { turns: [], lastAt: now }
    existing.turns.push({ role, content, ts: now })
    if (existing.turns.length > CANVAS_SESSION_MAX_TURNS * 2) {
      existing.turns.splice(0, existing.turns.length - CANVAS_SESSION_MAX_TURNS * 2)
    }
    existing.lastAt = now
    canvasSessionHistory.set(sessionId, existing)
    // Write-through to SQLite for restart durability
    try {
      const db = getDb()
      db.prepare('INSERT INTO canvas_sessions (session_id, role, content, ts) VALUES (?, ?, ?, ?)').run(sessionId, role, content, now)
      // Prune rows beyond max turns (keep newest CANVAS_SESSION_MAX_TURNS*2)
      db.prepare(`
        DELETE FROM canvas_sessions WHERE session_id = ? AND ts NOT IN (
          SELECT ts FROM canvas_sessions WHERE session_id = ? ORDER BY ts DESC LIMIT ?
        )
      `).run(sessionId, sessionId, CANVAS_SESSION_MAX_TURNS * 2)
    } catch {
      // SQLite failure is non-fatal — in-memory session still works
    }
  }

  //
  // ── Canvas query route (extracted to src/canvas-query.ts) ─────
  const { canvasQueryRoutes } = await import("./canvas-query.js")
  await app.register(canvasQueryRoutes, {
    eventBus,
    canvasStateMap,
    taskManager,
    chatManager,
    getCanvasSession,
    pushCanvasSession,
    listHosts,
  } as any)


  // POST /canvas/push — agent self-initiates a canvas event without a human query.
  // Agents call this to surface their own work: utterances that float from their orb,
  // release pulses when something ships, handoff arcs when work moves between agents.
  // All events emit on the pulse SSE stream as canvas_push for the browser to render.
  //
  // pixel spec: design/canvas-as-ours.html
  // ── Canvas push + artifact routes (extracted to src/canvas-push.ts) ─────
  const { canvasPushRoutes } = await import("./canvas-push.js")
  await app.register(canvasPushRoutes, {
    eventBus,
    queueCanvasPushEvent,
    canvasStateMap,
  } as any)

  // GET /canvas/pulse — SSE stream emitting a heartbeat tick every 2s with live intensity values
  // Drives smooth canvas animation without polling. Each tick includes per-agent orb data + team mood.
  // Tick shape: { agents: [{ id, state, urgency, activeSpeaker, color, age }], team: { rhythm, tension, ambientPulse, dominantColor } }
  app.get('/canvas/pulse', async (request, reply) => {
    const STALE_MS = 60 * 60 * 1000 // 60min — agents stay visible as long as they heartbeat
    const STATE_URGENCY: Record<string, number> = {
      urgent: 1.0, decision: 0.85, needs_attention: 0.75,
      rendering: 0.5, thinking: 0.45, working: 0.3,
      waiting: 0.15, handoff: 0.2, idle: 0.0, floor: 0.0, ambient: 0.05,
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders?.()

    let closed = false
    request.raw.on('close', () => { closed = true })

    // Cache avatars — refresh every 30s to avoid DB reads on every tick
    let avatarCache: Record<string, { type: string; content: string; animated: boolean }> = {}
    let avatarCacheAge = 0
    const refreshAvatarCache = () => {
      const now = Date.now()
      if (now - avatarCacheAge < 30_000 && Object.keys(avatarCache).length > 0) return
      try {
        const rows = getDb().prepare("SELECT agent_id, settings FROM agent_config WHERE settings LIKE '%avatar%'").all() as Array<{ agent_id: string; settings: string }>
        const fresh: typeof avatarCache = {}
        for (const row of rows) {
          try {
            const s = JSON.parse(row.settings)
            if (s.avatar) fresh[row.agent_id] = { type: s.avatar.type, content: s.avatar.content, animated: s.avatar.animated ?? false }
          } catch { /* skip */ }
        }
        avatarCache = fresh
        avatarCacheAge = now
      } catch { /* non-blocking */ }
    }

    // Cache for focus, calendar, and activity (30s TTL — cheap to compute)
    interface CanvasMetaCache { focus: ReturnType<typeof getFocus>; upcomingEvents: Array<{ id: string; summary: string; dtstart: number; organizer: string }>; recentActivity: Array<{ ts: number; type: string; subject: unknown }>; age: number }
    let canvasMetaCache: CanvasMetaCache | null = null
    const getCanvasMeta = (): CanvasMetaCache => {
      const now = Date.now()
      if (canvasMetaCache && (now - canvasMetaCache.age) < 30_000) return canvasMetaCache
      const focus = getFocus()
      let upcomingEvents: CanvasMetaCache['upcomingEvents'] = []
      try {
        const events = calendarEvents.listEvents({ from: now, to: now + 24 * 60 * 60 * 1000, limit: 5 })
        upcomingEvents = events.map(e => ({ id: e.id, summary: e.summary, dtstart: e.dtstart, organizer: e.organizer }))
      } catch { /* skip */ }
      let recentActivity: CanvasMetaCache['recentActivity'] = []
      try {
        const twoHoursAgo = now - 2 * 60 * 60 * 1000
        const activity = queryActivity({ range: '24h', type: ['task', 'chat'], limit: 10 })
        recentActivity = activity.events.filter(e => e.ts_ms > twoHoursAgo).slice(0, 5).map(e => ({ ts: e.ts_ms, type: e.type, subject: e.subject }))
      } catch { /* skip */ }
      canvasMetaCache = { focus, upcomingEvents, recentActivity, age: now }
      return canvasMetaCache
    }

    const emitTick = () => {
      if (closed) return
      refreshAvatarCache()
      const now = Date.now()

      // Per-agent orb data
      const agents: Array<{
        id: string; state: string; urgency: number;
        activeSpeaker: boolean; color: string; age: number;
        task: string | null;
        avatar: { type: string; content: string; animated: boolean } | null
      }> = []

      for (const [agentId, entry] of canvasStateMap) {
        if (now - entry.updatedAt > STALE_MS) continue
        const payload = entry.payload as Record<string, unknown> ?? {}
        const presState = String((payload as any).presenceState ?? entry.state)
        const explicitUrgency = typeof (payload as any).urgency === 'number' ? (payload as any).urgency : null
        const urgency = explicitUrgency ?? (STATE_URGENCY[presState] ?? STATE_URGENCY[entry.state] ?? 0)

        // Extract current task label from payload — supports multiple sources:
        // 1. Explicit payload.task (agent-pushed)
        // 2. payload.activeTask.title (canvas state)
        // 3. payload.sourceTasks[0].title (auto-state sweep)
        const taskLabel: string | null =
          (typeof (payload as any).task === 'string' ? (payload as any).task : null) ??
          ((payload as any).activeTask?.title as string | undefined) ??
          ((payload as any).sourceTasks?.[0]?.title as string | undefined) ??
          null

        agents.push({
          id: agentId,
          state: presState,
          urgency,
          activeSpeaker: !!(payload as any).activeSpeaker,
          color: getIdentityColor(agentId, '#94a3b8'),
          age: now - entry.updatedAt,
          task: taskLabel,
          avatar: avatarCache[agentId] ?? null,
        })
      }

      // Team mood (inline mini-derivation from canvasStateMap)
      const states = agents.map(a => a.state)
      const urgentCount = states.filter(s => s === 'urgent').length
      const decisionCount = states.filter(s => s === 'decision').length
      const renderingCount = states.filter(s => s === 'rendering').length
      const thinkingCount = states.filter(s => s === 'thinking').length
      const idleCount = states.filter(s => s === 'floor' || s === 'ambient' || s === 'idle').length
      const activeCount = agents.length
      const workingCount = activeCount - idleCount
      const tension = Math.min(1.0, (urgentCount * 0.35) + (decisionCount * 0.25) + (activeCount > 0 ? (workingCount / activeCount) * 0.15 : 0))
      const rhythm = urgentCount > 0 ? 'surge' : activeCount === 0 ? 'quiet' : decisionCount > 0 ? 'tense' : renderingCount + thinkingCount >= Math.max(1, activeCount * 0.6) ? 'flow' : 'grinding'
      const ambientPulse = rhythm === 'surge' ? 'fast' : rhythm === 'flow' ? 'normal' : 'slow'
      let dominantColor = '#60a5fa'
      for (const a of agents) {
        if (a.state !== 'floor' && a.state !== 'ambient') { dominantColor = a.color; break }
      }

      // Include focus, calendar, and activity (cached, 30s TTL)
      const meta = getCanvasMeta()

      const tick = {
        t: now,
        agents,
        team: { rhythm, tension, ambientPulse, dominantColor, ...meta },
      }

      try {
        reply.raw.write(`data: ${JSON.stringify(tick)}\n\n`)
      } catch { closed = true }
    }

    // Emit immediately + every 2s
    emitTick()
    const interval = setInterval(() => {
      if (closed) { clearInterval(interval); return }
      emitTick()
    }, 2000)

    // Also forward burst + spark events in real-time (don't wait for next tick)
    const listenerId = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    eventBus.on(listenerId, (event) => {
      if (closed) return
      if (event.type !== 'canvas_burst' && event.type !== 'canvas_spark' && event.type !== 'canvas_milestone' && event.type !== 'canvas_expression' && event.type !== 'canvas_message' && event.type !== 'canvas_push' && event.type !== 'canvas_artifact' && event.type !== 'canvas_takeover' && event.type !== 'canvas_render') return
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event.data as object, t: event.timestamp })}\n\n`)
      } catch { closed = true }
    })

    request.raw.on('close', () => {
      clearInterval(interval)
      eventBus.off(listenerId)
    })

    // Keep connection alive — never resolve
    return new Promise<void>(() => {})
  })

  // GET /canvas/session/mode — inferred presence mode for the current session
  // Mode is derived from: time of day + active canvas states + team rhythm.
  // Human never selects a mode — surface adapts silently.
  // Returns: { mode, reason, narrative }
  app.get('/canvas/session/mode', async () => {
    const now = Date.now()
    const hour = new Date(now).getHours()
    const STALE_MS = 10 * 60 * 1000

    const activeStates: string[] = []
    const activeAgents: Array<{ id: string; state: string; payload: unknown }> = []
    for (const [agentId, entry] of canvasStateMap) {
      if (now - entry.updatedAt > STALE_MS) continue
      activeStates.push(entry.state)
      activeAgents.push({ id: agentId, state: entry.state, payload: entry.payload })
    }

    const hasUrgent = activeStates.includes('urgent')
    const hasDecision = activeStates.includes('decision')
    const hasRendering = activeStates.includes('rendering')
    const hasThinking = activeStates.includes('thinking')
    const activeCount = activeAgents.length
    const isLateNight = hour >= 22 || hour < 6

    // Mode inference — priority cascade
    // immersive: urgent or decision — human needs full attention
    // operational: rendering/thinking agents, human is watching work happen
    // conversational: active agents but nothing critical — human may want to talk
    // ambient: nothing active or late night — canvas breathing quietly

    let mode: 'ambient' | 'conversational' | 'operational' | 'immersive'
    let reason: string

    if (hasUrgent || hasDecision) {
      mode = 'immersive'
      reason = hasDecision ? 'decision awaiting human input' : 'urgent state active'
    } else if (hasRendering || (hasThinking && activeCount > 1)) {
      mode = 'operational'
      reason = hasRendering ? 'agent is rendering output' : 'multiple agents processing'
    } else if (activeCount > 0 && !isLateNight) {
      mode = 'conversational'
      reason = 'agents active during working hours'
    } else {
      mode = 'ambient'
      reason = isLateNight ? 'late night — quiet watch' : 'no active agents'
    }

    // One-line narrative — what's happening right now
    const agentPhrases: string[] = []
    for (const a of activeAgents.slice(0, 3)) {
      const payload = a.payload as Record<string, unknown>
      const presState = (payload as any)?.presenceState ?? a.state
      const task = (payload as any)?.activeTask?.title
      const phrase = presState === 'thinking' ? `${a.id} is thinking`
        : presState === 'rendering' ? (task ? `${a.id} is rendering${task ? ` — ${task.slice(0, 30)}` : ''}` : `${a.id} is rendering`)
        : presState === 'working' ? (task ? `${a.id} on ${task.slice(0, 30)}` : `${a.id} is working`)
        : presState === 'urgent' ? `${a.id} needs attention`
        : presState === 'decision' ? `${a.id} awaits your decision`
        : presState === 'handoff' ? `${a.id} is handing off`
        : presState === 'waiting' ? `${a.id} is ready`
        : null
      if (phrase) agentPhrases.push(phrase)
    }

    const narrative = agentPhrases.length > 0
      ? agentPhrases.join(', ')
      : isLateNight ? 'The team is quiet. You can rest.'
      : 'Nothing active right now.'

    return {
      mode,
      reason,
      narrative,
      context: { hour, activeCount, hasUrgent, hasDecision, hasRendering, isLateNight },
      generated_at: new Date(now).toISOString(),
    }
  })

  // GET /canvas/session/snapshot — resumable session state for cross-device continuity
  // Returns the minimal snapshot needed for a second surface to resume from the same point.
  // Spec: /Users/ryan/.openclaw/workspace-pixel/design/interface-os-v0-continuity.html
  app.get('/canvas/session/snapshot', async (request) => {
    const query = request.query as { agentId?: string }

    // Determine the "active" agent: explicitly requested, or the most-recently-updated
    let activeAgentId: string | null = query.agentId ?? null
    let activeEntry: { state: string; sensors: string | null; payload: unknown; updatedAt: number } | null = null

    if (activeAgentId) {
      activeEntry = canvasStateMap.get(activeAgentId) ?? null
    } else {
      // Pick the most recently updated non-floor agent
      for (const [id, entry] of canvasStateMap) {
        if (entry.state !== 'floor') {
          if (!activeEntry || entry.updatedAt > activeEntry.updatedAt) {
            activeAgentId = id
            activeEntry = entry
          }
        }
      }
    }

    const now = Date.now()

    if (!activeAgentId || !activeEntry) {
      return {
        snapshot: null,
        reason: 'no_active_session',
        generated_at: new Date(now).toISOString(),
      }
    }

    const payload = activeEntry.payload as Record<string, unknown> | null ?? {}

    // Last complete content block from canvas history
    // getHistory returns Array<{ event: SlotEvent; timestamp: number }>
    const recentHistory = canvasSlots.getHistory(undefined, 5)
    const lastContent = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1] : null

    // Active decision payload (if in decision/urgent state)
    const isDecision = activeEntry.state === 'decision' || activeEntry.state === 'urgent'

    const snapshot = {
      // Core session identity
      agent_id: activeAgentId,
      agent_label: payload.agentLabel ?? activeAgentId,
      identity_color: getIdentityColor(activeAgentId),

      // Canvas state (transferable)
      canvas_state: activeEntry.state,
      presence_state: payload.presenceState ?? null,
      sensors: activeEntry.sensors ?? null,

      // Active task context
      active_task: payload.activeTask ?? null,
      progress_pills: (payload as any).progressPills ?? null,

      // Last completed content block (not mid-stream)
      content_snapshot: lastContent
        ? { type: lastContent.event.slot, body: lastContent.event.payload, timestamp: lastContent.timestamp }
        : null,

      // Decision payload — must follow the human to the next surface
      active_decision: isDecision ? (payload.decision ?? payload.attention ?? null) : null,

      // Attention / approval context
      attention: payload.attention ?? null,

      // Timing
      session_age_ms: now - activeEntry.updatedAt,
      updated_at: new Date(activeEntry.updatedAt).toISOString(),
      generated_at: new Date(now).toISOString(),

      // Handoff metadata
      handoff: {
        // Sensor consent is per-device — new device must re-consent
        sensor_consent_transferred: false,
        // In-progress streams cannot freeze — target joins at next complete block
        stream_in_progress: activeEntry.state === 'rendering',
        // Summary for handoff banner (e.g. "Agent is rendering a code review")
        summary: (() => {
          const name = payload.agentLabel ?? activeAgentId
          if (activeEntry!.state === 'rendering') return `${name} is rendering${payload.activeTask ? ` — ${(payload.activeTask as any).title}` : ''}`
          if (activeEntry!.state === 'decision' || activeEntry!.state === 'urgent') return `${name} needs a decision`
          if (activeEntry!.state === 'thinking') return `${name} is thinking`
          if (activeEntry!.state === 'waiting') return `${name} is waiting`
          return `${name} is active`
        })(),
      },
    }

    return { snapshot, generated_at: snapshot.generated_at }
  })

  // GET /canvas/history — recent render history
  app.get('/canvas/history', async (request) => {
    const query = request.query as any
    const slot = query?.slot as string | undefined
    const limit = Math.min(Number(query?.limit) || 20, 100)
    return { history: canvasSlots.getHistory(slot, limit) }
  })

  // /canvas/rejections → canvas-routes.ts plugin

  // GET /canvas/stream — SSE stream of canvas render events
  app.get('/canvas/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Track live viewer
    liveViewerCount++
    let viewersDirty = true

    // Derive agents from task board — only show agents in current TEAM-ROLES.yaml
    const allTasks = taskManager.listTasks({})
    const agentStates: Record<string, any> = {}
    const registeredAgentNames = new Set(getAgentRoles().map(r => r.name.toLowerCase()))
    for (const task of allTasks) {
      const assignee = task.assignee
      if (!assignee || assignee === 'unassigned') continue
      const agentId = assignee.toLowerCase()
      if (!registeredAgentNames.has(agentId)) continue // skip agents not in current roster
      const canvasEntry = canvasStateMap.get(agentId)
      const isDone = task.status === 'done' || task.status === 'cancelled'
      const isBlocked = task.status === 'blocked'
      const isWorking = task.status === 'doing'
      if (!agentStates[agentId]) {
        // First task for this agent — create entry with state derived from canvas or task status
        const lastMsg = (canvasEntry as any)?.lastMessage
        agentStates[agentId] = {
          state: canvasEntry?.state || (isDone ? 'ambient' : isBlocked ? 'attention' : isWorking ? 'working' : 'floor'),
          currentTask: task.title,
          updatedAt: task.updatedAt || Date.now(),
          sourceTasks: [],
          lastMessage: lastMsg,
        }
      }
      // Accumulate ALL tasks for this agent (not just the first one)
      agentStates[agentId].sourceTasks.push({ id: task.id, title: task.title, status: task.status })
      // currentTask = most-recently-updated task
      if ((agentStates[agentId].updatedAt || 0) < (task.updatedAt || 0)) {
        agentStates[agentId].currentTask = task.title
        agentStates[agentId].updatedAt = task.updatedAt || Date.now()
      }
    }

    // Send current state as initial snapshot — include all agents from task board
    const activeSlots = canvasSlots.getActive()
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ slots: activeSlots, agents: agentStates, viewers: liveViewerCount })}\n\n`)

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
      liveViewerCount = Math.max(0, liveViewerCount - 1)
      unsubscribe()
      clearInterval(heartbeat)
    })
  })

  // ── Live Viewer Counter ─────────────────────────────────────────────
  // Tracks open SSE connections to /canvas/stream with live=true
  // Exposed via GET /canvas/viewers
  let liveViewerCount = 0

  app.get('/canvas/viewers', async (_request, reply) => {
    reply.header('cache-control', 'no-cache')
    return reply.send({ viewers: liveViewerCount })
  })

  // ── Cloud push: periodically sync canvas state to reflectt-cloud API ─────────
  // Node → cloud canvas state pipeline. Pushes every CLOUD_PUSH_INTERVAL ms.
  let cloudPushTimer: ReturnType<typeof setTimeout> | null = null
  let lastPushedState = ''
  const CLOUD_PUSH_INTERVAL = 5_000

  async function pushCanvasStateToCloud() {
    const cloudUrl = process.env.REFLECTT_CLOUD_URL
    const hostToken = process.env.REFLECTT_HOST_TOKEN
    const hostId = process.env.REFLECTT_HOST_ID
    if (!cloudUrl || !hostToken || !hostId) return
    // Snapshot current canvas state
    const activeSlots = canvasSlots.getActive()
    const state = { slots: activeSlots, pushedAt: Date.now() }
    const stateJson = JSON.stringify(state)
    if (stateJson === lastPushedState) return
    try {
      const res = await fetch(`${cloudUrl}/api/hosts/${hostId}/canvas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hostToken}` },
        body: JSON.stringify({ state }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) lastPushedState = stateJson
    } catch { /* fire-and-forget */ }
  }

  function scheduleCloudPush() {
    if (cloudPushTimer) clearTimeout(cloudPushTimer)
    cloudPushTimer = setTimeout(async () => {
      await pushCanvasStateToCloud()
      scheduleCloudPush()
    }, CLOUD_PUSH_INTERVAL)
  }

  // Start pushing canvas state to cloud
  scheduleCloudPush()

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
      reviewer: getAgentRoles()[0]?.name,
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

  // Reflection dedup (DB-backed): suppress identical reflections from the same author
  // within a 24h window, and point callers at the canonical reflection.
  // This survives restarts (unlike in-memory dedup maps) and prevents reflection spam loops.
  const REFLECTION_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours
  const REFLECTION_DEDUP_MAX_SCAN = 200

  function normalizeDedupText(s: string): string {
    return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  }

  function normalizeDedupEvidence(evidence: unknown): string[] {
    if (!Array.isArray(evidence)) return []
    return evidence
      .map((e) => normalizeDedupText(String(e)))
      .filter(Boolean)
      .sort()
  }

  function reflectionDedupSignature(input: { author: string; pain: string; impact: string; evidence: unknown; went_well: string; suspected_why: string; proposed_fix: string; role_type: string; severity?: string | null }): string {
    const parts = [
      normalizeDedupText(input.author),
      normalizeDedupText(input.pain),
      normalizeDedupText(input.impact),
      ...normalizeDedupEvidence(input.evidence),
      normalizeDedupText(input.went_well),
      normalizeDedupText(input.suspected_why),
      normalizeDedupText(input.proposed_fix),
      normalizeDedupText(input.role_type),
      normalizeDedupText(input.severity ?? ''),
    ]
    return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
  }

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

    // DB-backed dedup: if an identical reflection was submitted by the same author in the last 24h,
    // return the canonical reflection instead of creating a new one.
    const now = Date.now()
    const dedupSignature = reflectionDedupSignature({
      author: result.data.author,
      pain: result.data.pain,
      impact: result.data.impact,
      evidence: result.data.evidence,
      went_well: result.data.went_well,
      suspected_why: result.data.suspected_why,
      proposed_fix: result.data.proposed_fix,
      role_type: result.data.role_type,
      severity: result.data.severity ?? null,
    })

    const since = now - REFLECTION_DEDUP_WINDOW_MS
    const recent = listReflections({ author: result.data.author, since, limit: REFLECTION_DEDUP_MAX_SCAN })
    const canonical = recent.find((r) =>
      reflectionDedupSignature({
        author: r.author,
        pain: r.pain,
        impact: r.impact,
        evidence: r.evidence,
        went_well: r.went_well,
        suspected_why: r.suspected_why,
        proposed_fix: r.proposed_fix,
        role_type: r.role_type,
        severity: r.severity ?? null,
      }) === dedupSignature
    )

    if (canonical) {
      // Best-effort: annotate canonical reflection metadata with duplicate counter.
      try {
        recordReflectionDuplicate(canonical.id, now, dedupSignature)
      } catch {}

      reply.code(200)
      return {
        success: true,
        reflection: canonical,
        insight: null,
        deduped: true,
        canonical_reflection_id: canonical.id,
        dedup_window_hours: 24,
        dedup_signature: dedupSignature,
        hint: `Duplicate suppressed (24h). Canonical reflection: /reflections/${canonical.id}`,
      }
    }

    // Stamp signature into metadata for traceability (best-effort)
    result.data.metadata = { ...(result.data.metadata ?? {}), dedup_signature: dedupSignature }

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
      dedup: {
        window_hours: 24,
        scope: 'Identical reflections from the same author within the window are suppressed and the canonical reflection is returned.',
        signature_fields: ['author', 'pain', 'impact', 'evidence[] (normalized)', 'went_well', 'suspected_why', 'proposed_fix', 'role_type', 'severity'],
      },
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

  // ── Activity Timeline ──────────────────────────────────────────────────

  app.get('/activity', async (request) => {
    const query = request.query as Record<string, string>

    const range = query.range === '7d' ? '7d' as const : '24h' as const
    const type = query.type ? query.type.split(',').map(t => t.trim()).filter(Boolean) : undefined
    const agent = query.agent || undefined
    const limit = query.limit ? Number(query.limit) : undefined
    const after = query.after || undefined

    // debug=1 only allowed from localhost
    const isLocalhost = request.ip === '127.0.0.1' || request.ip === '::1' || request.ip === '::ffff:127.0.0.1'
    const debug = query.debug === '1' && isLocalhost

    try {
      return queryActivity({ range, type, agent, limit, after, debug })
    } catch (err) {
      request.log.error({ err }, 'Activity query failed')
      throw err
    }
  })

  app.get('/activity/sources', async () => {
    return {
      sources: [...ACTIVITY_SOURCES],
      description: 'Allowed values for partial.missing[] and type filter',
    }
  })

  app.get('/insights', async (request) => {
    const query = request.query as Record<string, string>

    // Hygiene: when listing candidate insights, proactively cool down any
    // candidates whose promoted task is already done/cancelled so they don't resurface.
    // Keep listInsights() itself pure (no DB writes on read).
    if (query.status === 'candidate') {
      const offset = query.offset ? Number(query.offset) || 0 : 0
      if (offset === 0) sweepShippedCandidates()
    }

    const result = listInsights({
      status: query.status,
      priority: query.priority,
      workflow_stage: query.workflow_stage,
      failure_family: query.failure_family,
      impacted_unit: query.impacted_unit,
      limit: query.limit ? Math.min(Number(query.limit) || 50, 200) : 50,
      offset: query.offset ? Number(query.offset) || 0 : 0,
    })

    if (isCompact(query)) {
      const slimInsights = (result.insights || []).map((i: any) => ({
        id: i.id,
        title: i.title,
        score: i.score,
        priority: i.priority,
        status: i.status,
        task_id: i.task_id,
        independent_count: i.independent_count,
      }))
      return { ...result, insights: slimInsights }
    }

    return result
  })

  app.get<{ Params: { id: string } }>('/insights/:id', async (request, reply) => {
    const insight = getInsight(request.params.id)
    if (!insight) {
      reply.code(404)
      return { success: false, error: 'Insight not found' }
    }
    return { insight }
  })

  // Admin-only mutation endpoint: allow re-key + status changes for hygiene.
  // Safety rails: allowlisted fields only, requires actor + reason, and writes an audit record.
  app.patch<{ Params: { id: string } }>('/insights/:id', async (request, reply) => {
    const enabled = process.env.REFLECTT_ENABLE_INSIGHT_MUTATION_API === 'true'
      || process.env.REFLECTT_ENABLE_INSIGHT_MUTATION_API === '1'

    if (!enabled) {
      reply.code(403)
      return {
        success: false,
        error: 'Insight mutation API is disabled',
        hint: 'Set REFLECTT_ENABLE_INSIGHT_MUTATION_API=true to enable (and optionally REFLECTT_INSIGHT_MUTATION_TOKEN for auth).'
      }
    }

    const ip = String((request as any).ip || '')
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      reply.code(403)
      return {
        success: false,
        error: 'Forbidden: localhost-only endpoint',
        hint: `Request ip (${ip || 'unknown'}) is not loopback`,
      }
    }

    const requiredToken = process.env.REFLECTT_INSIGHT_MUTATION_TOKEN
    if (requiredToken) {
      const raw = (request.headers as any)['x-reflectt-admin-token']
      let provided = Array.isArray(raw) ? raw[0] : raw
      const auth = (request.headers as any).authorization
      if ((!provided || typeof provided !== 'string') && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        provided = auth.slice('Bearer '.length)
      }

      if (typeof provided !== 'string' || provided !== requiredToken) {
        reply.code(403)
        return {
          success: false,
          error: 'Forbidden: missing/invalid admin token',
          hint: 'Provide x-reflectt-admin-token header (or Authorization: Bearer ...) matching REFLECTT_INSIGHT_MUTATION_TOKEN.'
        }
      }
    }

    const body = (request.body ?? {}) as Record<string, unknown>

    // Reject unexpected top-level keys (immutable fields protected)
    const allowedKeys = new Set(['actor', 'reason', 'status', 'cluster_key', 'metadata'])
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        reply.code(400)
        return { success: false, error: `Immutable/unknown field: ${key}`, hint: 'Allowed: actor, reason, status, cluster_key, metadata' }
      }
    }

    // Validate metadata allowlist
    if (body.metadata !== undefined) {
      if (!body.metadata || typeof body.metadata !== 'object') {
        reply.code(400)
        return { success: false, error: 'metadata must be an object' }
      }
      const allowedMeta = new Set(['notes', 'cluster_key_override'])
      for (const k of Object.keys(body.metadata as Record<string, unknown>)) {
        if (!allowedMeta.has(k)) {
          reply.code(400)
          return { success: false, error: `Immutable/unknown metadata field: ${k}`, hint: 'Allowed metadata keys: notes, cluster_key_override' }
        }
      }
    }

    const actor = typeof body.actor === 'string' ? body.actor : ''
    const reason = typeof body.reason === 'string' ? body.reason : ''
    const status = typeof body.status === 'string' ? body.status : undefined
    const cluster_key = typeof body.cluster_key === 'string' ? body.cluster_key : undefined

    const metadata = body.metadata as Record<string, unknown> | undefined
    const result = patchInsightById(request.params.id, {
      actor,
      reason,
      ...(status ? { status: status as any } : {}),
      ...(cluster_key ? { cluster_key } : {}),
      ...(metadata ? {
        metadata: {
          ...(typeof metadata.notes === 'string' ? { notes: metadata.notes } : {}),
          ...(typeof metadata.cluster_key_override === 'string' ? { cluster_key_override: metadata.cluster_key_override } : {}),
        },
      } : {}),
    })

    if (!result.success) {
      const notFound = result.error === 'Insight not found'
      reply.code(notFound ? 404 : 400)
      return { success: false, error: result.error }
    }

    return { success: true, insight: result.insight }
  })

  // Narrow localhost-only admin endpoints for routine hygiene: cooldown/close.
  // These avoid enabling the broader PATCH /insights/:id mutation API.
  app.post<{ Params: { id: string } }>('/insights/:id/cooldown', async (request, reply) => {
    const ip = String((request as any).ip || '')
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      reply.code(403)
      return {
        success: false,
        error: 'Forbidden: localhost-only endpoint',
        hint: `Request ip (${ip || 'unknown'}) is not loopback`,
      }
    }

    const requiredToken = process.env.REFLECTT_INSIGHT_MUTATION_TOKEN
    if (requiredToken) {
      const raw = (request.headers as any)['x-reflectt-admin-token']
      let provided = Array.isArray(raw) ? raw[0] : raw
      const auth = (request.headers as any).authorization
      if ((!provided || typeof provided !== 'string') && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        provided = auth.slice('Bearer '.length)
      }

      if (typeof provided !== 'string' || provided !== requiredToken) {
        reply.code(403)
        return {
          success: false,
          error: 'Forbidden: missing/invalid admin token',
          hint: 'Provide x-reflectt-admin-token header (or Authorization: Bearer ...) matching REFLECTT_INSIGHT_MUTATION_TOKEN.'
        }
      }
    }

    const body = (request.body ?? {}) as Record<string, unknown>
    const actor = typeof body.actor === 'string' ? body.actor : ''
    const reason = typeof body.reason === 'string' ? body.reason : ''
    const notes = typeof body.notes === 'string' ? body.notes : undefined
    const cooldown_reason = typeof body.cooldown_reason === 'string' ? body.cooldown_reason : undefined

    const cooldown_until = typeof body.cooldown_until === 'number' && Number.isFinite(body.cooldown_until)
      ? body.cooldown_until
      : (typeof body.cooldown_ms === 'number' && Number.isFinite(body.cooldown_ms)
        ? Date.now() + Math.max(0, body.cooldown_ms)
        : undefined)

    const result = cooldownInsightById(request.params.id, {
      actor,
      reason,
      ...(notes ? { notes } : {}),
      ...(cooldown_until ? { cooldown_until } : {}),
      ...(cooldown_reason ? { cooldown_reason } : {}),
    })

    if (!result.success) {
      const notFound = result.error === 'Insight not found'
      reply.code(notFound ? 404 : 400)
      return { success: false, error: result.error }
    }

    return { success: true, insight: result.insight }
  })

  app.post<{ Params: { id: string } }>('/insights/:id/close', async (request, reply) => {
    const ip = String((request as any).ip || '')
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      reply.code(403)
      return {
        success: false,
        error: 'Forbidden: localhost-only endpoint',
        hint: `Request ip (${ip || 'unknown'}) is not loopback`,
      }
    }

    const requiredToken = process.env.REFLECTT_INSIGHT_MUTATION_TOKEN
    if (requiredToken) {
      const raw = (request.headers as any)['x-reflectt-admin-token']
      let provided = Array.isArray(raw) ? raw[0] : raw
      const auth = (request.headers as any).authorization
      if ((!provided || typeof provided !== 'string') && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        provided = auth.slice('Bearer '.length)
      }

      if (typeof provided !== 'string' || provided !== requiredToken) {
        reply.code(403)
        return {
          success: false,
          error: 'Forbidden: missing/invalid admin token',
          hint: 'Provide x-reflectt-admin-token header (or Authorization: Bearer ...) matching REFLECTT_INSIGHT_MUTATION_TOKEN.'
        }
      }
    }

    const body = (request.body ?? {}) as Record<string, unknown>
    const actor = typeof body.actor === 'string' ? body.actor : ''
    const reason = typeof body.reason === 'string' ? body.reason : ''
    const notes = typeof body.notes === 'string' ? body.notes : undefined

    const result = closeInsightById(request.params.id, {
      actor,
      reason,
      ...(notes ? { notes } : {}),
    })

    if (!result.success) {
      const notFound = result.error === 'Insight not found'
      reply.code(notFound ? 404 : 400)
      return { success: false, error: result.error }
    }

    return { success: true, insight: result.insight }
  })

  app.get('/insights/stats', async () => {
    return insightStats()
  })

  // POST /insights/stale-candidates/reconcile — run stale candidate reconcile sweep
  // Closes candidate insights where post-incident recovery evidence exists and guardrails pass.
  app.post<{ Body: { dry_run?: boolean; insight_ids?: string[]; actor?: string } }>(
    '/insights/stale-candidates/reconcile',
    async (request, reply) => {
      const body = request.body ?? {}
      const dryRun = body.dry_run !== false // default: true (safe)
      const actor = typeof body.actor === 'string' ? body.actor : 'api-reconcile'
      const insightIds = Array.isArray(body.insight_ids) ? body.insight_ids : undefined

      try {
        const result = runStaleCandidateReconcileSweep({ dryRun, actor, insightIds })
        return { success: true, ...result }
      } catch (err: unknown) {
        reply.status(500)
        return { success: false, error: String(err) }
      }
    },
  )

  // GET /insights/stale-candidates/preview — dry-run reconcile (GET for convenience)
  app.get('/insights/stale-candidates/preview', async () => {
    const result = runStaleCandidateReconcileSweep({ dryRun: true, actor: 'preview' })
    return { success: true, ...result }
  })

  // ── Loop summary: top signals from the reflection loop ──
  app.get('/loop/summary', async (request) => {
    const query = request.query as Record<string, string>
    const limit = query.limit ? Math.min(Math.max(1, Number(query.limit)), 100) : undefined
    const min_score = query.min_score ? Number(query.min_score) : undefined
    const exclude_addressed = query.exclude_addressed === '1' || query.exclude_addressed === 'true'

    const result = await getLoopSummary({ limit, min_score, exclude_addressed })

    if (isCompact(query)) {
      // Strip heavy fields: evidence_refs, linked_task details
      const slimEntries = result.entries.map(e => ({
        insight_id: e.insight_id,
        title: e.title,
        score: e.score,
        priority: e.priority,
        status: e.status,
        independent_count: e.independent_count,
        addressed: e.addressed,
        linked_task: e.linked_task ? { id: e.linked_task.id, status: e.linked_task.status } : null,
      }))
      return { success: true, entries: slimEntries, total: result.total, filters: result.filters }
    }

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

  // ── Insight auto-tagger ────────────────────────────────────────────────────

  // GET /insights/auto-tag/rules — return current keyword rule set
  app.get('/insights/auto-tag/rules', async () => {
    return { rules: getAutoTagRules(), default_count: DEFAULT_AUTO_TAG_RULES.length }
  })

  // PUT /insights/auto-tag/rules — replace rule set at runtime
  app.put('/insights/auto-tag/rules', async (request, reply) => {
    const body = request.body as { rules?: AutoTagRule[] }
    if (!Array.isArray(body?.rules)) {
      reply.code(400)
      return { success: false, error: 'Body must be { rules: AutoTagRule[] }' }
    }
    setAutoTagRules(body.rules)
    return { success: true, count: body.rules.length }
  })

  // DELETE /insights/auto-tag/rules — reset to defaults
  app.delete('/insights/auto-tag/rules', async () => {
    resetAutoTagRules()
    return { success: true, message: 'Rules reset to defaults', count: DEFAULT_AUTO_TAG_RULES.length }
  })

  // POST /insights/auto-tag/backfill — reclassify all uncategorized insights
  // Query: dry_run=true to preview without writing
  app.post('/insights/auto-tag/backfill', async (request) => {
    const q = request.query as Record<string, string>
    const dryRun = q.dry_run === 'true' || q.dry_run === '1'
    const summary = backfillUncategorizedInsights(dryRun)
    return { success: true, dry_run: dryRun, ...summary }
  })

  // POST /insights/:id/auto-tag — re-run auto-tag on a single insight
  app.post<{ Params: { id: string } }>('/insights/:id/auto-tag', async (request, reply) => {
    const { id } = request.params
    const insight = getInsight(id)
    if (!insight) {
      reply.code(404)
      return { success: false, error: 'Insight not found' }
    }
    const newFamily = inferFamilyFromTitle(insight.title)
    if (!newFamily || newFamily === insight.failure_family) {
      return { success: true, changed: false, family: insight.failure_family }
    }
    autoTagInsightIfUncategorized(id, insight.title, insight.cluster_key)
    return { success: true, changed: true, old_family: insight.failure_family, new_family: newFamily }
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
    const agent = typeof query.agent === 'string' ? query.agent.trim().toLowerCase() : undefined
    const includeTest = query.include_test === '1' || query.include_test === 'true'

    // Pause check: refuse pulls when agent or team is paused
    if (agent) {
      const pauseStatus = checkPauseStatus(agent)
      if (pauseStatus.paused) {
        return {
          task: null,
          paused: true,
          message: pauseStatus.message,
          remainingMs: pauseStatus.remainingMs,
          resumesAt: pauseStatus.entry?.pausedUntil ?? null,
        }
      }
    }

    // Intensity rate-limit: enforce maxPullsPerHour
    if (agent) {
      const { recordPull, getIntensity } = await import('./intensity.js')
      const pull = recordPull(agent)
      if (!pull.allowed) {
        const { preset, limits } = getIntensity()
        const retryMin = Math.ceil(pull.resetsInMs / 60_000)
        return {
          task: null,
          throttled: true,
          intensity: preset,
          message: `Pull rate limit reached (${limits.maxPullsPerHour}/hr at "${preset}" intensity). Try again in ~${retryMin}m.`,
          retryAfterMs: pull.resetsInMs,
        }
      }
    }

    // WIP enforcement: block pull if agent is at their lane WIP limit
    if (agent) {
      const { checkWipLimit } = await import('./lane-config.js')
      const doingTasks = taskManager.listTasks({ status: 'doing', assigneeIn: getAgentAliases(agent) })
      const wip = checkWipLimit(agent, doingTasks.length)
      if (wip?.blocked) {
        return {
          task: null,
          message: wip.message,
          wipLimit: wip.wipLimit,
          doing: wip.doing,
        }
      }
    }

    const task = taskManager.getNextTask(agent, { includeTest })
    if (!task) {
      const aliases = agent ? getAgentAliases(agent) : []

      // "Ready" counts: match /tasks/next selection semantics (blocked excluded)
      const readyTodo = taskManager.listTasks({ status: 'todo', includeBlocked: false, includeTest })
      const ready_todo_unassigned = readyTodo.filter(t => {
        const a = String(t.assignee || '').trim().toLowerCase()
        return a.length === 0 || a === 'unassigned'
      }).length
      const ready_todo_assigned = agent
        ? taskManager.listTasks({ status: 'todo', assigneeIn: aliases, includeBlocked: false, includeTest }).length
        : 0
      const ready_doing_assigned = agent
        ? taskManager.listTasks({ status: 'doing', assigneeIn: aliases, includeBlocked: false, includeTest }).length
        : 0
      const ready_validating_assigned = agent
        ? taskManager.listTasks({ status: 'validating', assigneeIn: aliases, includeBlocked: false, includeTest }).length
        : 0

      const { formatTasksNextEmptyResponse } = await import('./tasks-next-diagnostics.js')
      const payload = formatTasksNextEmptyResponse({
        agent,
        ready_doing_assigned,
        ready_todo_unassigned,
        ready_todo_assigned,
        ready_validating_assigned,
      })

      return { task: null, ...payload }
    }

    // Rule C: auto-claim (todo→doing) when ?claim=1
    const shouldClaim = query.claim === '1' || query.claim === 'true'
    if (shouldClaim && agent && task.status === 'todo') {
      const { claimTask } = await import('./todoHoardingGuard.js')
      const claimed = await claimTask(task.id, agent)
      if (claimed) {
        const enriched = enrichTaskWithComments(claimed)
        return { task: isCompact(query) ? compactTask(enriched) : enriched, claimed: true }
      }
    }

    const enriched = enrichTaskWithComments(task)
    return { task: isCompact(query) ? compactTask(enriched) : enriched }
  })

  // Get active (doing) task for an agent
  app.get('/tasks/active', async (request) => {
    const query = request.query as Record<string, string>
    const agent = typeof query.agent === 'string' ? query.agent.trim().toLowerCase() : undefined
    if (!agent) {
      return { task: null, message: 'agent query param required' }
    }
    const doingTasks = taskManager.listTasks({ status: 'doing', assigneeIn: getAgentAliases(agent) })
    const task = doingTasks[0] || null
    if (!task) {
      return { task: null, message: 'No active tasks' }
    }
    const enriched = enrichTaskWithComments(task)
    return { task: isCompact(query) ? compactTask(enriched) : enriched }
  })

  // ── Reviews: pending reviews for a reviewer ─────────────────────────
  app.get<{ Querystring: { reviewer?: string; compact?: string } }>('/reviews/pending', async (request) => {
    const query = request.query
    const reviewer = (query.reviewer || '').trim().toLowerCase()
    if (!reviewer) {
      return { success: false, error: 'reviewer query param required', hint: 'GET /reviews/pending?reviewer=ryan' }
    }

    const now = Date.now()
    const validating = taskManager.listTasks({ status: 'validating', includeTest: true })
    const pending = validating.filter(t => {
      if ((t.reviewer || '').trim().toLowerCase() !== reviewer) return false
      const meta = (t.metadata || {}) as Record<string, unknown>
      // Skip already-approved tasks
      if (meta.review_state === 'approved' || meta.reviewer_approved === true) return false
      return true
    })

    const compact = isCompact(query)
    const items = pending.map(t => {
      const meta = (t.metadata || {}) as Record<string, unknown>
      const enteredAt = (meta.entered_validating_at as number) || t.updatedAt
      const ageMinutes = Math.round((now - enteredAt) / 60000)
      const prUrl = meta.review_handoff && typeof (meta.review_handoff as Record<string, unknown>).pr_url === 'string'
        ? (meta.review_handoff as Record<string, unknown>).pr_url as string
        : (meta.qa_bundle && typeof (meta.qa_bundle as Record<string, unknown>).artifact_links === 'object'
          ? ((meta.qa_bundle as Record<string, unknown>).artifact_links as string[])?.[0]
          : undefined)

      const base: Record<string, unknown> = {
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        priority: t.priority,
        age_minutes: ageMinutes,
        review_state: meta.review_state || 'queued',
      }
      if (prUrl) base.pr_url = prUrl
      if (meta.artifact_path) base.artifact_path = meta.artifact_path
      if (!compact) {
        base.done_criteria = t.done_criteria
        base.description = t.description
      }
      return base
    })

    // Sort by age descending (oldest first)
    items.sort((a, b) => (b.age_minutes as number) - (a.age_minutes as number))

    return {
      reviewer,
      pending_count: items.length,
      reviews: items,
    }
  })

  // ── Heartbeat: single compact payload for agent heartbeat polls ─────
  app.get<{ Params: { agent: string } }>('/heartbeat/:agent', async (request) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    if (!agent) return { error: 'agent is required' }

    const doingTasks = taskManager.listTasks({ status: 'doing', assigneeIn: getAgentAliases(agent) })
    const activeTask = doingTasks[0] || null
    // Auto-claim: if agent has no active work and has a suggested next task, claim it now.
    // This ensures idle agents automatically pick up queued work without requiring
    // the runtime to make a separate claim call after reading the heartbeat.
    let nextTask = activeTask ? null : (taskManager.getNextTask(agent) || null)
    if (!activeTask && nextTask && nextTask.status === 'todo') {
      // Auto-claim wrapped in try/catch: if claim fails due to lifecycle gates
      // (missing done_criteria/reviewer), heartbeat should still return normally
      // rather than throwing — agent gets the suggestion without being crashed.
      try {
        const { claimTask } = await import('./todoHoardingGuard.js')
        const claimed = await claimTask(nextTask.id, agent)
        nextTask = claimed || null
      } catch {
        // Claim blocked by lifecycle gate — return task as suggestion only
      }
    }

    const allMessages = chatManager.getMessages({ limit: 200, since: Date.now() - (4 * 60 * 60 * 1000) })
    const inbox = inboxManager.getInbox(agent, allMessages, { limit: 10 })
    const slimInbox = inbox.map(m => ({
      from: m.from,
      content: (m.content || '').slice(0, 200),
      ts: m.timestamp,
      ch: m.channel,
      ...(m.priority ? { p: m.priority } : {}),
    }))

    const todoTasks = taskManager.listTasks({ status: 'todo', assigneeIn: getAgentAliases(agent) })
    const validatingTasks = taskManager.listTasks({ status: 'validating', assigneeIn: getAgentAliases(agent) })

    const slim = (t: Task | null | undefined) => t ? {
      id: t.id, title: t.title, status: t.status, priority: t.priority,
      ...(t.dueAt ? { dueAt: t.dueAt } : {}),
      ...(t.scheduledFor ? { scheduledFor: t.scheduledFor } : {}),
    } : null
    presenceManager.recordActivity(agent, 'heartbeat')

    // Keep canvasStateMap fresh — agents visible on canvas as long as they heartbeat.
    // Derive canvas state from task activity (same logic as emitOrbState).
    {
      const derivedState = activeTask
        ? (activeTask.status === 'blocked' ? 'working' : 'working')
        : (nextTask ? 'idle' : 'idle')
      const prevEntry = canvasStateMap.get(agent)
      canvasStateMap.set(agent, {
        state: derivedState as any,
        sensors: null,
        payload: {
          ...(prevEntry?.payload as Record<string, unknown> ?? {}),
          presenceState: activeTask ? 'working' : 'idle',
          sourceTasks: activeTask ? [{ id: activeTask.id, title: activeTask.title, status: activeTask.status }] : [],
          _auto: true,
        },
        updatedAt: Date.now(),
      })
    }

    // Check pause status
    const pauseStatus = checkPauseStatus(agent)

    // Intensity info
    const { getIntensity, checkPullBudget } = await import('./intensity.js')
    const intensity = getIntensity()
    const pullBudget = checkPullBudget(agent)

    // Drop stats for this agent
    const allDrops = chatManager.getDropStats()
    const agentDrops = allDrops[agent]

    const focusSummary = getFocusSummary()

    // Boot context: recent memories + active run (survives restart)
    let bootMemories: Array<{ key: string; content: string; namespace: string; updatedAt: number }> = []
    let activeRun: { id: string; objective: string; status: string; startedAt: number } | null = null
    try {
      const { listMemories } = await import('./agent-memories.js')
      const memories = listMemories({ agentId: agent, limit: 5 })
      bootMemories = memories.map(m => ({
        key: m.key, content: m.content.slice(0, 200),
        namespace: m.namespace, updatedAt: m.updatedAt,
      }))
    } catch { /* agent-memories not available */ }
    try {
      const { getActiveAgentRun } = await import('./agent-runs.js')
      const run = getActiveAgentRun(agent, 'default')
      if (run) {
        activeRun = { id: run.id, objective: run.objective, status: run.status, startedAt: run.startedAt }
      }
    } catch { /* agent-runs not available */ }

    // Capability context — written by syncCapabilityContext() in cloud.ts.
    // Included in heartbeat so Claude Code agents receive it on every check-in.
    const capabilityContext = readCapabilityContext()

    return {
      agent, ts: Date.now(),
      active: slim(activeTask), next: pauseStatus.paused ? null : slim(nextTask),
      inbox: slimInbox, inboxCount: inbox.length,
      queue: { todo: todoTasks.length, doing: doingTasks.length, validating: validatingTasks.length },
      intensity: { preset: intensity.preset, pullsRemaining: pullBudget.remaining, wipLimit: intensity.limits.wipLimit },
      ...(focusSummary ? { focus: focusSummary } : {}),
      ...(agentDrops ? { drops: { total: agentDrops.total, rolling_1h: agentDrops.rolling_1h } } : {}),
      ...(pauseStatus.paused ? { paused: true, pauseMessage: pauseStatus.message, resumesAt: pauseStatus.entry?.pausedUntil ?? null } : {}),
      ...(bootMemories.length > 0 ? { memories: bootMemories } : {}),
      ...(activeRun ? { run: activeRun } : {}),
      ...(capabilityContext ? { capabilityContext } : {}),
      ...(() => {
        const p = presenceManager.getAllPresence().find(p => p.agent === agent)
        return p?.waiting ? { waiting: p.waiting } : {}
      })(),
      action: pauseStatus.paused ? `PAUSED: ${pauseStatus.message}`
        : activeTask ? `Continue ${activeTask.id}`
        : nextTask ? `Claim ${nextTask.id}`
        : inbox.length > 0 ? `Check inbox (${inbox.length} messages)`
        : 'HEARTBEAT_OK',
    }
  })

  // ── Agent Waiting State ──────────────────────────────────────────────
  // Agents signal they're blocked on human input. Shows in heartbeat + presence.

  app.post<{ Params: { agent: string } }>('/agents/:agent/waiting', async (request, reply) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    const body = request.body as { reason?: string; waitingFor?: string; taskId?: string; expiresAt?: number } ?? {}
    if (!body.reason) return reply.code(400).send({ error: 'reason is required' })
    presenceManager.setWaiting(agent, { reason: body.reason, waitingFor: body.waitingFor, taskId: body.taskId, expiresAt: body.expiresAt })
    return { success: true, agent, status: 'waiting', waiting: { reason: body.reason, waitingFor: body.waitingFor, taskId: body.taskId, expiresAt: body.expiresAt } }
  })

  app.delete<{ Params: { agent: string } }>('/agents/:agent/waiting', async (request) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    presenceManager.clearWaiting(agent)
    return { success: true, agent, status: 'idle' }
  })

  // ── Agent thought — brief expression that flows to canvas via presence → pulse ──
  // POST /agents/:name/thought { text: "..." }
  // Thought is attached to agent's presence entry and synced to cloud heartbeat.
  // Canvas renders it as ephemeral expression (8s TTL managed client-side).
  app.post<{ Params: { name: string } }>('/agents/:name/thought', async (request, reply) => {
    const name = String(request.params.name || '').trim().toLowerCase()
    if (!name) return reply.code(400).send({ error: 'agent name is required' })
    const body = request.body as { text?: string } ?? {}
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 200) : ''
    if (!text) return reply.code(400).send({ error: 'text is required (max 200 chars)' })

    // Attach thought to presence
    const presence = presenceManager.getPresence(name)
    if (presence) {
      presence.thought = text
      presence.lastUpdate = Date.now()
    }

    // Also emit as canvas_expression so it appears immediately on pulse
    eventBus.emit({
      id: `thought-${Date.now()}-${name}`,
      type: 'canvas_expression' as const,
      data: { agent: name, text, kind: 'thought' },
      timestamp: Date.now(),
    })

    return { success: true, agent: name, thought: text }
  })

  // ── Bootstrap: dynamic agent config generation ──────────────────────
  app.get<{ Params: { agent: string } }>('/bootstrap/heartbeat/:agent', async (request) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    if (!agent) return { error: 'agent is required' }

    const pkg = await import('../package.json', { assert: { type: 'json' } }).catch(() => ({ default: { version: 'unknown' } }))
    const version = pkg.default.version

    // Derive base URL from request so generated docs work on any host (localhost, Fly.io, etc.)
    const proto = request.headers['x-forwarded-proto'] || 'http'
    const host = request.headers['x-forwarded-host'] || request.headers.host || `127.0.0.1:${serverConfig.port}`
    const baseUrl = `${proto}://${host}`

    const heartbeatMd = `# HEARTBEAT.md — ${agent}
# Auto-generated by reflectt-node v${version}
# Re-fetch: GET /bootstrap/heartbeat/${agent}

## Priority Order
1. Check status (single call — replaces 3 separate checks):
   - \`curl -s "${baseUrl}/heartbeat/${agent}"\`
   - Response includes: active task, next task, inbox, queue counts, suggested action
   - If action is \`HEARTBEAT_OK\`, reply with HEARTBEAT_OK
2. If active task exists, **do real work** (ship code/docs/artifacts).
3. If inbox has messages, respond to direct mentions.
4. **Never report task status from memory alone** — always query the API first.

## No-Task Idle Loop (recommended)
If your heartbeat shows **no active task** and **no next task**:
1. Post a brief status in team chat **once per hour max**: "[no task] checking board + signals".
2. Check the board + top signals:
   - \`curl -s "${baseUrl}/tasks?status=todo&limit=5&compact=true"\`
   - \`curl -s "${baseUrl}/loop/summary?compact=true"\`
3. If there’s a clear next task for your lane, claim it and start work. If a signal/insight is actionable, create/claim a task and start work.
4. If the board + signals are empty, write up what you checked and propose a next step in a problems/ideas channel if your team has one (otherwise use \`#general\`).
5. If you’re still idle after checking, propose the next highest-leverage work item with evidence — don’t wait for someone else to assign it.

## Comms Protocol (required)
**Rule: task updates go to the task, not to chat.**
- \`POST /tasks/:id/comments\` for all progress, blockers, and decisions on a task.
- Chat channels are for coordination, not status reports. Do not post "working on task-xyz" or "done with task-xyz" to chat.

1. **Task progress, blockers, decisions** → \`POST /tasks/:id/comments\` (always first)
2. **Shipped artifacts** → post in shipping channel after the task comment, include \`@reviewer\` + task ID + PR/artifact link
3. **Review requests** → post in reviews channel after the task comment, include \`@reviewer\` + task ID + exact ask
4. **Blockers needing human action** → post in blockers channel after the task comment, include **who you need** + task ID + concrete unblock needed
5. \`#general\` is for decisions and cross-team coordination only — not task status updates

## API Quick Reference
- Heartbeat check: \`GET /heartbeat/${agent}\`
- Task details: \`GET /tasks/:id?compact=true\`
- Send message: \`POST /chat/messages\`
- Chat context: \`GET /chat/context/${agent}\`
- My dashboard: \`GET /me/${agent}?compact=true\`
- Discover endpoints: \`GET /capabilities\`

## Ready-Queue Floor (enforced)
- Maintain **>=2 unblocked todo tasks** during active hours.
- Before moving any task to validating/done, check: will queue drop below 2?
- If yes: flag in task comment + alert in #general.
- Board health worker monitors this automatically.

## Rules
- Do not load full chat history.
- Do not post plan-only updates.
- If nothing changed and no direct action is required, reply \`HEARTBEAT_OK\`.
- **Decision authority:** Team owns product/arch/process decisions. Escalate credentials, legal, and vision decisions to the admin/owner. See \`decision_authority\` block in \`defaults/TEAM-ROLES.yaml\` for the full list.
`

    // Stable hash for change detection (agents can cache and compare)
    const { createHash } = await import('node:crypto')
    const contentHash = createHash('sha256').update(heartbeatMd).digest('hex').slice(0, 16)

    return {
      agent,
      version,
      generated_at: Date.now(),
      content: heartbeatMd,
      content_hash: contentHash,
    }
  })

  // ── Bootstrap Team: recommend composition + initial tasks + heartbeat configs ──
  app.post<{ Body: BootstrapTeamRequest }>('/bootstrap/team', async (request) => {
    const body = (request.body || {}) as BootstrapTeamRequest
    return bootstrapTeam({
      useCase: typeof body.useCase === 'string' ? body.useCase.trim() : undefined,
      maxAgents: typeof body.maxAgents === 'number' ? body.maxAgents : undefined,
    })
  })

  // ── Capabilities: lightweight, queryable alternative to /docs ────────
  // Full docs: GET /docs (68K chars / ~17K tokens)
  // This endpoint: ~2K chars filtered, ~4K unfiltered — 90%+ reduction
  // Query: ?category=tasks|chat|insights|reflections|heartbeat|inbox|system
  app.get('/capabilities', async (request) => {
    const query = request.query as Record<string, string>
    const categoryFilter = (query.category || '').toLowerCase().trim()

    const allCategories: Record<string, { description: string; endpoints: Array<{ method: string; path: string; compact?: boolean; hint?: string }> }> = {
      heartbeat: {
        description: 'Agent heartbeat and self-configuration',
        endpoints: [
          { method: 'GET', path: '/heartbeat/:agent', hint: 'Single compact payload (~200 tokens). Replaces /tasks/active + /tasks/next + /inbox.' },
          { method: 'GET', path: '/bootstrap/heartbeat/:agent', hint: 'Generate optimal HEARTBEAT.md. Re-fetch when version changes.' },
          { method: 'POST', path: '/bootstrap/team', hint: 'Returns TEAM-ROLES.yaml schema, constraints, examples, and save endpoint. The calling agent composes the team. Body: { useCase?, maxAgents? }' },
        ],
      },
      tasks: {
        description: 'Task management (CRUD, assignment, lifecycle)',
        endpoints: [
          { method: 'GET', path: '/tasks', compact: true, hint: 'List. Query: status, assignee, priority, compact' },
          { method: 'GET', path: '/tasks/:id', compact: true },
          { method: 'GET', path: '/tasks/active', compact: true, hint: 'Doing task for agent. Query: agent' },
          { method: 'GET', path: '/tasks/next', compact: true, hint: 'Pull next available. Query: agent' },
          { method: 'POST', path: '/tasks', hint: 'Create. Requires: title, assignee, reviewer, done_criteria' },
          { method: 'PATCH', path: '/tasks/:id', hint: 'Update status/metadata' },
          { method: 'POST', path: '/tasks/:id/comments' },
          { method: 'POST', path: '/tasks/:id/review', hint: 'Submit review decision (approve/reject). Approve auto-transitions validating→done.' },
          { method: 'GET', path: '/reviews/pending', compact: true, hint: 'Pending reviews for a reviewer. Query: reviewer (required)' },
        ],
      },
      chat: {
        description: 'Team chat messaging',
        endpoints: [
          { method: 'GET', path: '/chat/messages', compact: true, hint: 'History. Query: channel, limit, compact' },
          { method: 'GET', path: '/chat/context/:agent', hint: 'Compact deduplicated chat for agent context injection. Always slim.' },
          { method: 'POST', path: '/chat/messages', hint: 'Send. Body: from, content, channel' },
        ],
      },
      inbox: {
        description: 'Per-agent inbox (mentions and notifications)',
        endpoints: [
          { method: 'GET', path: '/inbox/:agent', compact: true, hint: 'Query: limit, since, compact' },
          { method: 'POST', path: '/inbox/:agent/ack', hint: 'Acknowledge. Body: { upTo: epochMs }' },
        ],
      },
      insights: {
        description: 'Reflection loop insights and signals',
        endpoints: [
          { method: 'GET', path: '/insights', compact: true, hint: 'List. Query: status, priority, compact' },
          { method: 'GET', path: '/loop/summary', compact: true, hint: 'Top signals ranked by score' },
        ],
      },
      reflections: {
        description: 'Team reflections',
        endpoints: [
          { method: 'POST', path: '/reflections', hint: 'Submit. Required: pain, impact, evidence[], went_well, suspected_why, proposed_fix, confidence, role_type, author' },
          { method: 'GET', path: '/reflections', hint: 'List. Query: author, limit' },
          { method: 'GET', path: '/reflections/schema', hint: 'Required/optional fields, role types, severity levels, dedup rules' },
        ],
      },
      activity: {
        description: 'Unified activity timeline',
        endpoints: [
          { method: 'GET', path: '/activity', hint: 'Timeline feed. Query: range (24h|7d), type, agent, limit, after (cursor)' },
        ],
      },
      system: {
        description: 'System health and discovery',
        endpoints: [
          { method: 'GET', path: '/health', hint: 'System health + version + stats' },
          { method: 'GET', path: '/pulse', compact: true, hint: 'Team pulse snapshot: deploy + board + per-agent doing + reviews. Query: compact' },
          { method: 'GET', path: '/capabilities', hint: 'This endpoint. Query: category to filter' },
          { method: 'GET', path: '/me/:agent', compact: true, hint: 'Full dashboard. Use /heartbeat/:agent for polls.' },
          { method: 'GET', path: '/docs', hint: 'Full API reference (68K chars). Use /capabilities instead when possible.' },
        ],
      },
      hosts: {
        description: 'Multi-host registry and cloud connection',
        endpoints: [
          { method: 'GET', path: '/hosts', compact: true, hint: 'List registered hosts. Query: compact' },
          { method: 'GET', path: '/cloud/status', hint: 'Cloud connection state + health summary' },
          { method: 'GET', path: '/cloud/events', hint: 'Connection lifecycle event log. Query: limit' },
        ],
      },
      manage: {
        description: 'Remote node management (auth-gated)',
        endpoints: [
          { method: 'GET', path: '/manage/status', hint: 'Unified status: version + health + uptime. Auth: x-manage-token or Bearer.' },
          { method: 'GET', path: '/manage/config', hint: 'Config introspection (secrets redacted). Auth required.' },
          { method: 'GET', path: '/manage/logs', hint: 'Bounded log tail. Query: level, since, limit, format=text. Auth required.' },
          { method: 'POST', path: '/manage/restart', hint: 'Graceful restart (Docker/systemd/CLI). Auth required.' },
          { method: 'POST', path: '/manage/reset-bootstrap', hint: 'Destructive reproof reset for managed hosts. Clears bootstrap state, deletes stale bootstrap tasks if present, and optionally restarts. Auth: manage token or managed host credential. Body must include { confirm: "RESET_BOOTSTRAP" }.' },
          { method: 'GET', path: '/manage/disk', hint: 'Data directory sizes. Auth required.' },
        ],
      },
    }

    // Filter by category if requested
    const categories = categoryFilter && allCategories[categoryFilter]
      ? { [categoryFilter]: allCategories[categoryFilter] }
      : allCategories

    return {
      version: BUILD_VERSION,
      api_version: '1',
      compact_supported: true,
      ...(categoryFilter ? { filtered_by: categoryFilter } : {}),
      categories,
      tips: [
        'Add ?compact=true to GET requests to reduce tokens by 50-75%',
        'Use /heartbeat/:agent for polls instead of 3 separate calls',
        'Use /capabilities?category=tasks to load only what you need',
        'Use /bootstrap/heartbeat/:agent to generate optimal HEARTBEAT.md',
        'Full docs: GET /docs (use /capabilities instead to save ~15K tokens)',
      ],
    }
  })

  // ── Version: current + latest available from GitHub ────────────────
  const versionCache: { latest: string | null; checkedAt: number; error?: string } = {
    latest: null,
    checkedAt: 0,
  }
  // GET /capabilities/readiness — per-capability status with dependency checks
  app.get('/capabilities/readiness', async () => {
    const { getCapabilityReadiness } = await import('./capability-readiness.js')
    const provStatus = provisioning.getStatus()
    return getCapabilityReadiness({
      cloudConnected: provStatus.phase === 'ready',
      cloudUrl: provStatus.cloudUrl,
      webhooks: provStatus.webhooks as Array<{ provider: string; active: boolean }>,
      samplingProviders: getActiveSamplingProviders(),
    })
  })

  const VERSION_CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

  app.get('/version', async () => {
    const now = Date.now()

    // Refresh cache if stale
    if (now - versionCache.checkedAt > VERSION_CACHE_TTL_MS) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const res = await fetch(
          'https://api.github.com/repos/reflectt/reflectt-node/releases/latest',
          {
            headers: {
              'Accept': 'application/vnd.github+json',
              'User-Agent': `reflectt-node/${BUILD_VERSION}`,
            },
            signal: controller.signal,
          },
        )
        clearTimeout(timeout)

        if (res.ok) {
          const data = await res.json() as { tag_name?: string }
          const tagName = data.tag_name || ''
          versionCache.latest = tagName.replace(/^v/, '')
          versionCache.error = undefined
        } else if (res.status === 404) {
          // No releases published yet
          versionCache.latest = null
          versionCache.error = undefined
        } else {
          versionCache.error = `GitHub API returned ${res.status}`
        }
      } catch (err) {
        versionCache.error = err instanceof Error ? err.message : 'fetch failed'
      }
      versionCache.checkedAt = now
    }

    const current = BUILD_VERSION
    const latest = versionCache.latest
    const updateAvailable = latest != null && latest !== current && latest > current

    return {
      current,
      commit: BUILD_COMMIT,
      latest: latest ?? 'unknown',
      update_available: updateAvailable,
      checked_at: versionCache.checkedAt,
      uptime_seconds: Math.round((now - BUILD_STARTED_AT) / 1000),
      ...(versionCache.error ? { check_error: versionCache.error } : {}),
    }
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
    const assignee = String(task.assignee || '').trim()
    const isUnassigned = assignee.length === 0 || assignee.toLowerCase() === 'unassigned'
    if (!isUnassigned) {
      reply.code(409)
      return {
        success: false,
        error: `Task already assigned to ${assignee}`,
        code: 'TASK_ALREADY_ASSIGNED',
        status: 409,
        assignee,
        hint: 'Task claims are atomic: first claim wins. Pull another task via GET /tasks/next.',
      }
    }
    const shortId = lookup.resolvedId.replace(/^task-\d+-/, '')
    const branch = `${body.agent}/task-${shortId}`
    // Inject default eta when absent — prevents 500 on the doing-status gate
    const existingMeta = (task.metadata || {}) as Record<string, unknown>
    const etaDefault = !existingMeta.eta
      ? ({ P0: '~2h', P1: '~2h', P2: '~4h', P3: '~4h' }[task.priority || 'P2'] ?? '~4h')
      : undefined
    const updated = await taskManager.updateTask(lookup.resolvedId, {
      assignee: body.agent,
      status: 'doing',
      metadata: {
        ...existingMeta,
        actor: body.agent,
        branch,
        ...(etaDefault ? { eta: etaDefault } : {}),
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
        createdBy: data.createdBy || 'system',
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
      const body = request.body as { status: PresenceStatus; task?: string | null; since?: number }
      
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

  // ── Team Pulse ─────────────────────────────────────────────────────
  app.get<{ Querystring: { compact?: string } }>('/pulse', async (request) => {
    const compact = request.query.compact === 'true' || request.query.compact === '1'
    if (compact) {
      return generateCompactPulse()
    }
    return generatePulse()
  })

  // ── Scope Overlap Scanner ──────────────────────────────────────────
  // POST /pr-link-reconciler/sweep — manually trigger a PR-link reconcile sweep
  // Stamps canonical_pr + canonical_commit for validating tasks whose PRs have merged.
  app.post('/pr-link-reconciler/sweep', async (_request, reply) => {
    try {
      const result = runPrLinkReconcileSweep({
        getValidatingTasks: () => taskManager.listTasks({ status: 'validating' }),
        patchTaskMetadata: (taskId, patch) => taskManager.patchTaskMetadata(taskId, patch),
      })
      return { success: true, ...result }
    } catch (err: unknown) {
      reply.status(500)
      return { success: false, error: String(err) }
    }
  })

  // GET /pr-link-reconciler/preview — dry-run: show which tasks would be updated
  app.get('/pr-link-reconciler/preview', async () => {
    const tasks = taskManager.listTasks({ status: 'validating' })
    const { extractPrUrl, hasCanonicalRefs } = await import('./pr-link-reconciler.js')
    const candidates = tasks
      .map(t => ({
        taskId: t.id,
        title: t.title?.slice(0, 60),
        prUrl: extractPrUrl(t),
        alreadyCanonical: hasCanonicalRefs(t),
      }))
      .filter(c => c.prUrl && !c.alreadyCanonical)
    return { success: true, candidates, total: candidates.length }
  })

  // POST /scope-overlap — trigger scope overlap scan after a PR merge
  app.post<{ Body: { prNumber: number; prTitle: string; prBranch: string; mergedTaskId?: string; repo?: string; mergeCommit?: string; notify?: boolean } }>('/scope-overlap', async (request) => {
    const { prNumber, prTitle, prBranch, mergedTaskId, repo, mergeCommit, notify } = request.body || {} as any
    if (!prNumber || !prTitle || !prBranch) {
      return { success: false, error: 'Required: prNumber, prTitle, prBranch' }
    }
    if (notify !== false) {
      const result = await scanAndNotify(prNumber, prTitle, prBranch, mergedTaskId, repo, mergeCommit)
      return { success: true, ...result }
    }
    const result = scanScopeOverlap(prNumber, prTitle, prBranch, mergedTaskId, repo)
    return { success: true, ...result }
  })

  // ── Team Focus ─────────────────────────────────────────────────────
  // GET /focus — current team focus directive
  app.get('/focus', async () => {
    const focus = getFocus()
    return focus ? { focus } : { focus: null, message: 'No focus set. Use POST /focus to set one.' }
  })

  // POST /focus — set team focus directive
  app.post<{ Body: { directive: string; setBy: string; expiresAt?: number; tags?: string[] } }>('/focus', async (request) => {
    const { directive, setBy, expiresAt, tags } = request.body || {} as any
    if (!directive || !setBy) {
      return { success: false, error: 'Required: directive, setBy' }
    }
    const focus = setFocus(directive, setBy, { expiresAt, tags })
    return { success: true, focus }
  })

  // DELETE /focus — clear team focus
  app.delete('/focus', async () => {
    clearFocus()
    return { success: true, message: 'Focus cleared' }
  })

  // Get all agent presences
  app.get('/presence', async () => {
    const explicitPresences = presenceManager.getAllPresence()
    const allActivity = presenceManager.getAllActivity()

    // Filter to agents known to this node's TEAM-ROLES registry
    const knownAgentNames = new Set(getAgentRoles().map(r => r.name.toLowerCase()))
    
    // Build map of explicit presence by agent (filtered to registry)
    const presenceMap = new Map(
      explicitPresences
        .filter(p => knownAgentNames.size === 0 || knownAgentNames.has(p.agent.toLowerCase()))
        .map(p => [p.agent, p])
    )
    
    // Add inferred presence for agents with only activity (registry-gated)
    const now = Date.now()
    for (const activity of allActivity) {
      if (!presenceMap.has(activity.agent) && activity.last_active
          && (knownAgentNames.size === 0 || knownAgentNames.has(activity.agent.toLowerCase()))) {
        const inactiveMs = now - activity.last_active
        
        let status: PresenceStatus = 'offline'
        if (inactiveMs < 15 * 60 * 1000) { // Active in last 15 minutes — match presence.ts IDLE_THRESHOLD_MS
          status = activity.tasks_completed_today > 0 ? 'working' : 'idle'
        } else if (inactiveMs < 30 * 60 * 1000) { // 15-30 min — idle grace period before offline
          status = 'idle'
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
        
        // Infer status based on recent activity — match presence.ts thresholds
        let status: PresenceStatus = 'offline'
        if (inactiveMs < 15 * 60 * 1000) { // Active in last 15 minutes
          status = activity.tasks_completed_today > 0 ? 'working' : 'idle'
        } else if (inactiveMs < 30 * 60 * 1000) { // 15-30 min idle grace
          status = 'idle'
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

  // ── Agent Notifications ─────────────────────────────────────────────
  // Structured notification delivery with ack workflow.
  // Storage: agent_notifications table (migration v27).

  const agentNotifModule = await import('./agent-notifications.js')

  // POST /agent-notifications — create a notification
  app.post('/agent-notifications', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const target_agent = String(body.target_agent || '').trim()
    if (!target_agent) {
      reply.code(400)
      return { error: 'target_agent is required' }
    }
    const title = String(body.title || '').trim()
    if (!title) {
      reply.code(400)
      return { error: 'title is required' }
    }

    const notification = agentNotifModule.createNotification(getDb(), {
      target_agent,
      source_agent: body.source_agent ? String(body.source_agent) : undefined,
      type: body.type ? String(body.type) as NotificationType : undefined,
      title,
      body: body.body ? String(body.body) : undefined,
      priority: body.priority ? String(body.priority) as NotificationPriorityLevel : undefined,
      task_id: body.task_id ? String(body.task_id) : undefined,
      metadata: body.metadata as Record<string, unknown> | undefined,
      expires_at: body.expires_at ? Number(body.expires_at) : undefined,
    })

    reply.code(201)
    return { success: true, notification }
  })

  // POST /agent-notifications/:id/ack — acknowledge a notification
  app.post<{ Params: { id: string } }>('/agent-notifications/:id/ack', async (request, reply) => {
    const { id } = request.params
    const body = request.body as Record<string, unknown>
    const decision = String(body.decision || '').trim() as AckDecision

    if (!['seen', 'accept', 'defer', 'dismiss'].includes(decision)) {
      reply.code(400)
      return { error: 'decision must be one of: seen, accept, defer, dismiss' }
    }

    const notification = agentNotifModule.ackNotification(getDb(), id, decision)
    if (!notification) {
      reply.code(404)
      return { error: 'Notification not found or already acked' }
    }

    return { success: true, notification }
  })

  // GET /agent-notifications?agent=:id — list notifications for an agent
  app.get('/agent-notifications', async (request, reply) => {
    const query = request.query as Record<string, string>
    const agent = String(query.agent || '').trim()
    if (!agent) {
      reply.code(400)
      return { error: 'agent query parameter is required' }
    }

    const status = query.status as NotificationStatus | undefined
    const limit = query.limit ? parseInt(query.limit, 10) : undefined

    const result = agentNotifModule.getNotifications(getDb(), agent, { status, limit })
    return { notifications: result.notifications, total: result.total }
  })

  // GET /agent-notifications/worker/stats — delivery worker status
  app.get('/agent-notifications/worker/stats', async () => {
    return { success: true, stats: notificationWorker.getStats() }
  })

  // POST /agent-notifications/worker/tick — manually trigger delivery tick (for testing)
  app.post('/agent-notifications/worker/tick', async () => {
    const results = await notificationWorker.tick()
    return { success: true, results }
  })

  // POST /agent-presence — upsert agent presence (delegates to PresenceManager + logs)
  app.post('/agent-presence', async (request) => {
    const body = request.body as Record<string, unknown>
    const agent = String(body.agent || '').trim()
    if (!agent) {
      return { error: 'agent is required' }
    }

    const status = String(body.status || 'idle') as import('./presence.js').PresenceStatus
    const task = body.task ? String(body.task) : undefined

    presenceManager.updatePresence(agent, status, task)

    // Log to agent_presence_log for historical tracking
    const focusLevel = body.focus_level ? String(body.focus_level) : null
    const metadata = body.metadata ? JSON.stringify(body.metadata) : null
    getDb().prepare(`
      INSERT INTO agent_presence_log (agent, status, task, focus_level, metadata, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agent, status, task ?? null, focusLevel, metadata, Date.now())

    const presence = presenceManager.getPresence(agent)
    return { success: true, presence }
  })

  // GET /agent-presence?agent=:id — read current agent presence
  app.get('/agent-presence', async (request, reply) => {
    const query = request.query as Record<string, string>
    const agent = String(query.agent || '').trim()
    if (!agent) {
      reply.code(400)
      return { error: 'agent query parameter is required' }
    }

    const presence = presenceManager.getPresence(agent)
    if (!presence) {
      return { presence: null, message: 'No presence data for this agent' }
    }
    return { presence }
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

  // ── Agent Timeline ───────────────────────────────────────────────────
  // Unified activity feed: runs + task state changes + trust events.
  // Returns events in reverse-chronological order.
  app.get<{ Params: { agent: string } }>('/agents/:agent/timeline', async (request) => {
    const agent = String(request.params.agent || '').trim().toLowerCase()
    if (!agent) return { error: 'agent is required' }

    const rawQuery = request.query as Record<string, string>
    const limit = Math.min(parseInt(rawQuery.limit || '50', 10), 200)
    const since = rawQuery.since ? parseInt(rawQuery.since, 10) : undefined

    const events: Array<{
      type: 'run_complete' | 'task_state_change' | 'trust_event' | 'expression_changed'
      timestamp: number
      summary: string
      taskId?: string
      runId?: string
      meta?: Record<string, unknown>
    }> = []

    // ── Source 1: Agent runs (completed/failed) ────────────────────
    try {
      const { listAgentRuns } = await import('./agent-runs.js')
      const agentRuns = listAgentRuns(agent, 'default', { limit, includeArchived: true })
      for (const run of agentRuns) {
        const endTs = run.completedAt ?? null
        const ts = endTs ?? run.startedAt
        if (since && ts < since) continue
        if (run.status === 'idle' || run.status === 'working') continue // only completed runs
        events.push({
          type: 'run_complete',
          timestamp: ts,
          summary: `Run ${run.status}: ${run.objective.slice(0, 100)}`,
          runId: run.id,
          meta: {
            status: run.status,
            durationMs: endTs ? endTs - run.startedAt : null,
          },
        })
      }
    } catch { /* agent-runs not available */ }

    // ── Source 2: Task state changes (from comments on agent tasks) ──
    {
      const agentAliases = getAgentAliases(agent)
      const agentTasks = taskManager.listTasks({ assigneeIn: agentAliases })
      for (const task of agentTasks) {
        const comments = taskManager.getTaskComments(task.id)
        for (const c of comments) {
          if (since && c.timestamp < since) continue
          // Status-change comments have category 'status_change' or contain [transition]
          const isStateChange = c.category === 'status_change'
            || /\[transition\]|\bdoing\b.*\bvalidating\b|\bvalidating\b.*\bdone\b|\btodo\b.*\bdoing\b|\bblocked\b/i.test(c.content)
          if (!isStateChange) continue
          events.push({
            type: 'task_state_change',
            timestamp: c.timestamp,
            summary: `Task ${task.id}: ${c.content.slice(0, 120)}`,
            taskId: task.id,
            meta: { taskTitle: task.title, author: c.author },
          })
        }
      }
    }

    // ── Source 4: Expression events from eventLog ─────────────────
    {
      const exprEvents = eventBus.getEvents({ agent, limit })
        .filter(e => e.type === 'canvas_expression')
      for (const e of exprEvents) {
        const data = e.data as any
        if (since && e.timestamp < since) continue
        // Classify expression type based on dominant channel
        const channels = data.channels ?? {}
        const expressionType: string =
          channels.voice ? 'thought' :
          channels.narrative && !channels.voice ? 'reaction' :
          channels.emoji ? 'emoji' :
          'visual'
        events.push({
          type: 'expression_changed',
          timestamp: e.timestamp,
          summary: channels.voice ?? channels.narrative ?? 'Expression',
          meta: {
            agentId: data.agentId,
            emoji: channels.emoji ?? null,
            name: channels.voice ?? channels.narrative ?? null,
            expressionType,
          },
        })
      }
    }

    // ── Source 3: Trust events ─────────────────────────────────────
    try {
      const { listTrustEvents } = await import('./trust-events.js')
      const trustEvts = listTrustEvents({ agentId: agent, since, limit })
      for (const te of trustEvts) {
        events.push({
          type: 'trust_event',
          timestamp: te.occurredAt,
          summary: `[${te.severity}] ${te.eventType}: ${te.summary}`,
          taskId: te.taskId ?? undefined,
          meta: { eventType: te.eventType, severity: te.severity },
        })
      }
    } catch { /* trust-events not available */ }

    // Sort reverse-chrono and cap at limit
    events.sort((a, b) => b.timestamp - a.timestamp)
    const sliced = events.slice(0, limit)

    return { agent, timeline: sliced, count: sliced.length }
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

  // Legacy activity endpoint replaced by unified /activity timeline (see above)

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

  // ============ GITHUB APPROVALS / PER-ACTOR AUTH (OPS) ============

  // Whoami for a given actor's token (never returns token)
  app.get<{ Params: { actor: string } }>('/github/whoami/:actor', async (request, reply) => {
    const enabled = process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API === 'true'
      || process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API === '1'

    if (!enabled) {
      reply.code(403)
      return {
        success: false,
        error: 'GitHub approval API is disabled',
        hint: 'Set REFLECTT_ENABLE_GITHUB_APPROVAL_API=true to enable (and optionally REFLECTT_GITHUB_APPROVAL_TOKEN for auth).'
      }
    }

    const ip = String((request as any).ip || '')
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      reply.code(403)
      return {
        success: false,
        error: 'Forbidden: localhost-only endpoint',
        hint: `Request ip (${ip || 'unknown'}) is not loopback`,
      }
    }

    const requiredToken = process.env.REFLECTT_GITHUB_APPROVAL_TOKEN
    if (requiredToken) {
      const raw = (request.headers as any)['x-reflectt-admin-token']
      let provided = Array.isArray(raw) ? raw[0] : raw
      const auth = (request.headers as any).authorization
      if ((!provided || typeof provided !== 'string') && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        provided = auth.slice('Bearer '.length)
      }

      if (typeof provided !== 'string' || provided !== requiredToken) {
        reply.code(403)
        return {
          success: false,
          error: 'Forbidden: missing/invalid admin token',
          hint: 'Provide x-reflectt-admin-token header (or Authorization: Bearer ...) matching REFLECTT_GITHUB_APPROVAL_TOKEN.'
        }
      }
    }

    const actor = request.params.actor
    const resolved = resolveGitHubTokenForActor(actor)
    if (!resolved?.token) {
      reply.code(404)
      return { success: false, error: `No GitHub token configured for actor: ${actor}` }
    }

    const user = await githubWhoami({ token: resolved.token })
    if (!user) {
      reply.code(502)
      return { success: false, error: 'GitHub whoami failed', source: resolved.source, hint: 'Token may be invalid or missing scopes.' }
    }

    return { success: true, actor, user, source: resolved.source, secretName: resolved.secretName, envKey: resolved.envKey }
  })

  // Approve a PR as a specific actor (token selected via vault/env mapping)
  app.post('/github/pr/approve', async (request, reply) => {
    const enabled = process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API === 'true'
      || process.env.REFLECTT_ENABLE_GITHUB_APPROVAL_API === '1'

    if (!enabled) {
      reply.code(403)
      return {
        success: false,
        error: 'GitHub approval API is disabled',
        hint: 'Set REFLECTT_ENABLE_GITHUB_APPROVAL_API=true to enable (and optionally REFLECTT_GITHUB_APPROVAL_TOKEN for auth).'
      }
    }

    const ip = String((request as any).ip || '')
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      reply.code(403)
      return {
        success: false,
        error: 'Forbidden: localhost-only endpoint',
        hint: `Request ip (${ip || 'unknown'}) is not loopback`,
      }
    }

    const requiredToken = process.env.REFLECTT_GITHUB_APPROVAL_TOKEN
    if (requiredToken) {
      const raw = (request.headers as any)['x-reflectt-admin-token']
      let provided = Array.isArray(raw) ? raw[0] : raw
      const auth = (request.headers as any).authorization
      if ((!provided || typeof provided !== 'string') && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        provided = auth.slice('Bearer '.length)
      }

      if (typeof provided !== 'string' || provided !== requiredToken) {
        reply.code(403)
        return {
          success: false,
          error: 'Forbidden: missing/invalid admin token',
          hint: 'Provide x-reflectt-admin-token header (or Authorization: Bearer ...) matching REFLECTT_GITHUB_APPROVAL_TOKEN.'
        }
      }
    }

    const body = request.body as { pr_url?: string; actor?: string; reason?: string }
    const prUrl = typeof body?.pr_url === 'string' ? body.pr_url : ''
    const actor = typeof body?.actor === 'string' ? body.actor : ''
    const reason = typeof body?.reason === 'string' ? body.reason : ''

    if (!prUrl || !actor) {
      reply.code(400)
      return { success: false, error: 'pr_url and actor are required' }
    }

    const resolved = resolveGitHubTokenForActor(actor)
    if (!resolved?.token) {
      reply.code(404)
      return { success: false, error: `No GitHub token configured for actor: ${actor}` }
    }

    // Best-effort: include reason but avoid dumping huge strings.
    const approveRes = await approvePullRequest({
      token: resolved.token,
      prUrl,
      body: reason ? `Approved via Reflectt as @${actor}. Reason: ${reason.slice(0, 500)}` : `Approved via Reflectt as @${actor}.`,
    })

    if (!approveRes.ok) {
      reply.code(approveRes.status || 502)
      return { success: false, error: 'PR approval failed', details: approveRes.message || 'unknown', source: resolved.source }
    }

    return { success: true, pr_url: prUrl, actor, source: resolved.source }
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
   *   ?raw=true   — include internal/infrastructure users (for debugging)
   *   (no params) — get aggregate summary across all users (clean, external only)
   */
  app.get('/activation/funnel', async (request) => {
    const query = request.query as Record<string, string>
    const userId = query.userId
    const raw = query.raw === 'true'

    if (userId) {
      return { funnel: getUserFunnelState(userId) }
    }

    return { funnel: getFunnelSummary({ raw }) }
  })

  /**
   * GET /activation/doctor-gate — polling-optimized endpoint for cloud onboarding UI.
   * Cloud BYOH onboarding polls this every 5s to check if the user ran reflectt doctor.
   * Returns a simple passed/failed state without the full funnel payload.
   *
   * Query: ?userId=<userId>
   *
   * Used by the cloud "Verify your setup" step (step 4 of BYOH onboarding).
   * task-1773703300024-73ydeyx9n
   */
  app.get('/activation/doctor-gate', async (request, reply) => {
    const query = request.query as Record<string, string>
    const userId = query.userId?.trim()
    if (!userId) return reply.code(400).send({ success: false, error: 'userId is required' })

    const state = getUserFunnelState(userId)
    const passedAt = state.events.host_preflight_passed ?? null
    const passed = passedAt !== null

    // Extract failure reasons from preflight_failed event metadata in the event log
    let failureReasons: string[] = []
    if (!passed && state.events.host_preflight_failed) {
      const log = getActivationEventLog()
      const failEvent = log.find(e => e.userId === userId && e.type === 'host_preflight_failed')
      if (failEvent?.metadata) {
        const fc = failEvent.metadata['failed_checks']
        if (Array.isArray(fc)) failureReasons = fc.map(String)
        else if (typeof failEvent.metadata['first_blocker'] === 'string') failureReasons = [failEvent.metadata['first_blocker']]
      }
    }

    return {
      userId,
      passed,
      passedAt,
      workspaceReady: state.events.workspace_ready !== null,
      preflightAttempted: state.events.host_preflight_failed !== null || passed,
      failureReasons,
    }
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
      'workspace_ready', 'workspace_not_ready',
      'first_task_started',
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
    const raw = query.raw === 'true'
    return { success: true, dashboard: getOnboardingDashboard({ weeks, raw }) }
  })

  /**
   * GET /activation/funnel/conversions — Step-by-step conversion rates.
   * Returns per-step reach count, conversion rate, and median step time.
   */
  app.get('/activation/funnel/conversions', async (request) => {
    const query = request.query as Record<string, string>
    const raw = query.raw === 'true'
    return { success: true, conversions: getConversionFunnel({ raw }) }
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

  /**
   * GET /activation/ghost-signups — Users who signed up but never ran preflight.
   * Cloud polls this to find candidates for the ghost signup nudge email.
   * Query: ?minAgeHours=2 (default 2h; use 24 for 24h tier candidates)
   *
   * task-1773709288800-lam5hd11b
   */
  app.get('/activation/ghost-signups', async (request) => {
    const query = request.query as Record<string, string>
    const minAgeHours = query.minAgeHours ? parseFloat(query.minAgeHours) : 2
    const minAgeMs = minAgeHours * 60 * 60 * 1000
    const { getGhostSignupCandidates } = await import('./ghost-signup-nudge.js')
    const candidates = getGhostSignupCandidates(minAgeMs)
    return { success: true, candidates, count: candidates.length, minAgeHours }
  })

  /**
   * POST /activation/ghost-signup-nudge — Send re-engagement email to a ghost signup.
   * Cloud calls this with { userId, email, nudgeTier? } after finding candidates.
   * Node sends the email via cloud relay, tags the user, and returns result.
   *
   * Body: { userId: string, email: string, nudgeTier?: '2h' | '24h' }
   *
   * task-1773709288800-lam5hd11b
   */
  app.post('/activation/ghost-signup-nudge', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const nudgeTier = (body.nudgeTier === '24h' ? '24h' : '2h') as '2h' | '24h'

    if (!userId) return reply.code(400).send({ success: false, error: 'userId is required' })
    if (!email || !email.includes('@')) return reply.code(400).send({ success: false, error: 'valid email is required' })

    const { sendGhostSignupNudge } = await import('./ghost-signup-nudge.js')

    const emailRelayFn = async (opts: {
      from: string; to: string; subject: string; html: string; text: string;
      tags?: Array<{ name: string; value: string }>;
    }) => {
      const hostId = process.env.REFLECTT_HOST_ID
      const relayPath = hostId ? `/api/hosts/${encodeURIComponent(hostId)}/relay/email` : '/api/hosts/relay/email'
      try {
        const relayResult = await cloudRelay(relayPath, {
          from: opts.from, to: opts.to, subject: opts.subject,
          html: opts.html, text: opts.text, tags: opts.tags,
          agent: 'funnel',
          idempotencyKey: `ghost-signup-nudge/${userId}/${nudgeTier}`,
        }, reply) as Record<string, unknown>
        const relayError = typeof relayResult?.error === 'string' ? relayResult.error : undefined
        return { success: !relayError, error: relayError }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'relay error' }
      }
    }

    const result = await sendGhostSignupNudge(userId, email, nudgeTier, emailRelayFn)
    return { success: true, result }
  })

  /**
   * POST /tracking/live-cta — Track /live page CTA clicks
   * Called by cloud app when user clicks "Start Free" on /live
   * task-1774294960543-v778wwmio
   */
  app.post('/tracking/live-cta', async (request) => {
    const body = request.body as Record<string, unknown>
    const source = body.source as string || 'unknown'
    const url = body.url as string || ''
    const ts = body.ts as number || Date.now()
    console.log(`[live-cta] ${new Date().toISOString()} source=${source} url=${url} ts=${ts}`)
    return { success: true, tracked: true }
  })

  /**
   * POST /tracking/live-visit — Track /live page visits
   * Simple hit counter - logs each visit to console
   */
  app.post('/tracking/live-visit', async (request) => {
    const body = request.body as Record<string, unknown>
    const referrer = body.referrer as string || 'direct'
    console.log(`[live-visit] ${new Date().toISOString()} referrer=${referrer}`)
    return { success: true, visited: true }
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
    const event = recordUsageTracking({
      agent: body.agent as string,
      model: body.model as string,
      provider: (body.provider as string | undefined) ?? 'unknown',
      input_tokens: Number(body.input_tokens) || 0,
      output_tokens: Number(body.output_tokens) || 0,
      estimated_cost_usd: body.estimated_cost_usd != null ? Number(body.estimated_cost_usd) : undefined,
      category: (body.category as UsageEvent['category'] | undefined) ?? 'other',
      timestamp: Number(body.timestamp) || Date.now(),
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

  // POST /usage/ingest — accept external usage records from OpenClaw sessions
  // Bridges agents not connected via node heartbeat (swift, kotlin, qa, etc.)
  // into the model_usage table so the cloud dashboard captures all agent spend.
  // Auth: REFLECTT_HOST_HEARTBEAT_TOKEN (Bearer / x-heartbeat-token / body.token).
  // Supports single record or batch (body.events array).
  app.post('/usage/ingest', async (request, reply) => {
    const auth = verifyHeartbeatAuth(request as any)
    if (!auth.ok) {
      reply.code(401)
      return { success: false, error: auth.error }
    }

    const body = request.body as Record<string, unknown>

    // Batch path: { events: [...] }
    if (Array.isArray(body.events)) {
      const items = body.events as Record<string, unknown>[]
      if (items.length === 0) {
        reply.code(400)
        return { success: false, error: 'events array must not be empty' }
      }
      const events = items.map(item => {
        if (!item.agent || !item.model) throw Object.assign(new Error('agent and model are required in every event'), { statusCode: 400 })
        return recordUsageTracking({
          agent: item.agent as string,
          model: item.model as string,
          provider: (item.provider as string | undefined) ?? 'openclaw',
          input_tokens: Number(item.input_tokens) || 0,
          output_tokens: Number(item.output_tokens) || 0,
          estimated_cost_usd: item.cost_usd != null ? Number(item.cost_usd) : undefined,
          category: (item.category as UsageEvent['category'] | undefined) ?? 'other',
          timestamp: Number(item.timestamp) || Date.now(),
          api_source: (item.session_id as string | undefined) ? `openclaw:${item.session_id}` : 'openclaw',
          metadata: item.session_id ? { session_id: item.session_id } : undefined,
        })
      })
      reply.code(201)
      return { success: true, count: events.length }
    }

    // Single record path: { agent, model, input_tokens, output_tokens, cost_usd, session_id?, timestamp? }
    if (!body.agent || !body.model) {
      reply.code(400)
      return { success: false, error: 'agent and model are required' }
    }
    const event = recordUsageTracking({
      agent: body.agent as string,
      model: body.model as string,
      provider: (body.provider as string | undefined) ?? 'openclaw',
      input_tokens: Number(body.input_tokens) || 0,
      output_tokens: Number(body.output_tokens) || 0,
      estimated_cost_usd: body.cost_usd != null ? Number(body.cost_usd) : undefined,
      category: (body.category as UsageEvent['category'] | undefined) ?? 'other',
      timestamp: Number(body.timestamp) || Date.now(),
      api_source: (body.session_id as string | undefined) ? `openclaw:${body.session_id}` : 'openclaw',
      metadata: body.session_id ? { session_id: body.session_id } : undefined,
    })
    reply.code(201)
    return { success: true, event }
  })

  // POST /usage/sync/openclaw — on-demand trigger for OpenClaw session sync
  // Reads ~/.openclaw/agents/*/sessions/sessions.json and ingests new sessions.
  app.post('/usage/sync/openclaw', async (request, reply) => {
    const auth = verifyHeartbeatAuth(request as any)
    if (!auth.ok) {
      reply.code(401)
      return { success: false, error: auth.error }
    }
    try {
      const result = await syncOpenClawUsage()
      reply.code(200)
      return { success: true, ...result }
    } catch (err) {
      reply.code(500)
      return { success: false, error: (err as Error).message }
    }
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

  // ── Cost Dashboard ──
  // GET /costs — aggregated spend: daily by model, avg per lane, top tasks
  app.get('/costs', async (request) => {
    const q = request.query as Record<string, string>
    const days = q.days ? Math.min(Number(q.days), 90) : 7
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    const dailyByModel = getDailySpendByModel({ days })
    const byLane = getAvgCostByLane({ days: Math.max(days, 30) }) // lane data needs more window
    const byAgent = getAvgCostByAgent({ days: Math.max(days, 30) })
    const topTasks = getUsageByTask({ since, limit: 20 })
    const summary = getUsageSummary({ since })

    // Roll up daily totals per day for the sparkline
    const dailyTotals: Record<string, number> = {}
    for (const row of dailyByModel) {
      dailyTotals[row.date] = (dailyTotals[row.date] ?? 0) + row.total_cost_usd
    }

    // Note: avg_cost_by_lane and avg_cost_by_agent use Math.max(days, 30) as their window.
    // Lane/agent-level averages need task density to be meaningful — a 7-day window might
    // have 0-1 closed tasks per agent/lane and produce misleading numbers. Using a 30-day
    // floor is intentional. daily_by_model, daily_totals, and top_tasks_by_cost use the
    // requested `days` window directly and will match the `window_days` field in the response.
    const laneAgentWindow = Math.max(days, 30)

    return {
      window_days: days,
      lane_agent_window_days: laneAgentWindow,
      summary: Array.isArray(summary) ? summary[0] ?? null : summary,
      daily_by_model: dailyByModel,
      daily_totals: Object.entries(dailyTotals)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, total_cost_usd]) => ({ date, total_cost_usd })),
      avg_cost_by_lane: byLane,
      avg_cost_by_agent: byAgent,
      top_tasks_by_cost: topTasks,
      generated_at: Date.now(),
    }
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

      // Touch presence: publishing content proves agent is alive
      if (body.publishedBy) {
        presenceManager.recordActivity(body.publishedBy, 'message')
        presenceManager.touchPresence(body.publishedBy)
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

      // Touch presence when adding content to calendar
      if (body.createdBy) {
        presenceManager.touchPresence(body.createdBy)
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
    const { getCloudStatus, getConnectionHealth, getConnectionEvents } = await import('./cloud.js')
    return {
      ...getCloudStatus(),
      connectionHealth: getConnectionHealth(),
    }
  })

  app.get('/cloud/events', async (request) => {
    const { getConnectionEvents } = await import('./cloud.js')
    const url = new URL(request.url, 'http://localhost')
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100)
    return { events: getConnectionEvents(limit) }
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

    // Persist raw inbound payload for agent retrieval (non-blocking, best-effort)
    try {
      const { storeWebhookPayload: persistInbound } = await import('./webhook-storage.js')
      const rawHeaders: Record<string, string> = {}
      for (const [k, v] of Object.entries(request.headers)) {
        if (typeof v === 'string') rawHeaders[k] = v
        else if (Array.isArray(v)) rawHeaders[k] = v.join(', ')
      }
      persistInbound({ source: provider, eventType, body, headers: rawHeaders })
    } catch {
      // storage failure must not interrupt webhook delivery
    }

    // Enrich GitHub webhook payloads with agent attribution
    const enrichedBody = provider === 'github'
      ? enrichWebhookPayload(body)
      : body

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
        payload: enrichedBody,
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

    // Post GitHub events to the 'github' chat channel with remapped mentions.
    // Pass enrichedBody (not body) so formatGitHubEvent has access to
    // _reflectt_attribution and can mention the correct agent (@link not @kai).
    if (provider === 'github') {
      const ghEventType = (request.headers['x-github-event'] as string) || eventType
      const chatMessage = formatGitHubEvent(ghEventType, enrichedBody as any)
      if (chatMessage) {
        chatManager.sendMessage({
          from: 'github',
          content: chatMessage,
          channel: 'github',
          metadata: { source: 'github-webhook', eventType: ghEventType, delivery: request.headers['x-github-delivery'] },
        }).catch(() => {}) // non-blocking
      }

      // canvas_artifact(type=test) on CI workflow_run completed
      if (ghEventType === 'workflow_run' && (enrichedBody as any)?.action === 'completed') {
        const wfRun = (enrichedBody as any)?.workflow_run as Record<string, unknown> | undefined
        if (wfRun) {
          const conclusion = (wfRun.conclusion as string) ?? 'unknown'
          const ciNow = Date.now()
          const agentId = (enrichedBody as any)?._reflectt_attribution?.agent ?? 'system'
          // Derive passed/failed/skipped from check_runs when available, else infer from conclusion
          const checkRunsArr = Array.isArray((enrichedBody as any)?.check_runs) ? (enrichedBody as any).check_runs : []
          const passed = checkRunsArr.filter((c: any) => c.conclusion === 'success').length
          const failed = checkRunsArr.filter((c: any) => c.conclusion === 'failure').length
          const skipped = checkRunsArr.filter((c: any) => c.conclusion === 'skipped' || c.conclusion === 'neutral').length
          eventBus.emit({
            id: `artifact-ci-${ciNow}-${String(wfRun.id ?? ciNow).slice(-6)}`,
            type: 'canvas_artifact' as const,
            timestamp: ciNow,
            data: {
              type: 'test' as const,
              agentId,
              title: `CI: ${String(wfRun.name ?? 'workflow')} — ${conclusion}`,
              url: (wfRun.html_url as string) ?? undefined,
              conclusion,
              passed: checkRunsArr.length > 0 ? passed : conclusion === 'success' ? 1 : 0,
              failed: checkRunsArr.length > 0 ? failed : conclusion === 'failure' ? 1 : 0,
              skipped: checkRunsArr.length > 0 ? skipped : 0,
              timestamp: ciNow,
            },
          })
        }
      }
    }

    // Post Sentry error alerts to #ops channel
    if (provider === 'sentry') {
      // Optional signature verification (HMAC-SHA256)
      const sentrySecret = process.env.SENTRY_CLIENT_SECRET
      const sentrySignature = request.headers['sentry-hook-signature'] as string | undefined
      if (sentrySecret && !verifySentrySignature(JSON.stringify(body), sentrySignature, sentrySecret)) {
        reply.code(401)
        return { success: false, message: 'Invalid Sentry webhook signature' }
      }

      const opsMessage = formatSentryAlert(body as any)
      if (opsMessage) {
        chatManager.sendMessage({
          from: 'sentry',
          content: opsMessage,
          channel: 'ops',
          metadata: { source: 'sentry-webhook', action: (body as any)?.action, resource: request.headers['sentry-hook-resource'] as string | undefined },
        }).catch(() => {}) // non-blocking
      }
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

  // OpenClaw status — show real config state + remediation when missing
  app.get('/openclaw/status', async () => {
    const hasToken = !!openclawConfig.gatewayToken
    const hasUrl = !!openclawConfig.gatewayUrl
    if (!hasToken) {
      return {
        connected: false,
        status: 'not configured',
        gateway: hasUrl ? openclawConfig.gatewayUrl : null,
        fix: [
          'Set environment variables in your .env file:',
          '  OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789',
          '  OPENCLAW_GATEWAY_TOKEN=your_token_here',
          '',
          'Find your token: cat ~/.openclaw/openclaw.json | grep gateway_token',
          'Or generate one: openclaw gateway token',
          '',
          'Then restart reflectt-node.',
        ].join('\n'),
        docs: 'https://docs.openclaw.ai/gateway',
      }
    }
    return {
      connected: true,
      status: 'configured',
      gateway: openclawConfig.gatewayUrl,
      agentId: openclawConfig.agentId,
    }
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

  // GET /compliance/violations — state-read-before-assertion compliance violations
  app.get('/compliance/violations', async (request, reply) => {
    const query = request.query as Record<string, string>
    const agent = query.agent || undefined
    const severity = (query.severity as any) || undefined
    const limit = Math.min(parseInt(query.limit || '100', 10) || 100, 1000)
    const since = query.since ? parseInt(query.since, 10) : undefined

    const violations = queryViolations({ agent, severity, limit, since })
    const summary = getViolationSummary(since)

    reply.send({
      violations,
      count: violations.length,
      summary,
      query: { agent: agent ?? null, severity: severity ?? null, limit, since: since ?? null },
    })
  })

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

  // ── Restart Drift Guard: reassert critical task ownership post-restart ──
  runRestartDriftGuard().catch(err => {
    console.error('[RestartDrift] Failed to run drift guard:', err)
  })

  // GET /execution-health — sweeper status + current violations
  app.get('/execution-health', async (_request, reply) => {
    const status = getSweeperStatus()
    const freshSweep = await sweepValidatingQueue()
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

  // GET /merge-gate/check/:owner/:repo/:prNumber — check if PR has preview approval
  app.get<{ Params: { owner: string; repo: string; prNumber: string } }>('/merge-gate/check/:owner/:repo/:prNumber', async (request) => {
    const { owner, repo, prNumber } = request.params
    const fullRepo = `${owner}/${repo}`
    const prNum = parseInt(prNumber, 10)
    if (isNaN(prNum)) return { approved: false, error: 'Invalid PR number' }
    // Check both exact repo match and wildcard
    const approved = hasPreviewApproval(fullRepo, prNum) || hasPreviewApproval('*', prNum)
    return { approved, repo: fullRepo, prNumber: prNum }
  })

  // GET /merge-gate/approvals — list all recorded preview approvals (diagnostics)
  app.get('/merge-gate/approvals', async () => {
    return { approvals: getPreviewApprovals() }
  })

  // GET /github/token — expose the cloud-refreshed GitHub installation token
  // Used by gateway/agent startup to set GH_TOKEN before spawning Claude Code.
  app.get('/github/token', async () => {
    const token = getCloudGitHubToken()
    if (!token) {
      return { available: false, error: 'No GitHub token available — cloud token refresh may not be configured' }
    }
    return { available: true, token }
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

  // ── Schedule feed — team-wide time-awareness ──────────────────────────────
  //
  // Provides canonical records for deploy windows, focus blocks, and
  // scheduled task work so agents can coordinate timing without chat.
  //
  // MVP scope: one-off windows only. No iCal/RRULE, no reminders.
  // See src/schedule.ts for what is intentionally NOT included.

  // GET /schedule/feed — upcoming entries in chronological order
  app.get('/schedule/feed', async (request) => {
    const q = request.query as Record<string, string>
    const kinds = q.kinds ? (q.kinds.split(',') as ScheduleKind[]) : undefined
    const entries = getScheduleFeed({
      after: q.after ? parseInt(q.after, 10) : undefined,
      before: q.before ? parseInt(q.before, 10) : undefined,
      kinds,
      owner: q.owner,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    })
    return { entries, count: entries.length }
  })

  // POST /schedule/entries — create a new schedule entry
  app.post('/schedule/entries', async (request, reply) => {
    try {
      const entry = createScheduleEntry(request.body as any)
      return reply.status(201).send({ entry })
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  // GET /schedule/entries/:id
  app.get<{ Params: { id: string } }>('/schedule/entries/:id', async (request, reply) => {
    const entry = getScheduleEntry(request.params.id)
    if (!entry) return reply.status(404).send({ error: 'Not found' })
    return { entry }
  })

  // PATCH /schedule/entries/:id
  app.patch<{ Params: { id: string } }>('/schedule/entries/:id', async (request, reply) => {
    try {
      const entry = updateScheduleEntry(request.params.id, request.body as any)
      if (!entry) return reply.status(404).send({ error: 'Not found' })
      return { entry }
    } catch (err: any) {
      return reply.status(400).send({ error: err.message })
    }
  })

  // DELETE /schedule/entries/:id
  app.delete<{ Params: { id: string } }>('/schedule/entries/:id', async (request, reply) => {
    const deleted = deleteScheduleEntry(request.params.id)
    if (!deleted) return reply.status(404).send({ error: 'Not found' })
    return reply.status(204).send()
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

  // GET /calendar/upcoming — next N days of events (agent execution surface)
  // Accepts ?days=7 (default 7). Returns spec-shaped response sorted chronologically.
  app.get('/calendar/upcoming', async (request) => {
    const q = request.query as Record<string, string>
    const days = Math.max(1, Math.min(90, parseInt(q.days ?? '7', 10) || 7))
    const now = Date.now()
    const to = now + days * 24 * 60 * 60 * 1000

    const events = calendarEvents.listEvents({ from: now, to, status: 'confirmed' })

    return {
      events: events.map(e => ({
        id: e.id,
        title: e.summary,
        start: new Date(e.dtstart).toISOString(),
        end: new Date(e.dtend).toISOString(),
        attendees: e.attendees.map(a => a.name),
        calendar: e.categories[0] ?? null,
        description: e.description || null,
        location: e.location || null,
        provider: 'local',
      })),
    }
  })

  // Create an event (spec format + legacy CreateEventInput both accepted)
  // Spec format: { title, start, duration_minutes?, attendees?, calendar?, description? }
  // Legacy format: { summary, organizer, dtstart, dtend, ... }
  // Error codes: 422 for past start time, 409 for exact duplicate (same title+start)
  app.post('/calendar/events', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      if (!body) return reply.code(400).send({ error: 'Request body is required' })

      let input: CreateEventInput

      if (typeof body.title === 'string' || typeof body.start === 'string') {
        // Spec format — translate to internal CreateEventInput
        const title = typeof body.title === 'string' ? body.title.trim() : ''
        const startStr = typeof body.start === 'string' ? body.start : ''
        if (!title) return reply.code(400).send({ error: 'title is required' })
        if (!startStr) return reply.code(400).send({ error: 'start is required' })

        const dtstart = Date.parse(startStr)
        if (isNaN(dtstart)) return reply.code(400).send({ error: 'start must be a valid ISO 8601 datetime' })

        // 422 for past dates
        if (dtstart < Date.now()) {
          return reply.code(422).send({ error: 'start must be in the future', code: 'PAST_DATE' })
        }

        const durationMinutes = typeof body.duration_minutes === 'number' ? body.duration_minutes : 60
        const dtend = dtstart + durationMinutes * 60 * 1000

        // 409 duplicate check: same title + same start time
        const existing = calendarEvents.listEvents({ from: dtstart - 1000, to: dtstart + 1000 })
        const duplicate = existing.find(e => e.summary.toLowerCase() === title.toLowerCase() && e.dtstart === dtstart)
        if (duplicate) {
          return reply.code(409).send({ error: 'Duplicate event: same title and start time already exists', existing_id: duplicate.id })
        }

        const rawAttendees = Array.isArray(body.attendees) ? body.attendees : []
        const calendar = typeof body.calendar === 'string' ? body.calendar : undefined
        input = {
          summary: title,
          description: typeof body.description === 'string' ? body.description : undefined,
          dtstart,
          dtend,
          organizer: 'agent',
          attendees: rawAttendees.map((a: unknown) => ({
            name: typeof a === 'string' ? a : String(a),
            email: typeof a === 'string' && a.includes('@') ? a : undefined,
            status: 'needs-action' as const,
          })),
          categories: calendar ? [calendar] : [],
        }
      } else {
        // Legacy format
        const legacy = body as unknown as CreateEventInput
        if (!legacy.summary || !legacy.organizer) {
          return reply.code(400).send({ error: 'summary and organizer are required' })
        }
        // 422 for past dates in legacy format too
        if (typeof legacy.dtstart === 'number' && legacy.dtstart < Date.now()) {
          return reply.code(422).send({ error: 'dtstart must be in the future', code: 'PAST_DATE' })
        }
        input = legacy
      }

      const event = calendarEvents.createEvent(input)

      // Return spec-shaped response for spec-format requests, full event for legacy
      if (typeof body.title === 'string') {
        return reply.code(201).send({
          id: event.id,
          title: event.summary,
          start: new Date(event.dtstart).toISOString(),
          end: new Date(event.dtend).toISOString(),
          provider: 'local',
        })
      }
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

  // Start hourly auto-snapshot for alert-preflight daily metrics
  startAutoSnapshot()

  // ─── Browser capability routes ───────────────────────────────────────────────
  const browser = await import('./capabilities/browser.js')

  app.get('/browser/config', async () => {
    return browser.getBrowserConfig()
  })

  app.post('/browser/sessions', async (request, reply) => {
    try {
      const body = request.body as { agent?: string; url?: string; headless?: boolean; viewport?: { width: number; height: number } }
      if (!body?.agent) return reply.code(400).send({ error: 'agent is required' })
      const session = await browser.createSession({
        agent: body.agent,
        url: body.url,
        headless: body.headless,
        viewport: body.viewport,
      })
      const { _stagehand, _page, _idleTimer, ...safe } = session
      return reply.code(201).send(safe)
    } catch (err: any) {
      const status = err.message?.includes('Max concurrent') || err.message?.includes('exceeded max') ? 429 : 500
      return reply.code(status).send({ error: err.message })
    }
  })

  app.get('/browser/sessions', async () => {
    return { sessions: browser.listSessions() }
  })

  app.get<{ Params: { id: string } }>('/browser/sessions/:id', async (request, reply) => {
    const session = browser.getSession(request.params.id)
    if (!session) return reply.code(404).send({ error: 'Session not found' })
    const { _stagehand, _page, _idleTimer, ...safe } = session
    return safe
  })

  app.delete<{ Params: { id: string } }>('/browser/sessions/:id', async (request, reply) => {
    await browser.closeSession(request.params.id)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/browser/sessions/:id/act', async (request, reply) => {
    try {
      const body = request.body as { instruction?: string }
      if (!body?.instruction) return reply.code(400).send({ error: 'instruction is required' })
      const result = await browser.act(request.params.id, body.instruction)
      return result
    } catch (err: any) {
      return reply.code(err.message?.includes('No active') ? 404 : 500).send({ error: err.message })
    }
  })

  app.post<{ Params: { id: string } }>('/browser/sessions/:id/extract', async (request, reply) => {
    try {
      const body = request.body as { instruction?: string; schema?: unknown }
      if (!body?.instruction) return reply.code(400).send({ error: 'instruction is required' })
      const result = await browser.extract(request.params.id, body.instruction, body.schema)
      return result
    } catch (err: any) {
      return reply.code(err.message?.includes('No active') ? 404 : 500).send({ error: err.message })
    }
  })

  app.post<{ Params: { id: string } }>('/browser/sessions/:id/observe', async (request, reply) => {
    try {
      const body = request.body as { instruction?: string }
      if (!body?.instruction) return reply.code(400).send({ error: 'instruction is required' })
      const result = await browser.observe(request.params.id, body.instruction)
      return result
    } catch (err: any) {
      return reply.code(err.message?.includes('No active') ? 404 : 500).send({ error: err.message })
    }
  })

  app.post<{ Params: { id: string } }>('/browser/sessions/:id/navigate', async (request, reply) => {
    try {
      const body = request.body as { url?: string }
      if (!body?.url) return reply.code(400).send({ error: 'url is required' })
      const result = await browser.navigate(request.params.id, body.url)
      return result
    } catch (err: any) {
      return reply.code(err.message?.includes('No active') ? 404 : 500).send({ error: err.message })
    }
  })

  app.get<{ Params: { id: string } }>('/browser/sessions/:id/screenshot', async (request, reply) => {
    try {
      const result = await browser.screenshot(request.params.id)
      return result
    } catch (err: any) {
      return reply.code(err.message?.includes('No active') ? 404 : 500).send({ error: err.message })
    }
  })

  // ── Agent Runs & Events ──────────────────────────────────────────────────
  const {
    createAgentRun,
    updateAgentRun,
    getAgentRun,
    getActiveAgentRun,
    listAgentRuns,
    appendAgentEvent,
    listAgentEvents,
    VALID_RUN_STATUSES,
  } = await import('./agent-runs.js')

  // Create a new agent run
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/runs', async (request, reply) => {
    const { agentId } = request.params
    const body = request.body as { objective?: string; teamId?: string; taskId?: string; parentRunId?: string }
    if (!body?.objective) return reply.code(400).send({ error: 'objective is required' })
    const teamId = body.teamId ?? 'default'
    try {
      const run = createAgentRun(agentId, teamId, body.objective, {
        taskId: body.taskId,
        parentRunId: body.parentRunId,
      })
      return reply.code(201).send(run)
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // Update an agent run (status, context, artifacts)
  app.patch<{ Params: { agentId: string; runId: string } }>('/agents/:agentId/runs/:runId', async (request, reply) => {
    const { runId } = request.params
    const body = request.body as {
      status?: string
      contextSnapshot?: Record<string, unknown>
      artifacts?: Array<Record<string, unknown>>
    }
    if (body?.status && !VALID_RUN_STATUSES.includes(body.status as any)) {
      return reply.code(400).send({ error: `Invalid status. Valid: ${VALID_RUN_STATUSES.join(', ')}` })
    }
    try {
      const run = updateAgentRun(runId, {
        status: body?.status as any,
        contextSnapshot: body?.contextSnapshot,
        artifacts: body?.artifacts,
      })
      if (!run) return reply.code(404).send({ error: 'Run not found' })

      // canvas_artifact(type=run) on agent run completion
      const terminalStatuses = ['completed', 'failed', 'cancelled']
      if (body?.status && terminalStatuses.includes(body.status)) {
        const completedAt = Date.now()
        const durationMs = run.startedAt ? completedAt - run.startedAt : null
        eventBus.emit({
          id: `artifact-run-${completedAt}-${runId.slice(-6)}`,
          type: 'canvas_artifact' as const,
          timestamp: completedAt,
          data: {
            type: 'run' as const,
            agentId: request.params.agentId,
            title: run.objective?.slice(0, 80) ?? `Run ${body.status}`,
            runId,
            status: body.status,
            durationMs,
            exitCode: run.artifacts?.find((a: any) => a.exitCode !== undefined)?.exitCode ?? null,
            timestamp: completedAt,
          },
        })
      }

      return run
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // List agent runs
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/runs', async (request, reply) => {
    const { agentId } = request.params
    const query = request.query as { status?: string; teamId?: string; limit?: string; include_archived?: string }
    const teamId = query.teamId ?? 'default'
    const limit = query.limit ? parseInt(query.limit, 10) : undefined
    const includeArchived = query.include_archived === 'true'
    return listAgentRuns(agentId, teamId, { status: query.status as any, limit, includeArchived })
  })

  // Get active run for an agent
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/runs/current', async (request, reply) => {
    const { agentId } = request.params
    const query = request.query as { teamId?: string }
    const teamId = query.teamId ?? 'default'
    const run = getActiveAgentRun(agentId, teamId)
    if (!run) return reply.code(404).send({ error: 'No active run' })
    return run
  })

  // GET /agents/:agentId/runs/current/pending-reviews
  // Returns all review_requested events for the agent that have no matching review_approved/rejected.
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/runs/current/pending-reviews', async (request, reply) => {
    const { agentId } = request.params
    const query = request.query as { limit?: string }
    const { listPendingApprovals } = await import('./agent-runs.js')
    const limit = query.limit ? parseInt(query.limit, 10) : undefined
    const pending = listPendingApprovals({ agentId, limit })
    return { agentId, pending }
  })

  // Append an event
  const { validateRoutingSemantics } = await import('./agent-runs.js')

  // GET /events/routing/validate — check if a payload passes routing semantics
  app.post('/events/routing/validate', async (request) => {
    const body = request.body as { eventType?: string; payload?: Record<string, unknown> }
    if (!body?.eventType) return { valid: false, errors: ['eventType is required'], warnings: [] }
    return validateRoutingSemantics(body.eventType, body.payload ?? {})
  })

  app.post<{ Params: { agentId: string } }>('/agents/:agentId/events', async (request, reply) => {
    const { agentId } = request.params
    // Note: `enforceRouting` is intentionally excluded from the accepted body — API layer always enforces.
    const body = request.body as { eventType?: string; runId?: string; payload?: Record<string, unknown> }
    if (!body?.eventType) return reply.code(400).send({ error: 'eventType is required' })
    try {
      const event = appendAgentEvent({
        agentId,
        runId: body.runId,
        eventType: body.eventType,
        payload: body.payload,
        enforceRouting: true,  // always enforce at API boundary — callers cannot bypass
      })
      return reply.code(201).send(event)
    } catch (err: any) {
      const message = String(err?.message || err)
      if (message.includes('Routing semantics violation')) {
        return reply.code(422).send({
          error: message,
          hint: 'Routing payload requires action_required (review|unblock|approve|fyi) and urgency (blocking|normal|low). Optional: owner, expires_at.',
        })
      }
      if (message.includes('rationale')) {
        return reply.code(400).send({ error: message })
      }
      return reply.code(500).send({ error: message })
    }
  })

  // POST /runs/:runId/events — post an event to a run by runId (without requiring agentId).
  // Routing semantics are always enforced at this boundary; callers cannot opt out.
  app.post<{ Params: { runId: string } }>('/runs/:runId/events', async (request, reply) => {
    const { runId } = request.params
    const body = request.body as { eventType?: string; payload?: Record<string, unknown> }
    if (!body?.eventType) return reply.code(400).send({ error: 'eventType is required' })

    const run = getAgentRun(runId)
    if (!run) return reply.code(404).send({ error: `Run not found: ${runId}` })

    try {
      const event = appendAgentEvent({
        agentId: run.agentId,
        runId,
        eventType: body.eventType,
        payload: body.payload,
        enforceRouting: true,  // always enforce at API boundary
      })
      return reply.code(201).send(event)
    } catch (err: any) {
      const message = String(err?.message || err)
      if (message.includes('Routing semantics violation')) {
        return reply.code(422).send({
          error: message,
          hint: 'Routing payload requires action_required (review|unblock|approve|fyi) and urgency (blocking|normal|low). Optional: owner, expires_at.',
        })
      }
      if (message.includes('rationale')) {
        return reply.code(400).send({ error: message })
      }
      return reply.code(500).send({ error: message })
    }
  })

  // List agent events
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/events', async (request, reply) => {
    const { agentId } = request.params
    const query = request.query as { runId?: string; type?: string; since?: string; limit?: string }
    return listAgentEvents({
      agentId,
      runId: query.runId,
      eventType: query.type,
      since: query.since ? parseInt(query.since, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    })
  })

  // ── Run Event Stream (SSE) ─────────────────────────────────────────────
  // Real-time SSE stream for run events. Canvas subscribes here instead of polling.
  // GET /agents/:agentId/runs/:runId/stream — stream events for a specific run
  // GET /agents/:agentId/stream — stream all events for an agent

  app.get<{ Params: { agentId: string; runId: string } }>('/agents/:agentId/runs/:runId/stream', async (request, reply) => {
    const { agentId, runId } = request.params
    const run = getAgentRun(runId)
    if (!run) { reply.code(404); return { error: 'Run not found' } }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Support Last-Event-ID for reconnection
    const lastEventId = request.headers['last-event-id'] as string | undefined
    const lastEventTs = lastEventId ? parseInt(lastEventId, 10) : 0

    if (lastEventTs > 0) {
      // Reconnect: replay missed events
      const missedEvents = listAgentEvents({ runId, limit: 100 })
        .filter(e => (e as any).timestamp > lastEventTs)
      for (const e of missedEvents) {
        const id = (e as any).timestamp || Date.now()
        reply.raw.write(`id: ${id}\nevent: replay\ndata: ${JSON.stringify(e)}\n\n`)
      }
    } else {
      // Send current run state as initial snapshot
      const snapshotId = Date.now()
      reply.raw.write(`id: ${snapshotId}\nevent: snapshot\ndata: ${JSON.stringify({ run, events: listAgentEvents({ runId, limit: 20 }) })}\n\n`)
    }

    // Subscribe to eventBus for this run's events
    const listenerId = `run-stream-${runId}-${Date.now()}`
    let closed = false
    let eventSeq = Date.now()

    eventBus.on(listenerId, (event) => {
      if (closed) return
      const data = event.data as Record<string, unknown> | undefined
      // Forward events that match this agent or run
      if (data && (data.runId === runId || data.agentId === agentId)) {
        try {
          eventSeq = Date.now()
          reply.raw.write(`id: ${eventSeq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        } catch { /* connection closed */ }
      }
    })

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (closed) { clearInterval(heartbeat); return }
      try { reply.raw.write(`:heartbeat\n\n`) } catch { clearInterval(heartbeat) }
    }, 15_000)

    // Cleanup
    request.raw.on('close', () => {
      closed = true
      eventBus.off(listenerId)
      clearInterval(heartbeat)
    })
  })

  // Stream all events for an agent
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/stream', async (request, reply) => {
    const { agentId } = request.params

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Send recent events as snapshot
    const recentEvents = listAgentEvents({ agentId, limit: 20 })
    const activeRun = getActiveAgentRun(agentId, 'default')
    reply.raw.write(`event: snapshot\ndata: ${JSON.stringify({ activeRun, events: recentEvents })}\n\n`)

    const listenerId = `agent-stream-${agentId}-${Date.now()}`
    let closed = false

    eventBus.on(listenerId, (event) => {
      if (closed) return
      const data = event.data as Record<string, unknown> | undefined
      if (data && data.agentId === agentId) {
        try {
          reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        } catch { /* connection closed */ }
      }
    })

    const heartbeat = setInterval(() => {
      if (closed) { clearInterval(heartbeat); return }
      try { reply.raw.write(`:heartbeat\n\n`) } catch { clearInterval(heartbeat) }
    }, 15_000)

    request.raw.on('close', () => {
      closed = true
      eventBus.off(listenerId)
      clearInterval(heartbeat)
    })
  })

  // ── Run Stream (by run ID only) ──────────────────────────────────────
  // GET /runs/:runId/stream — SSE stream for a run without requiring agentId.
  // Cloud Presence surface subscribes here to show live run activity.
  // Supports Last-Event-ID for reconnection: on reconnect, replays missed events.
  app.get<{ Params: { runId: string } }>('/runs/:runId/stream', async (request, reply) => {
    const { runId } = request.params
    const run = getAgentRun(runId)
    if (!run) { reply.code(404); return { error: 'Run not found' } }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    // Support Last-Event-ID for reconnection
    const lastEventId = request.headers['last-event-id'] as string | undefined
    const lastEventTs = lastEventId ? parseInt(lastEventId, 10) : 0

    if (lastEventTs > 0) {
      // Reconnect: replay events since last received
      const missedEvents = listAgentEvents({ runId, limit: 100 })
        .filter(e => (e as any).timestamp > lastEventTs)
      for (const e of missedEvents) {
        const id = (e as any).timestamp || Date.now()
        reply.raw.write(`id: ${id}\nevent: replay\ndata: ${JSON.stringify(e)}\n\n`)
      }
    } else {
      // Initial snapshot: run state + recent events
      const snapshotId = Date.now()
      reply.raw.write(`id: ${snapshotId}\nevent: snapshot\ndata: ${JSON.stringify({ run, events: listAgentEvents({ runId, limit: 20 }) })}\n\n`)
    }

    const listenerId = `run-direct-stream-${runId}-${Date.now()}`
    let closed = false
    let eventSeq = Date.now()

    eventBus.on(listenerId, (event) => {
      if (closed) return
      const data = event.data as Record<string, unknown> | undefined
      if (data && (data.runId === runId || data.agentId === run.agentId)) {
        try {
          eventSeq = Date.now()
          reply.raw.write(`id: ${eventSeq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        } catch { /* connection closed */ }
      }
    })

    const heartbeat = setInterval(() => {
      if (closed) { clearInterval(heartbeat); return }
      try { reply.raw.write(`:heartbeat\n\n`) } catch { clearInterval(heartbeat) }
    }, 15_000)

    request.raw.on('close', () => {
      closed = true
      eventBus.off(listenerId)
      clearInterval(heartbeat)
    })
  })

  // ── Workflow Templates ─────────────────────────────────────────────────

  const { listWorkflowTemplates, getWorkflowTemplate, runWorkflow } = await import('./workflow-templates.js')

  // GET /workflows — list available workflow templates
  app.get('/workflows', async () => ({ templates: listWorkflowTemplates() }))

  // GET /workflows/:id — get template details
  app.get<{ Params: { id: string } }>('/workflows/:id', async (request, reply) => {
    const template = getWorkflowTemplate(request.params.id)
    if (!template) { reply.code(404); return { error: 'Template not found' } }
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      steps: template.steps.map(s => ({ name: s.name, description: s.description })),
    }
  })

  // POST /workflows/:id/run — execute a workflow
  app.post<{ Params: { id: string } }>('/workflows/:id/run', async (request, reply) => {
    const template = getWorkflowTemplate(request.params.id)
    if (!template) { reply.code(404); return { error: 'Template not found' } }
    const body = request.body as {
      agentId?: string; teamId?: string; objective?: string; taskId?: string
      reviewer?: string; prUrl?: string; title?: string; urgency?: string
      nextOwner?: string; summary?: string
    } ?? {}
    const agentId = body.agentId ?? getAgentRoles()[0]?.name ?? 'system'
    const teamId = body.teamId ?? 'default'
    const result = await runWorkflow(template, agentId, teamId, body)
    return result
  })

  // POST /workflows/pr-review-demo — canonical runnable regression workflow
  // Happy path: create task (if missing) → run template → return run + recent events.
  app.post('/workflows/pr-review-demo', async (request, reply) => {
    const body = request.body as {
      agentId?: string
      reviewer?: string
      teamId?: string
      taskId?: string
      prUrl?: string
      objective?: string
      title?: string
      urgency?: string
      nextOwner?: string
      summary?: string
    } ?? {}

    const template = getWorkflowTemplate('pr-review')
    if (!template) {
      reply.code(500)
      return { error: 'Workflow template "pr-review" is not registered' }
    }

    const roles = getAgentRoles()
    const agentId = body.agentId ?? roles[0]?.name ?? 'system'
    const reviewer = body.reviewer ?? roles[1]?.name ?? roles[0]?.name ?? 'system'
    const teamId = body.teamId ?? 'default'

    let taskId = body.taskId
    let createdTaskId: string | undefined

    if (!taskId) {
      const demoTask = await taskManager.createTask({
        title: body.title ?? `Workflow demo: PR review handoff (${new Date().toISOString()})`,
        description: 'Auto-generated demo task for /workflows/pr-review-demo regression path.',
        status: 'doing',
        assignee: agentId,
        reviewer,
        done_criteria: [
          'Workflow run is created and attached to this task.',
          'Review request + approval + handoff events are emitted.',
          'Run reaches completed state with no failed steps.',
        ],
        createdBy: 'system',
        priority: 'P2',
        metadata: {
          eta: '5m',
          lane: 'workflow',
          source: 'workflow-regression',
          reflection_exempt: true,
          reflection_exempt_reason: 'Synthetic regression task for workflow endpoint verification',
        },
      })
      taskId = demoTask.id
      createdTaskId = demoTask.id
    }

    const result = await runWorkflow(template, agentId, teamId, {
      ...body,
      reviewer,
      teamId,
      taskId,
      objective: body.objective ?? 'Canonical PR review workflow regression run',
      title: body.title ?? 'PR review demo run',
      urgency: body.urgency ?? 'normal',
      nextOwner: body.nextOwner ?? reviewer,
      summary: body.summary ?? 'Regression demo completed via /workflows/pr-review-demo',
      prUrl: body.prUrl ?? 'https://github.com/reflectt/reflectt-node/pull/0',
    })

    const run = result.runId ? getAgentRun(result.runId) : null
    const events = result.runId ? listAgentEvents({ runId: result.runId, limit: 30 }) : []

    return {
      success: result.success,
      workflow: 'pr-review-demo',
      template: template.id,
      taskId,
      createdTaskId,
      run,
      result,
      eventCount: events.length,
      events,
      regression: {
        endpoint: '/workflows/pr-review-demo',
        createdTask: Boolean(createdTaskId),
        completed: run?.status === 'completed',
      },
    }
  })

  // ── Agent Messaging (Host-native) ─────────────────────────────────────
  // Local agent-to-agent messaging. Replaces gateway for same-Host agents.

  const { sendAgentMessage, listAgentMessages, listSentMessages, markMessagesRead, getUnreadCount, listChannelMessages } = await import('./agent-messaging.js')

  // Send message
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/messages/send', async (request, reply) => {
    const { agentId } = request.params
    const body = request.body as { to?: string; channel?: string; content?: string; metadata?: Record<string, unknown> }
    if (!body?.to) return reply.code(400).send({ error: 'to (recipient agent) is required' })
    if (!body?.content) return reply.code(400).send({ error: 'content is required' })
    const msg = sendAgentMessage({
      fromAgent: agentId,
      toAgent: body.to,
      channel: body.channel,
      content: body.content,
      metadata: body.metadata,
    })
    // Emit event for SSE subscribers
    eventBus.emit({
      id: `amsg-evt-${Date.now()}`,
      type: 'message_posted' as const,
      timestamp: Date.now(),
      data: { messageId: msg.id, from: agentId, to: body.to, channel: msg.channel },
    })
    return reply.code(201).send(msg)
  })

  // Inbox
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/messages', async (request) => {
    const { agentId } = request.params
    const query = request.query as { channel?: string; unread?: string; since?: string; limit?: string }
    return {
      messages: listAgentMessages({
        agentId,
        channel: query.channel,
        unreadOnly: query.unread === 'true',
        since: query.since ? parseInt(query.since, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      }),
      unreadCount: getUnreadCount(agentId),
    }
  })

  // Sent
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/messages/sent', async (request) => {
    const { agentId } = request.params
    const query = request.query as { limit?: string }
    return { messages: listSentMessages(agentId, query.limit ? parseInt(query.limit, 10) : undefined) }
  })

  // Mark read
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/messages/read', async (request) => {
    const { agentId } = request.params
    const body = request.body as { messageIds?: string[] } ?? {}
    const marked = markMessagesRead(agentId, body.messageIds)
    return { marked }
  })

  // Channel messages
  app.get('/messages/channel/:channel', async (request) => {
    const { channel } = request.params as { channel: string }
    const query = request.query as { since?: string; limit?: string }
    return {
      messages: listChannelMessages(channel, {
        since: query.since ? parseInt(query.since, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      }),
    }  })
  // ── Run Retention / Archive ────────────────────────────────────────────

  const { applyRunRetention, getRetentionStats } = await import('./agent-runs.js')

  // Schedule daily run retention archival using the configured TTL
  const runRetentionIntervalMs = 24 * 60 * 60 * 1000 // 24 hours
  const runRetentionTimer = setInterval(() => {
    try {
      applyRunRetention({ policy: { maxAgeDays: serverConfig.runRetentionDays } })
    } catch { /* non-fatal */ }
  }, runRetentionIntervalMs)
  runRetentionTimer.unref()
  // Run once at startup to archive any stale runs immediately
  try { applyRunRetention({ policy: { maxAgeDays: serverConfig.runRetentionDays } }) } catch { /* non-fatal */ }

  // Schedule daily webhook payload purge — removes stored payloads older than 90 days.
  // ── Stale candidate reconciler scheduler ──
  // Runs at startup (after 90s) + every 4 hours. Dry-run unless REFLECTT_AUTO_RECONCILE_CANDIDATES=true.
  ;(async () => {
    function doStaleCandidateSweep() {
      try {
        const result = runStaleCandidateReconcileSweep({
          dryRun: process.env.REFLECTT_AUTO_RECONCILE_CANDIDATES !== 'true',
          actor: 'stale-candidate-reconciler-scheduler',
        })
        if (result.eligible > 0 || result.closed > 0) {
          const mode = result.dryRun ? '[dry-run]' : '[live]'
          console.log(
            `[stale-candidate-reconciler] ${mode} swept=${result.swept} eligible=${result.eligible} ` +
            `closed=${result.closed} blocked=${result.blocked} (${result.durationMs}ms)`,
          )
        }
      } catch (err) {
        console.warn('[stale-candidate-reconciler] Sweep error:', err)
      }
    }
    const scStartupTimer = setTimeout(doStaleCandidateSweep, 90_000)
    scStartupTimer.unref()
    const scTimer = setInterval(doStaleCandidateSweep, 4 * 60 * 60 * 1000)
    scTimer.unref()
  })().catch(() => { /* never fail startup */ })

  // Dynamic import mirrors the best-effort pattern from the inbound webhook handler (PR #926 caveat resolved).
  // ── PR-link reconciler: stamp canonical refs on validating tasks with merged PRs ──
  // Runs at startup + every 30 minutes. Best-effort, never blocks startup.
  ;(async () => {
    const PR_RECONCILE_INTERVAL_MS = 30 * 60 * 1000 // 30 min

    function doReconcileSweep() {
      try {
        const result = runPrLinkReconcileSweep({
          getValidatingTasks: () => taskManager.listTasks({ status: 'validating' }),
          patchTaskMetadata: (taskId, patch) => taskManager.patchTaskMetadata(taskId, patch),
        })
        if (result.stamped > 0) {
          console.log(`[pr-link-reconciler] Swept ${result.swept} validating tasks: ${result.stamped} stamped, ${result.errors} errors (${result.durationMs}ms)`)
        }
      } catch (err) {
        console.warn('[pr-link-reconciler] Sweep error:', err)
      }
    }

    // Startup pass after 60s (let server settle first)
    const startupTimer = setTimeout(doReconcileSweep, 60_000)
    startupTimer.unref()

    // Recurring sweep
    const reconcileTimer = setInterval(doReconcileSweep, PR_RECONCILE_INTERVAL_MS)
    reconcileTimer.unref()
  })().catch(() => { /* never fail startup */ })

  const WEBHOOK_PAYLOAD_RETENTION_DAYS = 90
  ;(async () => {
    try {
      const { purgeOldPayloads } = await import('./webhook-storage.js')
      // Run at startup
      try { purgeOldPayloads(WEBHOOK_PAYLOAD_RETENTION_DAYS) } catch { /* non-fatal */ }
      // Then daily
      const webhookPurgeTimer = setInterval(() => {
        try { purgeOldPayloads(WEBHOOK_PAYLOAD_RETENTION_DAYS) } catch { /* non-fatal */ }
      }, 24 * 60 * 60 * 1000)
      webhookPurgeTimer.unref()
    } catch { /* webhook-storage not available — skip */ }
  })().catch(() => { /* outer non-fatal */ })

  // GET /runs/retention/stats — preview what retention policy would do
  app.get('/runs/retention/stats', async (request) => {
    const query = request.query as { maxAgeDays?: string; maxCompletedRuns?: string }
    return getRetentionStats({
      maxAgeDays: query.maxAgeDays ? parseInt(query.maxAgeDays, 10) : undefined,
      maxCompletedRuns: query.maxCompletedRuns ? parseInt(query.maxCompletedRuns, 10) : undefined,
    })
  })

  // POST /runs/retention/apply — apply retention policy
  app.post('/runs/retention/apply', async (request) => {
    const body = request.body as {
      maxAgeDays?: number
      maxCompletedRuns?: number
      deleteArchived?: boolean
      agentId?: string
      dryRun?: boolean
    } ?? {}
    return applyRunRetention({
      policy: {
        maxAgeDays: body.maxAgeDays,
        maxCompletedRuns: body.maxCompletedRuns,
        deleteArchived: body.deleteArchived,
      },
      agentId: body.agentId,
      dryRun: body.dryRun,
    })  })
  // ── Presence Narrator ──────────────────────────────────────────────────
  // Posts first-person status narrations to chat every 5 min (±60s jitter)
  // for agents with active doing tasks, following echo's constraint pack.
  const { startPresenceNarrator } = await import('./presence-narrator.js')
  const narratorAgentIds = getAgentRoles().map(r => r.name).filter(Boolean)
  const stopNarrator = startPresenceNarrator(narratorAgentIds, taskManager)
  app.addHook('onClose', async () => { stopNarrator() })

  // ── Artifact Store (Host-native) ──────────────────────────────────────
  const { storeArtifact, getArtifact, readArtifactContent, listArtifacts, deleteArtifact, getStorageUsage } = await import('./artifact-store.js')

  // Upload artifact
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/artifacts', async (request, reply) => {
    const { agentId } = request.params
    const body = request.body as { name?: string; content?: string; mimeType?: string; runId?: string; taskId?: string; metadata?: Record<string, unknown>; encoding?: string }
    if (!body?.name) return reply.code(400).send({ error: 'name is required' })
    if (!body?.content) return reply.code(400).send({ error: 'content is required' })
    const contentBuf = body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : Buffer.from(body.content)
    const art = storeArtifact({ agentId, name: body.name, content: contentBuf, mimeType: body.mimeType, runId: body.runId, taskId: body.taskId, metadata: body.metadata })
    return reply.code(201).send(art)
  })

  // List artifacts
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/artifacts', async (request) => {
    const { agentId } = request.params
    const query = request.query as { runId?: string; taskId?: string; limit?: string }
    return {
      artifacts: listArtifacts({ agentId, runId: query.runId, taskId: query.taskId, limit: query.limit ? parseInt(query.limit, 10) : undefined }),
      usage: getStorageUsage(agentId),
    }
  })

  // Get artifact metadata
  app.get('/artifacts/:artifactId', async (request, reply) => {
    const { artifactId } = request.params as { artifactId: string }
    const art = getArtifact(artifactId)
    if (!art) return reply.code(404).send({ error: 'Artifact not found' })
    return art
  })

  // Download artifact content
  app.get('/artifacts/:artifactId/content', async (request, reply) => {
    const { artifactId } = request.params as { artifactId: string }
    const content = readArtifactContent(artifactId)
    if (!content) return reply.code(404).send({ error: 'Artifact not found or file missing' })
    const art = getArtifact(artifactId)!
    return reply.type(art.mimeType).send(content)
  })

  // Delete artifact
  app.delete('/artifacts/:artifactId', async (request, reply) => {
    const { artifactId } = request.params as { artifactId: string }
    const deleted = deleteArtifact(artifactId)
    if (!deleted) return reply.code(404).send({ error: 'Artifact not found' })
    return { deleted: true }
  })

  // Storage usage
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/storage', async (request) => {
    const { agentId } = request.params
    return getStorageUsage(agentId)
  })

  // ── Webhook Storage ──────────────────────────────────────────────────
  const { storeWebhookPayload, getWebhookPayload, listWebhookPayloads, markPayloadProcessed, getUnprocessedCount, purgeOldPayloads } = await import('./webhook-storage.js')

  // Ingest webhook payload
  app.post('/webhooks/ingest', async (request, reply) => {
    const body = request.body as { source?: string; eventType?: string; agentId?: string; body?: Record<string, unknown> }
    if (!body?.source) return reply.code(400).send({ error: 'source is required' })
    if (!body?.eventType) return reply.code(400).send({ error: 'eventType is required' })
    if (!body?.body) return reply.code(400).send({ error: 'body (payload) is required' })
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === 'string') headers[k] = v
    }
    const payload = storeWebhookPayload({ source: body.source, eventType: body.eventType, agentId: body.agentId, body: body.body, headers })
    return reply.code(201).send(payload)
  })

  // List payloads
  app.get('/webhooks/payloads', async (request) => {
    const query = request.query as { source?: string; agentId?: string; unprocessed?: string; since?: string; limit?: string }
    return {
      payloads: listWebhookPayloads({
        source: query.source,
        agentId: query.agentId,
        unprocessedOnly: query.unprocessed === 'true',
        since: query.since ? parseInt(query.since, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      }),
      unprocessedCount: getUnprocessedCount({ source: query.source, agentId: query.agentId }),
    }
  })

  // Get single payload
  app.get('/webhooks/payloads/:payloadId', async (request, reply) => {
    const { payloadId } = request.params as { payloadId: string }
    const payload = getWebhookPayload(payloadId)
    if (!payload) return reply.code(404).send({ error: 'Payload not found' })
    return payload
  })

  // Mark processed
  app.post('/webhooks/payloads/:payloadId/process', async (request, reply) => {
    const { payloadId } = request.params as { payloadId: string }
    const marked = markPayloadProcessed(payloadId)
    if (!marked) return reply.code(404).send({ error: 'Payload not found or already processed' })
    return { processed: true }
  })

  // Purge old processed payloads
  app.post('/webhooks/purge', async (request) => {
    const body = request.body as { maxAgeDays?: number } ?? {}
    const deleted = purgeOldPayloads(body.maxAgeDays ?? 30)
    return { deleted }
  })

  // ── Trust Events ────────────────────────────────────────────────────────

  const { listTrustEvents } = await import('./trust-events.js')

  // GET /trust-events — list trust-collapse signals (diagnostic)
  app.get('/trust-events', async (request) => {
    const query = request.query as { agentId?: string; eventType?: string; since?: string; limit?: string }
    return listTrustEvents({
      agentId: query.agentId,
      eventType: query.eventType as any,
      since: query.since ? parseInt(query.since, 10) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
    })
  })

  // ── Approval Routing ────────────────────────────────────────────────────

  const {
    listPendingApprovals,
    listApprovalQueue,
    submitApprovalDecision,
  } = await import('./agent-runs.js')

  // List pending approvals (review_requested events needing action)
  app.get('/approvals/pending', async (request) => {
    const query = request.query as { agentId?: string; limit?: string }
    return listPendingApprovals({
      agentId: query.agentId,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    })
  })

  // Dedicated approval queue — unified view of everything needing human decision.
  // Answers: what needs decision, who owns it, when it expires, what happens if ignored.
  app.get('/approval-queue', async (request) => {
    const query = request.query as {
      agentId?: string
      category?: string
      includeExpired?: string
      limit?: string
    }
    const items = listApprovalQueue({
      agentId: query.agentId,
      category: query.category === 'review' || query.category === 'agent_action' ? query.category : undefined,
      includeExpired: query.includeExpired === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    })

    // Also surface agent-interface runs awaiting approval — they appear in the same decision card
    const pendingRuns = listPendingRuns()
    const agentInterfaceItems = pendingRuns.map(run => ({
      id: run.id,
      category: 'agent_action' as const,
      agentId: 'agent-interface',
      runId: run.id,
      title: `Agent action: ${(run.input as any).title ?? run.kind}`,
      description: `${run.kind} — ${(run.input as any).repo ?? ''}: ${(run.input as any).title ?? ''}`.trim(),
      urgency: 'normal',
      owner: 'human',
      expiresAt: run.createdAt + 10 * 60 * 1000,
      autoAction: 'reject',
      createdAt: run.createdAt,
      isExpired: Date.now() > run.createdAt + 10 * 60 * 1000,
      event: { id: run.id, event_type: 'approval_requested', payload: run.input },
    }))

    // Filter out agent-to-agent reviews — humans don't need to see these on the canvas.
    // Only show items where the reviewer is a human (not a known agent).
    const KNOWN_AGENTS_APPROVAL = new Set(getAgentRoles().map(r => r.name))

    // Check if ?humanOnly=true (default true for canvas, false for dashboard)
    const humanOnly = (request.query as Record<string, string>).humanOnly !== 'false'

    const filteredItems = humanOnly
      ? items.filter(item => {
          // agentId on the event IS the reviewer for review_requested events
          const reviewerAgent = (item.agentId ?? '').toLowerCase().trim()
          if (reviewerAgent && KNOWN_AGENTS_APPROVAL.has(reviewerAgent)) return false
          // Also check payload.reviewer if present
          const payload = item.event?.payload as Record<string, unknown> | undefined
          const payloadReviewer = (payload?.reviewer as string ?? '').toLowerCase().trim()
          if (payloadReviewer && KNOWN_AGENTS_APPROVAL.has(payloadReviewer)) return false
          return true
        })
      : items

    const allItems = [...filteredItems, ...agentInterfaceItems]
    return {
      items: allItems,
      count: allItems.length,
      hasExpired: allItems.some(i => i.isExpired),
    }
  })

  // Submit agent-action approval (approve_requested events)
  app.post<{ Params: { approvalId: string } }>('/approval-queue/:approvalId/decide', async (request, reply) => {
    const { approvalId } = request.params
    const body = request.body as { decision?: string; actor?: string; comment?: string; rationale?: { choice: string; considered: string[]; constraint: string } }
    if (!body?.decision || !['approve', 'reject', 'defer'].includes(body.decision)) {
      return reply.code(400).send({ error: 'decision must be "approve", "reject", or "defer"' })
    }
    if (!body?.actor) {
      return reply.code(400).send({ error: 'actor is required' })
    }
    try {
      // Auto-supply minimal rationale if omitted — humans approving via UI won't know to send it
      const rationale = body.rationale ?? {
        choice: `${body.decision === 'approve' ? 'Approved' : 'Rejected'} by ${body.actor}`,
        considered: ['approve', 'reject'],
        constraint: 'Human decision via approval queue',
      }
      const result = submitApprovalDecision({
        eventId: approvalId,
        decision: body.decision as 'approve' | 'reject',
        reviewer: body.actor,
        comment: body.comment,
        rationale,
      })

      // Emit canvas_input event so Presence Layer updates
      eventBus.emit({
        id: `aq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_input' as const,
        timestamp: Date.now(),
        data: {
          action: 'decision',
          approvalId,
          decision: body.decision,
          actor: body.actor,
        },
      })

      return result
    } catch (err: any) {
      return reply.code(err.message.includes('not found') ? 404 : 400).send({ error: err.message })
    }
  })

  // Submit approval decision
  app.post<{ Params: { eventId: string } }>('/approvals/:eventId/decide', async (request, reply) => {
    const { eventId } = request.params
    const body = request.body as {
      decision?: string
      reviewer?: string
      comment?: string
      rationale?: { choice?: string; considered?: string[]; constraint?: string }
    }
    if (!body?.decision || !['approve', 'reject'].includes(body.decision)) {
      return reply.code(400).send({ error: 'decision must be "approve" or "reject"' })
    }
    if (!body?.reviewer) {
      return reply.code(400).send({ error: 'reviewer is required' })
    }
    try {
      const result = submitApprovalDecision({
        eventId,
        decision: body.decision as 'approve' | 'reject',
        reviewer: body.reviewer,
        comment: body.comment,
        rationale: body.rationale as any,
      })
      return result
    } catch (err: any) {
      return reply.code(err.message.includes('not found') ? 404 : 400).send({ error: err.message })
    }
  })

  // POST /run-approvals/:eventId/decide — iOS lock screen action buttons + agent-interface approval bridge
  // Accepts approve/reject decisions from mobile clients directly.
  // Also handles agent-interface run approvals — if eventId matches a pending agent-interface run,
  // routes to approveRun/rejectRun instead of the legacy event system.
  app.post<{ Params: { eventId: string } }>('/run-approvals/:eventId/decide', async (request, reply) => {
    const { eventId } = request.params
    const body = request.body as {
      decision?: string
      actor?: string
      reason?: string
      rationale?: { choice?: string; considered?: string[]; constraint?: string }
    }
    if (!body?.decision || !['approve', 'reject'].includes(body.decision)) {
      return reply.code(400).send({ error: 'decision must be "approve" or "reject"' })
    }
    if (!body?.actor) {
      return reply.code(400).send({ error: 'actor is required' })
    }

    // Check if this is an agent-interface run approval (eventId = runId)
    const agentInterfaceRun = getRun(eventId)
    if (agentInterfaceRun) {
      if (agentInterfaceRun.status !== 'awaiting_approval') {
        return reply.code(409).send({ error: `Run is ${agentInterfaceRun.status}, not awaiting_approval` })
      }
      const ok = body.decision === 'approve' ? approveRun(eventId) : rejectRun(eventId)
      if (!ok) return reply.code(409).send({ error: 'No pending approval for this run' })
      // Emit canvas_input so Presence Layer reflects the decision
      eventBus.emit({
        id: `ai-decide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_input' as const,
        timestamp: Date.now(),
        data: { action: 'decision', approvalId: eventId, decision: body.decision, actor: body.actor },
      })
      return { success: true, runId: eventId, decision: body.decision }
    }

    try {
      const rationale = body.rationale ?? {
        choice: body.decision === 'approve' ? 'Approved' : 'Rejected',
        considered: ['approve', 'reject'],
        constraint: `Mobile decision by ${body.actor}`,
      }
      const result = submitApprovalDecision({
        eventId,
        decision: body.decision as 'approve' | 'reject',
        reviewer: body.actor,
        comment: body.reason,
        rationale: rationale as any,
      })
      // Emit canvas_input so Presence Layer reflects the decision
      eventBus.emit({
        id: `ra-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_input' as const,
        timestamp: Date.now(),
        data: {
          action: 'decision',
          approvalId: eventId,
          decision: body.decision,
          actor: body.actor,
        },
      })
      return result
    } catch (err: any) {
      return reply.code(err.message.includes('not found') ? 404 : 400).send({ error: err.message })
    }
  })

  // ── Canvas Input ──────────────────────────────────────────────────────
  // Human → agent control seam for the Presence Layer.
  // Payload is intentionally small per COO spec: action + target + actor.

  const CANVAS_INPUT_ACTIONS = ['decision', 'interrupt', 'pause', 'resume', 'mute', 'unmute', 'surface_tap', 'presence_dot_tap'] as const
  type CanvasInputAction = typeof CANVAS_INPUT_ACTIONS[number]

  const SURFACE_TAP_ZONES = ['floor_trigger', 'presence_dot', 'decision_card'] as const

  // canvas_input.v1 schema per design/interface-os-v0-multimodal-input.html
  // Also accepts legacy field `type` as alias for `action` (render-protocol uses `type`)
  const CanvasInputSchema = z.object({
    // `action` is canonical; `type` accepted as alias for canvas_input.v1 compatibility
    action: z.enum(CANVAS_INPUT_ACTIONS).optional(),
    type: z.enum(CANVAS_INPUT_ACTIONS).optional(),
    schema: z.literal('canvas_input.v1').optional(),
    zone: z.enum(SURFACE_TAP_ZONES).optional(),  // surface_tap zone
    targetRunId: z.string().optional(),            // which run to act on
    decisionId: z.string().optional(),             // for decision actions
    choice: z.enum(['approve', 'deny', 'defer']).optional(),  // for decision actions
    actor: z.string().optional(),                  // who made this input (optional for surface events)
    comment: z.string().optional(),               // optional rationale
  }).refine(d => d.action || d.type, { message: 'action or type is required' })

  app.post('/canvas/input', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const result = CanvasInputSchema.safeParse(body)
    if (!result.success) {
      reply.code(422)
      return {
        error: `Invalid canvas input: ${result.error.issues.map(i => i.message).join(', ')}`,
        hint: 'Required: action or type (decision|interrupt|pause|resume|mute|unmute|surface_tap|presence_dot_tap). Optional: actor, zone, targetRunId, decisionId, choice, comment.',
      }
    }

    const input = result.data
    const now = Date.now()

    // Normalize: accept `type` as alias for `action` (canvas_input.v1 compat)
    const action: CanvasInputAction = (input.action ?? input.type) as CanvasInputAction

    // Route surface signals — surface_tap and presence_dot_tap
    // These are UI receptivity signals from the canvas surface, not agent-control actions.
    if (action === 'surface_tap' || action === 'presence_dot_tap') {
      eventBus.emit({
        id: `cinput-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_input' as const,
        timestamp: now,
        data: {
          action,
          zone: input.zone ?? null,
          actor: input.actor ?? 'human',
          timestamp: now,
        },
      })
      return { success: true, action, zone: input.zone ?? null, timestamp: now }
    }

    // Route by action type
    if (action === 'decision') {
      if (!input.decisionId || !input.choice) {
        reply.code(422)
        return { error: 'Decision action requires decisionId and choice (approve|deny|defer)' }
      }

      // Emit canvas_input event for SSE subscribers
      eventBus.emit({ id: `cinput-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, type: "canvas_input" as const, timestamp: Date.now(), data: {
        action,
        decisionId: input.decisionId,
        choice: input.choice,
        actor: input.actor,
        comment: input.comment,
        timestamp: now,
      } })

      return {
        success: true,
        action: 'decision',
        decisionId: input.decisionId,
        choice: input.choice,
        actor: input.actor,
        timestamp: now,
      }
    }

    if (action === 'interrupt' || action === 'pause') {
      // Update active run if specified
      const runId = input.targetRunId
      if (runId) {
        try {
          updateAgentRun(runId, {
            status: action === 'interrupt' ? 'cancelled' : 'blocked',
          })
        } catch { /* run may not exist — still emit event */ }
      }

      eventBus.emit({ id: `cinput-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, type: "canvas_input" as const, timestamp: Date.now(), data: {
        action,
        targetRunId: runId || null,
        actor: input.actor,
        timestamp: now,
      } })

      return {
        success: true,
        action,
        targetRunId: runId || null,
        actor: input.actor,
        timestamp: now,
      }
    }

    if (action === 'resume') {
      const runId = input.targetRunId
      if (runId) {
        try {
          updateAgentRun(runId, { status: 'working' })
        } catch { /* run may not exist */ }
      }

      eventBus.emit({ id: `cinput-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, type: "canvas_input" as const, timestamp: Date.now(), data: {
        action: 'resume',
        targetRunId: runId || null,
        actor: input.actor,
        timestamp: now,
      } })

      return { success: true, action: 'resume', targetRunId: runId || null, actor: input.actor, timestamp: now }
    }

    // Mute/unmute — emit event only, no state change needed
    eventBus.emit({ id: `cinput-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, type: "canvas_input" as const, timestamp: Date.now(), data: {
      action,
      actor: input.actor,
      timestamp: now,
    } })

    return { success: true, action, actor: input.actor, timestamp: now }
  })

  // GET /canvas/input/schema — discovery endpoint
  app.get('/canvas/input/schema', async () => ({
    actions: CANVAS_INPUT_ACTIONS,
    schema: {
      action: 'decision | interrupt | pause | resume | mute | unmute',
      targetRunId: 'optional — which run to act on',
      decisionId: 'required for decision action — approval event ID',
      choice: 'required for decision — approve | deny | defer',
      actor: 'required — who made this input',
      comment: 'optional — rationale',
    },
  }))

  // ── Email / SMS relay ──────────────────────────────────────────────────

  async function cloudRelay(
    path: string,
    body: Record<string, unknown>,
    reply: { code: (n: number) => typeof reply; send: (b: unknown) => void },
    method: 'GET' | 'POST' = 'POST',
  ): Promise<unknown> {
    const cloudUrl = process.env.REFLECTT_CLOUD_URL
    const hostToken = process.env.REFLECTT_HOST_TOKEN || process.env.REFLECTT_HOST_CREDENTIAL
    if (!cloudUrl || !hostToken) {
      reply.code(503)
      return { error: 'Not connected to cloud. Configure REFLECTT_CLOUD_URL and REFLECTT_HOST_TOKEN.' }
    }
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${hostToken}` }
      const options: RequestInit = {}
      if (method === 'POST') {
        options.method = 'POST'
        headers['Content-Type'] = 'application/json'
        options.body = JSON.stringify(body)
      }
      options.headers = headers
      const res = await fetch(`${cloudUrl}${path}`, options)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        reply.code(res.status)
        return data
      }
      return data
    } catch (err: any) {
      reply.code(502)
      return { error: `Cloud relay failed: ${err.message}` }
    }
  }

  // Send email via cloud relay
  app.post('/email/send', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const from = typeof body.from === 'string' ? body.from.trim() : ''
    const to = body.to
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    if (!from) return reply.code(400).send({ error: 'from is required' })
    if (!to) return reply.code(400).send({ error: 'to is required' })
    if (!subject) return reply.code(400).send({ error: 'subject is required' })
    if (!body.html && !body.text) return reply.code(400).send({ error: 'html or text body is required' })

    // Use host-relay endpoint — authenticates with host credential, uses host's own teamId server-side
    const hostId = process.env.REFLECTT_HOST_ID
    const relayPath = hostId ? `/api/hosts/${encodeURIComponent(hostId)}/relay/email` : '/api/hosts/relay/email'
    return cloudRelay(relayPath, {
      from,
      to,
      subject,
      html: body.html,
      text: body.text,
      replyTo: body.replyTo,
      cc: body.cc,
      bcc: body.bcc,
      agent: body.agentId || body.agent || 'unknown',
    }, reply)
  })

  // Retrieve raw inbound email payload by ID (alias for /webhooks/payloads/:id filtered to email sources)
  app.get<{ Params: { emailId: string } }>('/email/inbound/:emailId', async (request, reply) => {
    const { emailId } = request.params
    const payload = getWebhookPayload(emailId)
    if (!payload) return reply.code(404).send({ error: 'Inbound email payload not found' })
    if (!['resend', 'email', 'sendgrid', 'mailgun'].includes(payload.source)) {
      return reply.code(404).send({ error: 'Inbound email payload not found' })
    }
    return payload
  })

  // Send SMS via cloud relay
  app.post('/sms/send', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const to = typeof body.to === 'string' ? body.to.trim() : ''
    const msgBody = typeof body.body === 'string' ? body.body.trim() : ''
    if (!to) return reply.code(400).send({ error: 'to is required (phone number)' })
    if (!msgBody) return reply.code(400).send({ error: 'body is required' })

    const hostIdSms = process.env.REFLECTT_HOST_ID
    const smsRelayPath = hostIdSms ? `/api/hosts/${encodeURIComponent(hostIdSms)}/relay/sms` : '/api/hosts/relay/sms'
    return cloudRelay(smsRelayPath, {
      to,
      body: msgBody,
      from: body.from,
      agent: body.agentId || body.agent || 'unknown',
    }, reply)
  })

  // ── Web Search (node-managed, direct API call) ─────────────────────────
  // Agents call POST /search to query the web. The node calls Serper, Brave,
  // or Tavily directly using a locally-configured API key (whichever is set).

  app.post('/search', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    if (!query) return reply.code(400).send({ error: 'query is required' })
    const limit = typeof body.limit === 'number' ? body.limit : 10

    try {
      const { search: webSearch } = await import('./capabilities/search.js')
      const result = await webSearch(query, limit)
      return result
    } catch (err: any) {
      const msg: string = err?.message ?? 'search failed'
      if (msg.includes('No search API key')) {
        return reply.code(503).send({ error: msg, hint: 'Set SERPER_API_KEY, BRAVE_SEARCH_API_KEY, or TAVILY_API_KEY on this node.' })
      }
      return reply.code(502).send({ error: msg })
    }
  })

  // ── Managed Browser Sessions (cloud relay via host credential) ─────────
  // Proxies to the cloud API's managed browser session stack using host auth.
  // Allows agents to use cloud-stored auth profiles (e.g., @ReflecttAI X session)
  // without needing Supabase JWT — uses host credential auth instead.

  // GET /browser/managed/sessions — list managed sessions
  app.get('/browser/managed/sessions', async (request, reply) => {
    const query = request.query as Record<string, string>
    const hostId = process.env.REFLECTT_HOST_ID
    const relayPath = hostId
      ? `/api/hosts/${encodeURIComponent(hostId)}/relay/browser/sessions`
      : '/api/hosts/relay/browser/sessions'
    const params = new URLSearchParams()
    if (query.status) params.set('status', query.status)
    if (query.limit) params.set('limit', query.limit)
    if (query.offset) params.set('offset', query.offset)
    const qs = params.toString()
    return cloudRelay(`${relayPath}${qs ? `?${qs}` : ''}`, {}, reply, 'GET')
  })

  // POST /browser/managed/sessions — create a managed session
  app.post('/browser/managed/sessions', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const hostId = process.env.REFLECTT_HOST_ID
    const relayPath = hostId
      ? `/api/hosts/${encodeURIComponent(hostId)}/relay/browser/sessions`
      : '/api/hosts/relay/browser/sessions'
    return cloudRelay(relayPath, {
      ...body,
      agent: body.agentId || body.agent || 'unknown',
    }, reply)
  })

  // POST /browser/managed/sessions/:sessionId/runs — execute actions in a managed session
  app.post<{ Params: { sessionId: string } }>('/browser/managed/sessions/:sessionId/runs', async (request, reply) => {
    const { sessionId } = request.params
    const body = request.body as Record<string, unknown>
    const hostId = process.env.REFLECTT_HOST_ID
    const relayPath = hostId
      ? `/api/hosts/${encodeURIComponent(hostId)}/relay/browser/sessions/${encodeURIComponent(sessionId)}/runs`
      : `/api/hosts/relay/browser/sessions/${encodeURIComponent(sessionId)}/runs`
    return cloudRelay(relayPath, {
      ...body,
      agent: body.agentId || body.agent || 'unknown',
    }, reply)
  })

  // ── Agent Config ──────────────────────────────────────────────────────
  // Per-agent model preference, cost cap, and settings.
  // This is the policy anchor for cost enforcement.

  const { getAgentConfig, listAgentConfigs, setAgentConfig, deleteAgentConfig, checkCostCap } = await import('./agent-config.js')

  // GET /agents/:agentId/config — get config for an agent
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/config', async (request) => {
    const config = getAgentConfig(request.params.agentId)
    return config ?? { agentId: request.params.agentId, configured: false }
  })

  // PUT /agents/:agentId/config — upsert config for an agent
  app.put<{ Params: { agentId: string } }>('/agents/:agentId/config', async (request, reply) => {
    const body = request.body as Record<string, unknown> ?? {}
    try {
      const config = setAgentConfig(request.params.agentId, {
        teamId: typeof body.teamId === 'string' ? body.teamId : undefined,
        model: body.model !== undefined ? (body.model as string | null) : undefined,
        fallbackModel: body.fallbackModel !== undefined ? (body.fallbackModel as string | null) : undefined,
        costCapDaily: body.costCapDaily !== undefined ? (body.costCapDaily as number | null) : undefined,
        costCapMonthly: body.costCapMonthly !== undefined ? (body.costCapMonthly as number | null) : undefined,
        maxTokensPerCall: body.maxTokensPerCall !== undefined ? (body.maxTokensPerCall as number | null) : undefined,
        settings: body.settings !== undefined ? (body.settings as Record<string, unknown>) : undefined,
      })
      return config
    } catch (err: any) {
      reply.code(400)
      return { error: err.message }
    }
  })

  // DELETE /agents/:agentId/config — remove config for an agent
  app.delete<{ Params: { agentId: string } }>('/agents/:agentId/config', async (request, reply) => {
    const deleted = deleteAgentConfig(request.params.agentId)
    if (!deleted) { reply.code(404); return { error: 'Config not found' } }
    return { success: true }
  })

  // GET /agent-configs — list all agent configs
  app.get('/agent-configs', async (request) => {
    const query = request.query as { teamId?: string }
    return { configs: listAgentConfigs({ teamId: query.teamId }) }
  })

  // GET /agents/:agentId/cost-check — runtime cost enforcement check
  // Used by the runtime before making model calls.
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/cost-check', async (request) => {
    const query = request.query as { dailySpend?: string; monthlySpend?: string }
    const dailySpend = query.dailySpend ? parseFloat(query.dailySpend) : 0
    const monthlySpend = query.monthlySpend ? parseFloat(query.monthlySpend) : 0
    return checkCostCap(request.params.agentId, dailySpend, monthlySpend)
  })

  // ── Cost-Policy Enforcement Middleware ──────────────────────────────────

  const {
    enforcePolicy,
    recordUsage,
    getDailySpend,
    getMonthlySpend,
    purgeUsageLog,
    ensureUsageLogTable,
  } = await import('./cost-enforcement.js')

  ensureUsageLogTable()

  // POST /agents/:agentId/enforce-cost — runtime enforcement before model calls
  app.post<{ Params: { agentId: string } }>('/agents/:agentId/enforce-cost', async (request, reply) => {
    const result = enforcePolicy(request.params.agentId)
    const status = result.action === 'deny' ? 403 : 200
    return reply.code(status).send(result)
  })

  // GET /agents/:agentId/spend — current daily + monthly spend
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/spend', async (request) => {
    const { agentId } = request.params
    return {
      agentId,
      dailySpend: getDailySpend(agentId),
      monthlySpend: getMonthlySpend(agentId),
    }
  })

  // POST /usage/record — record a usage event
  // Writes to BOTH usage_log (cost-enforcement) AND model_usage (usage-tracking → cloud sync).
  // Previously only wrote to usage_log, causing all models (gpt-5.4, etc.) to appear as $0
  // in the cloud usage dashboard which reads from model_usage via syncUsage().
  app.post('/usage/record', async (request, reply) => {
    const body = request.body as {
      agentId?: string; model?: string
      inputTokens?: number; outputTokens?: number
      cost?: number
    }
    if (!body?.agentId) return reply.code(400).send({ error: 'agentId is required' })
    if (!body?.model) return reply.code(400).send({ error: 'model is required' })
    if (typeof body.cost !== 'number') return reply.code(400).send({ error: 'cost is required (number)' })

    const now = Date.now()
    const inputTokens = body.inputTokens ?? 0
    const outputTokens = body.outputTokens ?? 0
    const cost = body.cost

    // Write to cost-enforcement usage_log (existing path — enforces caps)
    recordUsage({
      agentId: body.agentId,
      model: body.model,
      inputTokens,
      outputTokens,
      cost,
      timestamp: now,
    })

    // Bridge to model_usage (usage-tracking) so syncUsage() picks it up for cloud dashboard.
    // Best-effort: never block the response if this fails.
    try {
      recordUsageTracking({
        agent: body.agentId as string,
        model: body.model as string,
        provider: 'unknown',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: cost,
        category: 'other' as const,
        timestamp: now,
      })
    } catch { /* non-fatal: cost-enforcement path already succeeded */ }

    return reply.code(201).send({ ok: true })
  })

  // POST /usage/purge — purge old usage records
  app.post('/usage/purge', async (request) => {
    const body = request.body as { maxAgeDays?: number } | null
    const deleted = purgeUsageLog(body?.maxAgeDays ?? 90)
    return { deleted }
  })

  // ── Agent Memories ─────────────────────────────────────────────────────

  const {
    setMemory,
    getMemory,
    listMemories,
    deleteMemory,
    deleteMemoryById,
    purgeExpiredMemories,
    countMemories,
  } = await import('./agent-memories.js')

  // Set (create or update) a memory
  app.put<{ Params: { agentId: string } }>('/agents/:agentId/memories', async (request, reply) => {
    const { agentId } = request.params
    const body = request.body as {
      key?: string
      content?: string
      namespace?: string
      tags?: string[]
      expiresAt?: number | null
    }
    if (!body?.key) return reply.code(400).send({ error: 'key is required' })
    if (body.content === undefined || body.content === null) return reply.code(400).send({ error: 'content is required' })
    try {
      const memory = setMemory({
        agentId,
        namespace: body.namespace,
        key: body.key,
        content: body.content,
        tags: body.tags,
        expiresAt: body.expiresAt,
      })
      return reply.code(200).send(memory)
    } catch (err: any) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // Get a specific memory by key
  app.get<{ Params: { agentId: string; key: string } }>('/agents/:agentId/memories/:key', async (request, reply) => {
    const { agentId, key } = request.params
    const query = request.query as { namespace?: string }
    const memory = getMemory(agentId, key, query.namespace)
    if (!memory) return reply.code(404).send({ error: 'Memory not found' })
    return memory
  })

  // List memories for an agent
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/memories', async (request, reply) => {
    const { agentId } = request.params
    const query = request.query as {
      namespace?: string
      tag?: string
      search?: string
      limit?: string
    }
    return listMemories({
      agentId,
      namespace: query.namespace,
      tag: query.tag,
      search: query.search,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
    })
  })

  // Delete a memory by key
  app.delete<{ Params: { agentId: string; key: string } }>('/agents/:agentId/memories/:key', async (request, reply) => {
    const { agentId, key } = request.params
    const query = request.query as { namespace?: string }
    const deleted = deleteMemory(agentId, key, query.namespace)
    if (!deleted) return reply.code(404).send({ error: 'Memory not found' })
    return { deleted: true }
  })

  // Count memories
  app.get<{ Params: { agentId: string } }>('/agents/:agentId/memories/count', async (request, reply) => {
    const { agentId } = request.params
    const query = request.query as { namespace?: string }
    return { count: countMemories(agentId, query.namespace) }
  })

  // Purge expired memories (housekeeping)
  app.post('/agents/memories/purge', async (_request, reply) => {
    const purged = purgeExpiredMemories()
    return { purged }
  })

  return app
}
