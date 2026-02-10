import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getSpoonacularClient } from '@/lib/integrations/recipe'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface IngredientInput {
  name: string
  amount: number
  unit: string
}

interface CalculateNutritionInput {
  recipe_id?: string
  ingredients?: IngredientInput[]
  servings?: number
}

interface NutrientInfo {
  name: string
  amount: number
  unit: string
  percentOfDailyNeeds: number
}

interface NutritionBreakdown {
  calories: number
  protein: number
  fat: number
  carbohydrates: number
  fiber: number
  sugar: number
  sodium: number
  nutrients: NutrientInfo[]
  servings: number
  per_serving: {
    calories: number
    protein: number
    fat: number
    carbohydrates: number
  }
}

interface CalculateNutritionOutput {
  success: boolean
  result?: NutritionBreakdown
  error?: string
}

/**
 * Calculate detailed nutrition information
 *
 * Analyzes recipe or ingredient list to provide comprehensive nutrition
 * data including calories, macros, and micronutrients per serving.
 *
 * @param input - Recipe ID or ingredient list
 * @param context - Tool execution context
 * @returns Detailed nutrition breakdown
 */
export default async function calculateNutrition(
  input: CalculateNutritionInput,
  context: ToolContext
): Promise<CalculateNutritionOutput> {
  try {
    if (!input.recipe_id && !input.ingredients) {
      return {
        success: false,
        error: 'Must provide either recipe_id or ingredients list'
      }
    }

    logger.info('Calculating nutrition', {
      recipe_id: input.recipe_id,
      ingredients_count: input.ingredients?.length
    })

    const dataLayer = getData(context)
    const client = getSpoonacularClient()
    const servings = input.servings || 1

    let nutrition: any

    // If recipe_id provided, get nutrition from stored recipe
    if (input.recipe_id) {
      const recipe = await dataLayer.read('recipes', 'global', input.recipe_id)

      if (!recipe) {
        return {
          success: false,
          error: `Recipe ${input.recipe_id} not found. Please fetch recipe details first.`
        }
      }

      // If recipe has nutrition cached, use it
      if (recipe.nutrition && recipe.nutrition.nutrients) {
        nutrition = recipe.nutrition
      } else {
        // Fetch fresh nutrition data
        const apiRecipe = await client.getRecipeInformation(
          parseInt(input.recipe_id),
          true // includeNutrition
        )
        nutrition = apiRecipe.nutrition

        // Update cache
        try {
          await dataLayer.update('recipes', 'global', input.recipe_id, {
            nutrition,
            cached_at: new Date().toISOString()
          })
        } catch (updateError) {
          logger.warn('Failed to update recipe nutrition cache', {
            recipe_id: input.recipe_id
          })
        }
      }
    }
    // If ingredients provided, analyze them
    else if (input.ingredients) {
      // Convert ingredients to ingredient list format
      const ingredientList = input.ingredients.map(ing =>
        `${ing.amount} ${ing.unit} ${ing.name}`
      ).join('\n')

      // Analyze recipe nutrition via Spoonacular
      const response = await client.analyzeRecipe({
        title: 'Custom Recipe',
        servings: servings,
        ingredients: ingredientList
      })

      nutrition = response.nutrition
    }

    if (!nutrition || !nutrition.nutrients) {
      return {
        success: false,
        error: 'Failed to calculate nutrition information'
      }
    }

    // Extract key nutrients
    const findNutrient = (name: string) =>
      nutrition.nutrients.find((n: any) => n.name === name)

    const calories = findNutrient('Calories')?.amount || 0
    const protein = findNutrient('Protein')?.amount || 0
    const fat = findNutrient('Fat')?.amount || 0
    const carbs = findNutrient('Carbohydrates')?.amount || 0
    const fiber = findNutrient('Fiber')?.amount || 0
    const sugar = findNutrient('Sugar')?.amount || 0
    const sodium = findNutrient('Sodium')?.amount || 0

    const nutritionBreakdown: NutritionBreakdown = {
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      carbohydrates: Math.round(carbs * 10) / 10,
      fiber: Math.round(fiber * 10) / 10,
      sugar: Math.round(sugar * 10) / 10,
      sodium: Math.round(sodium),
      nutrients: nutrition.nutrients.map((n: any) => ({
        name: n.name,
        amount: Math.round(n.amount * 10) / 10,
        unit: n.unit,
        percentOfDailyNeeds: Math.round(n.percentOfDailyNeeds * 10) / 10
      })),
      servings: servings,
      per_serving: {
        calories: Math.round(calories / servings),
        protein: Math.round((protein / servings) * 10) / 10,
        fat: Math.round((fat / servings) * 10) / 10,
        carbohydrates: Math.round((carbs / servings) * 10) / 10
      }
    }

    logger.info('Nutrition calculated successfully', {
      recipe_id: input.recipe_id,
      total_calories: nutritionBreakdown.calories,
      servings: servings,
      calories_per_serving: nutritionBreakdown.per_serving.calories
    })

    return {
      success: true,
      result: nutritionBreakdown
    }
  } catch (error) {
    logger.error('Failed to calculate nutrition', {
      error: error instanceof Error ? error.message : 'Unknown error',
      recipe_id: input.recipe_id
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate nutrition'
    }
  }
}
