import {
  type ToolContext,
} from '@/lib/tools/helpers';

interface DeleteRuleInput {
  rule_id: string;
  hard_delete?: boolean;
  reason?: string;
}

interface DeleteRuleOutput {
  success: boolean;
  archived_path?: string;
  error?: string;
}

/**
 * Remove a rule (soft delete by default)
 */
export default async function deleteRule(input: DeleteRuleInput, ctx: ToolContext): Promise<DeleteRuleOutput> {
  try {
    const { rule_id, hard_delete = false, reason } = input;

    const target = 'global';

    if (!ctx.fileExists(target, 'rules', rule_id, 'definition.json')) {
      return {
        success: false,
        error: `Rule '${rule_id}' not found`
      };
    }

    if (hard_delete) {
      // Permanently delete
      await ctx.deleteDir(target, 'rules', rule_id);

      return {
        success: true
      };
    } else {
      // Soft delete - mark as deprecated
      const definition = await ctx.readJson(target, 'rules', rule_id, 'definition.json');
      definition.status = 'deprecated';
      definition.deprecated_at = new Date().toISOString();
      definition.deprecation_reason = reason || 'No reason provided';

      await ctx.writeJson(target, 'rules', rule_id, 'definition.json', definition);

      return {
        success: true,
        archived_path: `rules/${rule_id}/definition.json (marked as deprecated)`
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}