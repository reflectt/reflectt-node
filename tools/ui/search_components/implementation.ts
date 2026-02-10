import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { COMPONENT_INDEX, type ComponentIndexEntry } from '@/lib/components/component-index'
import { COMPONENT_EXAMPLES } from '@/lib/components/component-examples'
import { COMPONENT_RECIPES } from '@/lib/components/component-recipes'
import { USE_CASE_EXAMPLES } from '@/lib/components/use-case-examples'
import { COMPONENT_CAPABILITIES } from '@/lib/components/component-capabilities'
import { getSynergyPatternsForComponent } from '@/lib/components/component-suggestions'
import { COMPONENT_COMPARISON_MATRIX } from '@/lib/components/component-comparison'

interface SearchFilters {
  category?: string
  capabilities?: string[]
  complexity?: 'simple' | 'moderate' | 'complex'
  dataShape?: 'tabular' | 'hierarchical' | 'graph' | 'time-series'
}

interface SearchComponentsInput {
  query: string
  filters?: SearchFilters
  limit?: number
}

interface SearchResult {
  componentId: string
  score: number
  matchReason: string
  metadata: ComponentIndexEntry
  exampleProps?: any
  useCases?: string[]
  relatedComponents?: string[]
  complexity?: 'simple' | 'moderate' | 'complex'
  comparison?: {
    alternatives: string[]
    bestFor: string
  }
}

interface SearchComponentsSuccess {
  success: true
  query: string
  results: SearchResult[]
  totalFound: number
  searchSummary: {
    metadataMatches: number
    exampleMatches: number
    recipeMatches: number
    useCaseMatches: number
    capabilityMatches: number
  }
}

interface SearchComponentsFailure {
  success: false
  error: string
  suggestion?: string
}

type SearchComponentsOutput = SearchComponentsSuccess | SearchComponentsFailure

/**
 * Universal component search across all 7 discovery systems
 */
export default async function searchComponents(
  input: SearchComponentsInput,
  ctx: ToolContext
): Promise<SearchComponentsOutput> {
  try {
    const query = input.query.toLowerCase()
    const limit = input.limit || 10
    const results = new Map<string, SearchResult>()

    const searchSummary = {
      metadataMatches: 0,
      exampleMatches: 0,
      recipeMatches: 0,
      useCaseMatches: 0,
      capabilityMatches: 0
    }

    // 1. SEARCH METADATA (component names, descriptions, tags, categories)
    Object.entries(COMPONENT_INDEX).forEach(([id, metadata]) => {
      let score = 0
      const reasons: string[] = []

      // Name match (highest value)
      if (id.toLowerCase().includes(query)) {
        score += 50
        reasons.push('name match')
      }

      // Description match
      if (metadata.description?.toLowerCase().includes(query)) {
        score += 30
        reasons.push('description match')
      }

      // Tags match
      metadata.tags?.forEach(tag => {
        if (tag.toLowerCase().includes(query)) {
          score += 20
          reasons.push(`tag: ${tag}`)
        }
      })

      // Category match
      if (metadata.category?.toLowerCase().includes(query)) {
        score += 25
        reasons.push('category match')
      }

      // Use cases match
      metadata.useCases?.forEach(useCase => {
        if (useCase.toLowerCase().includes(query)) {
          score += 15
          reasons.push('use case match')
        }
      })

      // When to use match
      if (metadata.whenToUse?.toLowerCase().includes(query)) {
        score += 18
        reasons.push('usage guidance match')
      }

      if (score > 0) {
        searchSummary.metadataMatches++
        results.set(id, {
          componentId: id,
          score,
          matchReason: reasons.join(', '),
          metadata
        })
      }
    })

    // 2. SEARCH EXAMPLES
    Object.entries(COMPONENT_EXAMPLES).forEach(([id, examples]) => {
      examples.forEach(example => {
        if (example.description.toLowerCase().includes(query) ||
            example.useCase.toLowerCase().includes(query)) {
          const existing = results.get(id)
          if (existing) {
            existing.score += 15
            existing.matchReason += ', example match'
            existing.exampleProps = example.manifest
          } else {
            searchSummary.exampleMatches++
            results.set(id, {
              componentId: id,
              score: 15,
              matchReason: 'example match',
              metadata: COMPONENT_INDEX[id],
              exampleProps: example.manifest
            })
          }
        }
      })
    })

    // 3. SEARCH RECIPES
    Object.values(COMPONENT_RECIPES).forEach(recipe => {
      if (recipe.name.toLowerCase().includes(query) ||
          recipe.description.toLowerCase().includes(query) ||
          recipe.tags.some(tag => tag.toLowerCase().includes(query))) {
        recipe.components.forEach(componentId => {
          const existing = results.get(componentId)
          if (existing) {
            existing.score += 10
            existing.matchReason += `, recipe: ${recipe.name}`
          } else {
            searchSummary.recipeMatches++
            results.set(componentId, {
              componentId,
              score: 10,
              matchReason: `part of recipe: ${recipe.name}`,
              metadata: COMPONENT_INDEX[componentId]
            })
          }
        })
      }
    })

    // 4. SEARCH USE CASES
    Object.values(USE_CASE_EXAMPLES).forEach(useCase => {
      if (useCase.title.toLowerCase().includes(query) ||
          useCase.description.toLowerCase().includes(query) ||
          useCase.industry.toLowerCase().includes(query)) {
        useCase.components.forEach(componentId => {
          const existing = results.get(componentId)
          if (existing) {
            existing.score += 12
            existing.useCases = [...(existing.useCases || []), useCase.title]
          } else {
            searchSummary.useCaseMatches++
            results.set(componentId, {
              componentId,
              score: 12,
              matchReason: `use case: ${useCase.title}`,
              metadata: COMPONENT_INDEX[componentId],
              useCases: [useCase.title]
            })
          }
        })
      }
    })

    // 5. SEARCH CAPABILITIES
    Object.entries(COMPONENT_CAPABILITIES).forEach(([capId, capability]) => {
      if (capability.name.toLowerCase().includes(query) ||
          capability.description.toLowerCase().includes(query) ||
          capability.use_cases.some(uc => uc.toLowerCase().includes(query))) {
        capability.components.forEach(componentId => {
          const existing = results.get(componentId)
          if (existing) {
            existing.score += 18
            existing.matchReason += `, capability: ${capability.name}`
          } else {
            searchSummary.capabilityMatches++
            results.set(componentId, {
              componentId,
              score: 18,
              matchReason: `capability: ${capability.name}`,
              metadata: COMPONENT_INDEX[componentId]
            })
          }
        })
      }
    })

    // 6. SEARCH SYNERGIES
    // Add bonus score for components that work well together
    results.forEach(result => {
      const synergies = getSynergyPatternsForComponent(result.componentId)
      if (synergies.length > 0) {
        result.score += 5 // Small bonus for having synergies
        result.relatedComponents = Array.from(new Set(
          synergies.flatMap(s => s.components)
        )).filter(id => id !== result.componentId)
      }
    })

    // 7. SEARCH COMPARISONS
    // Add comparison data to help users choose between similar components
    Object.entries(COMPONENT_COMPARISON_MATRIX).forEach(([category, comparisons]) => {
      comparisons.forEach(comparison => {
        const result = results.get(comparison.name)
        if (result) {
          result.complexity = comparison.complexity
          result.comparison = {
            alternatives: comparisons
              .filter(c => c.name !== comparison.name)
              .map(c => c.name),
            bestFor: comparison.bestFor
          }
        }
      })
    })

    // APPLY FILTERS
    let filtered = Array.from(results.values())

    if (input.filters) {
      const { category, capabilities, complexity, dataShape } = input.filters

      if (category) {
        filtered = filtered.filter(r =>
          r.metadata.category?.toLowerCase() === category.toLowerCase()
        )
      }

      if (capabilities && capabilities.length > 0) {
        filtered = filtered.filter(r => {
          // Check if component has the required capabilities
          const componentCapabilities = r.metadata.capabilities || {}
          return capabilities.every(cap => {
            // Check if the capability exists and is true
            return componentCapabilities[cap as keyof typeof componentCapabilities] === true
          })
        })
      }

      if (complexity) {
        filtered = filtered.filter(r => r.complexity === complexity)
      }

      if (dataShape) {
        filtered = filtered.filter(r => r.metadata.dataShape === dataShape)
      }
    }

    // SORT BY SCORE (descending)
    filtered.sort((a, b) => b.score - a.score)

    // LIMIT RESULTS
    const limitedResults = filtered.slice(0, limit)

    return {
      success: true,
      query: input.query,
      results: limitedResults,
      totalFound: filtered.length,
      searchSummary
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      suggestion: 'Try simplifying your search query or use fewer filters.'
    }
  }
}
