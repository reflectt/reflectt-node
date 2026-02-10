import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getSpoonacularClient } from '@/lib/integrations/recipe'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface GetRecipeDetailsInput {
  recipe_id: string
  include_nutrition?: boolean
  include_similar?: boolean
}

interface RecipeDetails {
  id: number
  title: string
  image: string
  servings: number
  readyInMinutes: number
  summary: string
  cuisines: string[]
  diets: string[]
  instructions: string
  extendedIngredients: Array<{
    id: number
    name: string
    amount: number
    unit: string
    original: string
  }>
  nutrition?: {
    nutrients: Array<{
      name: string
      amount: number
      unit: string
      percentOfDailyNeeds: number
    }>
  }
  similar_recipes?: Array<{
    id: number
    title: string
    image: string
    readyInMinutes: number
  }>
  source_url?: string
  cached_at?: string
}

interface GetRecipeDetailsOutput {
  success: boolean
  result?: RecipeDetails
  error?: string
}

/**
 * Get complete recipe details with ingredients and instructions
 *
 * Fetches from database cache if available, otherwise calls Spoonacular API.
 * Includes nutrition information and optionally similar recipes.
 *
 * @param input - Recipe ID and options
 * @param context - Tool execution context
 * @returns Complete recipe details
 */
export default async function getRecipeDetails(
  input: GetRecipeDetailsInput,
  context: ToolContext
): Promise<GetRecipeDetailsOutput> {
  try {
    logger.info('Fetching recipe details', { recipe_id: input.recipe_id })

    const dataLayer = getData(context)
    const client = getSpoonacularClient()
    const includeNutrition = input.include_nutrition !== false // default true

    // Try to fetch from database first
    let recipe: RecipeDetails | null = null
    try {
      const cached = await dataLayer.read('recipes', 'global', input.recipe_id)
      if (cached) {
        // Check if cache is less than 7 days old
        const cacheAge = cached.cached_at
          ? Date.now() - new Date(cached.cached_at).getTime()
          : Infinity
        const sevenDays = 7 * 24 * 60 * 60 * 1000

        if (cacheAge < sevenDays && cached.extendedIngredients && cached.instructions) {
          logger.debug('Using cached recipe details', { recipe_id: input.recipe_id })
          recipe = cached as RecipeDetails
        }
      }
    } catch (readError) {
      logger.debug('Recipe not in cache', { recipe_id: input.recipe_id })
    }

    // If not cached or expired, fetch from API
    if (!recipe) {
      logger.debug('Fetching recipe from Spoonacular', { recipe_id: input.recipe_id })

      const apiRecipe = await client.getRecipeInformation(
        parseInt(input.recipe_id),
        includeNutrition
      )

      recipe = {
        id: apiRecipe.id,
        title: apiRecipe.title,
        image: apiRecipe.image,
        servings: apiRecipe.servings,
        readyInMinutes: apiRecipe.readyInMinutes,
        summary: apiRecipe.summary,
        cuisines: apiRecipe.cuisines || [],
        diets: apiRecipe.diets || [],
        instructions: apiRecipe.instructions || '',
        extendedIngredients: apiRecipe.extendedIngredients?.map((ing: any) => ({
          id: ing.id,
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          original: ing.original
        })) || [],
        nutrition: includeNutrition ? apiRecipe.nutrition : undefined,
        source_url: apiRecipe.sourceUrl
      }

      // Save to database
      try {
        await dataLayer.update('recipes', 'global', input.recipe_id, {
          ...recipe,
          cached_at: new Date().toISOString()
        })
      } catch (saveError) {
        logger.warn('Failed to cache recipe details', {
          recipe_id: input.recipe_id,
          error: saveError instanceof Error ? saveError.message : 'Unknown error'
        })
      }
    }

    // Fetch similar recipes if requested
    if (input.include_similar) {
      try {
        const similar = await client.getSimilarRecipes(parseInt(input.recipe_id), 5)
        recipe.similar_recipes = similar.map((r: any) => ({
          id: r.id,
          title: r.title,
          image: r.image || `https://spoonacular.com/recipeImages/${r.id}-312x231.jpg`,
          readyInMinutes: r.readyInMinutes
        }))
      } catch (similarError) {
        logger.warn('Failed to fetch similar recipes', {
          recipe_id: input.recipe_id,
          error: similarError instanceof Error ? similarError.message : 'Unknown error'
        })
      }
    }

    logger.info('Recipe details fetched successfully', {
      recipe_id: input.recipe_id,
      title: recipe.title,
      ingredients_count: recipe.extendedIngredients.length
    })

    return {
      success: true,
      result: recipe
    }
  } catch (error) {
    logger.error('Failed to get recipe details', {
      error: error instanceof Error ? error.message : 'Unknown error',
      recipe_id: input.recipe_id
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch recipe details'
    }
  }
}
