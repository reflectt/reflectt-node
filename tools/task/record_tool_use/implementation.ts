import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
  now,
} from '@/lib/tools/helpers';

interface RecordToolUseInput {
  run_path: string;
  tool_name: string;
  tool_input: any;
  tool_output?: any;
}

interface RecordToolUseOutput {
  success: boolean;
  error?: string;
}

async function recordToolUseImpl(
  input: RecordToolUseInput,
  ctx: ToolContext
): Promise<RecordToolUseOutput> {
  const validation = validateAll([
    () => validateRequired(input.run_path, 'run_path'),
    () => validateRequired(input.tool_name, 'tool_name'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Parse the run_path to extract path segments
  const pathSegments = input.run_path.split('/').filter(Boolean);

  const run = await ctx.readJson(undefined, ...pathSegments);
  if (!run) {
    throw new Error(`Task run not found at ${input.run_path}`);
  }

  if (!run.tools_used) {
    run.tools_used = [];
  }

  run.tools_used.push({
    tool: input.tool_name,
    input: input.tool_input,
    result: typeof input.tool_output === 'string'
      ? input.tool_output.substring(0, 500) // Truncate large results
      : input.tool_output,
    timestamp: now()
  });

  await ctx.writeJson(undefined, ...pathSegments, run);

  return { success: true };
}

export default async function recordToolUse(
  input: RecordToolUseInput,
  ctx: ToolContext
): Promise<RecordToolUseOutput> {
  try {
    const result = await recordToolUseImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
