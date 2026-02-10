import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface DeleteTaskInput {
  task_id: string;
  agent?: string;
  target_space?: string;
  scope?: 'space' | 'global';
}

interface DeleteTaskOutput {
  success: boolean;
  deleted_from?: 'global' | 'space';
  task_path?: string;
  agent?: string;
  message?: string;
  error?: string;
}

async function deleteTaskImpl(
  input: DeleteTaskInput,
  ctx: ToolContext
): Promise<DeleteTaskOutput> {
  const {
    task_id,
    agent,
    target_space,
    scope = 'space'
  } = input;

  const validation = validateAll([
    () => validateRequired(task_id, 'task_id'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Determine which space to use
  const space = scope === 'global' ? 'global' : target_space;

  // Helper function to find and delete task directory
  async function findAndDeleteTask(): Promise<{ path: string; agent: string }> {
    const categoryDirs = await ctx.listDirs(space, 'agents');

    for (const categoryDir of categoryDirs) {
      const agentDirs = await ctx.listDirs(space, 'agents', categoryDir);

      for (const agentDir of agentDirs) {
        // If agent is specified, skip non-matching agents
        if (agent && agentDir !== agent) continue;

        // Check if task exists
        try {
          await ctx.readJson(space, 'agents', categoryDir, agentDir, 'tasks', task_id, 'definition.json');

          // Delete entire task directory
          await ctx.deleteDir(space, 'agents', categoryDir, agentDir, 'tasks', task_id);

          return {
            path: `agents/${categoryDir}/${agentDir}/tasks/${task_id}`,
            agent: agentDir
          };
        } catch {
          // Task doesn't exist in this location, continue searching
        }
      }
    }

    const agentInfo = agent ? ` for agent ${agent}` : '';
    throw new Error(`Task not found: ${task_id}${agentInfo} in ${scope}`);
  }

  // Delete the task
  const { path: taskPath, agent: taskAgent } = await findAndDeleteTask();

  return {
    success: true,
    deleted_from: scope,
    task_path: taskPath,
    agent: taskAgent,
    message: `Successfully deleted task ${task_id} for agent ${taskAgent} from ${scope}`
  };
}

export default async function deleteTask(
  input: DeleteTaskInput,
  ctx: ToolContext
): Promise<DeleteTaskOutput> {
  try {
    return await deleteTaskImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
