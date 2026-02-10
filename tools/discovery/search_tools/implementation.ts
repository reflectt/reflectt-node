/**
 * Search Tools Implementation
 *
 * Searches all tools by natural language query using:
 * - Semantic search (OpenAI embeddings) - preferred
 * - Keyword matching (fallback)
 * - Relevance scoring
 * - Fast performance (~10-50ms)
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getAllToolDefinitions } from '@/lib/tools/tool-registry-cache'
import { loadAllTools, type ToolDefinition } from '@/lib/tools/helpers/tool-loader'
import { createToolSemanticSearch, type ToolSearchResult as SemanticToolSearchResult } from '@/lib/tools/tool-semantic-search'

interface SearchToolsInput {
  query: string
  category?: string
  limit?: number
}

interface ToolSearchResult {
  tool_name: string
  category: string
  description: string
  relevance_score: number
}

interface SearchToolsOutput {
  success: boolean
  results: ToolSearchResult[]
  total_tools: number
  query: string
  search_time_ms: number
  method?: 'semantic' | 'keyword'
  suggestion?: string
}

// Cache semantic search instance to avoid re-initialization
let cachedToolSemanticSearch: Awaited<ReturnType<typeof createToolSemanticSearch>> | null = null

async function getToolSemanticSearch() {
  if (!cachedToolSemanticSearch) {
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey) {
      try {
        cachedToolSemanticSearch = await createToolSemanticSearch(apiKey)
      } catch (error) {
        console.error('[search_tools] Failed to initialize semantic search:', error)
      }
    }
  }
  return cachedToolSemanticSearch
}

/**
 * Calculate relevance score for a tool based on query
 * Uses simple keyword matching with weights:
 * - Name match: 10 points
 * - Category match: 5 points
 * - Description match: 3 points per occurrence
 * - Tag match: 4 points per tag
 */
function calculateRelevance(tool: ToolDefinition, query: string): number {
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 2)

  let score = 0

  // Name matching (highest weight)
  const nameLower = (tool.name || tool.function_name || '').toLowerCase()
  if (nameLower.includes(queryLower)) {
    score += 10
  } else {
    for (const term of queryTerms) {
      if (nameLower.includes(term)) {
        score += 5
      }
    }
  }

  // Category matching
  const categoryLower = (tool.category || '').toLowerCase()
  if (categoryLower.includes(queryLower)) {
    score += 5
  } else {
    for (const term of queryTerms) {
      if (categoryLower.includes(term)) {
        score += 3
      }
    }
  }

  // Description matching
  const descLower = (tool.description || '').toLowerCase()
  if (descLower.includes(queryLower)) {
    score += 8
  }

  // Count individual term matches in description
  for (const term of queryTerms) {
    const matches = (descLower.match(new RegExp(term, 'g')) || []).length
    score += matches * 2
  }

  // Tag matching
  if (tool.tags && Array.isArray(tool.tags)) {
    for (const tag of tool.tags) {
      const tagLower = tag.toLowerCase()
      if (tagLower.includes(queryLower)) {
        score += 4
      } else {
        for (const term of queryTerms) {
          if (tagLower.includes(term)) {
            score += 2
          }
        }
      }
    }
  }

  return score
}

/**
 * Search tools by natural language query
 */
export default async function searchTools(
  input: SearchToolsInput,
  context: ToolContext
): Promise<SearchToolsOutput> {
  const startTime = Date.now()

  try {
    const { query, category, limit = 10 } = input

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        results: [],
        total_tools: 0,
        query: query || '',
        search_time_ms: Date.now() - startTime,
        suggestion: 'Please provide a search query'
      }
    }

    let results: ToolSearchResult[] = []
    let searchMethod: 'semantic' | 'keyword' = 'keyword'
    let totalTools = 0

    // Try semantic search first
    const semanticSearch = await getToolSemanticSearch()

    if (semanticSearch?.hasEmbeddings?.()) {
      try {
        console.log('[search_tools] Using semantic search')
        const semanticResults = await semanticSearch.search(query, {
          topK: limit,
          minScore: 0.4,
          filters: category ? { categories: [category] } : undefined
        })

        // Transform semantic results to match existing response format
        results = semanticResults.map((r: SemanticToolSearchResult) => ({
          tool_name: r.toolId,
          category: r.metadata.category || 'unknown',
          description: r.metadata.description || '',
          relevance_score: Math.round(r.score * 100) // Convert 0-1 to 0-100
        }))

        searchMethod = 'semantic'
        totalTools = semanticSearch.getEmbeddingCount()
        console.log(`[search_tools] Semantic search found ${results.length} results`)
      } catch (error) {
        console.error('[search_tools] Semantic search failed, falling back to keyword:', error)
      }
    } else {
      console.log('[search_tools] No embeddings available, using keyword search')
    }

    // Fall back to keyword search if semantic search failed or returned no results
    if (results.length === 0) {
      console.log('[search_tools] Using keyword search')

      // Load all tools (from cache if available)
      let allToolDefs: Map<string, ToolDefinition>

      const cachedDefs = getAllToolDefinitions()
      if (cachedDefs) {
        allToolDefs = cachedDefs
      } else {
        // Fallback to filesystem scan
        const globalDir = context.resolvePath('global')
        const { definitions } = await loadAllTools(globalDir)
        allToolDefs = definitions
      }

      totalTools = allToolDefs.size

      // Filter by category if specified
      let toolsToSearch = Array.from(allToolDefs.values())
      if (category) {
        const categoryLower = category.toLowerCase()
        toolsToSearch = toolsToSearch.filter(tool =>
          (tool.category || '').toLowerCase() === categoryLower
        )

        if (toolsToSearch.length === 0) {
          return {
            success: false,
            results: [],
            total_tools: allToolDefs.size,
            query,
            search_time_ms: Date.now() - startTime,
            method: searchMethod,
            suggestion: `No tools found in category "${category}". Try searching without category filter.`
          }
        }
      }

      // Calculate relevance scores
      const scoredTools = toolsToSearch
        .map(tool => ({
          tool,
          score: calculateRelevance(tool, query)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      // Format results
      results = scoredTools.map(({ tool, score }) => ({
        tool_name: tool.function_name || tool.id,
        category: tool.category || 'uncategorized',
        description: tool.description || 'No description available',
        relevance_score: score
      }))

      searchMethod = 'keyword'
    }

    const searchTimeMs = Date.now() - startTime

    // Track search event
    if (typeof window === 'undefined') {
      const { getSearchTracker } = await import('@/lib/tools/discovery-search-tracker')
      const tracker = getSearchTracker()
      tracker.recordToolSearch(
        query,
        results.map(r => r.tool_name),
        searchTimeMs,
        context.conversationId,
        context.conversationId
      )
    }

    if (results.length === 0) {
      return {
        success: false,
        results: [],
        total_tools: totalTools,
        query,
        search_time_ms: searchTimeMs,
        method: searchMethod,
        suggestion: 'No matching tools found. Try a different query or broader search terms.'
      }
    }

    return {
      success: true,
      results,
      total_tools: totalTools,
      query,
      search_time_ms: searchTimeMs,
      method: searchMethod
    }
  } catch (error: any) {
    return {
      success: false,
      results: [],
      total_tools: 0,
      query: input.query || '',
      search_time_ms: Date.now() - startTime,
      method: 'keyword',
      suggestion: `Search failed: ${error.message}`
    }
  }
}
