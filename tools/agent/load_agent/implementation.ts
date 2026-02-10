import { type ToolContext } from '@/lib/tools/helpers';

interface LoadAgentInput {
  agent_name: string;
  search_space?: boolean;  // Default: true - search in space first
  search_global?: boolean; // Default: true - search in global as fallback
  target_space?: string;
}

interface LoadAgentOutput {
  agent?: {
    id: string;
    slug: string;
    provider: string;
    model: string;
    maxOutputTokens: number;
    temperature: number;
    tools?: any;
    metadata?: any;
    version: number;
    system_prompt?: string;
  };
  found_in?: 'space' | 'global';
  error?: string;
}

/**
 * Load prompt file (markdown or raw)
 */
async function loadPromptFile(ctx: ToolContext, space: string, ...pathParts: string[]): Promise<string | null> {
  try {
    const content = await ctx.readText(space, ...pathParts);

    // Try to extract from markdown format first
    const match = content.match(/## System Prompt\s*```\s*([\s\S]*?)\s*```/);
    if (match) {
      return match[1].trim();
    }

    // Otherwise return raw content
    return content;
  } catch {
    return null;
  }
}

/**
 * Search for an agent in a specific space
 */
async function searchAgentInSpace(
  ctx: ToolContext,
  space: string,
  agentName: string
): Promise<any | null> {
  try {
    // Read categories (first level directories)
    const categories = await ctx.listDirs(space, 'agents');

    for (const category of categories) {
      // Read agent directories (second level directories)
      const agentDirs = await ctx.listDirs(space, 'agents', category);

      for (const agentDir of agentDirs) {
        try {
          const agent = await ctx.readJson(space, 'agents', category, agentDir, 'definition.json');
          if (!agent) continue;

          // Match by directory name, id, slug, or slug suffix
          if (
            agentDir === agentName ||
            agent.id === agentName ||
            agent.slug === agentName ||
            agent.slug?.endsWith(`:${agentName}`)
          ) {
            // Load system prompt from prompt.md if it exists
            const systemPrompt = await loadPromptFile(ctx, space, 'agents', category, agentDir, 'prompt.md');
            if (systemPrompt) {
              agent.system_prompt = systemPrompt;
            }
            return agent;
          }
        } catch {
          // Skip if definition doesn't exist
          continue;
        }
      }
    }
  } catch (error) {
    // Only log unexpected errors (not ENOENT during search)
    if ((error as any).code !== 'ENOENT') {
      console.error(`Error searching agents in ${space}:`, error);
    }
  }

  return null;
}

async function loadAgentImpl(
  input: LoadAgentInput,
  ctx: ToolContext
): Promise<LoadAgentOutput> {
  const searchSpace = input.search_space !== false;
  const searchGlobal = input.search_global !== false;
  const targetSpace = input.target_space || ctx.currentSpace || 'workrocket';

  // 1. Try space-specific agents first (allows overrides)
  if (searchSpace) {
    const spaceAgent = await searchAgentInSpace(ctx, targetSpace, input.agent_name);
    if (spaceAgent) {
      return { agent: spaceAgent, found_in: 'space' };
    }
  }

  // 2. Fall back to global agents (shared across spaces)
  if (searchGlobal) {
    const globalAgent = await searchAgentInSpace(ctx, 'global', input.agent_name);
    if (globalAgent) {
      return { agent: globalAgent, found_in: 'global' };
    }
  }

  return { error: `Agent "${input.agent_name}" not found` };
}

/**
 * Load an agent definition with hierarchical search
 *
 * Search order:
 * 1. Space-specific agents (if search_space=true) - allows overrides
 * 2. Global agents (if search_global=true) - shared definitions
 */
export default async function loadAgent(
  input: LoadAgentInput,
  ctx: ToolContext
): Promise<LoadAgentOutput> {
  return loadAgentImpl(input, ctx);
}
