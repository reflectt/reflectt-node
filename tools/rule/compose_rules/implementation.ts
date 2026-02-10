import { type ToolContext } from '@/lib/tools/helpers';

interface ComposeRulesInput {
  rule_ids: string[];
  logic: 'AND' | 'OR' | 'NOT' | 'SEQUENCE';
  name: string;
  description?: string;
  save_as?: string;
  short_circuit?: boolean;
}

interface ComposeRulesOutput {
  success: boolean;
  composite_rule?: Record<string, any>;
  rule_id?: string;
  error?: string;
}

/**
 * Combine multiple rules with logic operators
 */
export default async function composeRules(
  input: ComposeRulesInput,
  ctx: ToolContext
): Promise<ComposeRulesOutput> {
  try {
    const {
      rule_ids,
      logic,
      name,
      description,
      save_as,
      short_circuit = true
    } = input;

    if (rule_ids.length < 2) {
      return {
        success: false,
        error: 'Must provide at least 2 rules to compose'
      };
    }

    // Validate all rules exist
    const rules = [];
    for (const ruleId of rule_ids) {
      if (!ctx.fileExists('global', 'rules', ruleId, 'definition.json')) {
        return {
          success: false,
          error: `Rule '${ruleId}' not found`
        };
      }

      const rule = await ctx.readJson('global', 'rules', ruleId, 'definition.json');
      rules.push(rule);
    }

    // Create composite rule definition
    const compositeRule = {
      id: save_as || `composite-${Date.now()}`,
      name,
      description: description || `Composite rule combining: ${rule_ids.join(', ')}`,
      version: '1.0.0',
      type: 'composite',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: 'system',
      
      // Merge input schemas
      input_schema: mergeSchemas(rules.map(r => r.input_schema)),
      
      // Output is composite result
      output_schema: {
        type: 'object',
        properties: {
          result: {
            type: 'boolean',
            description: 'Overall result of composite rule'
          },
          results: {
            type: 'array',
            description: 'Individual rule results',
            items: { type: 'object' }
          },
          rules_applied: {
            type: 'array',
            description: 'Rules that were executed',
            items: { type: 'string' }
          }
        }
      },
      
      conditions: [],
      actions: [],
      
      dependencies: rule_ids,
      
      tags: ['composite', ...new Set(rules.flatMap(r => r.tags || []))],
      
      metadata: {
        composition_logic: logic,
        short_circuit,
        composed_rules: rule_ids,
        complexity: 'complex'
      }
    };

    // Save if requested
    if (save_as) {
      await ctx.ensureDir('global', 'rules', save_as);

      await ctx.writeJson('global', 'rules', save_as, 'definition.json', compositeRule);

      // Create metadata
      const metadata = {
        version_history: [
          {
            version: '1.0.0',
            created_at: new Date().toISOString(),
            changes: 'Initial composite rule creation'
          }
        ],
        usage_stats: {
          total_executions: 0,
          success_count: 0,
          failure_count: 0,
          avg_execution_time_ms: 0
        }
      };

      await ctx.writeJson('global', 'rules', save_as, 'metadata.json', metadata);

      // Generate prompt
      const prompt = generateCompositePrompt(compositeRule, rules);
      await ctx.writeText('global', 'rules', save_as, 'prompt.md', prompt);
    }

    return {
      success: true,
      composite_rule: compositeRule,
      rule_id: save_as
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Merge multiple input schemas
 */
function mergeSchemas(schemas: any[]): any {
  const merged = {
    type: 'object',
    properties: {},
    required: []
  };

  for (const schema of schemas) {
    if (schema.properties) {
      merged.properties = { ...merged.properties, ...schema.properties };
    }
    if (schema.required) {
      merged.required.push(...schema.required);
    }
  }

  // Remove duplicates from required
  merged.required = [...new Set(merged.required)];

  return merged;
}

/**
 * Generate prompt for composite rule
 */
function generateCompositePrompt(composite: any, rules: any[]): string {
  return `# ${composite.name}

## Purpose
${composite.description}

## Type
Composite Rule (${composite.metadata.composition_logic})

## Composed Rules
${rules.map(r => `- **${r.name}** (${r.id}): ${r.description}`).join('\n')}

## Composition Logic
**${composite.metadata.composition_logic}**: ${getLogicDescription(composite.metadata.composition_logic)}

## How It Works
This composite rule executes the following rules in ${composite.metadata.composition_logic} mode:

${rules.map((r, i) => `${i + 1}. ${r.name} - ${r.description}`).join('\n')}

${composite.metadata.short_circuit ? '\n**Short-circuit enabled**: Execution stops on first failure (AND) or success (OR).' : ''}

## Input Requirements
${formatCompositeSchema(composite.input_schema)}

## Output
- **result** (boolean): Overall pass/fail result
- **results** (array): Individual results from each rule
- **rules_applied** (array): List of rules that were executed

## Version History
- v${composite.version} (${new Date().toISOString().split('T')[0]}): Initial composite rule
`;
}

/**
 * Get description of logic operator
 */
function getLogicDescription(logic: string): string {
  switch (logic) {
    case 'AND':
      return 'All rules must pass for the composite to pass';
    case 'OR':
      return 'At least one rule must pass for the composite to pass';
    case 'NOT':
      return 'Negates the result of the composed rules';
    case 'SEQUENCE':
      return 'Executes rules in order, passing output of one to the next';
    default:
      return 'Unknown logic';
  }
}

/**
 * Format schema for display
 */
function formatCompositeSchema(schema: any): string {
  if (!schema.properties) {
    return 'No specific requirements';
  }
  
  return Object.entries(schema.properties)
    .map(([key, value]: [string, any]) => {
      const required = schema.required?.includes(key) ? ' (required)' : ' (optional)';
      return `- **${key}** (${value.type})${required}: ${value.description || 'No description'}`;
    })
    .join('\n');
}