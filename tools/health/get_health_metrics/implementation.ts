/**
 * Get Health Metrics Tool
 *
 * Retrieves health metrics like heart rate, blood pressure, weight, BMI, body fat
 * for analysis and tracking with optional trend analysis.
 *
 * @module tools/health/get_health_metrics
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

type MetricType =
  | 'heart_rate'
  | 'blood_pressure'
  | 'weight'
  | 'bmi'
  | 'body_fat'
  | 'vo2_max'
  | 'resting_hr'
  | 'steps'
  | 'distance'
  | 'calories'
  | 'active_minutes'

interface GetHealthMetricsInput {
  metric_types?: MetricType[]
  start_date?: string
  end_date?: string
  include_trend?: boolean
}

interface MetricData {
  type: string
  values: Array<{
    date: string
    value: number
    unit: string
    metadata?: Record<string, any>
  }>
  trend?: {
    direction: 'increasing' | 'decreasing' | 'stable'
    change_percent: number
    average: number
  }
}

interface GetHealthMetricsOutput {
  success: boolean
  result?: {
    metrics: MetricData[]
    date_range: {
      start: string
      end: string
    }
    total_records: number
  }
  error?: string
}

/**
 * Calculate trend from metric values
 */
function calculateTrend(values: Array<{ value: number }>): {
  direction: 'increasing' | 'decreasing' | 'stable'
  change_percent: number
  average: number
} {
  if (values.length < 2) {
    return { direction: 'stable', change_percent: 0, average: values[0]?.value || 0 }
  }

  const average = values.reduce((sum, v) => sum + v.value, 0) / values.length
  const firstHalf = values.slice(0, Math.floor(values.length / 2))
  const secondHalf = values.slice(Math.floor(values.length / 2))

  const firstAvg = firstHalf.reduce((sum, v) => sum + v.value, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((sum, v) => sum + v.value, 0) / secondHalf.length

  const changePercent = firstAvg !== 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0

  let direction: 'increasing' | 'decreasing' | 'stable' = 'stable'
  if (Math.abs(changePercent) > 5) {
    direction = changePercent > 0 ? 'increasing' : 'decreasing'
  }

  return {
    direction,
    change_percent: Math.round(changePercent * 100) / 100,
    average: Math.round(average * 100) / 100,
  }
}

/**
 * Get health metrics
 */
export default async function get_health_metrics(
  input: GetHealthMetricsInput,
  context: ToolContext
): Promise<GetHealthMetricsOutput> {
  try {
    const {
      metric_types,
      start_date,
      end_date,
      include_trend = false,
    } = input

    // Default date range: 30 days ago to today
    const endDate = end_date || new Date().toISOString().split('T')[0]
    const startDate =
      start_date ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Validate date formats
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return {
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
      }
    }

    logger.info('[get_health_metrics] Retrieving health metrics', {
      metric_types: metric_types || 'all',
      start_date: startDate,
      end_date: endDate,
      include_trend,
    })

    const dataLayer = getData(context)

    // List all health metric entries
    const allMetrics = await dataLayer.list('health_metrics', context.spaceId || 'global')

    // Filter by date range
    const filteredMetrics = allMetrics.filter((metric: any) => {
      if (!metric.date) return false
      return metric.date >= startDate && metric.date <= endDate
    })

    // Group metrics by type
    const metricsByType: Record<string, MetricData> = {}

    for (const metricEntry of filteredMetrics) {
      if (!metricEntry.metrics || !Array.isArray(metricEntry.metrics)) continue

      for (const metric of metricEntry.metrics) {
        // Filter by metric type if specified
        if (metric_types && metric_types.length > 0 && !metric_types.includes(metric.type)) {
          continue
        }

        if (!metricsByType[metric.type]) {
          metricsByType[metric.type] = {
            type: metric.type,
            values: [],
          }
        }

        metricsByType[metric.type].values.push({
          date: metricEntry.date,
          value: metric.value,
          unit: metric.unit,
          metadata: metric.metadata,
        })
      }
    }

    // Calculate trends if requested
    const metrics: MetricData[] = Object.values(metricsByType).map((metric) => {
      // Sort by date
      metric.values.sort((a, b) => a.date.localeCompare(b.date))

      if (include_trend) {
        metric.trend = calculateTrend(metric.values)
      }

      return metric
    })

    logger.info('[get_health_metrics] Retrieved health metrics', {
      metric_count: metrics.length,
      total_records: filteredMetrics.length,
    })

    return {
      success: true,
      result: {
        metrics,
        date_range: {
          start: startDate,
          end: endDate,
        },
        total_records: filteredMetrics.length,
      },
    }
  } catch (error) {
    logger.error('[get_health_metrics] Error retrieving metrics', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
