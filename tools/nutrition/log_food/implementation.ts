import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { getSpoonacularClient } from '@/lib/integrations/recipe'
import { logger } from '@/lib/observability/logger'

interface NutritionInfo {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g?: number
  sugar_g?: number
  sodium_mg?: number
}

interface LogFoodInput {
  food_name: string
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  serving_size?: number
  serving_unit?: string
  recipe_id?: string
  nutrition?: NutritionInfo
  notes?: string
  logged_at?: string
}

interface LogFoodOutput {
  success: boolean
  result?: {
    log_id: string
    food_name: string
    meal_type: string
    nutrition: NutritionInfo
    logged_at: string
  }
  error?: string
}

/**
 * Log food intake with nutrition information for meal tracking and calorie counting
 *
 * @param input - Food logging parameters
 * @param context - Tool execution context
 * @returns Food log confirmation with nutrition summary
 */
export default async function logFood(
  input: LogFoodInput,
  context: ToolContext
): Promise<LogFoodOutput> {
  try {
    logger.info('Logging food intake', {
      food_name: input.food_name,
      meal_type: input.meal_type,
      has_recipe_id: !!input.recipe_id
    })

    const dataLayer = getData(context)
    let nutrition: NutritionInfo | undefined = input.nutrition

    // If recipe_id provided, fetch nutrition from recipes
    if (input.recipe_id) {
      try {
        const recipe = await dataLayer.read('recipes', context.spaceId, input.recipe_id)
        if (recipe?.nutrition) {
          nutrition = recipe.nutrition as NutritionInfo
          logger.debug('Using nutrition from recipe', { recipe_id: input.recipe_id })
        }
      } catch (error) {
        logger.warn('Could not fetch recipe nutrition', {
          recipe_id: input.recipe_id,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // If nutrition still not available, search Spoonacular
    if (!nutrition) {
      try {
        const spoonacular = getSpoonacularClient()
        const searchQuery = `${input.serving_size || 1} ${input.serving_unit || ''} ${input.food_name}`.trim()

        logger.debug('Searching Spoonacular for nutrition', { query: searchQuery })

        const nutritionData = await spoonacular.searchNutrition(searchQuery)

        if (nutritionData) {
          nutrition = {
            calories: nutritionData.calories || 0,
            protein_g: nutritionData.protein || 0,
            carbs_g: nutritionData.carbs || 0,
            fat_g: nutritionData.fat || 0,
            fiber_g: nutritionData.fiber,
            sugar_g: nutritionData.sugar,
            sodium_mg: nutritionData.sodium
          }
          logger.debug('Retrieved nutrition from Spoonacular', { nutrition })
        }
      } catch (error) {
        logger.warn('Could not fetch nutrition from Spoonacular', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // If still no nutrition, return error
    if (!nutrition) {
      return {
        success: false,
        error: 'Could not determine nutrition information. Please provide nutrition data manually.'
      }
    }

    // Create food log entry
    const logId = `food_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const loggedAt = input.logged_at || new Date().toISOString()

    const foodLog = {
      id: logId,
      food_name: input.food_name,
      meal_type: input.meal_type,
      serving_size: input.serving_size || 1,
      serving_unit: input.serving_unit || 'serving',
      recipe_id: input.recipe_id,
      nutrition,
      notes: input.notes,
      logged_at: loggedAt,
      created_at: new Date().toISOString()
    }

    // Store in nutrition_logs table
    await dataLayer.create('nutrition_logs', context.spaceId, logId, foodLog)

    logger.info('Food logged successfully', {
      log_id: logId,
      calories: nutrition.calories
    })

    return {
      success: true,
      result: {
        log_id: logId,
        food_name: input.food_name,
        meal_type: input.meal_type,
        nutrition,
        logged_at: loggedAt
      }
    }

  } catch (error) {
    logger.error('Failed to log food', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to log food intake'
    }
  }
}
