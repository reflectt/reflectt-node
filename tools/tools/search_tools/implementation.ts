import {
  type ToolContext,
  formatError,
  type ToolOutput,
} from '@/lib/tools/helpers';
import { loadAllTools } from '@/lib/tools/helpers/tool-loader';

interface SearchToolsInput {
  query: string;
  category?: string;
  capabilities?: string[];
  limit?: number;
  includeExamples?: boolean;
  minScore?: number;
}

interface ToolSearchResult {
  toolName: string;
  category: string;
  description: string;
  relevanceScore: number;
  inputSchema: any;
  usageExample?: any;
  tags?: string[];
  matchedFields?: string[];
}

interface SearchToolsOutput extends ToolOutput<SearchToolsData> {
  success: boolean;
  results?: ToolSearchResult[];
  totalFound?: number;
  searchTime?: number;
}

interface SearchToolsData {
  results?: ToolSearchResult[];
  totalFound?: number;
  searchTime?: number;
}

/**
 * Search tools with fuzzy matching and relevance scoring
 *
 * Scoring algorithm:
 * - Exact name match: 100 points
 * - Name contains query: 50 points
 * - Description contains query: 30 points
 * - Category match: 20 points
 * - Parameter name match: 10 points
 * - Tag match: 15 points
 * - Example contains query: 5 points
 *
 * Bonus multipliers:
 * - Multiple word matches: 1.2x
 * - Query at start of field: 1.1x
 */
async function searchToolsImpl(
  input: SearchToolsInput,
  ctx: ToolContext
): Promise<SearchToolsOutput> {
  const startTime = Date.now();
  const {
    query,
    category,
    capabilities,
    limit = 10,
    includeExamples = true,
    minScore = 20
  } = input;

  // Normalize query for matching
  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

  // Load all tools
  const toolsDir = ctx.projectRoot + '/tools';
  const { definitions } = await loadAllTools(toolsDir);

  const results: ToolSearchResult[] = [];

  // Search through all tools
  for (const [toolName, def] of definitions.entries()) {
    // Filter by category if specified
    if (category && def.category !== category) {
      continue;
    }

    // Filter by capabilities if specified
    if (capabilities && capabilities.length > 0) {
      const toolTags = def.tags || [];
      const hasCapability = capabilities.some(cap => toolTags.includes(cap));
      if (!hasCapability) {
        continue;
      }
    }

    // Calculate relevance score
    let score = 0;
    const matchedFields: string[] = [];

    const toolNameLower = (def.name || toolName).toLowerCase();
    const descriptionLower = (def.description || '').toLowerCase();
    const tags = (def.tags || []).map(t => t.toLowerCase());

    // 1. Exact name match: 100 points
    if (toolNameLower === normalizedQuery) {
      score += 100;
      matchedFields.push('name (exact)');
    }
    // 2. Name contains query: 50 points (with bonuses)
    else if (toolNameLower.includes(normalizedQuery)) {
      let nameScore = 50;
      if (toolNameLower.startsWith(normalizedQuery)) nameScore *= 1.1; // Bonus for start match
      score += nameScore;
      matchedFields.push('name');
    }
    // 3. Check individual query words in name
    else {
      let wordMatchCount = 0;
      for (const word of queryWords) {
        if (toolNameLower.includes(word)) {
          wordMatchCount++;
        }
      }
      if (wordMatchCount > 0) {
        let wordScore = 30 * (wordMatchCount / queryWords.length);
        if (wordMatchCount === queryWords.length) wordScore *= 1.2; // Bonus for all words
        score += wordScore;
        matchedFields.push('name (partial)');
      }
    }

    // 4. Description contains query: 30 points
    if (descriptionLower.includes(normalizedQuery)) {
      let descScore = 30;
      if (descriptionLower.startsWith(normalizedQuery)) descScore *= 1.1;
      score += descScore;
      matchedFields.push('description');
    } else {
      // Check individual words in description
      let wordMatchCount = 0;
      for (const word of queryWords) {
        if (descriptionLower.includes(word)) {
          wordMatchCount++;
        }
      }
      if (wordMatchCount > 0) {
        let wordScore = 20 * (wordMatchCount / queryWords.length);
        if (wordMatchCount === queryWords.length) wordScore *= 1.2;
        score += wordScore;
        matchedFields.push('description (partial)');
      }
    }

    // 5. Category match: 20 points
    if (def.category && def.category.toLowerCase() === normalizedQuery) {
      score += 20;
      matchedFields.push('category');
    }

    // 6. Tag matches: 15 points per tag
    let tagMatchCount = 0;
    for (const tag of tags) {
      if (tag === normalizedQuery || queryWords.some(w => tag.includes(w))) {
        tagMatchCount++;
      }
    }
    if (tagMatchCount > 0) {
      score += 15 * tagMatchCount;
      matchedFields.push(`tags (${tagMatchCount})`);
    }

    // 7. Parameter name match: 10 points per parameter
    if (def.parameters?.properties) {
      let paramMatchCount = 0;
      for (const [paramName, paramDef] of Object.entries(def.parameters.properties)) {
        const paramNameLower = paramName.toLowerCase();
        const paramDescLower = ((paramDef as any).description || '').toLowerCase();

        if (queryWords.some(w => paramNameLower.includes(w) || paramDescLower.includes(w))) {
          paramMatchCount++;
        }
      }
      if (paramMatchCount > 0) {
        score += 10 * paramMatchCount;
        matchedFields.push(`parameters (${paramMatchCount})`);
      }
    }

    // 8. Example contains query: 5 points per example
    if (def.examples && Array.isArray(def.examples)) {
      let exampleMatchCount = 0;
      for (const example of def.examples) {
        const exampleStr = JSON.stringify(example).toLowerCase();
        if (queryWords.some(w => exampleStr.includes(w))) {
          exampleMatchCount++;
        }
      }
      if (exampleMatchCount > 0) {
        score += 5 * exampleMatchCount;
        matchedFields.push(`examples (${exampleMatchCount})`);
      }
    }

    // Only include if score meets minimum threshold
    if (score >= minScore) {
      results.push({
        toolName: def.name || toolName,
        category: def.category,
        description: def.description || '',
        relevanceScore: Math.round(score),
        inputSchema: def.parameters,
        usageExample: includeExamples && def.examples?.[0] ? def.examples[0] : undefined,
        tags: def.tags,
        matchedFields
      });
    }
  }

  // Sort by relevance score (descending)
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Limit results
  const limitedResults = results.slice(0, limit);

  const searchTime = Date.now() - startTime;

  return {
    success: true,
    results: limitedResults,
    totalFound: results.length,
    searchTime
  };
}

export default async function searchTools(
  input: SearchToolsInput,
  ctx: ToolContext
): Promise<SearchToolsOutput> {
  try {
    return { success: true, ...(await searchToolsImpl(input, ctx)) };
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    };
  }
}
