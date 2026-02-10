import { type ToolContext } from '@/lib/tools/helpers';

interface ValidateRuleInput {
  rule_id: string;
  strict?: boolean;
  check_dependencies?: boolean;
}

interface ValidateRuleOutput {
  success: boolean;
  valid?: boolean;
  errors?: string[];
  warnings?: string[];
  error?: string;
}

/**
 * Check if a rule definition is valid
 */
export default async function validateRule(
  input: ValidateRuleInput,
  ctx: ToolContext
): Promise<ValidateRuleOutput> {
  try {
    const { rule_id, strict = false, check_dependencies = true } = input;

    if (!ctx.fileExists('global', 'rules', rule_id, 'definition.json')) {
      return {
        success: false,
        error: `Rule '${rule_id}' not found`
      };
    }

    const definition = await ctx.readJson('global', 'rules', rule_id, 'definition.json');
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!definition.id) errors.push('Missing required field: id');
    if (!definition.name) errors.push('Missing required field: name');
    if (!definition.description) errors.push('Missing required field: description');
    if (!definition.type) errors.push('Missing required field: type');
    if (!definition.version) errors.push('Missing required field: version');

    // Valid type
    const validTypes = ['validation', 'automation', 'transformation', 'conditional', 'composite'];
    if (definition.type && !validTypes.includes(definition.type)) {
      errors.push(`Invalid type: ${definition.type}. Must be one of: ${validTypes.join(', ')}`);
    }

    // Schema validation
    if (!definition.input_schema) {
      errors.push('Missing input_schema');
    } else if (!definition.input_schema.properties) {
      warnings.push('input_schema should have properties defined');
    }

    if (!definition.output_schema) {
      errors.push('Missing output_schema');
    } else if (!definition.output_schema.properties) {
      warnings.push('output_schema should have properties defined');
    }

    // Conditions validation
    if (definition.conditions && Array.isArray(definition.conditions)) {
      for (let i = 0; i < definition.conditions.length; i++) {
        const condition = definition.conditions[i];
        if (!condition.field) {
          errors.push(`Condition ${i}: missing 'field'`);
        }
        if (!condition.operator) {
          errors.push(`Condition ${i}: missing 'operator'`);
        }
        
        const validOperators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'matches', 'in', 'exists'];
        if (condition.operator && !validOperators.includes(condition.operator)) {
          errors.push(`Condition ${i}: invalid operator '${condition.operator}'`);
        }
      }
    }

    // Actions validation
    if (definition.actions && Array.isArray(definition.actions)) {
      for (let i = 0; i < definition.actions.length; i++) {
        const action = definition.actions[i];
        if (!action.type) {
          errors.push(`Action ${i}: missing 'type'`);
        }
      }
    }

    // Check dependencies exist
    if (check_dependencies && definition.dependencies && Array.isArray(definition.dependencies)) {
      for (const depId of definition.dependencies) {
        if (!ctx.fileExists('global', 'rules', depId, 'definition.json')) {
          errors.push(`Dependency '${depId}' not found`);
        }
      }
    }

    // Strict mode checks
    if (strict) {
      if (!definition.tags || definition.tags.length === 0) {
        warnings.push('No tags defined (recommended for discoverability)');
      }
      if (!definition.metadata || !definition.metadata.domain) {
        warnings.push('No domain specified in metadata (recommended)');
      }
      if (!definition.metadata || !definition.metadata.complexity) {
        warnings.push('No complexity specified in metadata (recommended)');
      }

      // Check if prompt exists
      if (!ctx.fileExists('global', 'rules', rule_id, 'prompt.md')) {
        warnings.push('No prompt.md file found (recommended for documentation)');
      }
    }

    return {
      success: true,
      valid: errors.length === 0,
      errors,
      warnings
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}