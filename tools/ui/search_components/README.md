# Unified Component Search System

Universal component discovery tool that searches across all 7 discovery systems and returns ranked results.

## Overview

The `search_components` tool provides a single entry point for discovering components based on natural language queries. It searches across:

1. **Metadata** - Component names, descriptions, tags, categories
2. **Examples** - Pre-built example configurations
3. **Recipes** - Multi-component patterns and workflows
4. **Use Cases** - Real-world scenarios and applications
5. **Capabilities** - Interactive features and functionality
6. **Synergies** - Components that work well together
7. **Comparisons** - Alternative components for similar tasks

## Usage

### Basic Search
```typescript
// Natural language query
{
  "query": "table with sorting"
}
```

### Filtered Search
```typescript
{
  "query": "data visualization",
  "filters": {
    "category": "visualization",
    "capabilities": ["interactive", "exportable"],
    "complexity": "simple",
    "dataShape": "tabular"
  },
  "limit": 5
}
```

### Advanced Search
```typescript
{
  "query": "kanban board for tasks",
  "filters": {
    "category": "workflow",
    "capabilities": ["interactive", "collaborative"]
  },
  "limit": 10
}
```

## Scoring System

Results are ranked by score based on match quality:

| Match Type | Base Score |
|------------|-----------|
| Name match | 50 points |
| Description match | 30 points |
| Category match | 25 points |
| Tag match | 20 points |
| Capability match | 18 points |
| Use case match | 15 points |
| Example match | 15 points |
| Recipe match | 10 points |
| Synergy bonus | +5 points |

Components with multiple matches accumulate scores.

## Response Format

```typescript
{
  "success": true,
  "query": "table with sorting",
  "results": [
    {
      "componentId": "query_results_table",
      "score": 95,
      "matchReason": "name match, capability: sortable, example match",
      "metadata": {
        "name": "Query Results Table",
        "description": "Display query results with sorting, filtering, and pagination",
        "category": "data",
        "capabilities": {
          "sortable": true,
          "filterable": true,
          "interactive": true
        }
      },
      "exampleProps": {
        "interactiveModules": [...]
      },
      "useCases": ["Display SQL query results", "Show API data"],
      "relatedComponents": ["portals:chart", "portals:stat-grid"],
      "complexity": "simple",
      "comparison": {
        "alternatives": ["data_grid", "record_manager"],
        "bestFor": "Display-only data from queries"
      }
    }
  ],
  "totalFound": 3,
  "searchSummary": {
    "metadataMatches": 1,
    "exampleMatches": 1,
    "recipeMatches": 0,
    "useCaseMatches": 2,
    "capabilityMatches": 1
  }
}
```

## Discovery Systems Integration

### 1. Metadata System
- Source: `/lib/components/component-index.ts`
- Searches: names, descriptions, tags, categories, use cases
- Provides: Core component information

### 2. Examples System
- Source: `/lib/components/component-examples.ts`
- Searches: example descriptions and use cases
- Provides: Ready-to-use component configurations

### 3. Recipes System
- Source: `/lib/components/component-recipes.ts`
- Searches: recipe names, descriptions, tags
- Provides: Multi-component workflow patterns

### 4. Use Cases System
- Source: `/lib/components/use-case-examples.ts`
- Searches: titles, descriptions, industries
- Provides: Real-world application examples

### 5. Capabilities System
- Source: `/lib/components/component-capabilities.ts`
- Searches: capability names, descriptions, use cases
- Provides: Feature-based component discovery

### 6. Synergies System
- Source: `/lib/components/component-suggestions.ts`
- Provides: Related components that work well together
- Adds: Bonus scoring for components with synergies

### 7. Comparisons System
- Source: `/lib/components/component-comparison.ts`
- Provides: Alternative components and decision guidance
- Adds: Complexity levels and "best for" recommendations

## Filters

### Category Filter
```typescript
"category": "data" | "visualization" | "forms" | "workflow" | ...
```

### Capabilities Filter
```typescript
"capabilities": ["sortable", "filterable", "interactive", "exportable", ...]
```
Only returns components that have ALL specified capabilities.

### Complexity Filter
```typescript
"complexity": "simple" | "moderate" | "complex"
```
- **simple**: Easy to use, minimal configuration
- **moderate**: Some configuration needed
- **complex**: Advanced features, requires expertise

### Data Shape Filter
```typescript
"dataShape": "tabular" | "hierarchical" | "graph" | "time-series"
```
Matches components optimized for specific data structures.

## Example Queries

### "Show me a table"
Returns: `query_results_table`, `data_grid`, `record_manager`

### "Kanban board"
Returns: `flow-board`, `portals:kanban-board`, `workflow_status_board`

### "Data visualization with charts"
Returns: `portals:chart`, `chart`, `data-viz-3d`

### "Form builder"
Returns: `form-builder`, `dynamic-form`

### "Dashboard with metrics"
Returns: `portals:stat-grid`, `cost_dashboard`, `portals:card-grid`

## Best Practices

1. **Start broad**: Use general queries first, then filter
2. **Use natural language**: "table with sorting" works better than "sortable-table"
3. **Leverage filters**: Narrow results with specific requirements
4. **Check related components**: Use `relatedComponents` for complementary tools
5. **Review examples**: Use `exampleProps` for quick rendering

## Integration with Learning System

Search results can be enhanced by the learning system (`/lib/learning/ui-interaction-tracker.ts`):

- Popular components get visibility boost
- Frequently used components are suggested first
- Error-prone components can be flagged
- User satisfaction affects rankings

Use `get_ui_insights` tool to see which components users prefer.
