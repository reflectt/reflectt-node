import Anthropic from "@anthropic-ai/sdk";
import { loadAllTools, buildAnthropicToolSchema } from '@/lib/tools/helpers/tool-loader'
import { executeAgent } from '@/lib/tools/helpers/agent-executor'

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatWithAgentParams {
  agent_slug: string;
  message: string;
  context?: Record<string, any>;
  conversation_history?: ChatMessage[];
  max_tokens?: number;
}

interface ChatWithAgentResult {
  success: boolean;
  response?: string;
  agent_used?: string;
  tokens_used?: {
    input: number;
    output: number;
  };
  conversation_id?: string;  // NEW: Return conversation ID
  cost_usd?: number;         // NEW: Return cost
  duration_ms?: number;      // NEW: Return duration
  error?: string;
}

export default async function chat_with_agent(
  params: ChatWithAgentParams,
  toolContext: any
): Promise<ChatWithAgentResult> {
  try {
    const {
      agent_slug,
      message,
      context = {},
      conversation_history = [],
      max_tokens = 4096,
    } = params;

    // Extract paths from new ToolContext interface
    // toolContext.resolvePath(undefined) = current space data dir
    // toolContext.resolvePath('global') = global data dir
    const dataDir = toolContext?.resolvePath ? toolContext.resolvePath(undefined) : process.cwd();
    const globalDir = toolContext?.resolvePath ? toolContext.resolvePath('global') : process.cwd();

    // Load the target agent using context.executeTool()
    const agentResult = await toolContext.executeTool('load_agent', { agent_name: agent_slug });

    if (!agentResult.agent) {
      return {
        success: false,
        error: `Agent not found: ${agent_slug}`,
      };
    }

    const agent = agentResult.agent;

    // Build the system prompt with context
    let systemPrompt = agent.system_prompt || "";

    if (Object.keys(context).length > 0) {
      systemPrompt += "\n\n## Context for this conversation:\n\n";
      systemPrompt += "```json\n" + JSON.stringify(context, null, 2) + "\n```\n";
    }

    // Load tool definitions if agent has tools
    const { definitions } = await loadAllTools(globalDir);
    const toolDefs = Array.from(definitions.values()).map(def =>
      buildAnthropicToolSchema(def)
    );

    // Convert conversation history to Anthropic format
    const history: Anthropic.MessageParam[] = conversation_history.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Create enhanced agent with injected context
    const enhancedAgent = {
      ...agent,
      system_prompt: systemPrompt,
      maxOutputTokens: max_tokens
    };

    // Get parent conversation ID from context (if called from another agent)
    const parentConversationId = (toolContext as any).conversationId

    // Determine calling agent from parent conversation
    let callingAgent: string | undefined
    if (parentConversationId) {
      try {
        // Load parent conversation to get the calling agent
        const getConvResult = await toolContext.executeTool('get_conversation', {
          conversation_id: parentConversationId
        })

        if (getConvResult?.conversation?.agent_slug) {
          callingAgent = getConvResult.conversation.agent_slug
          console.log(`[chat_with_agent] Calling agent identified: ${callingAgent}`)
        }
      } catch (error) {
        console.warn(`[chat_with_agent] Could not load parent conversation to determine calling agent:`, error)
        // Fall back to context if available
        callingAgent = (toolContext as any).currentAgent
      }
    } else {
      // No parent conversation - try to get from context
      callingAgent = (toolContext as any).currentAgent
    }

    // Execute agent using the helper (replaces custom tool loop)
    const result = await executeAgent(
      enhancedAgent,
      message,
      toolDefs,
      toolContext,
      {
        history,
        conversationType: 'agent_to_agent',        // NEW: Mark as agent-to-agent
        parentConversationId,                      // NEW: Link to parent conversation
        callingAgent,                              // NEW: Track calling agent
        saveConversation: true,                    // NEW: Enable conversation tracking
        metadata: {                                // NEW: Additional context
          calling_agent: callingAgent,
          context_provided: context
        },
        onToolUse: (name, input, result) => {
          // Optional: Track tool usage here if needed
          console.log(`[chat_with_agent] Tool used: ${name}`);
        }
      }
    );

    // Trigger agent conversation event (non-blocking)
    try {
      await toolContext.executeTool('trigger_event', {
        event_type: 'agent.conversation_completed',
        data: {
          agent_slug,
          conversation_id: result.conversationId,
          calling_agent: callingAgent,
          tokens_used: {
            input: result.usage.input_tokens,
            output: result.usage.output_tokens,
            total: result.usage.input_tokens + result.usage.output_tokens
          },
          cost_usd: result.totalCostUsd,
          duration_ms: result.durationMs,
          message_preview: message.substring(0, 200),
          response_preview: result.response.substring(0, 200),
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'chat_with_agent',
          operation: 'agent_conversation'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      response: result.response,
      agent_used: agent_slug,
      tokens_used: {
        input: result.usage.input_tokens,
        output: result.usage.output_tokens
      },
      conversation_id: result.conversationId,      // NEW: Return conversation ID
      cost_usd: result.totalCostUsd,               // NEW: Return cost
      duration_ms: result.durationMs               // NEW: Return duration
    };
  } catch (error) {
    // Trigger agent failure event (non-blocking)
    try {
      await toolContext.executeTool('trigger_event', {
        event_type: 'agent.conversation_failed',
        data: {
          agent_slug: params.agent_slug,
          error: error instanceof Error ? error.message : String(error),
          message_preview: params.message.substring(0, 200),
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'chat_with_agent',
          operation: 'agent_conversation_failed'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
