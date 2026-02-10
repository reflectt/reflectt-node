import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'

interface TrackWaterInput {
  amount_ml?: number
  date?: string
  daily_goal_ml?: number
  reset_daily_total?: boolean
  get_summary?: boolean
}

interface TrackWaterOutput {
  success: boolean
  result?: {
    date: string
    total_ml: number
    goal_ml: number
    remaining_ml: number
    progress_percent: number
    entries_count: number
    last_entry?: {
      amount_ml: number
      time: string
    }
  }
  error?: string
}

/**
 * Track daily water intake and compare to hydration goals
 *
 * @param input - Water tracking parameters
 * @param context - Tool execution context
 * @returns Water tracking summary
 */
export default async function trackWater(
  input: TrackWaterInput,
  context: ToolContext
): Promise<TrackWaterOutput> {
  try {
    const date = input.date || new Date().toISOString().split('T')[0]
    const goalMl = input.daily_goal_ml || 2000

    logger.info('Tracking water intake', {
      date,
      get_summary: input.get_summary,
      reset: input.reset_daily_total
    })

    const dataLayer = getData(context)

    // If reset requested, delete all water logs for the day
    if (input.reset_daily_total) {
      const allLogs = await dataLayer.list('health_metrics', context.spaceId)
      const waterLogsForDate = allLogs.filter((log: any) => {
        const logDate = log.recorded_at?.split('T')[0] || log.created_at?.split('T')[0]
        return log.metric_type === 'water' && logDate === date
      })

      for (const log of waterLogsForDate) {
        await dataLayer.delete('health_metrics', context.spaceId, log.id)
      }

      logger.info('Reset daily water total', { date, deleted_count: waterLogsForDate.length })

      return {
        success: true,
        result: {
          date,
          total_ml: 0,
          goal_ml: goalMl,
          remaining_ml: goalMl,
          progress_percent: 0,
          entries_count: 0
        }
      }
    }

    // If not get_summary and amount provided, log new water intake
    if (!input.get_summary && input.amount_ml) {
      const logId = `water_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      const waterLog = {
        id: logId,
        metric_type: 'water',
        metric_value: input.amount_ml,
        metadata: {
          unit: 'ml'
        },
        recorded_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }

      await dataLayer.create('health_metrics', context.spaceId, logId, waterLog)

      logger.debug('Water intake logged', { log_id: logId, amount_ml: input.amount_ml })
    }

    // Get daily summary (always, whether logging or just getting summary)
    const allLogs = await dataLayer.list('health_metrics', context.spaceId)

    const waterLogsForDate = allLogs.filter((log: any) => {
      const logDate = log.recorded_at?.split('T')[0] || log.created_at?.split('T')[0]
      return log.metric_type === 'water' && logDate === date
    })

    // Sort by time to get latest entry
    const sortedLogs = waterLogsForDate.sort((a: any, b: any) => {
      const timeA = new Date(a.recorded_at || a.created_at).getTime()
      const timeB = new Date(b.recorded_at || b.created_at).getTime()
      return timeB - timeA
    })

    // Calculate total
    const totalMl = waterLogsForDate.reduce((total: number, log: any) => {
      return total + (log.metric_value || 0)
    }, 0)

    const remainingMl = Math.max(0, goalMl - totalMl)
    const progressPercent = Math.min(Math.round((totalMl / goalMl) * 100), 100)

    const result: any = {
      date,
      total_ml: Math.round(totalMl),
      goal_ml: goalMl,
      remaining_ml: Math.round(remainingMl),
      progress_percent: progressPercent,
      entries_count: waterLogsForDate.length
    }

    // Add last entry info if exists
    if (sortedLogs.length > 0) {
      const lastLog = sortedLogs[0]
      result.last_entry = {
        amount_ml: Math.round(lastLog.metric_value),
        time: lastLog.recorded_at || lastLog.created_at
      }
    }

    logger.info('Water tracking summary', {
      total_ml: result.total_ml,
      goal_ml: goalMl,
      progress_percent: progressPercent
    })

    return {
      success: true,
      result
    }

  } catch (error) {
    logger.error('Failed to track water', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to track water intake'
    }
  }
}
