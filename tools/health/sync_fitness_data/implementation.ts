/**
 * Sync Fitness Data Tool
 *
 * Synchronizes fitness and health data from connected devices like Fitbit,
 * Apple Health, or Google Fit.
 *
 * @module tools/health/sync_fitness_data
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getFitbitClient } from '@/lib/integrations/health'
import { getData } from '@/lib/data-layer'

type DataSource = 'fitbit' | 'apple_health' | 'google_fit'
type DataType = 'activity' | 'heart_rate' | 'sleep' | 'weight' | 'body_fat' | 'nutrition' | 'all'

interface SyncFitnessDataInput {
  source: DataSource
  data_types?: DataType[]
  date?: string
  full_sync?: boolean
}

interface SyncFitnessDataOutput {
  success: boolean
  result?: {
    source: string
    data_types_synced: string[]
    metrics_synced: number
    date_range: {
      start: string
      end: string
    }
    sync_timestamp: string
    errors?: string[]
  }
  error?: string
}

/**
 * Sync data from Fitbit
 */
async function syncFromFitbit(
  userId: string,
  tenantId: string,
  dataTypes: DataType[],
  date: string,
  fullSync: boolean,
  context: ToolContext
): Promise<{
  metrics_synced: number
  data_types_synced: string[]
  errors: string[]
}> {
  const fitbitClient = getFitbitClient()
  const dataLayer = getData(context)
  let metricsCount = 0
  const syncedTypes: string[] = []
  const errors: string[] = []

  const shouldSyncType = (type: string) =>
    dataTypes.includes('all') || dataTypes.includes(type as DataType)

  try {
    // Sync activity data
    if (shouldSyncType('activity')) {
      try {
        const activityData = await fitbitClient.getActivitySummary(userId, tenantId, date)

        const activityMetrics = [
          { type: 'steps', value: activityData.summary.steps, unit: 'steps' },
          {
            type: 'distance',
            value:
              activityData.summary.distances.find((d) => d.activity === 'total')?.distance || 0,
            unit: 'km',
          },
          { type: 'calories', value: activityData.summary.caloriesOut, unit: 'kcal' },
          {
            type: 'active_minutes',
            value:
              activityData.summary.lightlyActiveMinutes +
              activityData.summary.fairlyActiveMinutes +
              activityData.summary.veryActiveMinutes,
            unit: 'minutes',
          },
        ]

        await dataLayer.create(
          'health_metrics',
          context.spaceId || 'global',
          `fitbit_activity_${date}_${Date.now()}`,
          {
            date,
            source: 'fitbit',
            metrics: activityMetrics,
            created_at: new Date().toISOString(),
            user_id: userId,
            tenant_id: tenantId,
          }
        )

        metricsCount += activityMetrics.length
        syncedTypes.push('activity')
      } catch (error) {
        errors.push(`Activity sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Sync heart rate data
    if (shouldSyncType('heart_rate')) {
      try {
        const heartRateData = await fitbitClient.getHeartRateTimeSeries(
          userId,
          tenantId,
          date,
          '1d'
        )

        const hrEntry = heartRateData['activities-heart']?.[0]
        if (hrEntry?.value?.restingHeartRate) {
          const hrMetrics = [
            {
              type: 'resting_hr',
              value: hrEntry.value.restingHeartRate,
              unit: 'bpm',
            },
          ]

          await dataLayer.create(
            'health_metrics',
            context.spaceId || 'global',
            `fitbit_hr_${date}_${Date.now()}`,
            {
              date,
              source: 'fitbit',
              metrics: hrMetrics,
              created_at: new Date().toISOString(),
              user_id: userId,
              tenant_id: tenantId,
            }
          )

          metricsCount += hrMetrics.length
          syncedTypes.push('heart_rate')
        }
      } catch (error) {
        errors.push(`Heart rate sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Sync sleep data
    if (shouldSyncType('sleep')) {
      try {
        const sleepData = await fitbitClient.getSleepLog(userId, tenantId, date)

        if (sleepData.sleep.length > 0) {
          const mainSleep = sleepData.sleep.find((s) => s.isMainSleep) || sleepData.sleep[0]

          const sleepMetrics = [
            {
              type: 'sleep',
              value: mainSleep.minutesAsleep,
              unit: 'minutes',
              metadata: {
                efficiency: mainSleep.efficiency,
                time_in_bed: mainSleep.timeInBed,
                minutes_awake: mainSleep.minutesAwake,
                levels: mainSleep.levels.summary,
              },
            },
          ]

          await dataLayer.create(
            'health_metrics',
            context.spaceId || 'global',
            `fitbit_sleep_${date}_${Date.now()}`,
            {
              date,
              source: 'fitbit',
              metrics: sleepMetrics,
              created_at: new Date().toISOString(),
              user_id: userId,
              tenant_id: tenantId,
            }
          )

          metricsCount += sleepMetrics.length
          syncedTypes.push('sleep')
        }
      } catch (error) {
        errors.push(`Sleep sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Sync weight data
    if (shouldSyncType('weight')) {
      try {
        const weightData = await fitbitClient.getWeightLog(userId, tenantId, date, '1d')

        if (weightData.weight.length > 0) {
          const latestWeight = weightData.weight[0]

          const weightMetrics = [
            { type: 'weight', value: latestWeight.weight, unit: 'kg' },
            { type: 'bmi', value: latestWeight.bmi, unit: 'kg/m²' },
          ]

          if (latestWeight.fat !== undefined) {
            weightMetrics.push({ type: 'body_fat', value: latestWeight.fat, unit: '%' })
          }

          await dataLayer.create(
            'health_metrics',
            context.spaceId || 'global',
            `fitbit_weight_${date}_${Date.now()}`,
            {
              date,
              source: 'fitbit',
              metrics: weightMetrics,
              created_at: new Date().toISOString(),
              user_id: userId,
              tenant_id: tenantId,
            }
          )

          metricsCount += weightMetrics.length
          syncedTypes.push('weight')
        }
      } catch (error) {
        errors.push(`Weight sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Sync body fat data
    if (shouldSyncType('body_fat')) {
      try {
        const bodyFatData = await fitbitClient.getBodyFatLog(userId, tenantId, date, '1d')

        if (bodyFatData.fat.length > 0) {
          const latestFat = bodyFatData.fat[0]

          const fatMetrics = [{ type: 'body_fat', value: latestFat.fat, unit: '%' }]

          await dataLayer.create(
            'health_metrics',
            context.spaceId || 'global',
            `fitbit_fat_${date}_${Date.now()}`,
            {
              date,
              source: 'fitbit',
              metrics: fatMetrics,
              created_at: new Date().toISOString(),
              user_id: userId,
              tenant_id: tenantId,
            }
          )

          metricsCount += fatMetrics.length
          syncedTypes.push('body_fat')
        }
      } catch (error) {
        errors.push(`Body fat sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Sync nutrition data
    if (shouldSyncType('nutrition')) {
      try {
        const foodData = await fitbitClient.getFoodLog(userId, tenantId, date)

        if (foodData.summary) {
          const nutritionMetrics = [
            { type: 'nutrition', value: foodData.summary.calories, unit: 'kcal', metadata: { type: 'calories' } },
            { type: 'nutrition', value: foodData.summary.carbs, unit: 'g', metadata: { type: 'carbs' } },
            { type: 'nutrition', value: foodData.summary.protein, unit: 'g', metadata: { type: 'protein' } },
            { type: 'nutrition', value: foodData.summary.fat, unit: 'g', metadata: { type: 'fat' } },
          ]

          await dataLayer.create(
            'health_metrics',
            context.spaceId || 'global',
            `fitbit_nutrition_${date}_${Date.now()}`,
            {
              date,
              source: 'fitbit',
              metrics: nutritionMetrics,
              created_at: new Date().toISOString(),
              user_id: userId,
              tenant_id: tenantId,
            }
          )

          metricsCount += nutritionMetrics.length
          syncedTypes.push('nutrition')
        }
      } catch (error) {
        errors.push(`Nutrition sync failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    errors.push(`Fitbit sync error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    metrics_synced: metricsCount,
    data_types_synced: syncedTypes,
    errors,
  }
}

/**
 * Sync fitness data
 */
export default async function sync_fitness_data(
  input: SyncFitnessDataInput,
  context: ToolContext
): Promise<SyncFitnessDataOutput> {
  try {
    const {
      source,
      data_types = ['all'],
      date = new Date().toISOString().split('T')[0],
      full_sync = false,
    } = input

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return {
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
      }
    }

    // Require user ID and tenant ID for sync
    if (!context.userId || !context.tenantId) {
      return {
        success: false,
        error: 'User ID and Tenant ID required for fitness data sync',
      }
    }

    logger.info('[sync_fitness_data] Starting sync', {
      source,
      data_types,
      date,
      full_sync,
    })

    let result: {
      metrics_synced: number
      data_types_synced: string[]
      errors: string[]
    }

    // Sync based on source
    if (source === 'fitbit') {
      result = await syncFromFitbit(
        context.userId,
        context.tenantId,
        data_types,
        date,
        full_sync,
        context
      )
    } else if (source === 'apple_health') {
      return {
        success: false,
        error: 'Apple Health sync not yet implemented. Coming soon!',
      }
    } else if (source === 'google_fit') {
      return {
        success: false,
        error: 'Google Fit sync not yet implemented. Coming soon!',
      }
    } else {
      return {
        success: false,
        error: `Unknown source: ${source}`,
      }
    }

    logger.info('[sync_fitness_data] Sync completed', {
      source,
      metrics_synced: result.metrics_synced,
      data_types_synced: result.data_types_synced,
      errors_count: result.errors.length,
    })

    return {
      success: true,
      result: {
        source,
        data_types_synced: result.data_types_synced,
        metrics_synced: result.metrics_synced,
        date_range: {
          start: date,
          end: date,
        },
        sync_timestamp: new Date().toISOString(),
        errors: result.errors.length > 0 ? result.errors : undefined,
      },
    }
  } catch (error) {
    logger.error('[sync_fitness_data] Sync failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
