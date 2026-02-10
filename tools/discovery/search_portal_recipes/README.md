# Search Portal Recipes Tool

## Overview

The `search_portal_recipes` tool enables AI agents to discover and use pre-built portal recipes - sophisticated multi-component patterns designed for common use cases.

## Purpose

Portal recipes are curated combinations of components that create cohesive, engaging user experiences. Instead of the agent selecting individual components one by one, it can use recipes to instantly create complete portals optimized for specific scenarios.

## Available Recipes

1. **Super Fun Times** - Games, entertainment, celebration effects, music
2. **Creative Playground** - Drawing tools, design utilities, media capture
3. **Game Center** - Multiple game types, challenges, timers, audio
4. **Entertainment Hub** - Movies, music, videos, trending content
5. **Interactive Experience** - 3D effects, particles, celebrations, wow moments
6. **Kids Play Zone** - Safe, educational, age-appropriate content
7. **Wellness Sanctuary** - Meditation, mindfulness, health tracking
8. **Fitness Command Center** - Workout logging, exercise library, progress tracking

## Usage

```typescript
// Search for recipes matching a query
const result = await context.executeTool('search_portal_recipes', {
  query: 'fun portal with games',
  limit: 3
})
```

## Parameters

- **query** (required): Natural language search query
- **limit** (optional): Maximum recipes to return (default: 5, max: 20)

## Output

Returns recipes with:
- Recipe ID and name
- Detailed description
- Tags for categorization
- Relevance score (0-100)
- Complete component list with slots, priorities, reasoning
- Use cases and example queries

## Example Queries

- "super fun times"
- "I want to have fun"
- "creative portal with games"
- "entertainment hub"
- "wellness and meditation"
- "fitness tracker"
- "something for kids"

## Integration

The tool integrates with `@/lib/portals/portal-recipes` which contains the recipe definitions and semantic search logic. Recipes are matched based on:

1. Exact name matches (highest weight)
2. Example query matches (very high weight)
3. Description matches (high weight)
4. Use case matches (medium-high weight)
5. Tag matches (medium weight)
6. Individual word matches (low weight)

## Testing

Run the test suite:

```bash
npx tsx scripts/testing/test-search-portal-recipes.ts
```

## Version

1.0.0
