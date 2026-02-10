import { v4 as uuidv4 } from 'uuid';
import { type ToolContext, addTimestamps } from '@/lib/tools/helpers';
import { normalizeSchedule } from '@/lib/workflow-timeline/scheduler';

interface ScheduleWorkflowInput {
  workflow_id: string;
  schedule: string;
  schedule_type?: 'once' | 'recurring';
  run_at?: string;
  timezone?: string;
  space_id?: string;
  context?: Record<string, any>;
  enabled?: boolean;
  metadata?: Record<string, any>;
}

interface ScheduleWorkflowOutput {
  success: boolean;
  schedule_id?: string;
  next_run?: string;
  schedule_path?: string;
  cron_expression?: string;
  schedule_type?: 'once' | 'recurring';
  run_at?: string | null;
  label?: string;
  error?: string;
}

export default async function scheduleWorkflow(
  input: ScheduleWorkflowInput,
  ctx: ToolContext
): Promise<ScheduleWorkflowOutput> {
  try {
    const {
      workflow_id,
      schedule,
      schedule_type,
      run_at,
      timezone,
      space_id,
      context = {},
      enabled = true,
      metadata = {}
    } = input;

    // Determine target space (undefined = current space)
    const targetSpace = space_id || undefined;

    // Verify workflow exists
    if (!ctx.fileExists(targetSpace, 'workflows', workflow_id, 'definition.json')) {
      return {
        success: false,
        error: `Workflow ${workflow_id} not found in space ${space_id || 'current'}`
      };
    }

    const normalized = normalizeSchedule({
      schedule,
      scheduleType: schedule_type,
      runAt: run_at,
      timezone
    });

    // Create schedule record
    const schedule_id = uuidv4();

    const scheduleRecord = addTimestamps({
      id: schedule_id,
      workflow_id,
      schedule_input: schedule,
      schedule_type: normalized.mode,
      schedule: normalized.cronExpression ?? normalized.schedule,
      cron_expression: normalized.cronExpression ?? null,
      run_at: normalized.runAt ?? null,
      timezone: normalized.timezone ?? null,
      label: normalized.label,
      context,
      enabled,
      metadata,
      next_run: normalized.nextRun,
      last_run: null,
      run_count: 0,
    });

    // Ensure directory exists and write schedule
    await ctx.ensureDir(targetSpace, 'tables', 'scheduled_jobs', 'rows');
    await ctx.writeJson(targetSpace, 'tables', 'scheduled_jobs', 'rows', `${schedule_id}.json`, scheduleRecord);

    // Get the schedule path for return value
    const schedulePath = ctx.resolvePath(targetSpace, 'tables', 'scheduled_jobs', 'rows', `${schedule_id}.json`);

    // Create initial job execution record
    if (enabled) {
      await ctx.ensureDir(targetSpace, 'tables', 'job_executions', 'rows');

      const job_id = uuidv4();
      const jobRecord = addTimestamps({
        id: job_id,
        job_type: 'workflow',
        workflow_id,
        status: 'pending',
        context: {
          ...context,
          schedule_id,
          schedule_type: normalized.mode,
          triggered_by: 'schedule'
        },
        scheduled_at: normalized.nextRun,
      });

      await ctx.writeJson(targetSpace, 'tables', 'job_executions', 'rows', `${job_id}.json`, jobRecord);
    }

    // Trigger event (non-blocking)
    try {
      await ctx.executeTool('trigger_event', {
        event_type: 'schedule.workflow_scheduled',
        space_id: targetSpace,
        data: {
          workflow_id,
          schedule_id,
          schedule_type: normalized.mode,
          cron_expression: normalized.cronExpression,
          next_run: normalized.nextRun,
          label: normalized.label,
          enabled,
          timestamp: new Date().toISOString()
        },
        metadata: {
          source_tool: 'schedule_workflow',
          operation: 'workflow_scheduled'
        }
      });
    } catch (eventError) {
      console.warn(`Failed to trigger event: ${eventError}`);
    }

    return {
      success: true,
      schedule_id,
      next_run: normalized.nextRun,
      schedule_path: schedulePath,
      cron_expression: normalized.cronExpression ?? null,
      schedule_type: normalized.mode,
      run_at: normalized.runAt ?? null,
      label: normalized.label
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
