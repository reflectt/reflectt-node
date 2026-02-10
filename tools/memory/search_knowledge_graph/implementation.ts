import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { searchKnowledgeGraph } from '@/lib/memory/context-synthesis'

interface SearchKnowledgeGraphInput {
  user_id: string
  query: string
  category?: string
  min_confidence?: number
  limit?: number
}

export default async function search_knowledge_graph(
  input: SearchKnowledgeGraphInput,
  context: ToolContext
) {
  const {
    user_id,
    query,
    category,
    min_confidence = 0.5,
    limit = 20
  } = input

  try {
    // Load knowledge graph
    const kgSegments = ['memory', 'users', user_id, 'knowledge_graph.json']
    let knowledgeGraph: any

    try {
      knowledgeGraph = await context.readJson('global', ...kgSegments)
    } catch {
      return {
        success: true,
        facts: [],
        total_count: 0,
        message: 'No knowledge graph exists for this user yet'
      }
    }

    // Search for relevant facts
    const allFacts = await searchKnowledgeGraph(user_id, query, min_confidence, context)

    // Filter by category if specified
    let filteredFacts = allFacts
    if (category) {
      filteredFacts = allFacts.filter((fact: any) => fact.type === category)
    }

    // Apply limit
    const limitedFacts = filteredFacts.slice(0, limit)

    // Format results
    const formattedFacts = limitedFacts.map((fact: any) => ({
      fact: fact.fact,
      confidence: fact.confidence,
      category: fact.type,
      source_conversation_id: fact.source_conversation_ids[0], // Primary source
      all_sources: fact.source_conversation_ids,
      extracted_at: fact.learned_at,
      reinforcement_count: fact.reinforcement_count
    }))

    return {
      success: true,
      facts: formattedFacts,
      total_count: filteredFacts.length,
      returned_count: formattedFacts.length
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      facts: [],
      total_count: 0
    }
  }
}
