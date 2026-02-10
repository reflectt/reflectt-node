# get_component_props Tool

Discover available props, types, and defaults for any component before using `render_manifest`.

## Purpose

Allows AI to inspect component schemas and understand:
- What props are available
- Which props are required vs. optional
- Default values
- Type information (string, number, enum, etc.)
- Example configurations

## When to Use

- **Before render_manifest**: Validate props before rendering
- **Component Discovery**: Learn about component capabilities
- **Debugging**: Understand why render_manifest failed
- **Documentation**: Get example configurations

## Usage

```typescript
// Basic usage - get all props with examples
{
  "componentId": "query_results_table",
  "includeExamples": true
}

// Without examples for faster response
{
  "componentId": "portals:chart",
  "includeExamples": false
}
```

## Response Structure

### Success Response

```typescript
{
  success: true,
  componentId: "query_results_table",
  componentName: "Query Results Table",
  componentDescription: "Display tabular data...",
  category: "data",
  tags: ["table", "data", "grid"],

  // Prop information
  props: {
    columns: {
      type: "array",
      required: true,
      description: "Column definitions"
    },
    title: {
      type: "string",
      required: false,
      default: "Query Results"
    },
    pageSize: {
      type: "number",
      required: false,
      default: 20
    }
  },

  // Categorized props
  requiredProps: ["columns", "rows"],
  optionalProps: ["title", "description", "pageSize"],

  // Example configurations
  examples: [
    {
      description: "Basic table with query results",
      useCase: "Display SQL query results or API data",
      props: {
        columns: [...],
        rows: [...],
        title: "User Query Results"
      }
    }
  ],

  // Metadata
  capabilities: {
    interactive: true,
    exportable: true,
    searchable: true
  },
  whenToUse: "Use when you need to display tabular data...",
  alternatives: ["data_grid", "record_manager"]
}
```

### Error Response

```typescript
{
  success: false,
  error: "Component 'table' not found",
  suggestion: "Did you mean one of these? query_results_table, data-grid",
  similarComponents: ["query_results_table", "data-grid"],
  availableComponents: ["query_results_table", "portals:chart", ...]
}
```

## Example Workflow

```typescript
// 1. Discover what props a component needs
const propsInfo = await get_component_props({
  componentId: "portals:chart"
})

// 2. Use the information to build valid props
const chartProps = {
  title: "Monthly Revenue",        // optional string
  variant: "bar",                   // enum: 'bar' | 'line' | 'area'
  dataset: [...],                   // required array
  height: 300                       // optional number (default: 260)
}

// 3. Render with validated props
await render_manifest({
  render_manifest: {
    interactiveModules: [{
      id: "chart-1",
      componentId: "portals:chart",
      slot: "primary",
      props: chartProps
    }]
  }
})
```

## Supported Component Types

The tool extracts type information for:

- **Primitives**: string, number, boolean
- **Collections**: array, object, record
- **Special**: enum (with values), function
- **Nested**: Identifies complex object structures

## Error Handling

### Component Not Found
Returns similar components based on fuzzy matching:
- Checks component ID
- Searches tags
- Scans names and descriptions

### Schema Loading Failures
Gracefully handles missing schemas:
- Still returns component metadata
- Returns empty props object
- Provides helpful error messages

## Integration

### Reads From
- `/lib/components/component-index.ts` - Component metadata
- `/lib/components/component-examples.ts` - Example configurations
- Component schema files - Zod validation schemas

### Works With
- `render_manifest` - Use get_component_props first to validate props
- `inspect_component_state` - See currently rendered components

## Testing

Run tests with:
```bash
npm test -- tools/ui/get_component_props/implementation.test.ts
```

Test coverage:
- ✓ Component lookup and validation
- ✓ Props extraction from Zod schemas
- ✓ Required/optional prop detection
- ✓ Type extraction (including enums)
- ✓ Default value extraction
- ✓ Example configurations
- ✓ Error handling and suggestions
- ✓ Fuzzy component search

## Performance

- Fast component lookup (hash table)
- Lazy schema loading (only when needed)
- Optional example inclusion (disable for speed)
- Caches are handled by module system
