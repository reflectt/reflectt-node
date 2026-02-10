import {
  type ToolContext,
  parseSlugOrId,
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
  path?: string;
  prompt_file?: string;
}

interface GetAgentInput {
  agent_id?: string;
  slug?: string;
  target_space?: string;
  search_global?: boolean;
  search_space?: boolean;
}

interface GetAgentOutput {
  success?: boolean;
  agent?: Agent;
  found_in?: 'global' | 'space';
  error?: string;
}

async function getAgentImpl(
  input: GetAgentInput,
  ctx: ToolContext
): Promise<GetAgentOutput> {
  const {
    agent_id,
    slug,
    target_space,
    search_global = true,
    search_space = true
  } = input;

  // Validate: either agent_id or slug must be provided
  if (!agent_id && !slug) {
    throw new Error('Either agent_id or slug must be provided');
  }

  // Parse slug if provided
  const parsed = parseSlugOrId({ slug, id: agent_id });

  // Helper function to try reading an agent file
  async function tryReadAgent(space: string | undefined, source: 'global' | 'space'): Promise<Agent | null> {
    // If we have domain from slug, use it directly
    if (parsed.domain && parsed.id) {
      try {
        const agent = await ctx.readJson<Agent>(space, 'agents', parsed.domain, parsed.id, 'definition.json');

        if (agent) {
          agent.source = source;
          agent.path = `agents/${parsed.domain}/${parsed.id}/definition.json`;

          // Ensure domain is set from directory structure if not in JSON
          if (!agent.domain) {
            agent.domain = parsed.domain;
          }

          // Check for prompt file
          try {
            await ctx.readText(space, 'agents', parsed.domain, parsed.id, 'prompt.md');
            agent.prompt_file = `agents/${parsed.domain}/${parsed.id}/prompt.md`;
          } catch {
            // Prompt file doesn't exist, which is fine
          }

          return agent;
        }
      } catch {
        return null;
      }
    }

    // If we only have ID, search all domains
    if (parsed.id) {
      try {
        const categories = await ctx.listDirs(space, 'agents');

        for (const category of categories) {
          try {
            const agent = await ctx.readJson<Agent>(space, 'agents', category, parsed.id, 'definition.json');

            if (agent) {
              agent.source = source;
              agent.path = `agents/${category}/${parsed.id}/definition.json`;

              // Ensure domain is set from directory structure if not in JSON
              if (!agent.domain) {
                agent.domain = category;
              }

              // Check for prompt file
              try {
                await ctx.readText(space, 'agents', category, parsed.id, 'prompt.md');
                agent.prompt_file = `agents/${category}/${parsed.id}/prompt.md`;
              } catch {
                // Prompt file doesn't exist, which is fine
              }

              return agent;
            }
          } catch {
            // Agent doesn't exist in this category, continue searching
          }
        }
      } catch (error) {
        // Only log unexpected errors (not ENOENT during search)
        if ((error as any).code !== 'ENOENT') {
          console.error(`Error searching for agent:`, error);
        }
      }
    }

    return null;
  }

  // Search in space first (if enabled)
  if (search_space) {
    const agent = await tryReadAgent(target_space, 'space');
    if (agent) {
      return {
        success: true,
        agent,
        found_in: 'space'
      };
    }
  }

  // Search in global (if enabled)
  if (search_global) {
    const agent = await tryReadAgent('global', 'global');
    if (agent) {
      return {
        success: true,
        agent,
        found_in: 'global'
      };
    }
  }

  // Not found
  const identifier = slug || agent_id;
  throw new Error(`Agent not found: ${identifier}`);
}

export default async function getAgent(
  input: GetAgentInput,
  ctx: ToolContext
): Promise<GetAgentOutput> {
  try {
    return await getAgentImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
