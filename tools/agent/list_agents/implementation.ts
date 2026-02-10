import {
  type ToolContext,
  formatError,
} from '@/lib/tools/helpers';

interface Agent {
  id: string;
  slug: string;
  name: string;
  domain: string;
  role?: string;
  description?: string;
  capabilities?: string[];
  provider: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  source?: 'global' | 'space';
  prompt_file?: string;
}

interface ListAgentsInput {
  domain?: string;
  capabilities?: string[];
  target_space?: string;
}

interface ListAgentsOutput {
  agents: Agent[];
  total: number;
  global_count: number;
  space_count: number;
  error?: string;
}

async function listAgentsImpl(
  input: ListAgentsInput,
  ctx: ToolContext
): Promise<ListAgentsOutput> {
  const { domain, capabilities, target_space } = input;

  const agents: Agent[] = [];
  let globalCount = 0;
  let spaceCount = 0;

  // Helper function to read agents from a directory
  async function readAgentsFromPath(space: string | undefined, source: 'global' | 'space'): Promise<void> {
    try {
      const categories = await ctx.listDirs(space, 'agents');

      for (const category of categories) {
        // Filter by domain if specified (domain === category)
        if (domain && category !== domain) continue;

        const agentDirs = await ctx.listDirs(space, 'agents', category);

        for (const agentDir of agentDirs) {
          try {
            const agent = await ctx.readJson<Agent>(space, 'agents', category, agentDir, 'definition.json');
            if (!agent) continue;

            // Filter by capabilities if specified
            if (capabilities && capabilities.length > 0) {
              const agentCapabilities = agent.capabilities || [];
              const hasAllCapabilities = capabilities.every(cap =>
                agentCapabilities.includes(cap)
              );
              if (!hasAllCapabilities) continue;
            }

            // Add source information
            agent.source = source;

            // Check for prompt file
            try {
              await ctx.readText(space, 'agents', category, agentDir, 'prompt.md');
              agent.prompt_file = `agents/${category}/${agentDir}/prompt.md`;
            } catch {
              // Prompt file doesn't exist, which is fine
            }

            agents.push(agent);

            if (source === 'global') {
              globalCount++;
            } else {
              spaceCount++;
            }
          } catch (error) {
            // Suppress 'File not found' errors for missing agents in space
            if (typeof error?.message === 'string' && error.message.startsWith('File not found:')) {
              // Do nothing, agent doesn't exist in this space
            } else {
              console.error(`Error reading agent ${agentDir}:`, error);
            }
          }
        }
      }
    } catch (error) {
      // Suppress 'File not found' errors for missing agent directories
      if (typeof error?.message === 'string' && error.message.startsWith('File not found:')) {
        // Do nothing
      } else {
        console.error(`Error reading agents:`, error);
      }
    }
  }

  // Read from global data
  await readAgentsFromPath('global', 'global');

  // Read from space-specific data
  await readAgentsFromPath(target_space, 'space');

  // Sort agents by domain, then by name
  agents.sort((a, b) => {
    if (a.domain !== b.domain) {
      return a.domain?.localeCompare(b.domain);
    }
    return a.name?.localeCompare(b.name);
  });

  return {
    agents,
    total: agents.length,
    global_count: globalCount,
    space_count: spaceCount
  };
}

export default async function listAgents(
  input: ListAgentsInput,
  ctx: ToolContext
): Promise<ListAgentsOutput> {
  try {
    return await listAgentsImpl(input, ctx);
  } catch (error) {
    return {
      agents: [],
      total: 0,
      global_count: 0,
      space_count: 0,
      error: formatError(error)
    };
  }
}
