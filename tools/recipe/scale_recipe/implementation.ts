import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface ScaleRecipeInput {
  recipe_id: string
  target_servings: number
  save_as_new?: boolean
}

interface ScaledIngredient {
  id: number
  name: string
  amount: number
  unit: string
  original: string
  scaled_amount: number
  scaled_original: string
}

interface ScaledRecipe {
  id: number | string
  title: string
  original_servings: number
  target_servings: number
  scale_factor: number
  image: string
  readyInMinutes: number
  instructions: string
  cuisines: string[]
  diets: string[]
  extendedIngredients: ScaledIngredient[]
  cooking_time_note?: string
}

interface ScaleRecipeOutput {
  success: boolean
  result?: ScaledRecipe
  error?: string
}

/**
 * Scale a recipe to different serving size
 *
 * Adjusts all ingredient quantities proportionally and optionally
 * adjusts cooking times. Can save scaled version as new recipe.
 *
 * @param input - Recipe ID and target servings
 * @param context - Tool execution context
 * @returns Scaled recipe with adjusted quantities
 */
export default async function scaleRecipe(
  input: ScaleRecipeInput,
  context: ToolContext
): Promise<ScaleRecipeOutput> {
  try {
    logger.info('Scaling recipe', {
      recipe_id: input.recipe_id,
      target_servings: input.target_servings
    })

    const dataLayer = getData(context)

    // Fetch original recipe
    const recipe = await dataLayer.read('recipes', 'global', input.recipe_id)
    if (!recipe) {
      return {
        success: false,
        error: `Recipe ${input.recipe_id} not found. Please fetch recipe details first.`
      }
    }

    if (!recipe.servings || !recipe.extendedIngredients) {
      return {
        success: false,
        error: 'Recipe does not have complete ingredient information for scaling'
      }
    }

    const originalServings = recipe.servings
    const targetServings = input.target_servings
    const scaleFactor = targetServings / originalServings

    // Scale ingredients
    const scaledIngredients: ScaledIngredient[] = recipe.extendedIngredients.map((ing: any) => {
      const scaledAmount = ing.amount * scaleFactor

      // Round to reasonable precision
      const roundedAmount = scaledAmount < 1
        ? Math.round(scaledAmount * 100) / 100  // 2 decimals for small amounts
        : Math.round(scaledAmount * 10) / 10     // 1 decimal for larger amounts

      // Reconstruct original string with scaled amount
      const scaledOriginal = ing.original.replace(
        /^[\d/.]+/,
        roundedAmount.toString()
      )

      return {
        id: ing.id,
        name: ing.name,
        amount: ing.amount,
        unit: ing.unit,
        original: ing.original,
        scaled_amount: roundedAmount,
        scaled_original: scaledOriginal
      }
    })

    // Estimate cooking time adjustment (not linear)
    let cookingTimeNote: string | undefined
    if (recipe.readyInMinutes && scaleFactor !== 1) {
      if (scaleFactor > 2) {
        cookingTimeNote = 'For larger batches, cooking time may increase by 15-25%. Monitor closely.'
      } else if (scaleFactor < 0.5) {
        cookingTimeNote = 'For smaller portions, reduce cooking time by 10-20%. Check for doneness early.'
      }
    }

    const scaledRecipe: ScaledRecipe = {
      id: input.save_as_new ? `${recipe.id}_scaled_${targetServings}` : recipe.id,
      title: input.save_as_new
        ? `${recipe.title} (${targetServings} servings)`
        : recipe.title,
      original_servings: originalServings,
      target_servings: targetServings,
      scale_factor: Math.round(scaleFactor * 100) / 100,
      image: recipe.image,
      readyInMinutes: recipe.readyInMinutes,
      instructions: recipe.instructions,
      cuisines: recipe.cuisines || [],
      diets: recipe.diets || [],
      extendedIngredients: scaledIngredients,
      cooking_time_note: cookingTimeNote
    }

    // Save as new recipe if requested
    if (input.save_as_new) {
      try {
        await dataLayer.create('recipes', 'global', scaledRecipe.id.toString(), {
          ...scaledRecipe,
          is_scaled: true,
          original_recipe_id: recipe.id,
          created_at: new Date().toISOString()
        })
        logger.info('Saved scaled recipe as new recipe', {
          new_recipe_id: scaledRecipe.id
        })
      } catch (saveError) {
        logger.warn('Failed to save scaled recipe', {
          error: saveError instanceof Error ? saveError.message : 'Unknown error'
        })
      }
    }

    logger.info('Recipe scaled successfully', {
      recipe_id: input.recipe_id,
      original_servings: originalServings,
      target_servings: targetServings,
      scale_factor: scaleFactor
    })

    return {
      success: true,
      result: scaledRecipe
    }
  } catch (error) {
    logger.error('Failed to scale recipe', {
      error: error instanceof Error ? error.message : 'Unknown error',
      recipe_id: input.recipe_id
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to scale recipe'
    }
  }
}
