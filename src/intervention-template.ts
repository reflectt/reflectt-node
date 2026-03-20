// SPDX-License-Identifier: Apache-2.0
/**
 * Intervention Template Engine
 * 
 * Context-aware stall re-engagement system.
 * Selects and sends intervention messages when users stall on tasks.
 * 
 * Done criteria:
 * - InterventionTemplateEngine receives stall event and selects template based on stall_type
 * - Templates support personalization fields: user_name, last_intent, active_task_title, last_agent_name
 * - 3 template tiers: gentle nudge, contextual follow-up, handoff offer
 * - Cooldown enforcement: max 2 interventions per 20 min, max 4 per day per user
 * - Never resends same template if unanswered within 30 min
 * - InterventionResult logged: sent_at, template_type, user_id, stall_id, response_at (null if no response)
 * - Deduplication: same stall_type + same user within 30 min suppressed
 */

export type StallType = 'intent_abandoned' | 'task_stalled' | 'review_pending' | 'handoff_waiting' | 'approval_pending'

export type TemplateTier = 'gentle_nudge' | 'contextual_followup' | 'handoff_offer'

export interface InterventionTemplate {
  id: string
  tier: TemplateTier
  stallTypes: StallType[]
  template: string
  priority: number // Lower = more gentle
}

export interface PersonalizationFields {
  user_name?: string
  last_intent?: string
  active_task_title?: string
  last_agent_name?: string
}

export interface StallEvent {
  stallId: string
  userId: string
  stallType: StallType
  personalizations: PersonalizationFields
  timestamp: number
}

export interface InterventionResult {
  sent_at: number
  template_type: TemplateTier
  user_id: string
  stall_id: string
  response_at: number | null
  template_id: string
}

export interface CooldownEntry {
  count: number
  firstAt: number
}

// In-memory store for cooldowns and sent interventions
// Key: userId, Value: { rolling20min: CooldownEntry, daily: CooldownEntry }
const cooldownStore = new Map<string, { rolling20min: CooldownEntry; daily: CooldownEntry }>()

// Track sent templates to prevent duplicates within 30 min
// Key: `${userId}:${templateId}`, Value: timestamp
const sentTemplates = new Map<string, number>()

// Track deduplication: same stall_type + same user within 30 min
// Key: `${userId}:${stallType}`, Value: timestamp
const deduplicationStore = new Map<string, number>()

const COOLDOWN_20MIN_MS = 20 * 60 * 1000
const COOLDOWN_DAILY_MS = 24 * 60 * 60 * 1000
const DEDUP_WINDOW_MS = 30 * 60 * 1000
const SENT_TEMPLATE_WINDOW_MS = 30 * 60 * 1000
const MAX_20MIN = 2
const MAX_DAILY = 4

// ── Templates ──────────────────────────────────────────────────────────────────

const INTERVENTION_TEMPLATES: InterventionTemplate[] = [
  // Gentle nudge tier
  {
    id: 'gentle_nudge_intent',
    tier: 'gentle_nudge',
    stallTypes: ['intent_abandoned'],
    template: 'Hey {{user_name}}! You started something exciting — "{{last_intent}}". Want to pick up where you left off?',
    priority: 1,
  },
  {
    id: 'gentle_nudge_task',
    tier: 'gentle_nudge',
    stallTypes: ['task_stalled'],
    template: 'Quick check-in: "{{active_task_title}}" is waiting for you. Need any help?',
    priority: 1,
  },
  {
    id: 'gentle_nudge_review',
    tier: 'gentle_nudge',
    stallTypes: ['review_pending'],
    template: 'Your review is waiting — just a quick look to keep things moving 🚀',
    priority: 1,
  },
  {
    id: 'gentle_nudge_handoff',
    tier: 'gentle_nudge',
    stallTypes: ['handoff_waiting'],
    template: '{{last_agent_name}} has something ready for you. Ready to take a look?',
    priority: 1,
  },
  // Contextual follow-up tier
  {
    id: 'contextual_intent',
    tier: 'contextual_followup',
    stallTypes: ['intent_abandoned'],
    template: '{{user_name}}, still interested in "{{last_intent}}"? I can help you get started — just say the word.',
    priority: 2,
  },
  {
    id: 'contextual_task',
    tier: 'contextual_followup',
    stallTypes: ['task_stalled'],
    template: 'Looks like "{{active_task_title}}" might need some attention. What\'s blocking you?',
    priority: 2,
  },
  {
    id: 'contextual_review',
    tier: 'contextual_followup',
    stallTypes: ['review_pending'],
    template: '{{user_name}}, a review is waiting. Your feedback keeps the team moving forward!',
    priority: 2,
  },
  {
    id: 'contextual_handoff',
    tier: 'contextual_followup',
    stallTypes: ['handoff_waiting'],
    template: '{{last_agent_name}} handed off work to you on "{{active_task_title}}". Ready to review?',
    priority: 2,
  },
  // Handoff offer tier
  {
    id: 'handoff_intent',
    tier: 'handoff_offer',
    stallTypes: ['intent_abandoned'],
    template: '{{user_name}}, want me to draft a start on "{{last_intent}}"? I can have something ready for your review in minutes.',
    priority: 3,
  },
  {
    id: 'handoff_task',
    tier: 'handoff_offer',
    stallTypes: ['task_stalled'],
    template: 'Stuck on "{{active_task_title}}"? I can take a crack at it or find someone who can help.',
    priority: 3,
  },
  {
    id: 'handoff_review',
    tier: 'handoff_offer',
    stallTypes: ['review_pending'],
    template: 'Need a second pair of eyes? I can walk you through the review or handle it if you\'re swamped.',
    priority: 3,
  },
  {
    id: 'handoff_approval',
    tier: 'handoff_offer',
    stallTypes: ['approval_pending'],
    template: 'Waiting on your approval for "{{active_task_title}}". Want me to prep a summary to make it quick?',
    priority: 3,
  },
]

// ── Template Selection ────────────────────────────────────────────────────────

function selectTemplate(stallType: StallType): InterventionTemplate | null {
  const candidates = INTERVENTION_TEMPLATES.filter(t => t.stallTypes.includes(stallType))
  if (candidates.length === 0) return null
  
  // Sort by priority (gentler first)
  candidates.sort((a, b) => a.priority - b.priority)
  return candidates[0]
}

function interpolate(template: string, fields: PersonalizationFields): string {
  let result = template
  for (const [key, value] of Object.entries(fields)) {
    const placeholder = `{{${key}}}`
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value ?? '')
  }
  return result
}

// ── Cooldown & Deduplication ─────────────────────────────────────────────────

function checkCooldown(userId: string): { allowed: boolean; reason?: string } {
  const now = Date.now()
  let entry = cooldownStore.get(userId)
  
  if (!entry) {
    entry = { rolling20min: { count: 0, firstAt: now }, daily: { count: 0, firstAt: now } }
    cooldownStore.set(userId, entry)
  }
  
  // Check 20-min window
  if (now - entry.rolling20min.firstAt > COOLDOWN_20MIN_MS) {
    entry.rolling20min = { count: 0, firstAt: now }
  }
  if (entry.rolling20min.count >= MAX_20MIN) {
    return { allowed: false, reason: '20-min cooldown' }
  }
  
  // Check daily window
  if (now - entry.daily.firstAt > COOLDOWN_DAILY_MS) {
    entry.daily = { count: 0, firstAt: now }
  }
  if (entry.daily.count >= MAX_DAILY) {
    return { allowed: false, reason: 'daily cooldown' }
  }
  
  return { allowed: true }
}

function recordIntervention(userId: string): void {
  const now = Date.now()
  let entry = cooldownStore.get(userId)
  if (!entry) {
    entry = { rolling20min: { count: 0, firstAt: now }, daily: { count: 0, firstAt: now } }
    cooldownStore.set(userId, entry)
  }
  
  entry.rolling20min.count++
  entry.daily.count++
}

function checkDeduplication(userId: string, stallType: StallType): boolean {
  const key = `${userId}:${stallType}`
  const lastSent = deduplicationStore.get(key)
  if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
    return true // Suppressed
  }
  deduplicationStore.set(key, Date.now())
  return false
}

function checkTemplateDuplicate(userId: string, templateId: string): boolean {
  const key = `${userId}:${templateId}`
  const lastSent = sentTemplates.get(key)
  if (lastSent && Date.now() - lastSent < SENT_TEMPLATE_WINDOW_MS) {
    return true // Already sent, unanswered
  }
  sentTemplates.set(key, Date.now())
  return false
}

// ── Main Engine ─────────────────────────────────────────────────────────────

export interface EngineResult {
  sent: boolean
  reason?: string
  result?: InterventionResult
  message?: string  // The interpolated intervention text (only when sent=true)
}

export function processStallEvent(event: StallEvent): EngineResult {
  const { stallId, userId, stallType, personalizations, timestamp } = event
  const now = Date.now()
  
  // Deduplication: same stall_type + same user within 30 min suppressed
  if (checkDeduplication(userId, stallType)) {
    return { sent: false, reason: 'deduplicated' }
  }
  
  // Select template based on stall_type
  const template = selectTemplate(stallType)
  if (!template) {
    return { sent: false, reason: 'no template for stall_type' }
  }
  
  // Never resend same template if unanswered within 30 min
  if (checkTemplateDuplicate(userId, template.id)) {
    return { sent: false, reason: 'template already sent, unanswered within 30 min' }
  }
  
  // Cooldown enforcement
  const cooldownCheck = checkCooldown(userId)
  if (!cooldownCheck.allowed) {
    return { sent: false, reason: cooldownCheck.reason ?? 'cooldown' }
  }
  
  // All checks passed - send intervention
  const message = interpolate(template.template, personalizations)
  
  // Record that we sent this
  recordIntervention(userId)
  sentTemplates.set(`${userId}:${template.id}`, now)
  
  const result: InterventionResult = {
    sent_at: now,
    template_type: template.tier,
    user_id: userId,
    stall_id: stallId,
    response_at: null, // Will be updated if user responds
    template_id: template.id,
  }
  
  return {
    sent: true,
    message, // interpolated intervention text
    result,
  }
}

export function recordResponse(userId: string, templateId: string): void {
  const key = `${userId}:${templateId}`
  const lastSent = sentTemplates.get(key)
  if (lastSent) {
    // Mark as responded - future sends of same template allowed
    sentTemplates.delete(key)
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function getInterventionStats(userId: string): { twentyMin: number; daily: number } {
  const entry = cooldownStore.get(userId)
  if (!entry) return { twentyMin: 0, daily: 0 }
  
  const now = Date.now()
  let twentyMin = entry.rolling20min.count
  let daily = entry.daily.count
  
  // Reset if window expired
  if (now - entry.rolling20min.firstAt > COOLDOWN_20MIN_MS) twentyMin = 0
  if (now - entry.daily.firstAt > COOLDOWN_DAILY_MS) daily = 0
  
  return { twentyMin, daily }
}

// Cleanup old entries periodically
export function cleanupStaleEntries(): void {
  const now = Date.now()
  
  // Cleanup deduplication store
  for (const [key, timestamp] of deduplicationStore.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      deduplicationStore.delete(key)
    }
  }
  
  // Cleanup sent templates
  for (const [key, timestamp] of sentTemplates.entries()) {
    if (now - timestamp > SENT_TEMPLATE_WINDOW_MS) {
      sentTemplates.delete(key)
    }
  }
  
  // Cleanup cooldown store (reset expired entries)
  for (const [userId, entry] of cooldownStore.entries()) {
    if (now - entry.rolling20min.firstAt > COOLDOWN_20MIN_MS) {
      entry.rolling20min = { count: 0, firstAt: now }
    }
    if (now - entry.daily.firstAt > COOLDOWN_DAILY_MS) {
      entry.daily = { count: 0, firstAt: now }
    }
    if (entry.rolling20min.count === 0 && entry.daily.count === 0) {
      cooldownStore.delete(userId)
    }
  }
}
