import { v4 as uuidv4 } from 'uuid';
import {
  type ToolContext,
  validateEventType,
  validateRequired,
  quickValidate,
  withErrorHandling,
  addTimestamps,
  now,
  type ToolOutput,
} from '@/lib/tools/helpers';

interface TriggerEventInput {
  event_type: string;
  data: Record<string, any>;
  space?: string;
  metadata?: Record<string, any>;
}

interface TriggerEventOutput {
  event_id: string;
  triggered_workflows: string[];
  event_path: string;
  timestamp: string;
}

export default async function triggerEvent(
  input: TriggerEventInput,
  ctx: ToolContext
): Promise<ToolOutput<TriggerEventOutput>> {
  return withErrorHandling(async () => {
    const { event_type, data, space, metadata = {} } = input;

    // Validate inputs
    const error = quickValidate([
      () => validateRequired(event_type, 'event_type'),
      () => validateEventType(event_type, 'event_type'),
      () => validateRequired(data, 'data'),
      () => validateRequired(space, 'space'),
    ]);
    if (error) throw new Error(error);

    // Events must belong to a specific space
    const target = space;

    // Create event record with proper timestamps
    const event_id = uuidv4();
    const timestamp = now();

    const eventRecord = addTimestamps({
      id: event_id,
      event_type,
      data,
      metadata: {
        ...metadata,
        source: 'trigger_event_tool',
        triggered_at: timestamp,
        triggered_workflows: [] as string[]
      },
      status: 'triggered',
    });

    // Save event to events table
    await ctx.ensureDir(target, 'tables', 'events');
    await ctx.writeJson(target, 'tables', 'events', `${event_id}.json`, eventRecord);
    const eventPath = ctx.resolvePath(target, 'tables', 'events', `${event_id}.json`);

    // Helper function to scan workflows in a directory
    const scanWorkflows = async (spaceTarget: string | undefined) => {
      const workflows: Array<{ workflow: any; spaceTarget: string | undefined }> = [];

      if (ctx.fileExists(spaceTarget as any, 'workflows')) {
        // Get all directories (workflow folders)
        const workflowDirs = await ctx.listDirs(spaceTarget, 'workflows');

        for (const workflowDir of workflowDirs) {
          // Check for definition.json in directory
          if (ctx.fileExists(spaceTarget, 'workflows', workflowDir, 'definition.json')) {
            const workflow = await ctx.readJson(spaceTarget, 'workflows', workflowDir, 'definition.json');
            workflows.push({ workflow, spaceTarget });
          }
        }

        // Also check for flat .json files
        const workflowFiles = await ctx.listFiles(spaceTarget, 'workflows', '.json');
        for (const workflowFile of workflowFiles) {
          const workflow = await ctx.readJson(spaceTarget, 'workflows', workflowFile);
          workflows.push({ workflow, spaceTarget });
        }
      }

      return workflows;
    };

    // Look up workflows that listen to this event type in BOTH space and global
    const triggeredWorkflows: string[] = [];
    // Always check space-specific workflows first, then global workflows
    const spacesToCheck = [target, 'global'];
    
    for (const spaceToCheck of spacesToCheck) {
      const workflows = await scanWorkflows(spaceToCheck);
      
      for (const { workflow, spaceTarget } of workflows) {
        // Check if workflow has event triggers
        if (workflow.triggers && Array.isArray(workflow.triggers)) {
          const matchingTrigger = workflow.triggers.find(
            (trigger: any) => trigger.type === 'event' && trigger.event_type === event_type
          );

          if (matchingTrigger) {
            // Enqueue workflow for execution
            await ctx.ensureDir(target, 'tables', 'job_executions', 'rows');

            const job_id = uuidv4();
            const jobRecord = addTimestamps({
              id: job_id,
              job_type: 'workflow',
              workflow_id: workflow.id,
              workflow_space: spaceTarget, // Track which space the workflow came from
              status: 'pending',
              context: {
                event_id,
                event_type,
                event_data: data,
                triggered_by: 'event'
              },
              scheduled_at: timestamp,
            });

            await ctx.writeJson(target, 'tables', 'job_executions', 'rows', `${job_id}.json`, jobRecord);

            triggeredWorkflows.push(workflow.id);
          }
        }
      }
    }

    // Update event with triggered workflows
    eventRecord.metadata.triggered_workflows = triggeredWorkflows;
    eventRecord.status = triggeredWorkflows.length > 0 ? 'enqueued' : 'no_listeners';
    await ctx.writeJson(target, 'tables', 'events', `${event_id}.json`, eventRecord);

    // ASYNC JOB PROCESSING: Jobs are enqueued and will be processed by process_job_queue
    // This makes trigger_event non-blocking and prevents timeouts
    if (triggeredWorkflows.length > 0) {
      console.log(`\n✅ Event triggered ${triggeredWorkflows.length} workflow(s): ${triggeredWorkflows.join(', ')}`)
      console.log(`   Jobs enqueued. Use process_job_queue to execute them.\n`)
    }

    return {
      event_id,
      triggered_workflows: triggeredWorkflows,
      event_path: eventPath,
      timestamp
    };
  });
}
