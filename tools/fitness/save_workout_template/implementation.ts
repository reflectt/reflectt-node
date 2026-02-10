import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/observability/logger'

interface SaveWorkoutTemplateInput {
  workout_id: string
  template_name?: string
  mark_as_favorite?: boolean
  tags?: string[]
}

interface SaveWorkoutTemplateOutput {
  success: boolean
  result?: {
    template_id: string
    name: string
    exercises: any[]
    total_exercises: number
    is_favorite: boolean
    tags: string[]
    created_from_workout_id: string
  }
  error?: string
}

/**
 * Save a completed workout as a reusable template for future workouts
 * @param input - Template save parameters
 * @param context - Tool context for path resolution and data operations
 * @returns Template creation result
 */
export default async function saveWorkoutTemplate(
  input: SaveWorkoutTemplateInput,
  context: ToolContext
): Promise<SaveWorkoutTemplateOutput> {
  try {
    logger.info('Saving workout template', {
      workout_id: input.workout_id,
      template_name: input.template_name
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

    // Fetch the completed workout
    const { data: workout, error: fetchError } = await supabase
      .from('workouts')
      .select('*')
      .eq('id', input.workout_id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !workout) {
      throw new Error(`Workout not found: ${input.workout_id}`)
    }

    if (workout.workout_type !== 'completed') {
      throw new Error('Can only create templates from completed workouts')
    }

    // Transform exercises - remove actual performance data, keep structure
    const templateExercises = (workout.exercises || []).map((ex: any) => ({
      exercise_id: ex.exercise_id,
      name: ex.name,
      sets: ex.sets || 3,
      reps: ex.reps || 10,
      rest_seconds: ex.rest_seconds || 60,
      // Remove actual weight, duration, and notes - these are performance data
      // Template users will fill these in when they use the template
    }))

    // Merge tags
    const mergedTags = Array.from(new Set([
      ...(workout.tags || []),
      ...(input.tags || [])
    ]))

    // Create template workout
    const templateData = {
      user_id: userId,
      name: input.template_name || `${workout.name} (Template)`,
      workout_type: 'template',
      description: workout.description,
      exercises: templateExercises,
      tags: mergedTags,
      estimated_duration_minutes: workout.estimated_duration_minutes,
      estimated_calories: workout.estimated_calories,
      is_favorite: input.mark_as_favorite || false,
      metadata: {
        created_from_workout_id: input.workout_id,
        created_from_date: workout.completed_at
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data: template, error: insertError } = await supabase
      .from('workouts')
      .insert(templateData)
      .select()
      .single()

    if (insertError) {
      throw new Error(`Failed to create template: ${insertError.message}`)
    }

    logger.info('Workout template saved', {
      template_id: template.id,
      workout_id: input.workout_id,
      is_favorite: input.mark_as_favorite
    })

    return {
      success: true,
      result: {
        template_id: template.id,
        name: template.name,
        exercises: templateExercises,
        total_exercises: templateExercises.length,
        is_favorite: template.is_favorite,
        tags: mergedTags,
        created_from_workout_id: input.workout_id
      }
    }
  } catch (error) {
    logger.error('Error saving workout template', {
      error: error instanceof Error ? error.message : String(error),
      workout_id: input.workout_id
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error saving workout template'
    }
  }
}
