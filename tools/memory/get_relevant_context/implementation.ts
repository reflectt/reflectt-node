import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getRelevantContext } from '@/lib/memory/context-synthesis'
import { searchKnowledgeGraph } from '@/lib/memory/context-synthesis'

interface GetRelevantContextInput {
  user_id: string
  query: string
  limit?: number
  recency_weight?: number
  include_cache?: boolean
}

export default async function get_relevant_context(
  input: GetRelevantContextInput,
  context: ToolContext
) {
  const {
    user_id,
    query,
    limit = 10,
    recency_weight = 0.7,
    include_cache = true
  } = input

  try {
    // Check for cached context if requested
    let cachedContext = null
    if (include_cache) {
      try {
        const cacheSegments = ['memory', 'users', user_id, 'context_cache.json']
        cachedContext = await context.readJson('global', ...cacheSegments)

        // Check if cache is still valid (24 hours)
        const cacheAge = Date.now() - new Date(cachedContext.last_updated).getTime()
        const ttl = cachedContext.ttl || 86400 // 24 hours default
        if (cacheAge > ttl * 1000) {
          cachedContext = null // Cache expired
        }
      } catch {
        // No cache exists
      }
    }

    // Get relevant context from conversation history
    const contextResult = await getRelevantContext(
      user_id,
      query,
      limit,
      recency_weight,
      context
    )

    // Search knowledge graph for relevant facts
    const knowledgeFacts = await searchKnowledgeGraph(user_id, query, 0.6, context)

    // Combine knowledge graph facts with context facts
    const allFacts = [
      ...contextResult.learned_facts,
      ...knowledgeFacts.map(fact => ({
        fact: fact.fact,
        confidence: fact.confidence,
        source: fact.source_conversation_ids
      }))
    ]

    // Deduplicate facts
    const uniqueFacts = allFacts.filter((fact, index, self) =>
      index === self.findIndex(f => f.fact === fact.fact)
    )

    // Load user profile for preferences
    let userPreferences = {}
    try {
      const profileSegments = ['memory', 'users', user_id, 'profile.json']
      const profile = await context.readJson('global', ...profileSegments)
      userPreferences = profile.preferences || {}
    } catch {
      // No profile exists
    }

    // Build response
    const response = {
      success: true,
      context: {
        relevant_conversations: contextResult.relevant_conversations,
        extracted_facts: uniqueFacts.map(f => f.fact),
        user_preferences: userPreferences,
        recent_activity_summary: cachedContext?.recent_activity_summary || contextResult.context_summary,
        suggestions: contextResult.recommendations
      },
      from_cache: include_cache && cachedContext !== null,
      conversation_count: contextResult.relevant_conversations.length,
      fact_count: uniqueFacts.length
    }

    return response
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      context: {
        relevant_conversations: [],
        extracted_facts: [],
        user_preferences: {},
        recent_activity_summary: 'No context available',
        suggestions: []
      }
    }
  }
}
