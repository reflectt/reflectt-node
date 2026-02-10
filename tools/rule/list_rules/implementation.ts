import { type ToolContext } from '@/lib/tools/helpers/tool-context';

interface ListRulesInput {
  type?: 'validation' | 'automation' | 'transformation' | 'conditional' | 'composite';
  tags?: string[];
  status?: 'active' | 'draft' | 'deprecated';
  domain?: string;
  include_deprecated?: boolean;
}

interface ListRulesOutput {
  success: boolean;
  rules?: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    version: string;
    tags: string[];
    domain?: string;
  }>;
  total?: number;
  error?: string;
}

/**
 * List all available rules with optional filtering
 */
export default async function listRules(
  input: ListRulesInput,
  ctx: ToolContext
): Promise<ListRulesOutput> {
  try {
    const {
      type,
      tags,
      status = 'active',
      domain,
      include_deprecated = false
    } = input;

    // List all rule IDs via ToolContext - adapter handles routing
    const ruleIds = await ctx.listDirs('global', 'rules');

    const rules = [];

    for (const ruleId of ruleIds) {
      try {
        // Read rule definition via ToolContext
        const definition = await ctx.readJson<any>('global', 'rules', ruleId, 'definition.json');

        // Apply filters
        if (type && definition.type !== type) continue;
        if (status && definition.status !== status) continue;
        if (!include_deprecated && definition.status === 'deprecated') continue;
        if (domain && definition.metadata?.domain !== domain) continue;
        if (tags && tags.length > 0) {
          const hasAllTags = tags.every(tag => definition.tags?.includes(tag));
          if (!hasAllTags) continue;
        }

        rules.push({
          id: definition.id,
          name: definition.name,
          description: definition.description,
          type: definition.type,
          status: definition.status,
          version: definition.version,
          tags: definition.tags || [],
          domain: definition.metadata?.domain
        });
      } catch (error) {
        // Skip rules that can't be read
        continue;
      }
    }

    // Sort by name
    rules.sort((a, b) => a.name.localeCompare(b.name));

    return {
      success: true,
      rules,
      total: rules.length
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}