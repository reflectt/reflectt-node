import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  loadAgentKnowledge,
  getAgentToolPatterns,
  getAgentFacts,
  getAgentRecommendations,
  getAgentPerformanceSummary
} from '@/lib/memory/agent-knowledge'

interface GetAgentKnowledgeInput {
  agent_slug: string
  include_tool_patterns?: boolean
  include_success_contexts?: boolean
}

export default async function get_agent_knowledge(
  input: GetAgentKnowledgeInput,
  context: ToolContext
) {
  const {
    agent_slug,
    include_tool_patterns = true,
    include_success_contexts = true
  } = input

  try {
    // Load agent knowledge
    const knowledge = await loadAgentKnowledge(agent_slug, context)

    if (!knowledge) {
      return {
        success: true,
        knowledge: {
          agent_slug,
          learned_facts: [],
          tool_patterns: [],
          success_contexts: [],
          total_conversations: 0,
          last_updated: new Date().toISOString()
        },
        message: 'No knowledge exists for this agent yet'
      }
    }

    // Get performance summary
    const summary = await getAgentPerformanceSummary(agent_slug, context)

    // Get high-confidence facts
    const facts = await getAgentFacts(agent_slug, 0.6, context)

    // Get tool patterns if requested
    let toolPatterns: any[] = []
    if (include_tool_patterns) {
      toolPatterns = await getAgentToolPatterns(agent_slug, context)
    }

    // Get success contexts (high-confidence facts with high success rates)
    let successContexts: string[] = []
    if (include_success_contexts) {
      successContexts = facts
        .filter(f => f.success_rate > 0.7)
        .map(f => f.fact)
    }

    // Get recommendations
    const recommendations = await getAgentRecommendations(agent_slug, context)

    return {
      success: true,
      knowledge: {
        agent_slug: knowledge.agent_slug,
        domain: knowledge.domain,
        learned_facts: facts.map(f => ({
          fact: f.fact,
          confidence: f.confidence,
          usage_count: f.usage_count,
          success_rate: f.success_rate
        })),
        tool_patterns: toolPatterns.map(p => ({
          tool_name: p.tool_name,
          success_rate: p.success_rate,
          usage_count: p.usage_count,
          avg_duration_ms: p.avg_duration_ms,
          common_contexts: [p.preferred_for],
          best_practices: p.notes ? [p.notes] : []
        })),
        success_contexts: successContexts,
        total_conversations: summary.total_conversations,
        last_updated: knowledge.last_updated,
        recommendations
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      knowledge: {
        agent_slug,
        learned_facts: [],
        tool_patterns: [],
        success_contexts: [],
        total_conversations: 0,
        last_updated: new Date().toISOString()
      }
    }
  }
}
