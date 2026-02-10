import { v4 as uuidv4 } from 'uuid'
import {
  type ToolContext,
  addTimestamps,
  updateTimestamp,
} from '@/lib/tools/helpers'
import {
  isDue,
  calculateNextAfter,
  parseCronSchedule,
} from '@/lib/workflow-timeline/scheduler'

interface CheckScheduledWorkflowsInput {
  space_id?: string
  limit?: number
  now?: string
  auto_process?: boolean
  notification?: DispatchNotificationConfig
}

interface DispatchedJob {
  schedule_id: string
  workflow_id: string
  job_id: string
  run_at: string
  mode: 'once' | 'recurring'
}

interface CheckScheduledWorkflowsOutput {
  success: boolean
  dispatched: DispatchedJob[]
  total_schedules: number
  pending_count: number
  next_due?: string | null
  auto_processed?: boolean
  error?: string
  notifications_created?: number
  notification_errors?: string[]
}

const ACTIVE_STATUSES = new Set(['pending', 'running', 'scheduled'])

interface NotificationActionConfig {
  label: string
  action: string
  payload?: Record<string, any>
}

interface DispatchNotificationConfig {
  user_id?: string
  scope?: 'global' | 'space'
  space_id?: string
  title?: string
  message?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  category?: string
  source?: string
  actions?: NotificationActionConfig[]
  metadata?: Record<string, any>
}

type CreateNotificationFn = (
  input: {
    user_id: string
    title: string
    message: string
    scope?: 'global' | 'space'
    space_id?: string
    severity?: 'info' | 'success' | 'warning' | 'error'
    category?: string
    source?: string
    metadata?: Record<string, any>
    actions?: NotificationActionConfig[]
  },
  ctx: ToolContext
) => Promise<{ success: boolean; notification_id?: string; error?: string }>

export default async function checkScheduledWorkflows(
  input: CheckScheduledWorkflowsInput,
  ctx: ToolContext
): Promise<CheckScheduledWorkflowsOutput> {
  try {
    const { space_id, limit = 25, now, auto_process = false, notification: notificationConfig } = input
    const targetSpace = space_id || undefined
    const currentTime = now ? new Date(now) : new Date()

    if (!ctx.fileExists(targetSpace, 'tables', 'scheduled_jobs', 'rows')) {
      return {
        success: true,
        dispatched: [],
        total_schedules: 0,
        pending_count: 0,
        next_due: null,
        auto_processed: false,
        notifications_created: notificationConfig ? 0 : undefined,
      }
    }

    const scheduleFiles = await ctx.listFiles(targetSpace, 'tables', 'scheduled_jobs', 'rows', '.json')
    if (scheduleFiles.length === 0) {
      return {
        success: true,
        dispatched: [],
        total_schedules: 0,
        pending_count: 0,
        next_due: null,
        auto_processed: false,
        notifications_created: notificationConfig ? 0 : undefined,
      }
    }

    const schedules = await Promise.all(
      scheduleFiles.map(async (filename) => {
        const record = await ctx.readJson(targetSpace, 'tables', 'scheduled_jobs', 'rows', filename)
        return { filename, record }
      })
    )

    const enabledSchedules = schedules.filter(({ record }) => record?.enabled !== false)

    // Preload job executions referencing schedules to avoid duplicate dispatch
    const activeJobScheduleIds = new Set<string>()
    if (ctx.fileExists(targetSpace, 'tables', 'job_executions', 'rows')) {
      const jobFiles = await ctx.listFiles(targetSpace, 'tables', 'job_executions', 'rows', '.json')
      for (const jobFilename of jobFiles) {
        try {
          const job = await ctx.readJson(targetSpace, 'tables', 'job_executions', 'rows', jobFilename)
          const scheduleId = job?.context?.schedule_id
          if (!scheduleId) continue

          if (job?.status === 'scheduled') {
            // Migrate legacy "scheduled" jobs to pending so the worker picks them up
            job.status = 'pending'
            job.updated_at = new Date().toISOString()
            await ctx.writeJson(targetSpace, 'tables', 'job_executions', 'rows', jobFilename, job)
          }

          const status = job?.status
          if (typeof status === 'string' && ACTIVE_STATUSES.has(status)) {
            activeJobScheduleIds.add(scheduleId)
          }
        } catch {
          // ignore malformed job
        }
      }
    }

    const dispatched: DispatchedJob[] = []
    let pendingCount = 0
    let nextDue: string | null = null
    let notificationsCreated = 0
    const notificationErrors: string[] = []

    for (const { filename, record } of enabledSchedules) {
      const scheduleId = record?.id
      const nextRun = record?.next_run ?? null

      if (!scheduleId || !nextRun) {
        continue
      }

      if (activeJobScheduleIds.has(scheduleId)) {
        pendingCount += 1
        continue
      }

      if (!isDue(nextRun, currentTime)) {
        if (!nextDue || nextRun < nextDue) {
          nextDue = nextRun
        }
        continue
      }

      if (dispatched.length >= limit) {
        pendingCount += 1
        continue
      }

      const workflowId = record?.workflow_id
      if (!workflowId) {
        continue
      }

      await ctx.ensureDir(targetSpace, 'tables', 'job_executions', 'rows')

      const jobId = uuidv4()
      const runAtIso = new Date(Math.max(currentTime.getTime(), new Date(nextRun).getTime())).toISOString()

      const jobRecord = addTimestamps({
        id: jobId,
        job_type: 'workflow',
        workflow_id: workflowId,
        status: 'pending',
        context: {
          ...record.context,
          schedule_id: scheduleId,
          schedule_type: record.schedule_type ?? 'recurring',
          triggered_by: 'schedule'
        },
        scheduled_at: runAtIso
      })

      await ctx.writeJson(targetSpace, 'tables', 'job_executions', 'rows', `${jobId}.json`, jobRecord)

      const updatedSchedule = updateTimestamp({
        ...record,
        last_run: runAtIso,
        run_count: Number(record.run_count ?? 0) + 1,
        last_job_id: jobId,
      })

      if ((record.schedule_type ?? 'recurring') === 'once') {
        updatedSchedule.enabled = false
        updatedSchedule.next_run = null
      } else {
        const cronSource = record.cron_expression || record.schedule
        if (cronSource) {
          const cronExpression = parseCronSchedule(cronSource)
          updatedSchedule.next_run = calculateNextAfter(runAtIso, cronExpression)
        }
      }

      await ctx.writeJson(targetSpace, 'tables', 'scheduled_jobs', 'rows', filename, updatedSchedule)

      dispatched.push({
        schedule_id: scheduleId,
        workflow_id: workflowId,
        job_id: jobId,
        run_at: runAtIso,
        mode: (record.schedule_type ?? 'recurring') as 'once' | 'recurring'
      })

      if (notificationConfig) {
        const hasSpaceContext = Boolean(notificationConfig.space_id || targetSpace)
        const resolvedScope = notificationConfig.scope ?? (hasSpaceContext ? 'space' : 'global')
        const resolvedSpaceId =
          resolvedScope === 'space'
            ? notificationConfig.space_id ?? (typeof targetSpace === 'string' ? targetSpace : undefined)
            : undefined

        const notificationUserId = notificationConfig.user_id?.trim() || 'web_user'

        try {
          const result = await ctx.executeTool('create_notification',
            {
              user_id: notificationUserId,
              title:
                notificationConfig.title ??
                (record?.label
                  ? `Scheduled workflow dispatched: ${record.label}`
                  : 'Scheduled workflow dispatched'),
              message:
                notificationConfig.message ??
                `Workflow ${workflowId} queued from schedule ${scheduleId} for ${runAtIso}.`,
              scope: resolvedScope,
              space_id: resolvedScope === 'space' ? resolvedSpaceId : undefined,
              severity: notificationConfig.severity ?? 'info',
              category: notificationConfig.category ?? 'scheduler',
              source: notificationConfig.source ?? 'check_scheduled_workflows',
              metadata: {
                ...(notificationConfig.metadata ?? {}),
                schedule_id: scheduleId,
                workflow_id: workflowId,
                job_id: jobId,
                run_at: runAtIso,
                schedule_type: record.schedule_type ?? 'recurring',
                label: record?.label ?? null,
              },
              actions: notificationConfig.actions,
            }
          )

          if (result.success) {
            notificationsCreated += 1
          } else if (result.error) {
            notificationErrors.push(result.error)
          }
        } catch (error) {
          notificationErrors.push(error instanceof Error ? error.message : String(error))
        }
      }
    }

    let autoProcessed = false
    if (auto_process && dispatched.length > 0) {
      await ctx.executeTool('process_job_queue', { space_id, limit: dispatched.length })
      autoProcessed = true
    }

    // Trigger schedule check event (non-blocking)
    if (dispatched.length > 0) {
      try {
        await ctx.executeTool('trigger_event', {
          event_type: 'schedule.jobs_dispatched',
          space_id: targetSpace,
          data: {
            dispatched_count: dispatched.length,
            pending_count: pendingCount,
            total_schedules: enabledSchedules.length,
            next_due: nextDue,
            workflows_triggered: dispatched.map(d => d.workflow_id),
            auto_processed: autoProcessed,
            timestamp: new Date().toISOString()
          },
          metadata: {
            source_tool: 'check_scheduled_workflows',
            operation: 'jobs_dispatched'
          }
        });
      } catch (eventError) {
        console.warn(`Failed to trigger event: ${eventError}`);
      }
    }

    return {
      success: true,
      dispatched,
      total_schedules: enabledSchedules.length,
      pending_count: pendingCount,
      next_due: nextDue,
      auto_processed: autoProcessed,
      notifications_created: notificationConfig ? notificationsCreated : undefined,
      notification_errors: notificationConfig && notificationErrors.length > 0 ? notificationErrors : undefined,
    }
  } catch (error) {
    return {
      success: false,
      dispatched: [],
      total_schedules: 0,
      pending_count: 0,
      next_due: null,
      auto_processed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
