import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'

interface TrackProgressInput {
  exercise_name?: string
  metric?: 'weight' | 'reps' | 'volume' | 'frequency' | 'duration'
  period?: 'week' | 'month' | '3months' | 'year' | 'all'
  include_chart_data?: boolean
}

interface ProgressDataPoint {
  date: string
  value: number
  workout_id: string
  sets?: number
  reps?: number
  weight_kg?: number
}

interface PersonalRecord {
  metric: string
  value: number
  date: string
  workout_id: string
}

interface TrackProgressOutput {
  success: boolean
  result?: {
    exercise_name?: string
    metric: string
    period: string
    current_value?: number
    previous_value?: number
    change_percentage?: number
    trend: 'improving' | 'declining' | 'stable'
    personal_records: PersonalRecord[]
    data_points?: ProgressDataPoint[]
    chart_data?: {
      labels: string[]
      values: number[]
    }
    summary: string
  }
  error?: string
}

/**
 * Track fitness progress over time for specific exercises
 * @param input - Progress tracking parameters
 * @param context - Tool context for path resolution and data operations
 * @returns Progress tracking results with trend analysis
 */
export default async function trackProgress(
  input: TrackProgressInput,
  context: ToolContext
): Promise<TrackProgressOutput> {
  try {
    const metric = input.metric || 'weight'
    const period = input.period || '3months'

    logger.info('Tracking progress', {
      exercise_name: input.exercise_name,
      metric,
      period
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get user ID from environment or use demo user
    // TODO: In production, this should come from authenticated session
    const userId = process.env.USER_ID || 'demo-user'

    // Calculate date range based on period
    const now = new Date()
    let startDate: Date

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case '3months':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      case 'all':
        startDate = new Date(0)
        break
      default:
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    }

    // Fetch workouts in date range
    let query = supabase
      .from('workouts')
      .select('*')
      .eq('user_id', userId)
      .eq('workout_type', 'completed')
      .gte('completed_at', startDate.toISOString())
      .order('completed_at', { ascending: true })

    const { data: workouts, error: fetchError } = await query

    if (fetchError) {
      throw new Error(`Failed to fetch workouts: ${fetchError.message}`)
    }

    if (!workouts || workouts.length === 0) {
      return {
        success: true,
        result: {
          exercise_name: input.exercise_name,
          metric,
          period,
          trend: 'stable',
          personal_records: [],
          data_points: [],
          summary: 'No workout data found in the specified period'
        }
      }
    }

    // Extract exercise data
    const dataPoints: ProgressDataPoint[] = []
    let maxWeight = 0
    let maxReps = 0
    let maxVolume = 0
    let maxDuration = 0
    const personalRecords: PersonalRecord[] = []

    for (const workout of workouts) {
      const exercises = workout.exercises || []

      for (const exercise of exercises) {
        // Filter by exercise name if provided
        if (input.exercise_name &&
            exercise.name.toLowerCase() !== input.exercise_name.toLowerCase()) {
          continue
        }

        const date = workout.completed_at
        let value = 0

        // Calculate metric value
        switch (metric) {
          case 'weight':
            value = exercise.weight_kg || 0
            if (value > maxWeight) {
              maxWeight = value
              personalRecords.push({
                metric: 'weight',
                value,
                date,
                workout_id: workout.id
              })
            }
            break
          case 'reps':
            value = exercise.reps || 0
            if (value > maxReps) {
              maxReps = value
              personalRecords.push({
                metric: 'reps',
                value,
                date,
                workout_id: workout.id
              })
            }
            break
          case 'volume':
            value = (exercise.sets || 0) * (exercise.reps || 0) * (exercise.weight_kg || 0)
            if (value > maxVolume) {
              maxVolume = value
              personalRecords.push({
                metric: 'volume',
                value,
                date,
                workout_id: workout.id
              })
            }
            break
          case 'duration':
            value = exercise.duration_seconds || 0
            if (value > maxDuration) {
              maxDuration = value
              personalRecords.push({
                metric: 'duration',
                value,
                date,
                workout_id: workout.id
              })
            }
            break
          case 'frequency':
            value = 1 // Count occurrences
            break
        }

        dataPoints.push({
          date,
          value,
          workout_id: workout.id,
          sets: exercise.sets,
          reps: exercise.reps,
          weight_kg: exercise.weight_kg
        })
      }
    }

    if (dataPoints.length === 0) {
      return {
        success: true,
        result: {
          exercise_name: input.exercise_name,
          metric,
          period,
          trend: 'stable',
          personal_records: [],
          data_points: [],
          summary: input.exercise_name
            ? `No data found for exercise: ${input.exercise_name}`
            : 'No exercise data found in the specified period'
        }
      }
    }

    // Calculate trend
    const recentData = dataPoints.slice(-5)
    const oldData = dataPoints.slice(0, 5)
    const recentAvg = recentData.reduce((sum, d) => sum + d.value, 0) / recentData.length
    const oldAvg = oldData.reduce((sum, d) => sum + d.value, 0) / oldData.length

    let trend: 'improving' | 'declining' | 'stable' = 'stable'
    let changePercentage = 0

    if (oldAvg > 0) {
      changePercentage = ((recentAvg - oldAvg) / oldAvg) * 100
      if (changePercentage > 5) trend = 'improving'
      else if (changePercentage < -5) trend = 'declining'
    }

    // Prepare chart data if requested
    let chartData
    if (input.include_chart_data) {
      chartData = {
        labels: dataPoints.map(d => new Date(d.date).toLocaleDateString()),
        values: dataPoints.map(d => d.value)
      }
    }

    // Keep only latest PR for each metric
    const uniquePRs = personalRecords.reduce((acc, pr) => {
      acc[pr.metric] = pr
      return acc
    }, {} as Record<string, PersonalRecord>)

    const summary = `${input.exercise_name || 'Overall progress'}: ${trend} trend with ${changePercentage.toFixed(1)}% change over ${period}. ${Object.keys(uniquePRs).length} personal record(s) set.`

    logger.info('Progress tracked successfully', {
      exercise_name: input.exercise_name,
      data_points: dataPoints.length,
      trend
    })

    return {
      success: true,
      result: {
        exercise_name: input.exercise_name,
        metric,
        period,
        current_value: recentAvg,
        previous_value: oldAvg,
        change_percentage: changePercentage,
        trend,
        personal_records: Object.values(uniquePRs),
        data_points: dataPoints,
        chart_data: chartData,
        summary
      }
    }
  } catch (error) {
    logger.error('Error tracking progress', {
      error: error instanceof Error ? error.message : String(error),
      exercise_name: input.exercise_name
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error tracking progress'
    }
  }
}
