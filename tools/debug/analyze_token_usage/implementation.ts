/**
 * Analyze Token Usage Tool
 * Analyze token patterns and costs
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { ConversationFile } from '@/lib/conversations/types'

interface AnalyzeTokenUsageInput {
  user_id: string
  conversation_id?: string
  days?: number
}

interface AnalyzeTokenUsageOutput {
  success: boolean
  analysis: {
    avg_tokens_per_message: number
    high_token_conversations: Array<{
      id: string
      tokens: number
      cost_usd: number
      input_output_ratio: number
    }>
    system_prompt_tokens: number
    inefficiencies: string[]
    total_tokens: number
    total_cost_usd: number
    optimization_potential: number
  }
  error?: string
}

export default async function analyzeTokenUsage(
  input: AnalyzeTokenUsageInput,
  context: ToolContext
): Promise<AnalyzeTokenUsageOutput> {
  try {
    let conversations: ConversationFile[] = []

    if (input.conversation_id) {
      // Analyze single conversation
      const conv = await context.readJson<ConversationFile>(
        'global',
        'conversations',
        input.user_id,
        `${input.conversation_id}.json`
      )
      conversations = [conv]
    } else {
      // Analyze multiple conversations
      const days = input.days || 7
      const dateFrom = new Date()
      dateFrom.setDate(dateFrom.getDate() - days)
      const dateFromStr = dateFrom.toISOString()

      const convFiles = await context.listFiles('global', ['conversations', input.user_id], '.json')

      for (const file of convFiles) {
        if (file === 'index.json') continue

        const conv = await context.readJson<ConversationFile>(
          'global',
          'conversations',
          input.user_id,
          file
        )

        if (conv.created_at >= dateFromStr) {
          conversations.push(conv)
        }
      }
    }

    // Analyze tokens
    const analysis = analyzeTokens(conversations)

    return {
      success: true,
      analysis,
    }
  } catch (error: any) {
    return {
      success: false,
      analysis: {
        avg_tokens_per_message: 0,
        high_token_conversations: [],
        system_prompt_tokens: 0,
        inefficiencies: [],
        total_tokens: 0,
        total_cost_usd: 0,
        optimization_potential: 0,
      },
      error: `Failed to analyze token usage: ${error.message}`,
    }
  }
}

function analyzeTokens(conversations: ConversationFile[]) {
  let total_input_tokens = 0
  let total_output_tokens = 0
  let total_cost_usd = 0
  let total_messages = 0

  const highTokenConvs: Array<{
    id: string
    tokens: number
    cost_usd: number
    input_output_ratio: number
  }> = []

  for (const conv of conversations) {
    total_input_tokens += conv.total_input_tokens
    total_output_tokens += conv.total_output_tokens
    total_cost_usd += conv.total_cost_usd
    total_messages += conv.messages.length

    const totalTokens = conv.total_input_tokens + conv.total_output_tokens
    if (totalTokens > 10000) {
      highTokenConvs.push({
        id: conv.id,
        tokens: totalTokens,
        cost_usd: conv.total_cost_usd,
        input_output_ratio: conv.total_input_tokens / Math.max(conv.total_output_tokens, 1),
      })
    }
  }

  // Sort high token conversations
  highTokenConvs.sort((a, b) => b.tokens - a.tokens)

  // Detect inefficiencies
  const inefficiencies: string[] = []
  const avgRatio = total_input_tokens / Math.max(total_output_tokens, 1)

  if (avgRatio > 10) {
    inefficiencies.push(
      `High input/output ratio (${avgRatio.toFixed(1)}:1). System prompt may be too large.`
    )
  }

  if (highTokenConvs.length > conversations.length * 0.3) {
    inefficiencies.push(
      `${((highTokenConvs.length / conversations.length) * 100).toFixed(0)}% of conversations use >10k tokens. Consider prompt optimization.`
    )
  }

  const avgTokensPerConv = (total_input_tokens + total_output_tokens) / Math.max(conversations.length, 1)
  if (avgTokensPerConv > 15000) {
    inefficiencies.push(
      `Average of ${avgTokensPerConv.toFixed(0)} tokens per conversation. Consider using prompt caching.`
    )
  }

  // Estimate system prompt tokens (rough estimate from first message)
  let system_prompt_tokens = 0
  if (conversations.length > 0) {
    const firstConv = conversations[0]
    const firstUserMsg = firstConv.messages.find(m => m.role === 'user')
    if (firstUserMsg && firstUserMsg.input_tokens) {
      // System prompt is typically 1-5k tokens
      system_prompt_tokens = Math.min(firstUserMsg.input_tokens, 5000)
    }
  }

  // Estimate optimization potential
  let optimization_potential = 0
  if (avgRatio > 10) {
    // Could save ~30% with prompt caching
    optimization_potential += total_cost_usd * 0.3
  }
  if (highTokenConvs.length > 0) {
    // Could save ~20% with optimization
    optimization_potential += total_cost_usd * 0.2
  }

  return {
    avg_tokens_per_message: (total_input_tokens + total_output_tokens) / Math.max(total_messages, 1),
    high_token_conversations: highTokenConvs.slice(0, 10), // Top 10
    system_prompt_tokens,
    inefficiencies,
    total_tokens: total_input_tokens + total_output_tokens,
    total_cost_usd,
    optimization_potential,
  }
}
