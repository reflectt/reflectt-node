import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface GetAgentPromptInput {
  agent_id: string;
  category: string;
  scope?: 'global' | 'space';
  target_space?: string;
}

interface GetAgentPromptOutput {
  success: boolean;
  prompt?: string;
  error?: string;
  metadata?: {
    agent_id: string;
    category: string;
    scope: string;
    prompt_exists: boolean;
  };
}

async function getAgentPromptImpl(
  input: GetAgentPromptInput,
  ctx: ToolContext
): Promise<GetAgentPromptOutput> {
  const { agent_id, category, scope = 'global', target_space } = input;

  // Validate input
  const validation = validateAll([
    () => validateRequired(agent_id, 'agent_id'),
    () => validateRequired(category, 'category'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Determine which space to read from
  const space = scope === 'global' ? 'global' : target_space;

  // Try to read prompt file
  let promptContent: string;
  try {
    promptContent = await ctx.readText(space, 'agents', category, agent_id, 'prompt.md');
  } catch {
    return {
      success: false,
      error: `Prompt file not found`,
      metadata: {
        agent_id,
        category,
        scope,
        prompt_exists: false,
      },
    };
  }

  return {
    success: true,
    prompt: promptContent,
    metadata: {
      agent_id,
      category,
      scope,
      prompt_exists: true,
    },
  };
}

export default async function getAgentPrompt(
  input: GetAgentPromptInput,
  ctx: ToolContext
): Promise<GetAgentPromptOutput> {
  try {
    return await getAgentPromptImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}