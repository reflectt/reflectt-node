import { randomUUID } from 'crypto';
import {
  type ToolContext,
  validateIdentifier,
} from '@/lib/tools/helpers';

interface CreateRuleInput {
  rule_id: string;
  name: string;
  description: string;
  type: 'validation' | 'automation' | 'transformation' | 'conditional' | 'composite';
  input_schema: Record<string, any>;
  output_schema: Record<string, any>;
  conditions?: Array<Record<string, any>>;
  actions?: Array<Record<string, any>>;
  prompt_content?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  dependencies?: string[];
}

interface CreateRuleOutput {
  success: boolean;
  rule_id?: string;
  paths?: {
    definition: string;
    prompt: string;
    metadata: string;
  };
  error?: string;
}

/**
 * Create a new business rule with definition and prompt
 */
export default async function createRule(input: CreateRuleInput, ctx: ToolContext): Promise<CreateRuleOutput> {
  try {
    const {
      rule_id,
      name,
      description,
      type,
      input_schema,
      output_schema,
      conditions = [],
      actions = [],
      prompt_content,
      tags = [],
      metadata = {},
      dependencies = [],
    } = input;

    // Validate rule_id
    validateIdentifier(rule_id, 'rule_id');

    // Rules are always stored in global
    const target = 'global';

    // Check if rule already exists
    if (ctx.fileExists(target, 'rules', rule_id, 'definition.json')) {
      return {
        success: false,
        error: `Rule '${rule_id}' already exists. Use update_rule to modify it.`
      };
    }

    // Ensure directory exists
    await ctx.ensureDir(target, 'rules', rule_id);

    // Create definition
    const now = new Date().toISOString();
    const definition = {
      id: rule_id,
      name,
      description,
      version: '1.0.0',
      type,
      status: 'active',
      created_at: now,
      updated_at: now,
      author: 'system',
      input_schema,
      output_schema,
      conditions,
      actions,
      dependencies,
      tags,
      metadata: {
        ...metadata,
        execution_count: 0,
        last_executed: null,
      }
    };

    // Create metadata file
    const metadataObj = {
      version_history: [
        {
          version: '1.0.0',
          created_at: now,
          changes: 'Initial version'
        }
      ],
      usage_stats: {
        total_executions: 0,
        success_count: 0,
        failure_count: 0,
        avg_execution_time_ms: 0,
      }
    };

    // Generate default prompt if not provided
    const prompt = prompt_content || generateDefaultPrompt(definition);

    // Write files
    await ctx.writeJson(target, 'rules', rule_id, 'definition.json', definition);
    await ctx.writeJson(target, 'rules', rule_id, 'metadata.json', metadataObj);
    await ctx.writeText(target, 'rules', rule_id, 'prompt.md', prompt);

    return {
      success: true,
      rule_id,
      paths: {
        definition: `rules/${rule_id}/definition.json`,
        prompt: `rules/${rule_id}/prompt.md`,
        metadata: `rules/${rule_id}/metadata.json`,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Generate a default prompt template for a rule
 */
function generateDefaultPrompt(definition: any): string {
  return `# ${definition.name}

## Purpose
${definition.description}

## Type
${definition.type}

## When to Use
- Use this rule when you need to ${definition.type} data
- Apply during ${definition.type} operations

## How It Works
This rule evaluates the input against defined conditions and executes the specified actions.

## Input Requirements
${formatSchema(definition.input_schema)}

## Output
${formatSchema(definition.output_schema)}

## Examples

### Example 1: Valid Input
**Input:**
\`\`\`json
{
  "example": "value"
}
\`\`\`

**Output:**
\`\`\`json
{
  "result": true,
  "errors": []
}
\`\`\`

## Edge Cases
- Document edge cases here
- Add more as discovered

## Dependencies
${definition.dependencies.length > 0 ? definition.dependencies.map((d: string) => `- ${d}`).join('\n') : 'None'}

## Version History
- v${definition.version} (${new Date().toISOString().split('T')[0]}): Initial version
`;
}

/**
 * Format JSON schema for markdown display
 */
function formatSchema(schema: Record<string, any>): string {
  if (!schema.properties) {
    return 'No schema defined';
  }
  
  return Object.entries(schema.properties)
    .map(([key, value]: [string, any]) => {
      const required = schema.required?.includes(key) ? ' (required)' : ' (optional)';
      return `- **${key}** (${value.type})${required}: ${value.description || 'No description'}`;
    })
    .join('\n');
}