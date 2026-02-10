import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { componentRegistry, componentIds, type ComponentRegistryEntry } from '@/components/component-registry'
import { createSemanticSearch, type SearchResult } from '@/lib/components/semantic-search'
import * as fs from 'fs'
import * as path from 'path'

interface SearchComponentsInput {
  query: string
  domain?: string
  limit?: number
}

interface ComponentSearchResult {
  component_id: string
  domain: string
  name: string
  description: string
  relevance_score: number
}

interface SearchComponentsOutput {
  success: boolean
  results: ComponentSearchResult[]
  total_components: number
  query: string
  search_time_ms: number
  method?: 'semantic' | 'keyword'
  suggestion?: string
}

// Cache semantic search instance to avoid re-initialization
let cachedSemanticSearch: Awaited<ReturnType<typeof createSemanticSearch>> | null = null

async function getSemanticSearch() {
  if (!cachedSemanticSearch) {
    const apiKey = process.env.OPENAI_API_KEY
    if (apiKey) {
      try {
        cachedSemanticSearch = await createSemanticSearch(apiKey)
      } catch (error) {
        console.error('[search_components] Failed to initialize semantic search:', error)
      }
    }
  }
  return cachedSemanticSearch
}

function calculateComponentRelevance(
  componentId: string,
  entry: ComponentRegistryEntry,
  fullDef: any,
  query: string
): number {
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 2)
  let score = 0

  const name = (fullDef?.name || entry.displayName || entry.name || '').toLowerCase()
  const description = (fullDef?.description || entry.description || '').toLowerCase()
  const domains = fullDef?.domains || (entry.domain ? [entry.domain] : [])
  const domain = domains.filter((d: any) => d).map((d: string) => d.toLowerCase())
  const useCases = (fullDef?.use_cases || []).filter((uc: any) => uc).map((uc: string) => uc.toLowerCase())

  if (name.includes(queryLower)) score += 10
  else queryTerms.forEach(term => { if (name.includes(term)) score += 5 })

  if (description.includes(queryLower)) score += 8
  queryTerms.forEach(term => {
    const matches = (description.match(new RegExp(term, 'g')) || []).length
    score += matches * 2
  })

  domain.forEach((d: string) => {
    if (d.includes(queryLower)) score += 6
    else queryTerms.forEach(term => { if (d.includes(term)) score += 3 })
  })

  useCases.forEach((uc: string) => {
    if (uc.includes(queryLower)) score += 7
    else queryTerms.forEach(term => { if (uc.includes(term)) score += 3 })
  })

  return score
}

export default async function searchComponents(
  input: SearchComponentsInput,
  context: ToolContext
): Promise<SearchComponentsOutput> {
  const startTime = Date.now()
  try {
    const { query, domain, limit = 10 } = input

    if (!query || query.trim().length === 0) {
      return {
        success: false, results: [], total_components: 0, query: query || '',
        search_time_ms: Date.now() - startTime, suggestion: 'Please provide a search query'
      }
    }

    let results: ComponentSearchResult[] = []
    let searchMethod: 'semantic' | 'keyword' = 'keyword'

    // Try semantic search first
    const semanticSearch = await getSemanticSearch()

    if (semanticSearch?.hasEmbeddings?.()) {
      try {
        console.log('[search_components] Using semantic search')
        const semanticResults = await semanticSearch.searchWithFallback(query, {
          topK: limit,
          minScore: 0.25, // Lowered to 0.25 to capture casual phrases like "super fun times" (scores ~26%)
          filters: domain ? { category: domain } : undefined
        })

        // Transform semantic results to match existing response format
        results = semanticResults.map((r: SearchResult) => ({
          component_id: r.componentId,
          domain: r.metadata.category || 'unknown',
          name: r.metadata.displayName || r.componentId,
          description: r.metadata.description || '',
          relevance_score: Math.round(r.score * 100) // Convert 0-1 to 0-100
        }))

        searchMethod = 'semantic'
        console.log(`[search_components] Semantic search found ${results.length} results`)
      } catch (error) {
        console.error('[search_components] Semantic search failed, falling back to keyword:', error)
      }
    } else {
      console.log('[search_components] No embeddings available, using keyword search')
    }

    // Fall back to keyword search if semantic search failed or returned no results
    if (results.length === 0) {
      console.log('[search_components] Using keyword search')
      const allComponents: Array<{ id: string; entry: ComponentRegistryEntry; fullDef: any }> = []
      const componentsDir = path.join(process.cwd(), 'components', 'domains')

      for (const componentId of componentIds) {
        const entry = componentRegistry[componentId]
        if (!entry) continue
        if (domain && entry.domain !== domain) continue

        let fullDef: any = null
        try {
          const parts = componentId.split(':')
          const domainName = parts.length > 1 ? parts[0] : (entry.domain || '')
          const compName = parts.length > 1 ? parts[1] : componentId
          const defPath = path.join(componentsDir, domainName, compName, 'definition.json')
          if (fs.existsSync(defPath)) {
            const content = fs.readFileSync(defPath, 'utf-8')
            fullDef = JSON.parse(content)
          }
        } catch (err) {}

        allComponents.push({ id: componentId, entry, fullDef })
      }

      const scoredComponents = allComponents
        .map(({ id, entry, fullDef }) => ({
          id, entry, fullDef,
          score: calculateComponentRelevance(id, entry, fullDef, query)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)

      results = scoredComponents.map(({ id, entry, fullDef, score }) => ({
        component_id: id,
        domain: entry.domain || 'unknown',
        name: fullDef?.name || entry.displayName || entry.name || id,
        description: fullDef?.description || entry.description || 'No description',
        relevance_score: score
      }))

      searchMethod = 'keyword'
    }

    const searchTimeMs = Date.now() - startTime

    // Track search event
    if (typeof window === 'undefined') {
      const { getSearchTracker } = await import('@/lib/tools/discovery-search-tracker')
      const tracker = getSearchTracker()
      tracker.recordComponentSearch(
        query,
        results.map(r => r.component_id),
        searchTimeMs,
        context.conversationId,
        context.conversationId
      )
    }

    if (results.length === 0) {
      return {
        success: false,
        results: [],
        total_components: componentIds.length,
        query,
        search_time_ms: searchTimeMs,
        method: searchMethod,
        suggestion: 'No matching components found. Try different search terms.'
      }
    }

    return {
      success: true,
      results,
      total_components: componentIds.length,
      query,
      search_time_ms: searchTimeMs,
      method: searchMethod
    }
  } catch (error: any) {
    return {
      success: false,
      results: [],
      total_components: 0,
      query: input.query || '',
      search_time_ms: Date.now() - startTime,
      method: 'keyword',
      suggestion: 'Search failed: ' + error.message
    }
  }
}
