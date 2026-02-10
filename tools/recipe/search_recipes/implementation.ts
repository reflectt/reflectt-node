import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getSpoonacularClient } from '@/lib/integrations/recipe'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface SearchRecipesInput {
  query: string
  cuisine?: string
  diet?: 'Vegetarian' | 'Vegan' | 'Gluten Free' | 'Ketogenic' | 'Paleo'
  intolerances?: string[]
  max_ready_time?: number
  max_calories?: number
  min_protein?: number
  include_ingredients?: string[]
  exclude_ingredients?: string[]
  limit?: number
}

interface RecipeResult {
  id: number
  title: string
  image: string
  imageType?: string
  readyInMinutes?: number
  servings?: number
  summary?: string
  cuisines?: string[]
  diets?: string[]
  nutrition?: {
    calories?: number
    protein?: string
    fat?: string
    carbs?: string
  }
}

interface SearchRecipesOutput {
  success: boolean
  result?: {
    recipes: RecipeResult[]
    total_results: number
    query_info: {
      query: string
      filters_applied: Record<string, any>
    }
  }
  error?: string
}

/**
 * Search for recipes with comprehensive filters
 *
 * Searches Spoonacular API with filters for cuisine, diet, ingredients,
 * cooking time, and nutrition. Caches results and saves to database.
 *
 * @param input - Search parameters
 * @param context - Tool execution context
 * @returns Search results with recipe summaries
 */
export default async function searchRecipes(
  input: SearchRecipesInput,
  context: ToolContext
): Promise<SearchRecipesOutput> {
  try {
    logger.info('Searching recipes', {
      query: input.query,
      filters: {
        cuisine: input.cuisine,
        diet: input.diet,
        max_ready_time: input.max_ready_time
      }
    })

    const client = getSpoonacularClient()
    const dataLayer = getData(context)
    const limit = input.limit || 10

    // Build search parameters
    const searchParams: Record<string, any> = {
      query: input.query,
      number: limit,
      addRecipeInformation: true,
      addRecipeNutrition: true,
      fillIngredients: true
    }

    if (input.cuisine) searchParams.cuisine = input.cuisine
    if (input.diet) searchParams.diet = input.diet
    if (input.intolerances?.length) searchParams.intolerances = input.intolerances.join(',')
    if (input.max_ready_time) searchParams.maxReadyTime = input.max_ready_time
    if (input.max_calories) searchParams.maxCalories = input.max_calories
    if (input.min_protein) searchParams.minProtein = input.min_protein
    if (input.include_ingredients?.length) searchParams.includeIngredients = input.include_ingredients.join(',')
    if (input.exclude_ingredients?.length) searchParams.excludeIngredients = input.exclude_ingredients.join(',')

    // Search recipes via Spoonacular
    const response = await client.searchRecipes(searchParams)

    if (!response.results || response.results.length === 0) {
      return {
        success: true,
        result: {
          recipes: [],
          total_results: 0,
          query_info: {
            query: input.query,
            filters_applied: searchParams
          }
        }
      }
    }

    // Save recipes to database for offline access
    const recipes: RecipeResult[] = []
    for (const recipe of response.results) {
      try {
        // Store in recipes table
        await dataLayer.create('recipes', 'global', recipe.id.toString(), {
          spoonacular_id: recipe.id,
          title: recipe.title,
          image: recipe.image,
          image_type: recipe.imageType,
          ready_in_minutes: recipe.readyInMinutes,
          servings: recipe.servings,
          summary: recipe.summary,
          cuisines: recipe.cuisines || [],
          diets: recipe.diets || [],
          nutrition: recipe.nutrition || {},
          source_url: recipe.sourceUrl,
          cached_at: new Date().toISOString()
        })

        recipes.push({
          id: recipe.id,
          title: recipe.title,
          image: recipe.image,
          imageType: recipe.imageType,
          readyInMinutes: recipe.readyInMinutes,
          servings: recipe.servings,
          summary: recipe.summary,
          cuisines: recipe.cuisines,
          diets: recipe.diets,
          nutrition: recipe.nutrition ? {
            calories: recipe.nutrition.nutrients?.find((n: any) => n.name === 'Calories')?.amount,
            protein: recipe.nutrition.nutrients?.find((n: any) => n.name === 'Protein')?.amount + 'g',
            fat: recipe.nutrition.nutrients?.find((n: any) => n.name === 'Fat')?.amount + 'g',
            carbs: recipe.nutrition.nutrients?.find((n: any) => n.name === 'Carbohydrates')?.amount + 'g'
          } : undefined
        })
      } catch (saveError) {
        logger.warn('Failed to save recipe to database', {
          recipe_id: recipe.id,
          error: saveError instanceof Error ? saveError.message : 'Unknown error'
        })
        // Continue even if save fails
        recipes.push({
          id: recipe.id,
          title: recipe.title,
          image: recipe.image,
          imageType: recipe.imageType,
          readyInMinutes: recipe.readyInMinutes,
          servings: recipe.servings
        })
      }
    }

    logger.info('Recipe search completed', {
      results_count: recipes.length,
      total_available: response.totalResults
    })

    return {
      success: true,
      result: {
        recipes,
        total_results: response.totalResults || recipes.length,
        query_info: {
          query: input.query,
          filters_applied: searchParams
        }
      }
    }
  } catch (error) {
    logger.error('Recipe search failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      query: input.query
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search recipes'
    }
  }
}
