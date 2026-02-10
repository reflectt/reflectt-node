import { now, formatError, type ToolContext } from '@/lib/tools/helpers';

interface UpsertAgentInput {
  id: string;
  slug: string;
  name: string;
  domain: string;
  role?: string;
  description?: string;
  capabilities?: string[];
  provider: string;
  model: string;
  maxOutputTokens?: number;
  temperature?: number;
  prompt_file: string;
  scope?: 'space' | 'global';  // Default: 'space'
  target_space?: string;  // Optional: write to specific space
}

interface UpsertAgentOutput {
  success: boolean;
  path?: string;
  message?: string;
  error?: string;
}

async function upsertAgentImpl(
  input: UpsertAgentInput,
  ctx: ToolContext
): Promise<UpsertAgentOutput> {
  const {
    id,
    slug,
    name,
    domain,
    role,
    description,
    capabilities,
    provider,
    model,
    maxOutputTokens = 4096,
    temperature = 0.3,
    prompt_file,
    scope = 'space',
    target_space
  } = input;

  // Determine target: target_space > scope > undefined (current space)
  const target = target_space || (scope === 'global' ? 'global' : undefined);

  // Build agent object with all required fields
  const agentData = {
    id,
    slug,
    name,
    domain,
    role: role || name,
    description: description || role || name,
    capabilities: capabilities || [],
    provider,
    model,
    maxOutputTokens,
    temperature,
    tools: null,
    metadata: {
      domain,
      capability: (capabilities && capabilities[0]) || 'general'
    },
    version: 1,
    exported_at: now()
  };

  // Check if agent already exists (update vs create)
  const agentExists = await ctx.fileExists(target, 'agents', domain, id, 'definition.json');
  const operation = agentExists ? 'updated' : 'created';

  // Write to agents/{domain}/{id}/definition.json
  await ctx.ensureDir(target, 'agents', domain, id);
  await ctx.writeJson(target, 'agents', domain, id, 'definition.json', agentData);

  // Create README.md with agent description
  const readmeContent = `# ${name}

${description || role || 'No description available.'}

## Details

- **Domain:** ${domain}
- **Provider:** ${provider}
- **Model:** ${model}
- **Temperature:** ${temperature}
- **Max Output Tokens:** ${maxOutputTokens}

${capabilities && capabilities.length > 0 ? `## Capabilities

${capabilities.map(c => `- ${c}`).join('\n')}` : ''}

## Version

${agentData.version} (Created: ${agentData.exported_at})
`;

  await ctx.writeText(target, 'agents', domain, id, 'README.md', readmeContent);

  // Trigger agent management event (non-blocking)
  try {
    await ctx.executeTool('trigger_event', {
      event_type: agentExists ? 'system.agent_updated' : 'system.agent_created',
      space_id: target,
      data: {
        agent_id: id,
        agent_slug: slug,
        agent_name: name,
        domain,
        operation,
        scope: target === 'global' ? 'global' : 'space',
        model,
        provider,
        capabilities,
        timestamp: now()
      },
      metadata: {
        source_tool: 'upsert_agent',
        operation: `agent_${operation}`
      }
    });
  } catch (eventError) {
    console.warn(`Failed to trigger event: ${eventError}`);
  }

  return {
    success: true,
    path: `agents/${domain}/${id}/`,
    message: `Agent ${slug} created/updated successfully`
  };
}

/**
 * Create or update an agent with validated schema
 *
 * Supports writing to either:
 * - space scope (default): Write to current space's agents directory
 * - global scope: Write to global shared agents directory
 * - target_space: Write to a specific named space (overrides scope)
 */
export default async function upsertAgent(
  input: UpsertAgentInput,
  ctx: ToolContext
): Promise<UpsertAgentOutput> {
  try {
    return await upsertAgentImpl(input, ctx);
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
