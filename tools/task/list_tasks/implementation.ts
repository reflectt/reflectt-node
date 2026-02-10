import {
  type ToolContext,
  formatError,
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
  prompt_file?: string;
  created_at?: string;
  updated_at?: string;
}

interface ListTasksInput {
  agent?: string;
  status?: 'active' | 'draft' | 'completed' | 'pending';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  target_space?: string;
}

interface ListTasksOutput {
  success: boolean;
  tasks?: Task[];
  total?: number;
  global_count?: number;
  space_count?: number;
  agents_with_tasks?: string[];
  error?: string;
}

async function listTasksImpl(
  input: ListTasksInput,
  ctx: ToolContext
): Promise<ListTasksOutput> {
  const { agent, status, priority, target_space } = input;

  const tasks: Task[] = [];
  const agentsWithTasks = new Set<string>();
  let globalCount = 0;
  let spaceCount = 0;

  // Helper function to read tasks from a directory
  async function readTasksFromPath(space: string | undefined, source: 'global' | 'space'): Promise<void> {
    try {
      const categoryDirs = await ctx.listDirs(space, 'agents');

      for (const categoryDir of categoryDirs) {
        const agentDirs = await ctx.listDirs(space, 'agents', categoryDir);

        for (const agentDir of agentDirs) {
          // Filter by agent if specified
          if (agent && agentDir !== agent) continue;

          try {
            const taskDirs = await ctx.listDirs(space, 'agents', categoryDir, agentDir, 'tasks');

            for (const taskDir of taskDirs) {
              try {
                const task = await ctx.readJson<Task>(
                  space,
                  'agents',
                  categoryDir,
                  agentDir,
                  'tasks',
                  taskDir,
                  'definition.json'
                );

                if (!task) continue;

                // Filter by status if specified
                if (status && task.status !== status) continue;

                // Filter by priority if specified
                if (priority && task.priority !== priority) continue;

                // Add source and path information
                task.source = source;
                task.path = `agents/${categoryDir}/${agentDir}/tasks/${taskDir}/definition.json`;

                // Check if prompt file exists
                try {
                  await ctx.readText(space, 'agents', categoryDir, agentDir, 'tasks', taskDir, 'prompt.md');
                  task.prompt_file = `agents/${categoryDir}/${agentDir}/tasks/${taskDir}/prompt.md`;
                } catch {
                  // Prompt file doesn't exist, which is fine
                }

                tasks.push(task);
                agentsWithTasks.add(task.agent);

                if (source === 'global') {
                  globalCount++;
                } else {
                  spaceCount++;
                }
              } catch (error) {
                // Suppress 'File not found' errors for missing tasks in space
                if (typeof error?.message === 'string' && error.message.startsWith('File not found:')) {
                  // Do nothing, task doesn't exist in this space
                } else {
                  console.error(`Error reading task ${taskDir}:`, error);
                }
              }
            }
          } catch {
            // No tasks directory for this agent, continue
          }
        }
      }
    } catch (error) {
      // Suppress 'File not found' errors for missing task directories
      if (typeof error?.message === 'string' && error.message.startsWith('File not found:')) {
        // Do nothing
      } else {
        console.error(`Error reading tasks:`, error);
      }
    }
  }

  // Read from global data
  await readTasksFromPath('global', 'global');

  // Read from space-specific data
  await readTasksFromPath(target_space, 'space');

  // Sort tasks by priority (critical > high > medium > low), then by agent, then by title
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    const aPriority = priorityOrder[a.priority || 'medium'];
    const bPriority = priorityOrder[b.priority || 'medium'];

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    if (a.agent !== b.agent) {
      return a.agent.localeCompare(b.agent);
    }

    return a.title.localeCompare(b.title);
  });

  return {
    success: true,
    tasks,
    total: tasks.length,
    global_count: globalCount,
    space_count: spaceCount,
    agents_with_tasks: Array.from(agentsWithTasks).sort()
  };
}

export default async function listTasks(
  input: ListTasksInput,
  ctx: ToolContext
): Promise<ListTasksOutput> {
  try {
    const result = await listTasksImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
