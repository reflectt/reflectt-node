import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createExerciseDBClient } from '@/lib/integrations/fitness/exercisedb-client'
import { logger } from '@/lib/observability/logger'

interface GetExerciseInfoInput {
  query: string
  body_part?: string
  equipment?: string
  target_muscle?: string
}

interface ExerciseInfo {
  id: string
  name: string
  body_part: string
  equipment: string
  target_muscle: string
  secondary_muscles: string[]
  instructions: string[]
  gif_url: string
}

interface GetExerciseInfoOutput {
  success: boolean
  result?: {
    exercises: ExerciseInfo[]
    total_results: number
    query: string
    filters_applied?: {
      body_part?: string
      equipment?: string
      target_muscle?: string
    }
  }
  error?: string
}

/**
 * Get detailed information about an exercise including proper form, target muscles, equipment needed, and demonstration
 * @param input - Exercise search parameters
 * @param context - Tool context for path resolution and data operations
 * @returns Exercise information with details and instructions
 */
export default async function getExerciseInfo(
  input: GetExerciseInfoInput,
  context: ToolContext
): Promise<GetExerciseInfoOutput> {
  try {
    logger.info('Getting exercise info', {
      query: input.query,
      filters: {
        body_part: input.body_part,
        equipment: input.equipment,
        target_muscle: input.target_muscle
      }
    })

    const exerciseDB = createExerciseDBClient()

    // Search for exercises
    let exercises = await exerciseDB.searchExercises(input.query)

    // Apply filters if provided
    if (input.body_part) {
      exercises = exercises.filter(ex =>
        ex.bodyPart.toLowerCase() === input.body_part!.toLowerCase()
      )
    }

    if (input.equipment) {
      exercises = exercises.filter(ex =>
        ex.equipment.toLowerCase() === input.equipment!.toLowerCase()
      )
    }

    if (input.target_muscle) {
      exercises = exercises.filter(ex =>
        ex.target.toLowerCase() === input.target_muscle!.toLowerCase()
      )
    }

    // If no results with filters, try without filters
    if (exercises.length === 0 && (input.body_part || input.equipment || input.target_muscle)) {
      logger.debug('No results with filters, retrying without filters')
      exercises = await exerciseDB.searchExercises(input.query)
    }

    if (exercises.length === 0) {
      logger.warn('No exercises found', { query: input.query })
      return {
        success: true,
        result: {
          exercises: [],
          total_results: 0,
          query: input.query,
          filters_applied: {
            body_part: input.body_part,
            equipment: input.equipment,
            target_muscle: input.target_muscle
          }
        }
      }
    }

    // Transform to output format
    const exerciseInfoList: ExerciseInfo[] = exercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      body_part: ex.bodyPart,
      equipment: ex.equipment,
      target_muscle: ex.target,
      secondary_muscles: ex.secondaryMuscles || [],
      instructions: ex.instructions || [],
      gif_url: ex.gifUrl
    }))

    // Limit to top 10 results
    const limitedResults = exerciseInfoList.slice(0, 10)

    logger.info('Exercise info retrieved', {
      total_results: limitedResults.length,
      query: input.query
    })

    return {
      success: true,
      result: {
        exercises: limitedResults,
        total_results: limitedResults.length,
        query: input.query,
        filters_applied: {
          body_part: input.body_part,
          equipment: input.equipment,
          target_muscle: input.target_muscle
        }
      }
    }
  } catch (error) {
    logger.error('Error getting exercise info', {
      error: error instanceof Error ? error.message : String(error),
      query: input.query
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error getting exercise info'
    }
  }
}
