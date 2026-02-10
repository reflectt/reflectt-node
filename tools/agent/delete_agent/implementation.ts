import {
  type ToolContext,
  parseSlugOrId,
  validateRequired,
  formatError,
} from '@/lib/tools/helpers';

interface DeleteAgentInput {
  agent_id?: string;
  slug?: string;
  target_space?: string;
  scope?: 'space' | 'global';
  delete_tasks?: boolean;
}

interface DeleteAgentOutput {
  success: boolean;
  deleted_from?: 'global' | 'space';
  agent_path?: string;
  tasks_deleted?: number;
  message?: string;
  error?: string;
}

async function deleteAgentImpl(
  input: DeleteAgentInput,
  ctx: ToolContext
): Promise<DeleteAgentOutput> {
  const {
    agent_id,
    slug,
    target_space,
    scope = 'space',
    delete_tasks = false
  } = input;

  // Validate: either agent_id or slug must be provided
  validateRequired(agent_id || slug, 'Either slug or id must be provided');

  // Parse slug if provided
  const parsed = parseSlugOrId({ slug, id: agent_id });

  // Determine space target
  const target: 'global' | string | undefined =
    target_space ? target_space :
    scope === 'global' ? 'global' :
    undefined;

  // Helper function to find and delete agent directory
  async function findAndDeleteAgent(): Promise<{ path: string; domain: string }> {
    // If we have domain from slug, use it directly
    if (parsed.domain && parsed.id) {
      if (!ctx.fileExists(target, 'agents', parsed.domain, parsed.id)) {
        throw new Error(`Agent not found: ${parsed.domain}:${parsed.id}`);
      }

      // Delete directory
      await ctx.deleteDir(target, 'agents', parsed.domain, parsed.id);
      const agentPath = ctx.resolvePath(target, 'agents', parsed.domain, parsed.id);

      return { path: agentPath, domain: parsed.domain };
    }

    // If we only have ID, search all domains
    if (parsed.id) {
      // Check if agents directory exists
      if (!ctx.fileExists(target, 'agents')) {
        const agentsPath = ctx.resolvePath(target, 'agents');
        throw new Error(`Agents directory not found: ${agentsPath}`);
      }

      const categories = await ctx.listDirs(target, 'agents');

      for (const category of categories) {
        if (ctx.fileExists(target, 'agents', category, parsed.id)) {
          // Delete directory
          await ctx.deleteDir(target, 'agents', category, parsed.id);
          const agentPath = ctx.resolvePath(target, 'agents', category, parsed.id);

          return { path: agentPath, domain: category };
        }
      }

      throw new Error(`Agent not found: ${parsed.id} in ${scope}`);
    }

    throw new Error('Unable to determine agent to delete');
  }

  // Delete the agent
  const { path: agentPath, domain: agentDomain } = await findAndDeleteAgent();

  // Optionally delete associated tasks
  let tasksDeleted = 0;
  if (delete_tasks && parsed.id) {
    try {
      if (ctx.fileExists(target, 'tasks', parsed.id)) {
        const taskFiles = await ctx.listFiles(target, 'tasks', parsed.id, '.json');
        tasksDeleted = taskFiles.length;

        // Delete only JSON task files, not the entire directory
        for (const taskFile of taskFiles) {
          await ctx.deleteFile(target, 'tasks', parsed.id, taskFile);
        }
      }
    } catch (error) {
      // Tasks directory doesn't exist or error deleting
      console.error(`Error deleting tasks for agent ${parsed.id}:`, error);
    }
  }

  const result: DeleteAgentOutput = {
    success: true,
    deleted_from: scope,
    agent_path: agentPath,
    message: `Successfully deleted agent ${parsed.id} from ${scope}`
  };

  if (delete_tasks) {
    result.tasks_deleted = tasksDeleted;
    result.message += ` and ${tasksDeleted} associated task(s)`;
  }

  return result;
}

export default async function deleteAgent(
  input: DeleteAgentInput,
  ctx: ToolContext
): Promise<DeleteAgentOutput> {
  try {
    return await deleteAgentImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
