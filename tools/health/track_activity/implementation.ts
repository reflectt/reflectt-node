/**
 * Track Activity Tool
 *
 * Tracks physical activity like steps, distance, calories burned, and active minutes
 * from fitness trackers (Fitbit) or manual entry.
 *
 * @module tools/health/track_activity
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getFitbitClient } from '@/lib/integrations/health'
import { getData } from '@/lib/data-layer'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

interface TrackActivityInput {
  date?: string
  source?: 'manual' | 'fitbit' | 'apple_health' | 'google_fit'
  steps?: number
  distance_km?: number
  calories?: number
  active_minutes?: number
  sync_from_fitbit?: boolean
}

interface TrackActivityOutput {
  success: boolean
  result?: {
    date: string
    source: string
    metrics_stored: number
    summary: {
      steps?: number
      distance_km?: number
      calories?: number
      active_minutes?: number
    }
  }
  error?: string
}

/**
 * Track physical activity
 */
export default async function track_activity(
  input: TrackActivityInput,
  context: ToolContext
): Promise<TrackActivityOutput> {
  try {
    const {
      date = new Date().toISOString().split('T')[0],
      source = 'manual',
      steps,
      distance_km,
      calories,
      active_minutes,
      sync_from_fitbit = false,
    } = input

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
      }
    }

    logger.info('[track_activity] Tracking activity', {
      date,
      source,
      sync_from_fitbit,
    })

    let activityData: {
      steps?: number
      distance_km?: number
      calories?: number
      active_minutes?: number
    } = {}

    // If syncing from Fitbit, fetch data
    if (sync_from_fitbit || source === 'fitbit') {
      if (!context.userId || !context.tenantId) {
        return {
          success: false,
          error: 'User ID and Tenant ID required for Fitbit sync',
        }
      }

      try {
        const fitbitClient = getFitbitClient()
        const activitySummary = await fitbitClient.getActivitySummary(
          context.userId,
          context.tenantId,
          date
        )

        // Extract activity data from Fitbit response
        activityData = {
          steps: activitySummary.summary.steps,
          distance_km: activitySummary.summary.distances.find((d) => d.activity === 'total')?.distance || 0,
          calories: activitySummary.summary.caloriesOut,
          active_minutes:
            activitySummary.summary.lightlyActiveMinutes +
            activitySummary.summary.fairlyActiveMinutes +
            activitySummary.summary.veryActiveMinutes,
        }

        logger.info('[track_activity] Fetched activity from Fitbit', {
          date,
          steps: activityData.steps,
          calories: activityData.calories,
        })
      } catch (error) {
        logger.error('[track_activity] Fitbit sync failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        return {
          success: false,
          error: `Fitbit sync failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    } else {
      // Use manual input
      activityData = {
        steps,
        distance_km,
        calories,
        active_minutes,
      }
    }

    // Store metrics in health_metrics table (if using database)
    // For now, we'll store using data layer
    const dataLayer = getData(context)
    const metricsStored: Array<{ type: string; value: number; unit: string }> = []

    if (activityData.steps !== undefined) {
      metricsStored.push({
        type: 'steps',
        value: activityData.steps,
        unit: 'steps',
      })
    }

    if (activityData.distance_km !== undefined) {
      metricsStored.push({
        type: 'distance',
        value: activityData.distance_km,
        unit: 'km',
      })
    }

    if (activityData.calories !== undefined) {
      metricsStored.push({
        type: 'calories',
        value: activityData.calories,
        unit: 'kcal',
      })
    }

    if (activityData.active_minutes !== undefined) {
      metricsStored.push({
        type: 'active_minutes',
        value: activityData.active_minutes,
        unit: 'minutes',
      })
    }

    // Store metrics in data layer
    const metricId = `activity_${date}_${Date.now()}`
    await dataLayer.create('health_metrics', context.spaceId || 'global', metricId, {
      date,
      source,
      metrics: metricsStored,
      created_at: new Date().toISOString(),
      user_id: context.userId,
      tenant_id: context.tenantId,
    })

    logger.info('[track_activity] Activity tracked successfully', {
      date,
      metrics_count: metricsStored.length,
    })

    return {
      success: true,
      result: {
        date,
        source: sync_from_fitbit ? 'fitbit' : source,
        metrics_stored: metricsStored.length,
        summary: activityData,
      },
    }
  } catch (error) {
    logger.error('[track_activity] Error tracking activity', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
