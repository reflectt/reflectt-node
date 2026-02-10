import {
  type ToolContext,
  validateRequired,
  withErrorHandling,
} from '@/lib/tools/helpers'

interface GetWorkflowStatusInput {
  execution_id: string
  workflow_id?: string // Optional for backwards compatibility, will be inferred if not provided
  target_space?: string
  include_step_details?: boolean
}

interface GetWorkflowStatusOutput {
  success: boolean
  execution?: any
  progress?: {
    total_steps: number
    completed: number
    running: number
    failed: number
    pending: number
  }
  error?: string
}

export default async function getWorkflowStatus(
  input: GetWorkflowStatusInput,
  ctx: ToolContext
): Promise<GetWorkflowStatusOutput> {
  return withErrorHandling(async () => {
    const validation = validateRequired(input.execution_id, 'execution_id')
    if (!validation.valid) throw new Error(validation.errors[0].message)

    let execution: any

    // If workflow_id is provided, use direct path
    if (input.workflow_id) {
      try {
        execution = await ctx.readJson(input.target_space, 'workflows', input.workflow_id, 'executions', `${input.execution_id}.json`)
      } catch {
        throw new Error(`Execution not found: ${input.execution_id}`)
      }
    } else {
      // Scan all workflow directories to find the execution
      try {
        const workflowDirs = await ctx.listDirs(input.target_space, 'workflows')

        let found = false
        for (const workflowId of workflowDirs) {
          try {
            execution = await ctx.readJson(input.target_space, 'workflows', workflowId, 'executions', `${input.execution_id}.json`)
            found = true
            break
          } catch {
            // Execution not in this workflow, continue searching
          }
        }

        if (!found) {
          throw new Error(`Execution not found: ${input.execution_id}`)
        }
      } catch {
        throw new Error(`Execution not found: ${input.execution_id}`)
      }
    }

    // Calculate progress
    const steps = Object.values(execution.step_executions) as any[]
    const progress = {
      total_steps: steps.length,
      completed: steps.filter(s => s.status === 'completed').length,
      running: steps.filter(s => s.status === 'running').length,
      failed: steps.filter(s => s.status === 'failed').length,
      pending: steps.filter(s => s.status === 'pending').length
    }

    return {
      execution: input.include_step_details ? execution : {
        id: execution.id,
        workflow_id: execution.workflow_id,
        workflow_name: execution.workflow_name,
        status: execution.status,
        started_at: execution.started_at,
        completed_at: execution.completed_at
      },
      progress
    }
  })
}
