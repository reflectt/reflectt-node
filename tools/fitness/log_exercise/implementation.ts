import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createExerciseDBClient } from '@/lib/integrations/fitness/exercisedb-client'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'

interface LogExerciseInput {
  exercise_name: string
  exercise_id?: string
  sets?: number
  reps?: number
  weight_kg?: number
  duration_seconds?: number
  notes?: string
  workout_id?: string
}

interface LogExerciseOutput {
  success: boolean
  result?: {
    workout_id: string
    exercise_name: string
    exercise_id?: string
    sets?: number
    reps?: number
    weight_kg?: number
    duration_seconds?: number
    notes?: string
    logged_at: string
  }
  error?: string
}

/**
 * Log a completed exercise with sets, reps, weight, and performance notes
 * @param input - Exercise log details
 * @param context - Tool context for path resolution and data operations
 * @returns Exercise logging result
 */
export default async function logExercise(
  input: LogExerciseInput,
  context: ToolContext
): Promise<LogExerciseOutput> {
  try {
    logger.info('Logging exercise', {
      exercise_name: input.exercise_name,
      workout_id: input.workout_id
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

    let exerciseId = input.exercise_id

    // If no exercise_id provided, search ExerciseDB
    if (!exerciseId) {
      logger.debug('Searching for exercise in ExerciseDB', { name: input.exercise_name })

      const exerciseDB = createExerciseDBClient()
      const searchResults = await exerciseDB.searchExercises(input.exercise_name)

      if (searchResults.length > 0) {
        exerciseId = searchResults[0].id
        logger.debug('Found exercise in ExerciseDB', {
          exercise_id: exerciseId,
          name: searchResults[0].name
        })
      }
    }

    const exerciseLog = {
      exercise_id: exerciseId,
      name: input.exercise_name,
      sets: input.sets,
      reps: input.reps,
      weight_kg: input.weight_kg,
      duration_seconds: input.duration_seconds,
      notes: input.notes
    }

    const timestamp = new Date().toISOString()

    // If workout_id provided, add to existing workout
    if (input.workout_id) {
      logger.debug('Adding exercise to existing workout', { workout_id: input.workout_id })

      const { data: workout, error: fetchError } = await supabase
        .from('workouts')
        .select('exercises')
        .eq('id', input.workout_id)
        .eq('user_id', userId)
        .single()

      if (fetchError || !workout) {
        throw new Error(`Workout not found: ${input.workout_id}`)
      }

      const updatedExercises = [...(workout.exercises || []), exerciseLog]

      const { error: updateError } = await supabase
        .from('workouts')
        .update({
          exercises: updatedExercises,
          updated_at: timestamp
        })
        .eq('id', input.workout_id)
        .eq('user_id', userId)

      if (updateError) {
        throw new Error(`Failed to update workout: ${updateError.message}`)
      }

      logger.info('Exercise added to workout', {
        workout_id: input.workout_id,
        exercise_name: input.exercise_name
      })

      return {
        success: true,
        result: {
          workout_id: input.workout_id,
          exercise_name: input.exercise_name,
          exercise_id: exerciseId,
          sets: input.sets,
          reps: input.reps,
          weight_kg: input.weight_kg,
          duration_seconds: input.duration_seconds,
          notes: input.notes,
          logged_at: timestamp
        }
      }
    } else {
      // Create new single-exercise workout
      logger.debug('Creating new workout for exercise')

      const workoutData = {
        user_id: userId,
        name: `${input.exercise_name} - ${new Date().toLocaleDateString()}`,
        workout_type: 'completed',
        exercises: [exerciseLog],
        completed_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp
      }

      const { data: newWorkout, error: insertError } = await supabase
        .from('workouts')
        .insert(workoutData)
        .select()
        .single()

      if (insertError) {
        throw new Error(`Failed to create workout: ${insertError.message}`)
      }

      logger.info('Created new workout for exercise', {
        workout_id: newWorkout.id,
        exercise_name: input.exercise_name
      })

      return {
        success: true,
        result: {
          workout_id: newWorkout.id,
          exercise_name: input.exercise_name,
          exercise_id: exerciseId,
          sets: input.sets,
          reps: input.reps,
          weight_kg: input.weight_kg,
          duration_seconds: input.duration_seconds,
          notes: input.notes,
          logged_at: timestamp
        }
      }
    }
  } catch (error) {
    logger.error('Error logging exercise', {
      error: error instanceof Error ? error.message : String(error),
      exercise_name: input.exercise_name
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error logging exercise'
    }
  }
}
