import {
  formatError,
  validateRequired,
  validateAll,
  now,
  type ToolOutput,
} from '@/lib/tools/helpers';
import { type ToolContext } from '@/lib/tools/helpers/tool-context';
import { readJsonFile, writeJsonFile } from '@/lib/tools/helpers/file-operations';

interface FailTaskRunInput {
  run_path: string;
  error: string;
}

interface FailTaskRunOutput extends ToolOutput<Record<string, unknown>> {
  success: boolean;
  duration_ms?: number;
}

async function failTaskRunImpl(
  input: FailTaskRunInput,
  ctx: ToolContext
): Promise<FailTaskRunOutput> {
  const validation = validateAll([
    () => validateRequired(input.run_path, 'run_path'),
    () => validateRequired(input.error, 'error'),
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

  run.status = 'failed';
  run.completed_at = now();
  run.duration_ms = duration_ms;
  run.error = input.error;

  await writeJsonFile(input.run_path, run);

  return { success: true, duration_ms };
}

export default async function failTaskRun(
  input: FailTaskRunInput,
  ctx: ToolContext
): Promise<FailTaskRunOutput> {
  try {
    const result = await failTaskRunImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
