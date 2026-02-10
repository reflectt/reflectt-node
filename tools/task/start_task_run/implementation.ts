import {
  formatError,
  validateRequired,
  validateAll,
  now,
} from '@/lib/tools/helpers';
import { type ToolContext } from '@/lib/tools/helpers/tool-context';
import { readJsonFile, writeJsonFile } from '@/lib/tools/helpers/file-operations';

interface StartTaskRunInput {
  run_path: string;
  agent_model: string;
}

interface StartTaskRunOutput {
  success: boolean;
  error?: string;
}

async function startTaskRunImpl(
  input: StartTaskRunInput,
  ctx: ToolContext
): Promise<StartTaskRunOutput> {
  const validation = validateAll([
    () => validateRequired(input.run_path, 'run_path'),
    () => validateRequired(input.agent_model, 'agent_model'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  const run = await readJsonFile(input.run_path);
  if (!run) {
    throw new Error(`Task run not found at ${input.run_path}`);
  }

  run.status = 'running';
  run.started_at = now();
  run.agent_model = input.agent_model;

  await writeJsonFile(input.run_path, run);

  return {
    success: true,
  };
}

export default async function startTaskRun(
  input: StartTaskRunInput,
  ctx: ToolContext
): Promise<StartTaskRunOutput> {
  try {
    const result = await startTaskRunImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
