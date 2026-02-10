import {
  type ToolContext,
} from '@/lib/tools/helpers';

interface GetLearnedPatternsInput {
  user_id: string;
  trigger_match?: string;
  min_confidence?: number;
}

export default async function get_learned_patterns(input: GetLearnedPatternsInput, ctx: ToolContext) {
  const { user_id, trigger_match, min_confidence = 0.5 } = input;

  // Determine target (space-specific or global)
  const target = ctx.space_id || 'global';

  // Check if patterns exist
  if (!ctx.fileExists(target, 'memory', 'users', user_id, 'learned_patterns.json')) {
    return {
      success: true,
      user_id,
      patterns: [],
      total: 0,
      message: 'No learned patterns found'
    };
  }

  // Load patterns
  const data = await ctx.readJson(target, 'memory', 'users', user_id, 'learned_patterns.json');
  let patterns = data.patterns || [];

  // Apply confidence filter
  patterns = patterns.filter((p: any) => p.confidence >= min_confidence);

  // Apply trigger match filter
  if (trigger_match) {
    const matchLower = trigger_match.toLowerCase();
    patterns = patterns.filter((p: any) =>
      p.trigger.toLowerCase().includes(matchLower)
    );
  }

  // Sort by confidence (highest first)
  patterns.sort((a: any, b: any) => b.confidence - a.confidence);

  return {
    success: true,
    user_id,
    patterns,
    total: patterns.length,
    filters_applied: {
      trigger_match,
      min_confidence
    }
  };
}