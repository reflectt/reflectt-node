import {
  type ToolContext,
  validateIdentifier,
  validateRequired,
  quickValidate,
  withErrorHandling,
  addTimestamps,
} from '@/lib/tools/helpers'

interface WorkflowStep {
  id: string
  agent: string
  task: string
  depends_on: string[]
  inputs: Record<string, any>
  error_handling: 'fail' | 'continue' | 'retry'
  max_retries?: number
}

interface CreateWorkflowInput {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  target_space?: string
  tags?: string[]
  version?: string
}

interface CreateWorkflowOutput {
  success: boolean
  workflow_id?: string
  path?: string
  error?: string
  validation_errors?: string[]
}

function validateDependencies(steps: WorkflowStep[]): string[] {
  const errors: string[] = []
  const stepIds = new Set(steps.map(s => s.id))

  // Check for duplicate step IDs
  const duplicates = steps.map(s => s.id).filter((id, index, arr) => arr.indexOf(id) !== index)
  if (duplicates.length > 0) {
    errors.push(`Duplicate step IDs: ${duplicates.join(', ')}`)
  }

  // Check dependencies exist
  for (const step of steps) {
    for (const dep of step.depends_on) {
      if (!stepIds.has(dep)) {
        errors.push(`Step "${step.id}" depends on non-existent step "${dep}"`)
      }
    }
  }

  // Check for circular dependencies
  function hasCycle(stepId: string, visited: Set<string>, recStack: Set<string>): boolean {
    visited.add(stepId)
    recStack.add(stepId)

    const step = steps.find(s => s.id === stepId)
    if (step) {
      for (const dep of step.depends_on) {
        if (!visited.has(dep)) {
          if (hasCycle(dep, visited, recStack)) return true
        } else if (recStack.has(dep)) {
          return true
        }
      }
    }

    recStack.delete(stepId)
    return false
  }

  const visited = new Set<string>()
  const recStack = new Set<string>()

  for (const step of steps) {
    if (!visited.has(step.id) && hasCycle(step.id, visited, recStack)) {
      errors.push('Circular dependency detected')
      break
    }
  }

  return errors
}

export default async function upsertWorkflow(
  input: CreateWorkflowInput,
  ctx: ToolContext
): Promise<CreateWorkflowOutput> {
  return withErrorHandling(async () => {
    // Validate input
    const error = quickValidate([
      () => validateIdentifier(input.id, 'workflow_id'),
      () => validateRequired(input.name, 'name'),
      () => validateRequired(input.description, 'description'),
    ])
    if (error) throw new Error(error)

    if (!input.steps || input.steps.length === 0) {
      throw new Error('At least one step required')
    }

    // Validate each step
    for (const step of input.steps) {
      const stepError = quickValidate([
        () => validateIdentifier(step.id, 'step_id'),
        () => validateRequired(step.agent, 'agent'),
        () => validateRequired(step.task, 'task'),
      ])
      if (stepError) throw new Error(stepError)

      if (!['fail', 'continue', 'retry'].includes(step.error_handling)) {
        throw new Error(`Step "${step.id}" has invalid error_handling`)
      }
    }

    // Validate dependencies
    const validationErrors = validateDependencies(input.steps)
    if (validationErrors.length > 0) {
      return { success: false, validation_errors: validationErrors }
    }

    // Create workflow record
    const workflow = addTimestamps({
      id: input.id,
      name: input.name,
      description: input.description,
      steps: input.steps,
      tags: input.tags || [],
      version: input.version || '1.0.0',
    })

    // Check if workflow already exists (update vs create)
    const workflowExists = ctx.fileExists(input.target_space, 'workflows', input.id, 'definition.json');
    const operation = workflowExists ? 'updated' : 'created';

    // Save to workflows/[workflow_id]/definition.json
    await ctx.writeJson(input.target_space, 'workflows', input.id, 'definition.json', workflow)

    // Trigger workflow management event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: workflowExists ? 'system.workflow_updated' : 'system.workflow_created',
        space_id: input.target_space,
        data: {
          workflow_id: input.id,
          workflow_name: input.name,
          operation,
          step_count: input.steps.length,
          version: workflow.version,
          tags: workflow.tags,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'upsert_workflow',
          operation: `workflow_${operation}`
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      workflow_id: input.id,
      path: `workflows/${input.id}/definition.json`
    }
  })
}
