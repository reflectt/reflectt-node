import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface GenerateShoppingListInput {
  recipe_ids: string[]
  servings?: Record<string, number>
  organize_by_aisle?: boolean
  exclude_pantry_items?: boolean
}

interface ShoppingItem {
  name: string
  amount: number
  unit: string
  display: string
  aisle?: string
  from_recipes: string[]
}

interface ShoppingListOutput {
  success: boolean
  result?: {
    items: ShoppingItem[]
    items_by_aisle?: Record<string, ShoppingItem[]>
    total_items: number
    recipes_included: Array<{
      id: string
      title: string
      servings: number
    }>
  }
  error?: string
}

// Common pantry items to exclude
const PANTRY_ITEMS = new Set([
  'salt', 'pepper', 'black pepper', 'olive oil', 'vegetable oil',
  'water', 'sugar', 'flour', 'baking powder', 'baking soda',
  'vanilla extract', 'garlic powder', 'onion powder'
])

// Aisle categories
const AISLE_MAP: Record<string, string> = {
  // Produce
  'tomato': 'Produce', 'onion': 'Produce', 'garlic': 'Produce',
  'lettuce': 'Produce', 'carrot': 'Produce', 'potato': 'Produce',
  'bell pepper': 'Produce', 'cucumber': 'Produce', 'spinach': 'Produce',

  // Meat & Seafood
  'chicken': 'Meat & Seafood', 'beef': 'Meat & Seafood', 'pork': 'Meat & Seafood',
  'fish': 'Meat & Seafood', 'salmon': 'Meat & Seafood', 'shrimp': 'Meat & Seafood',

  // Dairy
  'milk': 'Dairy', 'cheese': 'Dairy', 'butter': 'Dairy',
  'yogurt': 'Dairy', 'cream': 'Dairy', 'eggs': 'Dairy',

  // Bakery
  'bread': 'Bakery', 'tortilla': 'Bakery', 'buns': 'Bakery',

  // Pantry
  'pasta': 'Pantry', 'rice': 'Pantry', 'beans': 'Pantry',
  'sauce': 'Pantry', 'oil': 'Pantry', 'vinegar': 'Pantry',

  // Spices
  'cumin': 'Spices', 'paprika': 'Spices', 'oregano': 'Spices',
  'basil': 'Spices', 'thyme': 'Spices', 'rosemary': 'Spices'
}

/**
 * Generate shopping list from multiple recipes
 *
 * Combines ingredients from multiple recipes, scales by servings,
 * merges duplicates, and organizes by grocery aisle.
 *
 * @param input - Recipe IDs and shopping preferences
 * @param context - Tool execution context
 * @returns Organized shopping list
 */
export default async function generateShoppingList(
  input: GenerateShoppingListInput,
  context: ToolContext
): Promise<ShoppingListOutput> {
  try {
    logger.info('Generating shopping list', {
      recipe_count: input.recipe_ids.length,
      organize_by_aisle: input.organize_by_aisle
    })

    const dataLayer = getData(context)
    const organizeByAisle = input.organize_by_aisle !== false // default true

    // Fetch all recipes
    const recipes = await Promise.all(
      input.recipe_ids.map(async (id) => {
        const recipe = await dataLayer.read('recipes', 'global', id)
        if (!recipe) {
          logger.warn('Recipe not found', { recipe_id: id })
          return null
        }
        return { id, recipe }
      })
    )

    const validRecipes = recipes.filter(r => r !== null) as Array<{
      id: string
      recipe: any
    }>

    if (validRecipes.length === 0) {
      return {
        success: false,
        error: 'No valid recipes found. Please fetch recipe details first.'
      }
    }

    // Combine ingredients from all recipes
    const ingredientMap = new Map<string, ShoppingItem>()

    for (const { id, recipe } of validRecipes) {
      if (!recipe.extendedIngredients) continue

      const targetServings = input.servings?.[id] || recipe.servings || 1
      const scaleFactor = targetServings / (recipe.servings || 1)

      for (const ing of recipe.extendedIngredients) {
        const name = ing.name.toLowerCase()

        // Skip pantry items if requested
        if (input.exclude_pantry_items && PANTRY_ITEMS.has(name)) {
          continue
        }

        const scaledAmount = ing.amount * scaleFactor
        const key = `${name}-${ing.unit}`

        if (ingredientMap.has(key)) {
          // Combine with existing ingredient
          const existing = ingredientMap.get(key)!
          existing.amount += scaledAmount
          existing.from_recipes.push(recipe.title)
        } else {
          // Add new ingredient
          const aisle = organizeByAisle ? getAisle(name) : undefined

          ingredientMap.set(key, {
            name: ing.name,
            amount: scaledAmount,
            unit: ing.unit,
            display: formatAmount(scaledAmount, ing.unit, ing.name),
            aisle,
            from_recipes: [recipe.title]
          })
        }
      }
    }

    // Convert to array and sort
    const items = Array.from(ingredientMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    // Organize by aisle if requested
    let itemsByAisle: Record<string, ShoppingItem[]> | undefined
    if (organizeByAisle) {
      itemsByAisle = {}
      for (const item of items) {
        const aisle = item.aisle || 'Other'
        if (!itemsByAisle[aisle]) {
          itemsByAisle[aisle] = []
        }
        itemsByAisle[aisle].push(item)
      }
    }

    logger.info('Shopping list generated successfully', {
      total_items: items.length,
      recipes_count: validRecipes.length,
      aisles: itemsByAisle ? Object.keys(itemsByAisle).length : 0
    })

    return {
      success: true,
      result: {
        items,
        items_by_aisle: itemsByAisle,
        total_items: items.length,
        recipes_included: validRecipes.map(({ id, recipe }) => ({
          id,
          title: recipe.title,
          servings: input.servings?.[id] || recipe.servings || 1
        }))
      }
    }
  } catch (error) {
    logger.error('Failed to generate shopping list', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate shopping list'
    }
  }
}

/**
 * Get grocery aisle for ingredient
 */
function getAisle(ingredientName: string): string {
  const name = ingredientName.toLowerCase()

  for (const [keyword, aisle] of Object.entries(AISLE_MAP)) {
    if (name.includes(keyword)) {
      return aisle
    }
  }

  return 'Other'
}

/**
 * Format ingredient amount for display
 */
function formatAmount(amount: number, unit: string, name: string): string {
  // Round to reasonable precision
  let rounded: number
  if (amount < 1) {
    rounded = Math.round(amount * 100) / 100
  } else if (amount < 10) {
    rounded = Math.round(amount * 10) / 10
  } else {
    rounded = Math.round(amount)
  }

  // Convert to fractions for common measurements
  if (unit === 'cup' || unit === 'cups') {
    if (rounded === 0.25) return `1/4 cup ${name}`
    if (rounded === 0.33) return `1/3 cup ${name}`
    if (rounded === 0.5) return `1/2 cup ${name}`
    if (rounded === 0.67) return `2/3 cup ${name}`
    if (rounded === 0.75) return `3/4 cup ${name}`
  }

  // Handle plural units
  const displayUnit = rounded === 1
    ? unit.replace(/s$/, '')
    : unit.endsWith('s') ? unit : unit + 's'

  return `${rounded} ${displayUnit} ${name}`
}
