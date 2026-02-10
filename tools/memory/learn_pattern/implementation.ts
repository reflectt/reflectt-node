import {
  type ToolContext,
} from '@/lib/tools/helpers';

interface Pattern {
  trigger: string;
  action: string;
  confidence: number;
  context?: Record<string, any>;
  examples?: string[];
}

interface LearnPatternInput {
  user_id: string;
  pattern: Pattern;
}

export default async function learn_pattern(input: LearnPatternInput, ctx: ToolContext) {
  const { user_id, pattern } = input;

  // Determine target (space-specific or global)
  const target = ctx.space_id || 'global';

  // Ensure directory exists
  await ctx.ensureDir(target, 'memory', 'users', user_id);

  // Load existing patterns
  let patterns: any[] = [];
  if (ctx.fileExists(target, 'memory', 'users', user_id, 'learned_patterns.json')) {
    const data = await ctx.readJson(target, 'memory', 'users', user_id, 'learned_patterns.json');
    patterns = data.patterns || [];
  }

  // Create pattern entry
  const patternEntry = {
    ...pattern,
    id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    learned_at: new Date().toISOString(),
    times_triggered: 0,
    last_triggered: null
  };

  // Check if similar pattern exists
  const existingIndex = patterns.findIndex((p: any) =>
    p.trigger.toLowerCase() === pattern.trigger.toLowerCase()
  );

  if (existingIndex >= 0) {
    // Update existing pattern with higher confidence
    patterns[existingIndex] = {
      ...patterns[existingIndex],
      ...patternEntry,
      confidence: Math.max(patterns[existingIndex].confidence, pattern.confidence),
      updated_at: new Date().toISOString()
    };
  } else {
    // Add new pattern
    patterns.push(patternEntry);
  }

  // Save patterns
  const patternsData = {
    user_id,
    patterns,
    updated_at: new Date().toISOString()
  };

  await ctx.writeJson(target, 'memory', 'users', user_id, 'learned_patterns.json', patternsData);

  const patternsPath = ctx.resolvePath(target, 'memory', 'users', user_id, 'learned_patterns.json');

  return {
    success: true,
    user_id,
    pattern_id: patternEntry.id,
    total_patterns: patterns.length,
    path: patternsPath
  };
}