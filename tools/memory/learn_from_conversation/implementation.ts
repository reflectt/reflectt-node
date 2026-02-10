import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { loadConversation } from '@/lib/conversations/storage-v2'
import { extractLearnings, updateKnowledgeGraph } from '@/lib/memory/context-synthesis'
import { recordAgentFact, recordToolSuccess } from '@/lib/memory/agent-knowledge'

interface LearnFromConversationInput {
  conversation_id: string
  user_id: string
  auto_update?: boolean
}

export default async function learn_from_conversation(
  input: LearnFromConversationInput,
  context: ToolContext
) {
  const { conversation_id, user_id, auto_update = true } = input

  try {
    // Load the conversation
    const conversation = await loadConversation(conversation_id, user_id, context, 'global')

    if (!conversation) {
      return {
        success: false,
        error: `Conversation not found: ${conversation_id}`
      }
    }

    // Extract learnings from conversation
    const learnings = await extractLearnings(conversation, context)

    const result = {
      success: true,
      learnings: {
        facts: learnings.facts,
        preferences: learnings.preferences,
        patterns: learnings.patterns,
        tool_successes: [] as string[],
        agent_insights: [] as string[]
      },
      updated_profile: false,
      updated_knowledge_graph: false
    }

    // Auto-update if requested
    if (auto_update) {
      // Update knowledge graph with facts
      if (learnings.facts.length > 0) {
        await updateKnowledgeGraph(user_id, learnings.facts, conversation_id, context)
        result.updated_knowledge_graph = true
      }

      // Update user profile with preferences
      if (Object.keys(learnings.preferences).length > 0) {
        try {
          const profileSegments = ['memory', 'users', user_id, 'profile.json']
          let profile: any

          try {
            profile = await context.readJson('global', ...profileSegments)
          } catch {
            // Create default profile
            profile = {
              user_id,
              name: user_id,
              preferences: {},
              working_style: {},
              domains: [],
              created_at: new Date().toISOString()
            }
          }

          // Merge preferences
          profile.preferences = {
            ...profile.preferences,
            ...learnings.preferences
          }

          profile.updated_at = new Date().toISOString()

          // Save profile
          await context.ensureDir('global', 'memory', 'users', user_id)
          await context.writeJson('global', ...profileSegments, profile)
          result.updated_profile = true
        } catch (error: any) {
          console.error('Failed to update user profile:', error)
        }
      }

      // Record agent learnings and tool usage
      const agentSlug = conversation.agent_slug
      const success = conversation.status === 'completed'

      // Record tool usage patterns
      for (const tool of conversation.tools_used) {
        const toolSuccess = tool.status === 'success'

        await recordToolSuccess(
          agentSlug,
          tool.tool_name,
          `Used in ${conversation.conversation_type}`,
          tool.duration_ms,
          toolSuccess,
          context
        )

        if (toolSuccess) {
          result.learnings.tool_successes.push(
            `${tool.tool_name} succeeded in ${tool.duration_ms}ms`
          )
        }
      }

      // Record agent facts from patterns
      for (const pattern of learnings.patterns) {
        await recordAgentFact(agentSlug, pattern, conversation_id, success, context)
        result.learnings.agent_insights.push(pattern)
      }

      // Record general agent success pattern
      if (success && conversation.duration_ms > 0) {
        const fact = `Successfully handled ${conversation.conversation_type} in ${(conversation.duration_ms / 1000).toFixed(1)}s`
        await recordAgentFact(agentSlug, fact, conversation_id, true, context)
        result.learnings.agent_insights.push(fact)
      }
    }

    return result
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      learnings: {
        facts: [],
        preferences: {},
        patterns: [],
        tool_successes: [],
        agent_insights: []
      },
      updated_profile: false,
      updated_knowledge_graph: false
    }
  }
}
