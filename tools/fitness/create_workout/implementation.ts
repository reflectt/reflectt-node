import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createExerciseDBClient } from '@/lib/integrations/fitness/exercisedb-client'
import { generateWorkoutPlan } from '@/lib/integrations/fitness/exercisedb-parser'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'

interface Exercise {
  exercise_id?: string
  name: string
  sets?: number
  reps?: number
  weight_kg?: number
  duration_seconds?: number
  rest_seconds?: number
}

interface CreateWorkoutInput {
  name: string
  workout_type?: 'template' | 'completed'
  exercises?: Exercise[]
  description?: string
  tags?: string[]
  auto_generate?: boolean
  body_parts?: string[]
  duration_minutes?: number
  equipment?: string[]
}

interface CreateWorkoutOutput {
  success: boolean
  result?: {
    workout_id: string
    name: string
    workout_type: string
    exercises: Exercise[]
    total_exercises: number
    estimated_duration_minutes: number
    estimated_calories?: number
    description?: string
    tags?: string[]
  }
  error?: string
}

/**
 * Create a new workout plan or template with exercises, sets, reps, and rest periods
 * @param input - Workout configuration
 * @param context - Tool context for path resolution and data operations
 * @returns Workout creation result
 */
export default async function createWorkout(
  input: CreateWorkoutInput,
  context: ToolContext
): Promise<CreateWorkoutOutput> {
  try {
    logger.info('Creating workout', {
      name: input.name,
      auto_generate: input.auto_generate,
      workout_type: input.workout_type || 'template'
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    let exercises: Exercise[] = []

    // Auto-generate workout if requested
    if (input.auto_generate) {
      logger.debug('Auto-generating workout', {
        body_parts: input.body_parts,
        duration_minutes: input.duration_minutes,
        equipment: input.equipment
      })

      const exerciseDB = createExerciseDBClient()
      const generatedWorkout = await generateWorkoutPlan({
        bodyParts: input.body_parts || [],
        durationMinutes: input.duration_minutes || 45,
        equipment: input.equipment,
        exerciseDB
      })

      exercises = generatedWorkout.exercises
    } else if (input.exercises && input.exercises.length > 0) {
      exercises = input.exercises
    } else {
      throw new Error('Either provide exercises array or set auto_generate to true')
    }

    // Calculate workout metrics
    const estimatedDuration = exercises.reduce((total, ex) => {
      const exerciseTime = (ex.sets || 3) * ((ex.reps || 10) * 3 + (ex.rest_seconds || 60))
      return total + exerciseTime
    }, 0) / 60 // Convert to minutes

    const estimatedCalories = Math.round(estimatedDuration * 8) // Rough estimate: 8 cal/min

    // Get user ID from environment or use demo user
    // TODO: In production, this should come from authenticated session
    const userId = process.env.USER_ID || 'demo-user'

    // Insert workout into database
    const workoutData = {
      user_id: userId,
      name: input.name,
      workout_type: input.workout_type || 'template',
      description: input.description,
      exercises: exercises,
      tags: input.tags || [],
      estimated_duration_minutes: Math.round(estimatedDuration),
      estimated_calories: estimatedCalories,
      is_favorite: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data: workout, error: insertError } = await supabase
      .from('workouts')
      .insert(workoutData)
      .select()
      .single()

    if (insertError) {
      logger.error('Failed to insert workout', { error: insertError.message })
      throw new Error(`Failed to create workout: ${insertError.message}`)
    }

    logger.info('Workout created successfully', {
      workout_id: workout.id,
      total_exercises: exercises.length
    })

    return {
      success: true,
      result: {
        workout_id: workout.id,
        name: workout.name,
        workout_type: workout.workout_type,
        exercises: exercises,
        total_exercises: exercises.length,
        estimated_duration_minutes: Math.round(estimatedDuration),
        estimated_calories: estimatedCalories,
        description: input.description,
        tags: input.tags
      }
    }
  } catch (error) {
    logger.error('Error creating workout', {
      error: error instanceof Error ? error.message : String(error),
      name: input.name
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating workout'
    }
  }
}
