import {
  type ToolContext,
} from '@/lib/tools/helpers';

interface UpdateRuleInput {
  rule_id: string;
  updates: Record<string, any>;
  version_bump?: 'major' | 'minor' | 'patch';
  change_notes?: string;
}

interface UpdateRuleOutput {
  success: boolean;
  old_version?: string;
  new_version?: string;
  changes?: string[];
  error?: string;
}

/**
 * Modify an existing rule (creates new version)
 */
export default async function updateRule(input: UpdateRuleInput, ctx: ToolContext): Promise<UpdateRuleOutput> {
  try {
    const { rule_id, updates, version_bump = 'patch', change_notes } = input;

    const target = 'global';

    if (!ctx.fileExists(target, 'rules', rule_id, 'definition.json')) {
      return {
        success: false,
        error: `Rule '${rule_id}' not found`
      };
    }

    // Read current definition
    const definition = await ctx.readJson(target, 'rules', rule_id, 'definition.json');
    const oldVersion = definition.version;

    // Calculate new version
    const newVersion = bumpVersion(oldVersion, version_bump);

    // Track changes
    const changes: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (JSON.stringify(definition[key]) !== JSON.stringify(value)) {
        changes.push(key);
      }
    }

    // Apply updates
    const updatedDefinition = {
      ...definition,
      ...updates,
      version: newVersion,
      updated_at: new Date().toISOString()
    };

    // Update metadata
    let metadata;
    if (ctx.fileExists(target, 'rules', rule_id, 'metadata.json')) {
      metadata = await ctx.readJson(target, 'rules', rule_id, 'metadata.json');
    } else {
      metadata = {
        version_history: [],
        usage_stats: {
          total_executions: 0,
          success_count: 0,
          failure_count: 0,
          avg_execution_time_ms: 0
        }
      };
    }

    metadata.version_history.push({
      version: newVersion,
      created_at: new Date().toISOString(),
      changes: change_notes || `Updated: ${changes.join(', ')}`,
      fields_changed: changes
    });

    // Write updated files
    await ctx.writeJson(target, 'rules', rule_id, 'definition.json', updatedDefinition);
    await ctx.writeJson(target, 'rules', rule_id, 'metadata.json', metadata);

    return {
      success: true,
      old_version: oldVersion,
      new_version: newVersion,
      changes
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Bump semantic version
 */
function bumpVersion(version: string, bump: 'major' | 'minor' | 'patch'): string {
  const parts = version.split('.').map(Number);
  
  switch (bump) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      return version;
  }
}