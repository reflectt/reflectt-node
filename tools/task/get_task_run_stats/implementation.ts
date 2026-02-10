import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface GetTaskRunStatsInput {
  agent_name: string;
  task_id: string;
}

interface GetTaskRunStatsOutput {
  success: boolean;
  total_runs?: number;
  completed?: number;
  failed?: number;
  avg_duration_ms?: number;
  success_rate?: number;
  error?: string;
}

async function getTaskRunStatsImpl(
  input: GetTaskRunStatsInput,
  ctx: ToolContext
): Promise<GetTaskRunStatsOutput> {
  const validation = validateAll([
    () => validateRequired(input.agent_name, 'agent_name'),
    () => validateRequired(input.task_id, 'task_id'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // List all run files in current space
  const runFiles = await ctx.listFiles(
    undefined,
    'tasks',
    input.agent_name,
    input.task_id,
    'runs'
  );

  // Filter for JSON files
  const jsonFiles = runFiles.filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    return {
      success: true,
      total_runs: 0,
      completed: 0,
      failed: 0,
      avg_duration_ms: 0,
      success_rate: 0
    };
  }

  // Read all run files
  const runs = await Promise.all(
    jsonFiles.map(async (f) => {
      try {
        return await ctx.readJson(
          undefined,
          'tasks',
          input.agent_name,
          input.task_id,
          'runs',
          f
        );
      } catch {
        return null;
      }
    })
  );

  // Filter out any null reads
  const validRuns = runs.filter(r => r !== null);

  const completed = validRuns.filter(r => r.status === 'completed').length;
  const failed = validRuns.filter(r => r.status === 'failed').length;
  const avgDuration = validRuns
    .filter(r => r.duration_ms)
    .reduce((sum, r) => sum + (r.duration_ms || 0), 0) / validRuns.length || 0;

  return {
    success: true,
    total_runs: validRuns.length,
    completed,
    failed,
    avg_duration_ms: Math.round(avgDuration),
    success_rate: validRuns.length > 0 ? (completed / validRuns.length) * 100 : 0
  };
}

export default async function getTaskRunStats(
  input: GetTaskRunStatsInput,
  ctx: ToolContext
): Promise<GetTaskRunStatsOutput> {
  try {
    return await getTaskRunStatsImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
