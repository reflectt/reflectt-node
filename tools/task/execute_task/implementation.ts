import type { ToolContext } from '@/lib/tools/helpers'
import {
  loadTask,
  buildTaskPrompt,
  formatError,
} from '@/lib/tools/helpers'

interface ExecuteTaskInput {
  agent_name: string
  task_name: string
  input?: Record<string, any>
  context?: Record<string, any>
  conversation_history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

interface ExecuteTaskOutput {
  success: boolean
  agent?: string
  task?: string
  result?: string
  tokens_used?: {
    input: number
    output: number
  }
  tools_used?: Array<{
    name: string
    input: any
    result: string
  }>
  run_id?: string
  error?: string
}

/**
 * Execute a task for an agent
 *
 * Phase 2 Refactoring: Now routes execution through chat_with_agent tool
 * instead of calling lib helpers directly. This creates clean dependency chain:
 * execute_task → chat_with_agent → lib/agent-executor
 *
 * Task-specific logic preserved:
 * - Task run tracking (create/start/complete/fail)
 * - Task stats recording
 * - Task context building
 * - Tool usage recording
 */
export default async function executeTask(
  input: ExecuteTaskInput,
  context: ToolContext
): Promise<ExecuteTaskOutput> {
  try {
    const { agent_name, task_name, input: taskInput, context: taskContext } = input

    // Load the task (use workflow_space if provided, otherwise checks space-specific first, then global)
    const workflowSpace = taskContext?.workflow_space as string | undefined
    const task = await loadTask(agent_name, task_name, context, workflowSpace)

    if (!task) {
      throw new Error(`Task "${task_name}" not found for agent "${agent_name}"`)
    }

    // Create task run for tracking
    const createRunResult = await context.executeTool('create_task_run', {
      agent_name,
      task_id: task.id || task_name,
      task_title: task.title || task_name,
      description: task.description,
      prompt: task.prompt,
      prompt_file: task.prompt_file,
      context: taskContext,
      steps: task.steps,
    })

    if (!createRunResult.success) {
      throw new Error(`Failed to create task run: ${createRunResult.error}`)
    }

    const runPath = createRunResult.run_path
    const runId = createRunResult.run_id

    // Get task stats for context
    try {
      const stats = await context.executeTool('get_task_run_stats', {
        agent_name,
        task_id: task.id || task_name,
      })
      // Stats are optional, just log if available
      if (stats.total_runs > 1) {
        console.log(`Task Stats: ${stats.total_runs} runs, ${stats.success_rate}% success`)
      }
    } catch {
      // Stats are optional, ignore errors
    }

    // Build the complete task prompt
    const fullPrompt = await buildTaskPrompt(task, agent_name, task_name, context)

    // Build comprehensive task context (combines task info + input + workflow context)
    const combinedContext = {
      task_name: task.title || task_name,
      task_description: task.description,
      task_id: task.id || task_name,
      run_id: runId,
      run_path: runPath,
      input: taskInput || {},
      ...(taskContext || {}), // Add workflow variables
    }

    // Start task run
    const startResult = await context.executeTool('start_task_run', {
      run_path: runPath,
      agent_model: 'claude-haiku-4-5-20251001', // Will be overridden by agent's model
    })

    if (!startResult.success) {
      throw new Error(`Failed to start task run: ${startResult.error}`)
    }

    // Execute via chat_with_agent tool (NEW: routes through tool system)
    const chatResult = await context.executeTool('chat_with_agent', {
      agent_slug: agent_name,
      message: fullPrompt,
      context: combinedContext,
      conversation_history: input.conversation_history,
    })

    if (!chatResult.success) {
      // Fail task run
      await context.executeTool('fail_task_run', {
        run_path: runPath,
        error: chatResult.error || 'Agent execution failed',
      })

      throw new Error(`Agent execution failed: ${chatResult.error}`)
    }

    // Record tools used (if any were tracked)
    const toolsUsed: Array<{ name: string; input: any; result: string }> = []
    if (chatResult.tools_used && Array.isArray(chatResult.tools_used)) {
      for (const tool of chatResult.tools_used) {
        await context.executeTool('record_tool_use', {
          run_path: runPath,
          tool_name: tool.name,
          tool_input: tool.input,
          tool_output: tool.result,
        })
        toolsUsed.push(tool)
      }
    }

    // Complete task run
    const completeResult = await context.executeTool('complete_task_run', {
      run_path: runPath,
      result: chatResult.response,
    })

    if (!completeResult.success) {
      console.error(`Warning: Failed to complete task run: ${completeResult.error}`)
    }

    // Trigger success event (non-blocking)
    try {
      await context.executeTool('trigger_event', {
        event_type: 'agent.task_completed',
        data: {
          agent_name,
          task_name,
          task_id: task.id || task_name,
          run_id: runId,
          result_preview: chatResult.response?.substring(0, 500),
          tokens_used: chatResult.tokens_used,
          tools_count: toolsUsed.length,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'execute_task',
          operation: 'task_completed'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      agent: agent_name,
      task: task_name,
      result: chatResult.response,
      tokens_used: chatResult.tokens_used,
      tools_used: toolsUsed,
      run_id: runId,
    }
  } catch (error) {
    // Trigger failure event (non-blocking)
    try {
      await context.executeTool('trigger_event', {
        event_type: 'agent.task_failed',
        data: {
          agent_name: input.agent_name,
          task_name: input.task_name,
          error: formatError(error),
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'execute_task',
          operation: 'task_failed'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: false,
      error: formatError(error)
    }
  }
}
