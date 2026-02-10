import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface ListTaskRunsInput {
  agent_name: string;
  task_id: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  limit?: number;
}

interface ListTaskRunsOutput {
  success: boolean;
  runs?: any[];
  total?: number;
  error?: string;
}

async function listTaskRunsImpl(
  input: ListTaskRunsInput,
  ctx: ToolContext
): Promise<ListTaskRunsOutput> {
  const validation = validateAll([
    () => validateRequired(input.agent_name, 'agent_name'),
    () => validateRequired(input.task_id, 'task_id'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // List run files from the tasks directory
  const runFiles = await ctx.listFiles(undefined, 'tasks', input.agent_name, input.task_id, 'runs');
  const jsonFiles = runFiles.filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    return { success: true, runs: [], total: 0 };
  }

  let runs = await Promise.all(
    jsonFiles.map(async (f) => {
      const content = await ctx.readJson(undefined, 'tasks', input.agent_name, input.task_id, 'runs', f);
      return content;
    })
  );

  // Filter out any null reads
  runs = runs.filter(r => r !== null);

  // Sort by started_at desc (newest first)
  runs.sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  // Filter by status if provided
  if (input.status) {
    runs = runs.filter(r => r.status === input.status);
  }

  // Apply limit if provided
  if (input.limit && input.limit > 0) {
    runs = runs.slice(0, input.limit);
  }

  return {
    success: true,
    runs,
    total: runs.length
  };
}

export default async function listTaskRuns(
  input: ListTaskRunsInput,
  ctx: ToolContext
): Promise<ListTaskRunsOutput> {
  try {
    return await listTaskRunsImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
