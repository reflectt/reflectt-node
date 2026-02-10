/**
 * Search Portal Recipes Tool
 *
 * Searches pre-built portal recipes (multi-component patterns) for common use cases
 * like 'super fun times', 'creative playground', 'game center', etc.
 *
 * @module tools/discovery/search_portal_recipes
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { recommendRecipeForQuery, getAllRecipeIds, getAllTags } from '@/lib/portals/portal-recipes'

interface SearchRecipesInput {
  /** Natural language search query */
  query: string
  /** Maximum number of recipes to return (default: 5) */
  limit?: number
}

interface RecipeComponent {
  /** Component ID from registry (e.g., 'games:story-engine') */
  component_id: string
  /** Where to place the component in the portal layout */
  slot: 'hero' | 'main' | 'detail' | 'sidebar' | 'footer'
  /** Priority/importance (1-10, higher = more important) */
  priority: number
  /** Explanation of why this component is included */
  reasoning: string
  /** Optional default props for the component */
  props?: Record<string, any>
}

interface RecipeResult {
  /** Unique recipe identifier */
  recipe_id: string
  /** Human-readable recipe name */
  name: string
  /** Detailed description of the portal experience */
  description: string
  /** Tags for categorization */
  tags: string[]
  /** Relevance score (0-100, higher = more relevant) */
  relevance_score: number
  /** Components that make up this recipe */
  components: RecipeComponent[]
  /** Use cases describing when to use this recipe */
  use_cases: string[]
  /** Example queries that match this recipe */
  example_queries: string[]
}

interface SearchRecipesOutput {
  success: boolean
  /** Matching recipes, sorted by relevance */
  results: RecipeResult[]
  /** The search query that was used */
  query: string
  /** Total number of recipes found */
  total_recipes: number
  /** Search execution time in milliseconds */
  search_time_ms: number
  /** Helpful suggestion if no results found */
  suggestion?: string
  /** Error message if search failed */
  error?: string
}

/**
 * Calculate relevance score for a recipe match based on semantic similarity
 * This is a simplified version - the recommendRecipeForQuery function handles the real scoring
 */
function calculateRelevanceScore(recipe: any, query: string): number {
  const normalizedQuery = query.toLowerCase().trim()
  let score = 0

  // Name match
  if (recipe.name.toLowerCase().includes(normalizedQuery)) {
    score += 40
  }

  // Description match
  if (recipe.description.toLowerCase().includes(normalizedQuery)) {
    score += 20
  }

  // Example query match
  if (recipe.exampleQueries?.some((eq: string) => eq.toLowerCase().includes(normalizedQuery))) {
    score += 30
  }

  // Tag match
  if (recipe.tags.some((tag: string) => normalizedQuery.includes(tag.toLowerCase()))) {
    score += 10
  }

  return Math.min(score, 100) // Cap at 100
}

/**
 * Search portal recipes implementation
 */
export default async function searchPortalRecipes(
  input: SearchRecipesInput,
  context: ToolContext
): Promise<SearchRecipesOutput> {
  const startTime = Date.now()

  try {
    const { query, limit = 5 } = input

    // Validate input
    if (!query || query.trim().length === 0) {
      return {
        success: false,
        results: [],
        query: query || '',
        total_recipes: 0,
        search_time_ms: Date.now() - startTime,
        error: 'Query cannot be empty. Please provide a search query like "fun portal" or "creative experience".'
      }
    }

    // Search for matching recipes
    const matchingRecipes = recommendRecipeForQuery(query)

    // No results found - provide helpful suggestion
    if (matchingRecipes.length === 0) {
      const allTags = getAllTags()
      const availableRecipes = getAllRecipeIds()

      return {
        success: true,
        results: [],
        query,
        total_recipes: 0,
        search_time_ms: Date.now() - startTime,
        suggestion: `No recipes found for "${query}". Try searching for: ${allTags.slice(0, 5).join(', ')}. Available recipes: ${availableRecipes.join(', ')}.`
      }
    }

    // Limit results
    const limitedRecipes = matchingRecipes.slice(0, limit)

    // Transform to output format with relevance scores
    const results: RecipeResult[] = limitedRecipes.map((recipe, index) => {
      // Calculate relevance based on position (first result is most relevant)
      // Real scoring happens in recommendRecipeForQuery, this is just for display
      const relevanceScore = Math.max(10, 100 - (index * 15))

      return {
        recipe_id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        tags: recipe.tags,
        relevance_score: relevanceScore,
        components: recipe.components.map(comp => ({
          component_id: comp.componentId,
          slot: comp.slot,
          priority: comp.priority,
          reasoning: comp.reasoning,
          props: comp.props
        })),
        use_cases: recipe.useCases,
        example_queries: recipe.exampleQueries || []
      }
    })

    const searchTimeMs = Date.now() - startTime

    return {
      success: true,
      results,
      query,
      total_recipes: matchingRecipes.length,
      search_time_ms: searchTimeMs
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    return {
      success: false,
      results: [],
      query: input.query || '',
      total_recipes: 0,
      search_time_ms: Date.now() - startTime,
      error: `Failed to search portal recipes: ${errorMessage}`
    }
  }
}
