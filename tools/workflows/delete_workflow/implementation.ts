import {
  type ToolContext,
  validateIdentifier,
  quickValidate,
  withErrorHandling,
} from '@/lib/tools/helpers'

interface DeleteWorkflowInput {
  id: string
  target_space?: string
}

interface DeleteWorkflowOutput {
  success: boolean
  workflow_id?: string
  path?: string
  error?: string
}

export default async function deleteWorkflow(
  input: DeleteWorkflowInput,
  ctx: ToolContext
): Promise<DeleteWorkflowOutput> {
  return withErrorHandling(async () => {
    const error = quickValidate([
      () => validateIdentifier(input.id, 'workflow_id')
    ])
    if (error) throw new Error(error)

    // Check if workflow exists and get details for event
    let workflowData: any = null;
    try {
      workflowData = await ctx.readJson(input.target_space, 'workflows', input.id, 'definition.json')
    } catch {
      throw new Error(`Workflow not found: ${input.id}`)
    }

    // Delete entire workflow directory (including all executions)
    await ctx.deleteDir(input.target_space, 'workflows', input.id)

    // Trigger workflow deletion event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'system.workflow_deleted',
        space_id: input.target_space,
        data: {
          workflow_id: input.id,
          workflow_name: workflowData?.name || input.id,
          step_count: workflowData?.steps?.length || 0,
          tags: workflowData?.tags || [],
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'delete_workflow',
          operation: 'workflow_deleted'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      workflow_id: input.id,
      path: `workflows/${input.id}/`
    }
  })
}
