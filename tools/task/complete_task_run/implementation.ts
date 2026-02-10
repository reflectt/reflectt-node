import {
  formatError,
  validateRequired,
  validateAll,
  now,
  type ToolOutput,
} from '@/lib/tools/helpers';
import { type ToolContext } from '@/lib/tools/helpers/tool-context';
import { readJsonFile, writeJsonFile } from '@/lib/tools/helpers/file-operations';

interface CompleteTaskRunInput {
  run_path: string;
  result: string;
  tokens?: number;
  cost?: number;
}

interface CompleteTaskRunOutput extends ToolOutput<{ duration_ms?: number }> {
  success: boolean;
  duration_ms?: number;
}

async function completeTaskRunImpl(
  input: CompleteTaskRunInput,
  ctx: ToolContext
): Promise<CompleteTaskRunOutput> {
  const validation = validateAll([
    () => validateRequired(input.run_path, 'run_path'),
    () => validateRequired(input.result, 'result'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  const run = await readJsonFile(input.run_path);
  if (!run) {
    throw new Error(`Task run not found at ${input.run_path}`);
  }

  const startTime = new Date(run.started_at).getTime();
  const endTime = Date.now();
  const duration_ms = endTime - startTime;

  run.status = 'completed';
  run.completed_at = now();
  run.duration_ms = duration_ms;
  run.result = input.result;
  run.total_tokens = input.tokens;
  run.total_cost = input.cost;

  await writeJsonFile(input.run_path, run);

  return { success: true, duration_ms };
}

export default async function completeTaskRun(
  input: CompleteTaskRunInput,
  ctx: ToolContext
): Promise<CompleteTaskRunOutput> {
  try {
    const result = await completeTaskRunImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
