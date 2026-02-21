// SPDX-License-Identifier: Apache-2.0
// Automated Reflection → Insight → Task intake pipeline
//
// Wires together reflections, insight clustering, and promotion into a single
// automated flow. When a reflection is submitted, the pipeline:
//   1. Creates the reflection
//   2. Ingests it into the insight engine (clustering/scoring)
//   3. Checks if the insight meets promotion gates
//   4. Auto-promotes if gates are met and auto_promote is enabled
//
// Designed for product use by customer teams, not just internal workflows.

import { createReflection, validateReflection, type Reflection } from './reflections.js'
import { ingestReflection, getInsight, tickCooldowns, extractClusterKey, type Insight } from './insights.js'
import { promoteInsight, validatePromotionInput, type PromotionContract, type PromotionResult } from './insight-promotion.js'
import { eventBus } from './events.js'

// ── Types ──

export interface IntakeInput {
  /** Reflection data */
  reflection: Record<string, unknown>
  /** Team id for scoping */
  team_id?: string
  /** Auto-promote if gates are met? Default: false */
  auto_promote?: boolean
  /** Default contract for auto-promotion (required if auto_promote=true) */
  promotion_contract?: PromotionContract
}

export interface IntakeResult {
  success: boolean
  /** Created reflection */
  reflection?: Reflection
  /** Insight the reflection was clustered into */
  insight?: Insight
  /** Cluster key used */
  cluster_key?: string
  /** Whether auto-promotion was attempted */
  auto_promote_attempted: boolean
  /** Promotion result (if auto-promotion was attempted) */
  promotion?: PromotionResult
  /** Pipeline stage that produced an error */
  error_stage?: 'validation' | 'reflection' | 'ingestion' | 'promotion'
  /** Error details */
  error?: string
  errors?: Array<{ field: string; message: string }>
}

export interface PipelineStats {
  total_intakes: number
  auto_promoted: number
  promotion_gates_met: number
  errors: number
  last_intake_at: number | null
}

// ── Pipeline State ──

let stats: PipelineStats = {
  total_intakes: 0,
  auto_promoted: 0,
  promotion_gates_met: 0,
  errors: 0,
  last_intake_at: null,
}

// ── Core Pipeline ──

/**
 * Run the full intake pipeline: validate → create reflection → ingest → (optionally auto-promote)
 */
export async function runIntake(input: IntakeInput): Promise<IntakeResult> {
  const { reflection: reflectionData, team_id, auto_promote = false, promotion_contract } = input

  // Stage 1: Validate reflection
  const validation = validateReflection(reflectionData)
  if (!validation.valid) {
    stats.errors++
    return {
      success: false,
      auto_promote_attempted: false,
      error_stage: 'validation',
      error: 'Reflection validation failed',
      errors: validation.errors,
    }
  }

  // Stage 2: Create reflection
  let reflection: Reflection
  try {
    // Inject team_id if provided
    const data = { ...validation.data }
    if (team_id && !data.team_id) {
      data.team_id = team_id
    }
    reflection = createReflection(data)
  } catch (err) {
    stats.errors++
    return {
      success: false,
      auto_promote_attempted: false,
      error_stage: 'reflection',
      error: `Failed to create reflection: ${(err as Error).message}`,
    }
  }

  // Stage 3: Ingest into insight engine (cluster + score + dedupe)
  let insight: Insight
  let clusterKey: string
  try {
    insight = ingestReflection(reflection)
    const keyObj = extractClusterKey(reflection)
    clusterKey = `${keyObj.workflow_stage}::${keyObj.failure_family}::${keyObj.impacted_unit}`
  } catch (err) {
    stats.errors++
    return {
      success: false,
      reflection,
      auto_promote_attempted: false,
      error_stage: 'ingestion',
      error: `Failed to ingest into insight engine: ${(err as Error).message}`,
    }
  }

  stats.total_intakes++
  stats.last_intake_at = Date.now()

  // Check promotion readiness
  // Note: the insight engine auto-promotes status to 'promoted' when gates are met,
  // but the task creation (board task with contract) happens in the promotion module.
  // So we check if the insight just reached 'promoted' status via auto-clustering.
  const gatesMet = insight.promotion_readiness === 'ready' || insight.promotion_readiness === 'promoted'
  if (gatesMet) {
    stats.promotion_gates_met++
  }

  // Stage 4: Auto-promote (create task) if enabled and insight was just auto-promoted by engine
  // The insight engine sets status='promoted' when canPromote() is true, but no board task exists yet.
  let promotionResult: PromotionResult | undefined
  let autoPromoteAttempted = false

  if (auto_promote && gatesMet && (insight.status === 'candidate' || insight.status === 'promoted')) {
    autoPromoteAttempted = true

    if (!promotion_contract) {
      return {
        success: true,
        reflection,
        insight,
        cluster_key: clusterKey,
        auto_promote_attempted: true,
        error_stage: 'promotion',
        error: 'Auto-promotion enabled but no promotion_contract provided',
      }
    }

    try {
      promotionResult = await promoteInsight({
        insight_id: insight.id,
        contract: promotion_contract,
        team_id,
      }, 'intake-pipeline')

      if (promotionResult.success) {
        stats.auto_promoted++
        // Refresh insight to get updated status
        insight = getInsight(insight.id) || insight

        // Emit event for downstream consumers
        eventBus.emit({
          id: `evt-auto-promote-${insight.id}`,
          type: 'task_created' as const,
          timestamp: Date.now(),
          data: {
            kind: 'insight:auto-promoted',
            insight_id: insight.id,
            task_id: promotionResult.task_id,
            cluster_key: clusterKey,
          },
        })
      }
    } catch (err) {
      // Non-fatal: reflection and insight were still created
      promotionResult = {
        success: false,
        insight_id: insight.id,
        error: `Auto-promotion failed: ${(err as Error).message}`,
      }
    }
  }

  return {
    success: true,
    reflection,
    insight,
    cluster_key: clusterKey,
    auto_promote_attempted: autoPromoteAttempted,
    promotion: promotionResult,
  }
}

/**
 * Batch intake: process multiple reflections in one call.
 * Each reflection is processed independently (one failure doesn't block others).
 */
export async function batchIntake(inputs: IntakeInput[]): Promise<{
  results: IntakeResult[]
  summary: { total: number; succeeded: number; failed: number; auto_promoted: number }
}> {
  const results: IntakeResult[] = []
  let succeeded = 0
  let failed = 0
  let autoPromoted = 0

  for (const input of inputs) {
    const result = await runIntake(input)
    results.push(result)
    if (result.success) {
      succeeded++
      if (result.promotion?.success) autoPromoted++
    } else {
      failed++
    }
  }

  return {
    results,
    summary: { total: inputs.length, succeeded, failed, auto_promoted: autoPromoted },
  }
}

/**
 * Run maintenance: tick cooldowns and return pipeline stats.
 */
export function pipelineMaintenance(): {
  stats: PipelineStats
  cooldowns: ReturnType<typeof tickCooldowns>
} {
  const cooldowns = tickCooldowns()
  return { stats: { ...stats }, cooldowns }
}

/**
 * Get pipeline stats.
 */
export function getPipelineStats(): PipelineStats {
  return { ...stats }
}

/**
 * Reset pipeline stats (for testing).
 */
export function _resetPipelineStats(): void {
  stats = {
    total_intakes: 0,
    auto_promoted: 0,
    promotion_gates_met: 0,
    errors: 0,
    last_intake_at: null,
  }
}
