import {
  type ToolContext,
} from '@/lib/tools/helpers';

interface ReadRuleInput {
  rule_id: string;
  include_metadata?: boolean;
}

interface ReadRuleOutput {
  success: boolean;
  rule?: {
    definition: Record<string, any>;
    prompt: string;
    metadata?: Record<string, any>;
  };
  error?: string;
}

/**
 * Load a rule definition and prompt
 */
export default async function readRule(input: ReadRuleInput, ctx: ToolContext): Promise<ReadRuleOutput> {
  try {
    const { rule_id, include_metadata = true } = input;

    // Rules are stored in global
    const target = 'global';

    // Check if rule exists
    if (!ctx.fileExists(target, 'rules', rule_id, 'definition.json')) {
      return {
        success: false,
        error: `Rule '${rule_id}' not found`
      };
    }

    // Read definition
    const definition = await ctx.readJson(target, 'rules', rule_id, 'definition.json');

    // Read prompt
    const prompt = await ctx.readText(target, 'rules', rule_id, 'prompt.md');

    // Read metadata if requested
    let metadata;
    if (include_metadata) {
      if (ctx.fileExists(target, 'rules', rule_id, 'metadata.json')) {
        metadata = await ctx.readJson(target, 'rules', rule_id, 'metadata.json');
      }
    }

    return {
      success: true,
      rule: {
        definition,
        prompt,
        metadata
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}