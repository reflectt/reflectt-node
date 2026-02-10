import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface UpsertTaskPromptInput {
  task_id: string;
  agent: string;
  prompt: string;
  category?: string;
  target_space?: string;
  scope?: 'space' | 'global';
}

interface UpsertTaskPromptOutput {
  success: boolean;
  message?: string;
  is_new?: boolean;
  task_path?: string;
  error?: string;
}

async function upsertTaskPromptImpl(
  input: UpsertTaskPromptInput,
  ctx: ToolContext
): Promise<UpsertTaskPromptOutput> {
  const {
    task_id,
    agent,
    prompt,
    category,
    target_space,
    scope = 'space'
  } = input;

  const validation = validateAll([
    () => validateRequired(task_id, 'task_id'),
    () => validateRequired(agent, 'agent'),
    () => validateRequired(prompt, 'prompt'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Determine which space to use
  const space = scope === 'global' ? 'global' : target_space;

  // Helper function to find task directory
  async function findTaskDir(): Promise<{ categoryDir: string; agentDir: string }> {
    // If category is provided, search only in that category
    const categoriesToSearch = category
      ? [category]
      : await ctx.listDirs(space, 'agents');

    for (const categoryDir of categoriesToSearch) {
      const agentDirs = await ctx.listDirs(space, 'agents', categoryDir);

      for (const agentDir of agentDirs) {
        // Check if this is the right agent and task exists
        if (agentDir === agent) {
          const taskExists = ctx.fileExists(
            space,
            'agents',
            categoryDir,
            agentDir,
            'tasks',
            task_id,
            'definition.json'
          );

          if (taskExists) {
            return { categoryDir, agentDir };
          }
        }
      }
    }

    const categoryInfo = category ? ` in category ${category}` : '';
    throw new Error(
      `Task not found: ${task_id} for agent ${agent}${categoryInfo} in ${scope}`
    );
  }

  // Find the task directory
  const { categoryDir, agentDir } = await findTaskDir();

  // Check if prompt.md already exists
  const promptExists = ctx.fileExists(
    space,
    'agents',
    categoryDir,
    agentDir,
    'tasks',
    task_id,
    'prompt.md'
  );

  // Write the prompt
  await ctx.writeText(
    space,
    'agents',
    categoryDir,
    agentDir,
    'tasks',
    task_id,
    'prompt.md',
    prompt
  );

  const taskPath = `agents/${categoryDir}/${agentDir}/tasks/${task_id}/prompt.md`;

  return {
    success: true,
    message: promptExists
      ? 'Prompt updated successfully'
      : 'Prompt created successfully',
    is_new: !promptExists,
    task_path: taskPath
  };
}

export default async function upsertTaskPrompt(
  input: UpsertTaskPromptInput,
  ctx: ToolContext
): Promise<UpsertTaskPromptOutput> {
  try {
    return await upsertTaskPromptImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
