/**
 * Set Health Goal Tool
 *
 * Sets health and fitness goals like target weight, daily steps, exercise minutes,
 * or calorie intake with progress tracking.
 *
 * @module tools/health/set_health_goal
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

type GoalType =
  | 'weight'
  | 'steps'
  | 'active_minutes'
  | 'calories_burned'
  | 'exercise_days'
  | 'heart_rate'
  | 'body_fat'

interface SetHealthGoalInput {
  goal_type: GoalType
  target_value: number
  current_value?: number
  deadline?: string
  notes?: string
}

interface SetHealthGoalOutput {
  success: boolean
  result?: {
    goal_id: string
    goal_type: string
    target_value: number
    current_value: number
    progress_percent: number
    remaining: number
    deadline?: string
    estimated_completion?: string
    notes?: string
    recommendations?: string[]
  }
  error?: string
}

/**
 * Get unit for goal type
 */
function getUnitForGoalType(goalType: GoalType): string {
  const units: Record<GoalType, string> = {
    weight: 'kg',
    steps: 'steps/day',
    active_minutes: 'minutes/day',
    calories_burned: 'kcal/day',
    exercise_days: 'days/week',
    heart_rate: 'bpm',
    body_fat: '%',
  }
  return units[goalType]
}

/**
 * Get metric type for goal type
 */
function getMetricTypeForGoal(goalType: GoalType): string {
  const metricMap: Record<GoalType, string> = {
    weight: 'weight',
    steps: 'steps',
    active_minutes: 'active_minutes',
    calories_burned: 'calories',
    exercise_days: 'activity',
    heart_rate: 'resting_hr',
    body_fat: 'body_fat',
  }
  return metricMap[goalType]
}

/**
 * Fetch current value from latest metrics
 */
async function getCurrentValue(
  goalType: GoalType,
  context: ToolContext
): Promise<number | undefined> {
  const dataLayer = getData(context)
  const metricType = getMetricTypeForGoal(goalType)

  try {
    // Get metrics from last 30 days
    const allMetrics = await dataLayer.list('health_metrics', context.spaceId || 'global')

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    // Filter recent metrics
    const recentMetrics = allMetrics
      .filter((m: any) => m.date >= thirtyDaysAgo)
      .sort((a: any, b: any) => b.date.localeCompare(a.date))

    // Find the latest value for this metric type
    for (const metricEntry of recentMetrics) {
      if (!metricEntry.metrics || !Array.isArray(metricEntry.metrics)) continue

      for (const metric of metricEntry.metrics) {
        if (metric.type === metricType) {
          return metric.value
        }
      }
    }

    return undefined
  } catch (error) {
    logger.warn('[set_health_goal] Could not fetch current value', {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * Calculate estimated completion date based on trend
 */
function estimateCompletion(
  currentValue: number,
  targetValue: number,
  goalType: GoalType
): string | undefined {
  // For weight loss/gain, assume 0.5-1kg per week is healthy
  if (goalType === 'weight') {
    const difference = Math.abs(targetValue - currentValue)
    const weeksNeeded = difference / 0.75 // Assume 0.75kg per week
    const estimatedDate = new Date(Date.now() + weeksNeeded * 7 * 24 * 60 * 60 * 1000)
    return estimatedDate.toISOString().split('T')[0]
  }

  // For body fat, assume 0.5-1% per month is realistic
  if (goalType === 'body_fat') {
    const difference = Math.abs(targetValue - currentValue)
    const monthsNeeded = difference / 0.75 // Assume 0.75% per month
    const estimatedDate = new Date(Date.now() + monthsNeeded * 30 * 24 * 60 * 60 * 1000)
    return estimatedDate.toISOString().split('T')[0]
  }

  // For activity-based goals, assume 1-2 weeks to build habit
  if (['steps', 'active_minutes', 'exercise_days'].includes(goalType)) {
    const estimatedDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 2 weeks
    return estimatedDate.toISOString().split('T')[0]
  }

  return undefined
}

/**
 * Get recommendations based on goal type
 */
function getRecommendations(goalType: GoalType, currentValue: number, targetValue: number): string[] {
  const recommendations: string[] = []

  if (goalType === 'weight') {
    if (currentValue > targetValue) {
      recommendations.push('Focus on a balanced diet with a calorie deficit of 300-500 kcal/day')
      recommendations.push('Incorporate 30-45 minutes of moderate exercise daily')
      recommendations.push('Stay hydrated and get adequate sleep (7-9 hours)')
    } else {
      recommendations.push('Increase calorie intake with nutrient-dense foods')
      recommendations.push('Include strength training exercises 3-4 times per week')
      recommendations.push('Ensure adequate protein intake (1.6-2.2g per kg body weight)')
    }
  } else if (goalType === 'steps') {
    recommendations.push('Start by increasing daily steps by 1000-2000 steps per week')
    recommendations.push('Take short walking breaks throughout the day')
    recommendations.push('Use stairs instead of elevators when possible')
  } else if (goalType === 'active_minutes') {
    recommendations.push('Break exercise into smaller sessions (e.g., 3x10 minutes)')
    recommendations.push('Try activities you enjoy to stay motivated')
    recommendations.push('Gradually increase intensity and duration')
  } else if (goalType === 'body_fat') {
    recommendations.push('Combine strength training with cardio exercises')
    recommendations.push('Focus on whole foods and minimize processed foods')
    recommendations.push('Track protein intake to preserve muscle mass')
    recommendations.push('Be patient - sustainable fat loss takes time')
  } else if (goalType === 'heart_rate') {
    recommendations.push('Engage in regular cardiovascular exercise')
    recommendations.push('Practice stress management techniques (meditation, yoga)')
    recommendations.push('Ensure adequate sleep and recovery')
  }

  return recommendations
}

/**
 * Set health goal
 */
export default async function set_health_goal(
  input: SetHealthGoalInput,
  context: ToolContext
): Promise<SetHealthGoalOutput> {
  try {
    const { goal_type, target_value, current_value, deadline, notes } = input

    // Validate deadline format if provided
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
      return {
        success: false,
        error: 'Invalid deadline format. Use YYYY-MM-DD',
      }
    }

    logger.info('[set_health_goal] Setting health goal', {
      goal_type,
      target_value,
      has_current_value: current_value !== undefined,
    })

    // Fetch current value if not provided
    let currentVal = current_value
    if (currentVal === undefined) {
      currentVal = await getCurrentValue(goal_type, context)
    }

    // If still no current value, use target as baseline
    if (currentVal === undefined) {
      currentVal = target_value
      logger.warn('[set_health_goal] No current value available, using target as baseline')
    }

    // Calculate progress
    const difference = target_value - currentVal
    const progressPercent =
      difference === 0
        ? 100
        : Math.max(0, Math.min(100, 100 - (Math.abs(difference) / Math.abs(currentVal)) * 100))

    // Estimate completion date
    const estimatedCompletion =
      deadline || estimateCompletion(currentVal, target_value, goal_type)

    // Get recommendations
    const recommendations = getRecommendations(goal_type, currentVal, target_value)

    // Store goal
    const dataLayer = getData(context)
    const goalId = `goal_${goal_type}_${Date.now()}`

    await dataLayer.create('health_goals', context.spaceId || 'global', goalId, {
      goal_type,
      target_value,
      current_value: currentVal,
      progress_percent: Math.round(progressPercent * 100) / 100,
      remaining: Math.abs(difference),
      deadline: estimatedCompletion,
      notes,
      recommendations,
      unit: getUnitForGoalType(goal_type),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user_id: context.userId,
      tenant_id: context.tenantId,
      status: 'active',
    })

    logger.info('[set_health_goal] Goal set successfully', {
      goal_id: goalId,
      progress_percent: progressPercent,
    })

    return {
      success: true,
      result: {
        goal_id: goalId,
        goal_type,
        target_value,
        current_value: currentVal,
        progress_percent: Math.round(progressPercent * 100) / 100,
        remaining: Math.abs(difference),
        deadline: deadline,
        estimated_completion: estimatedCompletion,
        notes,
        recommendations,
      },
    }
  } catch (error) {
    logger.error('[set_health_goal] Error setting goal', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
