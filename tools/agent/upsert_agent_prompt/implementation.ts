import {
  type ToolContext,
  formatError,
  type ToolOutput,
  validateRequired,
  validateAll,
} from '@/lib/tools/helpers';

interface UpsertAgentPromptInput {
  agent_id: string;
  category: string;
  prompt: string;
  scope?: 'global' | 'space';
  target_space?: string;
}

interface UpsertAgentPromptOutput {
  success: boolean;
  message?: string;
  error?: string;
  metadata?: {
    agent_id: string;
    category: string;
    scope: string;
    is_new: boolean;
    prompt_length: number;
  };
}

async function upsertAgentPromptImpl(
  input: UpsertAgentPromptInput,
  ctx: ToolContext
): Promise<UpsertAgentPromptOutput> {
  const { agent_id, category, prompt, scope = 'global', target_space } = input;

  // Validate input
  const validation = validateAll([
    () => validateRequired(agent_id, 'agent_id'),
    () => validateRequired(category, 'category'),
    () => validateRequired(prompt, 'prompt'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  if (prompt.trim().length === 0) {
    throw new Error('prompt cannot be empty');
  }

  // Determine which space to write to
  const space = scope === 'global' ? 'global' : target_space;

  // Check if agent exists
  let agentExists = false;
  try {
    await ctx.readJson(space, 'agents', category, agent_id, 'definition.json');
    agentExists = true;
  } catch {
    throw new Error(`Agent directory not found. Create the agent first using the appropriate tool.`);
  }

  // Check if prompt file already exists
  let isNew = true;
  try {
    await ctx.readText(space, 'agents', category, agent_id, 'prompt.md');
    isNew = false;
  } catch {
    // Prompt file doesn't exist yet
  }

  // Write prompt file
  await ctx.writeText(space, 'agents', category, agent_id, 'prompt.md', prompt);

  return {
    success: true,
    message: isNew
      ? `Prompt created successfully for ${agent_id}`
      : `Prompt updated successfully for ${agent_id}`,
    metadata: {
      agent_id,
      category,
      scope,
      is_new: isNew,
      prompt_length: prompt.length,
    },
  };
}

export default async function upsertAgentPrompt(
  input: UpsertAgentPromptInput,
  ctx: ToolContext
): Promise<UpsertAgentPromptOutput> {
  try {
    return await upsertAgentPromptImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}