import { type ToolContext } from '@/lib/tools/helpers'

interface ProcessJobQueueInput {
  space_id?: string;
  limit?: number;
  job_type?: 'workflow' | 'task';
}

interface JobResult {
  job_id: string;
  job_type: string;
  workflow_id?: string;
  status: 'completed' | 'failed';
  start_time: string;
  end_time: string;
  duration_ms: number;
  result?: any;
  error?: string;
}

interface ProcessJobQueueOutput {
  processed: number;
  succeeded: number;
  failed: number;
  jobs: JobResult[];
  space_id: string;
}

export default async function processJobQueue(
  input: ProcessJobQueueInput,
  ctx: ToolContext
): Promise<ProcessJobQueueOutput> {
  const space_id = input.space_id || 'current';
  const limit = input.limit || 10;
  const job_type = input.job_type;

  // Determine space target
  const target = space_id === 'current' ? undefined : space_id;

  // Check if job executions table exists
  if (!ctx.fileExists(target, 'tables', 'job_executions', 'rows')) {
    console.log(`No job_executions table found in ${space_id}`)
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      jobs: [],
      space_id
    }
  }

  const jobFiles = (await ctx.listFiles(target, 'tables', 'job_executions', 'rows', '.json'))
  const pendingJobs: Array<{ job: any; filename: string }> = []

  // Load and filter pending jobs
  for (const filename of jobFiles) {
    const job = await ctx.readJson(target, 'tables', 'job_executions', 'rows', filename)

    if (job.status === 'pending') {
      // Filter by job_type if specified
      if (!job_type || job.job_type === job_type) {
        pendingJobs.push({ job, filename })
      }
    }
  }

  // Sort by scheduled_at (oldest first)
  pendingJobs.sort((a, b) => {
    const timeA = new Date(a.job.scheduled_at || a.job.created_at).getTime()
    const timeB = new Date(b.job.scheduled_at || b.job.created_at).getTime()
    return timeA - timeB
  })

  // Limit number of jobs to process
  const jobsToProcess = pendingJobs.slice(0, limit)

  if (jobsToProcess.length === 0) {
    console.log(`No pending jobs found in ${space_id}`)
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      jobs: [],
      space_id
    }
  }

  console.log(`\n📊 Processing ${jobsToProcess.length} pending job(s) in ${space_id}...\n`)

  const results: JobResult[] = []
  let succeeded = 0
  let failed = 0

  // Process each job
  for (const { job, filename } of jobsToProcess) {
    const start_time = new Date().toISOString()
    const startMs = Date.now()

    const jobResult: JobResult = {
      job_id: job.id,
      job_type: job.job_type,
      workflow_id: job.workflow_id,
      status: 'completed',
      start_time,
      end_time: '',
      duration_ms: 0
    }

    console.log(`🚀 Processing job ${job.id}`)
    console.log(`   Type: ${job.job_type}`)
    if (job.workflow_id) console.log(`   Workflow: ${job.workflow_id}`)

    try {
      // Update job status to 'running'
      job.status = 'running'
      job.started_at = start_time
      job.updated_at = start_time
      await ctx.writeJson(target, 'tables', 'job_executions', 'rows', filename, job)

      // Execute based on job type
      if (job.job_type === 'workflow') {
        if (!job.workflow_id) {
          throw new Error('workflow_id is required for workflow jobs')
        }

        // Use workflow_space from the job (set by trigger_event) to ensure execution
        // happens in the correct space context where the workflow resides
        const executionSpace = job.workflow_space || (space_id === 'current' ? undefined : space_id)
        
        const workflowResult = await ctx.executeTool('execute_workflow',
          {
            workflow_id: job.workflow_id,
            context: job.context || {},
            sync: true,
            target_space: executionSpace
          }
        )

        jobResult.result = workflowResult
      } else {
        throw new Error(`Unsupported job type: ${job.job_type}`)
      }

      // Job succeeded
      const end_time = new Date().toISOString()
      const endMs = Date.now()
      jobResult.end_time = end_time
      jobResult.duration_ms = endMs - startMs
      jobResult.status = 'completed'
      succeeded++

      console.log(`   ✅ Completed in ${jobResult.duration_ms}ms\n`)

      // Update job status to 'completed'
      job.status = 'completed'
      job.completed_at = end_time
      job.result = jobResult.result
      job.updated_at = end_time
      await ctx.writeJson(target, 'tables', 'job_executions', 'rows', filename, job)

      // Trigger job completion event (non-blocking)
      try {
        await ctx.executeTool('trigger_event', {
          event_type: 'job.completed',
          space_id: target,
          data: {
            job_id: job.id,
            job_type: job.job_type,
            workflow_id: job.workflow_id,
            duration_ms: jobResult.duration_ms,
            timestamp: end_time
          },
          metadata: {
            source_tool: 'process_job_queue',
            operation: 'job_completed'
          }
        });
      } catch (eventError) {
        console.warn(`Failed to trigger event: ${eventError}`);
      }

    } catch (error: any) {
      // Job failed
      const end_time = new Date().toISOString()
      const endMs = Date.now()
      jobResult.end_time = end_time
      jobResult.duration_ms = endMs - startMs
      jobResult.status = 'failed'
      jobResult.error = error.message || String(error)
      failed++

      console.error(`   ❌ Failed: ${jobResult.error}\n`)

      // Update job status to 'failed'
      job.status = 'failed'
      job.completed_at = end_time
      job.error = jobResult.error
      job.updated_at = end_time
      await ctx.writeJson(target, 'tables', 'job_executions', 'rows', filename, job)

      // Trigger job failure event (non-blocking)
      try {
        await ctx.executeTool('trigger_event', {
          event_type: 'job.failed',
          space_id: target,
          data: {
            job_id: job.id,
            job_type: job.job_type,
            workflow_id: job.workflow_id,
            duration_ms: jobResult.duration_ms,
            error: jobResult.error,
            timestamp: end_time
          },
          metadata: {
            source_tool: 'process_job_queue',
            operation: 'job_failed'
          }
        });
      } catch (eventError) {
        console.warn(`Failed to trigger event: ${eventError}`);
      }
    }

    results.push(jobResult)
  }

  console.log(`\n✅ Processed ${results.length} jobs (${succeeded} succeeded, ${failed} failed)\n`)

  return {
    processed: results.length,
    succeeded,
    failed,
    jobs: results,
    space_id
  }
}