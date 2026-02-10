import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { getFitbitClient } from '@/lib/integrations/health'
import { logger } from '@/lib/observability/logger'

interface LogSleepInput {
  sleep_start?: string
  sleep_end?: string
  duration_hours?: number
  quality?: 'poor' | 'fair' | 'good' | 'excellent'
  notes?: string
  sync_from_fitbit?: boolean
}

interface LogSleepOutput {
  success: boolean
  result?: {
    log_id: string
    sleep_start: string
    sleep_end: string
    duration_hours: number
    quality?: string
    notes?: string
    synced_from_fitbit?: boolean
  }
  error?: string
}

/**
 * Calculate sleep duration from start and end times
 *
 * @param start - Sleep start timestamp
 * @param end - Sleep end timestamp
 * @returns Duration in hours
 */
function calculateDuration(start: string, end: string): number {
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  const durationMs = endTime - startTime
  return Math.round((durationMs / (1000 * 60 * 60)) * 10) / 10 // Round to 1 decimal
}

/**
 * Log sleep duration, quality, and patterns
 *
 * @param input - Sleep logging parameters
 * @param context - Tool execution context
 * @returns Sleep log summary
 */
export default async function logSleep(
  input: LogSleepInput,
  context: ToolContext
): Promise<LogSleepOutput> {
  try {
    logger.info('Logging sleep', { sync_from_fitbit: input.sync_from_fitbit })

    let sleepData: any = {}
    let syncedFromFitbit = false

    // Sync from Fitbit if requested
    if (input.sync_from_fitbit) {
      try {
        const fitbit = getFitbitClient()
        const today = new Date().toISOString().split('T')[0]

        logger.debug('Fetching sleep data from Fitbit', { date: today })

        const fitbitSleep = await fitbit.getSleepLog(today)

        if (fitbitSleep) {
          sleepData = {
            sleep_start: fitbitSleep.startTime,
            sleep_end: fitbitSleep.endTime,
            duration_hours: fitbitSleep.duration / 60, // Convert minutes to hours
            quality: fitbitSleep.efficiency >= 85 ? 'excellent' :
                     fitbitSleep.efficiency >= 75 ? 'good' :
                     fitbitSleep.efficiency >= 60 ? 'fair' : 'poor',
            notes: `Sleep efficiency: ${fitbitSleep.efficiency}%`
          }
          syncedFromFitbit = true
          logger.debug('Retrieved sleep data from Fitbit', { duration_hours: sleepData.duration_hours })
        }
      } catch (error) {
        logger.warn('Could not sync from Fitbit, using manual input', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // Use manual input if not synced from Fitbit
    if (!syncedFromFitbit) {
      if (!input.sleep_start || !input.sleep_end) {
        return {
          success: false,
          error: 'sleep_start and sleep_end are required for manual entry'
        }
      }

      const duration = input.duration_hours || calculateDuration(input.sleep_start, input.sleep_end)

      sleepData = {
        sleep_start: input.sleep_start,
        sleep_end: input.sleep_end,
        duration_hours: duration,
        quality: input.quality,
        notes: input.notes
      }
    }

    // Create sleep log entry
    const logId = `sleep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const dataLayer = getData(context)

    const sleepLog = {
      id: logId,
      metric_type: 'sleep',
      metric_value: sleepData.duration_hours,
      metadata: {
        sleep_start: sleepData.sleep_start,
        sleep_end: sleepData.sleep_end,
        quality: sleepData.quality,
        notes: sleepData.notes,
        synced_from_fitbit: syncedFromFitbit
      },
      recorded_at: sleepData.sleep_end,
      created_at: new Date().toISOString()
    }

    // Store in health_metrics table
    await dataLayer.create('health_metrics', context.spaceId, logId, sleepLog)

    logger.info('Sleep logged successfully', {
      log_id: logId,
      duration_hours: sleepData.duration_hours,
      synced: syncedFromFitbit
    })

    return {
      success: true,
      result: {
        log_id: logId,
        sleep_start: sleepData.sleep_start,
        sleep_end: sleepData.sleep_end,
        duration_hours: sleepData.duration_hours,
        quality: sleepData.quality,
        notes: sleepData.notes,
        synced_from_fitbit: syncedFromFitbit
      }
    }

  } catch (error) {
    logger.error('Failed to log sleep', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to log sleep data'
    }
  }
}
