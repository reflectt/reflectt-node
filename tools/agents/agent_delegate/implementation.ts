/**
 * Agent Delegate Tool Implementation
 *
 * Allows agents to delegate tasks to other specialized agents,
 * enabling multi-agent collaboration and workflows.
 */

import { createOrchestrator, type ComponentEventPayload } from '@/lib/agents/orchestrator'
import { AGENT_REGISTRY } from '@/lib/agents/registry'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { executeAgent } from '@/lib/tools/helpers/agent-executor'
import { loadAllTools, buildAnthropicToolSchema } from '@/lib/tools/helpers/tool-loader'

export interface AgentDelegateInput {
  target_agent: string
  task: string
  context?: {
    original_user_intent?: string
    component_id?: string
    data?: Record<string, any>
    delegating_agent?: string
    portal_id?: string
    delegation_chain?: Array<{
      from: string
      to: string
      task: string
      timestamp: string
    }>
    [key: string]: any
  }
  mode?: 'single' | 'sequential' | 'parallel'
  wait_for_result?: boolean
}

export interface AgentDelegateOutput {
  delegation_id: string
  target_agent: string
  target_agent_name: string
  status: 'delegated' | 'completed' | 'failed'
  message: string
  result?: any
  error?: string
  duration?: number
}

/**
 * Execute agent delegation
 */
export async function execute(
  input: AgentDelegateInput,
  context: ToolContext
): Promise<AgentDelegateOutput> {
  const startTime = Date.now()
  const delegationId = `delegation_${Date.now()}_${Math.random().toString(36).substring(7)}`

  console.log('[agent_delegate] Starting delegation:', {
    delegationId,
    targetAgent: input.target_agent,
    task: input.task,
    mode: input.mode || 'single'
  })

  try {
    // Validate target agent
    const targetAgentConfig = AGENT_REGISTRY[input.target_agent]
    if (!targetAgentConfig) {
      throw new Error(`Invalid target agent: ${input.target_agent}. Available agents: ${Object.keys(AGENT_REGISTRY).join(', ')}`)
    }

    // Create orchestrator
    const orchestrator = createOrchestrator()

    // Build delegation payload
    const delegationPayload: ComponentEventPayload = {
      component_id: input.context?.component_id || 'agent-delegation',
      event_type: 'delegate',
      event_data: {
        delegating_agent: input.context?.delegating_agent || 'unknown',
        task: input.task,
        delegation_id: delegationId,
        ...(input.context?.data || {})
      },
      user_intent: input.task,
      context: {
        space_id: context.currentSpace,
        portal_id: input.context?.portal_id,
        timestamp: new Date().toISOString(),
        original_user_intent: input.context?.original_user_intent,
        delegation_chain: [
          ...(input.context?.delegation_chain || []),
          {
            from: input.context?.delegating_agent || 'unknown',
            to: input.target_agent,
            task: input.task,
            timestamp: new Date().toISOString()
          }
        ]
      }
    }

    // Execute orchestration
    const orchestrationResult = await orchestrator.orchestrate(
      delegationPayload,
      {
        mode: input.mode || 'single',
        agents: [input.target_agent]
      }
    )

    const duration = Date.now() - startTime

    if (!orchestrationResult.success) {
      console.error('[agent_delegate] Delegation failed:', orchestrationResult.error)

      return {
        delegation_id: delegationId,
        target_agent: input.target_agent,
        target_agent_name: targetAgentConfig.name,
        status: 'failed',
        message: `Failed to delegate to ${targetAgentConfig.name}`,
        error: orchestrationResult.error?.message || 'Unknown error',
        duration
      }
    }

    const agentResult = orchestrationResult.results[0]

    console.log('[agent_delegate] Delegation successful:', {
      delegationId,
      targetAgent: agentResult.agent,
      duration
    })

    // If wait_for_result is true, execute the agent and get results
    if (input.wait_for_result) {
      console.log('[agent_delegate] Executing agent and waiting for result...')

      try {
        // Build message for the delegated agent
        const agentMessage = orchestrator.buildEventMessage(delegationPayload, agentResult)

        // Load tools for the agent
        const toolsDir = process.cwd() + '/tools'
        const { definitions } = await loadAllTools(toolsDir)
        const toolDefs = Array.from(definitions.values())
          .map(buildAnthropicToolSchema)
          .filter(schema => schema.name && schema.description && schema.input_schema)

        // Execute the agent with proper signature
        const executionResult = await executeAgent(
          agentResult.instance,
          agentMessage,
          toolDefs,
          context,
          {
            conversationType: 'agent_to_agent',
            saveConversation: true,
            metadata: {
              delegation_id: delegationId,
              delegating_agent: input.context?.delegating_agent,
              delegation_chain: delegationPayload.context.delegation_chain
            }
          }
        )

        const executionDuration = Date.now() - startTime

        console.log('[agent_delegate] Agent execution completed:', {
          delegationId,
          duration: executionDuration,
          conversationId: executionResult.conversationId
        })

        return {
          delegation_id: delegationId,
          target_agent: input.target_agent,
          target_agent_name: targetAgentConfig.name,
          status: 'completed',
          message: `Task delegated to ${targetAgentConfig.name} and completed successfully`,
          result: {
            agent_loaded: true,
            agent_id: agentResult.agentId,
            agent_name: agentResult.agent,
            capabilities: targetAgentConfig.capabilities,
            execution_result: executionResult.response,
            conversation_id: executionResult.conversationId,
            tokens_used: executionResult.usage,
            cost_usd: executionResult.totalCostUsd
          },
          duration: executionDuration
        }
      } catch (executionError) {
        console.error('[agent_delegate] Agent execution failed:', executionError)

        return {
          delegation_id: delegationId,
          target_agent: input.target_agent,
          target_agent_name: targetAgentConfig.name,
          status: 'failed',
          message: `Task delegated to ${targetAgentConfig.name} but execution failed`,
          error: executionError instanceof Error ? executionError.message : 'Unknown execution error',
          duration: Date.now() - startTime
        }
      }
    }

    // If wait_for_result is false, just return delegation status
    return {
      delegation_id: delegationId,
      target_agent: input.target_agent,
      target_agent_name: targetAgentConfig.name,
      status: 'delegated',
      message: `Task delegated to ${targetAgentConfig.name}. They will handle it asynchronously.`,
      result: {
        agent_loaded: true,
        agent_id: agentResult.agentId,
        agent_name: agentResult.agent,
        capabilities: targetAgentConfig.capabilities,
        note: 'Agent will execute asynchronously. Set wait_for_result: true to get execution results.'
      },
      duration
    }

  } catch (error) {
    const duration = Date.now() - startTime

    console.error('[agent_delegate] Delegation error:', error)

    return {
      delegation_id: delegationId,
      target_agent: input.target_agent,
      target_agent_name: AGENT_REGISTRY[input.target_agent]?.name || input.target_agent,
      status: 'failed',
      message: `Delegation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    }
  }
}

/**
 * Validation function
 */
export function validate(input: AgentDelegateInput): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Validate target_agent
  if (!input.target_agent) {
    errors.push('target_agent is required')
  } else if (!AGENT_REGISTRY[input.target_agent]) {
    errors.push(`Invalid target_agent: ${input.target_agent}. Available: ${Object.keys(AGENT_REGISTRY).join(', ')}`)
  }

  // Validate task
  if (!input.task || input.task.trim().length === 0) {
    errors.push('task is required and cannot be empty')
  }

  // Validate mode
  if (input.mode && !['single', 'sequential', 'parallel'].includes(input.mode)) {
    errors.push(`Invalid mode: ${input.mode}. Must be 'single', 'sequential', or 'parallel'`)
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Example usage documentation
 */
export const examples = [
  {
    description: 'Sales Agent delegates to Data Agent for query',
    input: {
      target_agent: 'data',
      task: 'Query the sales database for Q4 2024 revenue breakdown by product category. Return the top 5 products with their revenue and growth percentages.',
      context: {
        original_user_intent: 'User clicked "Total Revenue" stat to see breakdown',
        component_id: 'stat-grid',
        data: {
          metric: 'Total Revenue',
          period: 'Q4 2024'
        }
      },
      wait_for_result: true
    }
  },
  {
    description: 'Workflow Agent delegates to Design Agent for image',
    input: {
      target_agent: 'design',
      task: 'Generate a completion badge image for the "Launch MVP" milestone. Make it celebratory with confetti and a rocket icon.',
      context: {
        original_user_intent: 'User moved "Launch MVP" card to Done column',
        component_id: 'kanban-board',
        data: {
          card_title: 'Launch MVP',
          milestone: 'major'
        }
      },
      wait_for_result: true
    }
  },
  {
    description: 'Data Agent delegates to Sales Agent for insights',
    input: {
      target_agent: 'sales',
      task: 'Analyze this revenue data and provide strategic insights. Identify trends, risks, and opportunities.',
      context: {
        original_user_intent: 'User clicked Q4 bar in revenue chart',
        component_id: 'chart',
        data: {
          q4_revenue: 125000,
          q3_revenue: 98000,
          growth: '27.5%'
        }
      },
      wait_for_result: true
    }
  }
]
