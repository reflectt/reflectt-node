import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface Task {
  id: string;
  agent: string;
  title: string;
  description: string;
  status?: 'active' | 'draft' | 'completed' | 'pending';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, any>;
  source?: 'global' | 'space';
  path?: string;
  created_at?: string;
  updated_at?: string;
}

interface GetTaskInput {
  task_id: string;
  agent?: string;
  target_space?: string;
  search_global?: boolean;
  search_space?: boolean;
}

interface GetTaskOutput {
  success: boolean;
  task?: Task;
  found_in?: 'global' | 'space';
  error?: string;
}

async function getTaskImpl(
  input: GetTaskInput,
  ctx: ToolContext
): Promise<GetTaskOutput> {
  const {
    task_id,
    agent,
    target_space,
    search_global = true,
    search_space = true
  } = input;

  const validation = validateAll([
    () => validateRequired(task_id, 'task_id'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Helper function to try reading a task file
  async function tryReadTask(space: string | undefined, source: 'global' | 'space'): Promise<Task | null> {
    try {
      const categoryDirs = await ctx.listDirs(space, 'agents');

      for (const categoryDir of categoryDirs) {
        const agentDirs = await ctx.listDirs(space, 'agents', categoryDir);

        for (const agentDir of agentDirs) {
          // If agent is specified, skip non-matching agents
          if (agent && agentDir !== agent) continue;

          try {
            const task = await ctx.readJson<Task>(
              space,
              'agents',
              categoryDir,
              agentDir,
              'tasks',
              task_id,
              'definition.json'
            );

            if (task) {
              task.source = source;
              task.path = `agents/${categoryDir}/${agentDir}/tasks/${task_id}/definition.json`;
              return task;
            }
          } catch {
            // Task doesn't exist in this location, continue searching
          }
        }
      }
    } catch (error) {
      // Only log unexpected errors (not ENOENT during search)
      if ((error as any).code !== 'ENOENT') {
        console.error(`Error searching for task:`, error);
      }
    }

    return null;
  }

  // Search in space first (if enabled)
  if (search_space) {
    const task = await tryReadTask(target_space, 'space');
    if (task) {
      return {
        success: true,
        task,
        found_in: 'space'
      };
    }
  }

  // Search in global (if enabled)
  if (search_global) {
    const task = await tryReadTask('global', 'global');
    if (task) {
      return {
        success: true,
        task,
        found_in: 'global'
      };
    }
  }

  // Not found
  const agentInfo = agent ? ` for agent ${agent}` : '';
  throw new Error(`Task not found: ${task_id}${agentInfo}`);
}

export default async function getTask(
  input: GetTaskInput,
  ctx: ToolContext
): Promise<GetTaskOutput> {
  try {
    return { success: true, ...(await getTaskImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
