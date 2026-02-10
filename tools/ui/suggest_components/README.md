# Suggest Components Tool

Intelligently suggests complementary components that work well with currently rendered components.

## Purpose

Helps agents discover and recommend additional components that enhance the user experience when used together. Uses the component complementary map and synergy patterns to provide context-aware suggestions.

## When to Use

- After rendering a component to discover related components
- To build complete UI workflows
- To find components that complement existing views
- To enhance user experience with additional functionality

## Parameters

### `currentComponentId` (required)
Component ID to get suggestions for (e.g., 'query_results_table', 'portals:chart')

### `context` (optional)
Optional context about the use case:
- `dataType`: Type of data being displayed (e.g., 'query_results', 'metrics', 'relationships')
- `userIntent`: User's intent (e.g., 'data_analysis', 'visualization', 'exploration')

### `maxSuggestions` (optional)
Maximum number of suggestions to return (default: 5)

## Returns

### Success Response
```typescript
{
  success: true,
  currentComponent: string,
  currentComponentName: string,
  suggestions: Array<{
    componentId: string,
    componentName: string,
    reason: string,
    priority: number,
    suggestedSlot: 'primary' | 'secondary' | 'sidebar' | 'top',
    defaultProps: Record<string, any>,
    recommendedLayout: string,
    usage: string,
    synergyPatterns?: string[]
  }>,
  totalFound: number,
  synergyPatterns?: Array<{
    id: string,
    name: string,
    description: string,
    components: string[]
  }>
}
```

### Failure Response
```typescript
{
  success: false,
  error: string,
  suggestion?: string,
  availableComponents?: string[]
}
```

## Example Usage

### Example 1: Basic Suggestion
```typescript
{
  "currentComponentId": "query_results_table"
}
```

Returns suggestions for components that work well with tables (charts, filters, etc.)

### Example 2: With Context
```typescript
{
  "currentComponentId": "query_results_table",
  "context": {
    "dataType": "query_results",
    "userIntent": "data_analysis"
  },
  "maxSuggestions": 3
}
```

Returns top 3 suggestions optimized for data analysis workflows

### Example 3: Chart Visualization
```typescript
{
  "currentComponentId": "portals:chart",
  "maxSuggestions": 5
}
```

Returns suggestions for components that complement charts (tables, metrics, etc.)

## Integration Points

### Component Complementary Map
Located in `/lib/components/component-suggestions.ts`, this map defines relationships between components and their complementary components.

### Layout Analyzer
Uses `/lib/ui-control/layout-analyzer.ts` to recommend optimal layout configurations for suggested components.

### Component Index
Validates component IDs against `/lib/components/component-index.ts` to ensure suggestions are valid.

## Synergy Patterns

The tool also returns synergy patterns that describe how multiple components work together:
- **Master-Detail**: List view with detail pane
- **Dashboard Grid**: Multiple components in unified dashboard
- **Filter Cascade**: Filters affecting downstream components
- **Shared Context Bus**: Components sharing state via context bus

## Implementation Notes

1. Suggestions are ranked by priority (1-10, higher = more important)
2. Each suggestion includes a usage example for render_manifest
3. Layout recommendations consider component types and count
4. Synergy patterns provide implementation guidance for multi-component workflows

## Related Tools

- `render_manifest`: Use to render suggested components
- `get_component_props`: Get detailed props for suggested components
- `set_ui_layout`: Apply recommended layout configurations
- `inspect_component_state`: View currently rendered components
