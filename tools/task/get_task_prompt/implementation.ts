import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface GetTaskPromptInput {
  task_id: string;
  agent: string;
  category?: string;
  scope?: 'global' | 'space';
  space_id?: string;
}

interface GetTaskPromptOutput {
  success: boolean;
  prompt?: string;
  metadata?: {
    prompt_exists: boolean;
    task_path?: string;
  };
  error?: string;
}

async function getTaskPromptImpl(
  input: GetTaskPromptInput,
  ctx: ToolContext
): Promise<GetTaskPromptOutput> {
  const { task_id, agent, category, scope = 'global', space_id } = input;

  const validation = validateAll([
    () => validateRequired(task_id, 'task_id'),
    () => validateRequired(agent, 'agent'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Validate scope requires space_id
  if (scope === 'space' && !space_id) {
    throw new Error('space_id is required when scope is "space"');
  }

  // Determine which space to search
  const space = scope === 'global' ? 'global' : space_id;

  // If category is provided, go directly to it
  if (category) {
    try {
      const promptContent = await ctx.readText(space, 'agents', category, agent, 'tasks', task_id, 'prompt.md');
      const taskPath = ctx.resolvePath(space, 'agents', category, agent, 'tasks', task_id, 'prompt.md');
      return {
        success: true,
        prompt: promptContent,
        metadata: {
          prompt_exists: true,
          task_path: taskPath
        }
      };
    } catch {
      // Category hint was wrong, continue to search all categories
    }
  }

  // Search all categories
  const categories = await ctx.listDirs(space, 'agents');
  for (const cat of categories) {
    try {
      const promptContent = await ctx.readText(space, 'agents', cat, agent, 'tasks', task_id, 'prompt.md');
      const taskPath = ctx.resolvePath(space, 'agents', cat, agent, 'tasks', task_id, 'prompt.md');
      return {
        success: true,
        prompt: promptContent,
        metadata: {
          prompt_exists: true,
          task_path: taskPath
        }
      };
    } catch {
      // Not found in this category, continue
    }
  }

  throw new Error(`Prompt file not found for task ${task_id} (agent: ${agent})`);
}

export default async function getTaskPrompt(
  input: GetTaskPromptInput,
  ctx: ToolContext
): Promise<GetTaskPromptOutput> {
  try {
    return await getTaskPromptImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
