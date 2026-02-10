# Create Data Binding Tool

Automatically bind data between components so changes in one component automatically update another without manual synchronization code.

## Overview

The `create_data_binding` tool provides a declarative way to create reactive data flows between components. It supports:

- **Pre-built templates** for common patterns (table-to-chart, filter-to-multiple, etc.)
- **Custom bindings** with transformation functions
- **Bidirectional bindings** for two-way synchronization
- **Debouncing** for performance optimization
- **Enable/disable** bindings dynamically

## Quick Start

### Table to Chart Binding

```typescript
// When user selects rows in a table, automatically update chart
await create_data_binding({
  template: 'table-to-chart',
  sourceComponentId: 'customer-table',
  targetComponentId: 'revenue-chart',
  options: {
    xField: 'date',
    yField: 'revenue'
  }
})
```

### Filter to Multiple Components

```typescript
// One filter controls multiple components
await create_data_binding({
  template: 'filter-to-multiple',
  sourceComponentId: 'global-filter',
  targetComponentIds: ['table-1', 'chart-1', 'map-1'],
  options: {
    debounce: 300 // Wait 300ms after typing
  }
})
```

### Master-Detail Pattern

```typescript
// Selecting a row loads detail view
await create_data_binding({
  template: 'master-detail',
  sourceComponentId: 'orders-table',
  targetComponentId: 'order-details',
  options: {
    idField: 'orderId',
    loadFullRecord: true
  }
})
```

## Templates

### 1. table-to-chart

Maps selected table rows to chart data.

**Options:**
- `xField`: Field for x-axis (default: 'x')
- `yField`: Field for y-axis (default: 'y')
- `seriesField`: Field for series grouping (optional)

**Example:**
```typescript
{
  template: 'table-to-chart',
  sourceComponentId: 'sales-table',
  targetComponentId: 'sales-chart',
  options: {
    xField: 'month',
    yField: 'total',
    seriesField: 'region'
  }
}
```

### 2. filter-to-multiple

Syncs filter state from one component to many.

**Options:**
- `filterKeys`: Specific filter keys to sync (optional, defaults to all)
- `debounce`: Debounce delay in ms (optional)

**Example:**
```typescript
{
  template: 'filter-to-multiple',
  sourceComponentId: 'search-bar',
  targetComponentIds: ['table-1', 'table-2'],
  options: {
    filterKeys: ['search', 'category'],
    debounce: 500
  }
}
```

### 3. master-detail

Loads details when a master record is selected.

**Options:**
- `idField`: Field to use as identifier (default: 'id')
- `loadFullRecord`: Load full record vs just ID (default: false)

**Example:**
```typescript
{
  template: 'master-detail',
  sourceComponentId: 'customer-list',
  targetComponentId: 'customer-details',
  options: {
    idField: 'customerId',
    loadFullRecord: true
  }
}
```

### 4. search-to-highlight

Search terms highlight matching items in visualization.

**Options:**
- `searchField`: Search field to watch (default: 'query')
- `matchFields`: Fields to match against (default: ['name', 'label', 'id'])

**Example:**
```typescript
{
  template: 'search-to-highlight',
  sourceComponentId: 'search-input',
  targetComponentId: 'data-viz',
  options: {
    searchField: 'query',
    matchFields: ['name', 'description', 'tags']
  }
}
```

### 5. aggregation-to-summary

Data changes update summary statistics.

**Options:**
- `aggregationType`: 'sum' | 'avg' | 'count' | 'min' | 'max' (required)
- `aggregationField`: Field to aggregate (required for sum/avg/min/max)

**Example:**
```typescript
{
  template: 'aggregation-to-summary',
  sourceComponentId: 'orders-table',
  targetComponentId: 'total-revenue-card',
  options: {
    aggregationType: 'sum',
    aggregationField: 'amount'
  }
}
```

### 6. selection-sync

Keeps selections synchronized across multiple views.

**Options:**
- `idField`: Field to use as identifier (default: 'id')
- `bidirectional`: Enable two-way sync (default: false)

**Example:**
```typescript
{
  template: 'selection-sync',
  sourceComponentId: 'table-view',
  targetComponentId: 'map-view',
  options: {
    idField: 'locationId',
    bidirectional: true
  }
}
```

### 7. custom

Create a custom binding with manual configuration.

**Required Parameters:**
- `sourceComponentId`: Source component ID
- `sourceDataPath`: Path in source (e.g., 'selection.selectedRows')
- `targetComponentId`: Target component ID
- `targetPropPath`: Path in target (e.g., 'data')

**Optional:**
- `transformation`: JavaScript function to transform data
- `bidirectional`: Enable two-way sync
- `triggerEvents`: Events that trigger binding

**Example:**
```typescript
{
  template: 'custom',
  sourceComponentId: 'table-1',
  sourceDataPath: 'selection.selectedRows',
  targetComponentId: 'chart-1',
  targetPropPath: 'data',
  transformation: '(rows) => rows.map(r => ({ x: r.date, y: r.value }))',
  triggerEvents: ['selection_change']
}
```

## Data Paths

### Common Source Paths

- `selection.selectedRows` - Array of selected rows (tables)
- `selection.selectedRow` - Single selected row
- `filters` - All filters object
- `filters.search` - Specific filter value
- `data.rows` - All data rows
- `data` - Full data object

### Common Target Paths

- `data` - Update data
- `data.rows` - Update rows specifically
- `filters` - Update filters
- `highlightIds` - IDs to highlight
- `selection` - Update selection
- `record` - Single record data
- `recordId` - Record identifier

## Advanced Usage

### Multiple Bindings at Once

```typescript
// Create dashboard with multiple bindings
const bindings = await Promise.all([
  create_data_binding({
    template: 'table-to-chart',
    sourceComponentId: 'orders-table',
    targetComponentId: 'orders-chart'
  }),
  create_data_binding({
    template: 'aggregation-to-summary',
    sourceComponentId: 'orders-table',
    targetComponentId: 'total-card',
    options: { aggregationType: 'sum', aggregationField: 'amount' }
  }),
  create_data_binding({
    template: 'aggregation-to-summary',
    sourceComponentId: 'orders-table',
    targetComponentId: 'count-card',
    options: { aggregationType: 'count' }
  })
])
```

### Custom Transformation

```typescript
await create_data_binding({
  template: 'custom',
  sourceComponentId: 'user-table',
  sourceDataPath: 'selection.selectedRows',
  targetComponentId: 'email-list',
  targetPropPath: 'recipients',
  transformation: `
    (users) => users
      .filter(u => u.email)
      .map(u => ({ name: u.name, email: u.email }))
  `
})
```

### Conditional Binding

```typescript
await create_data_binding({
  template: 'custom',
  sourceComponentId: 'status-filter',
  sourceDataPath: 'filters.status',
  targetComponentId: 'actions-panel',
  targetPropPath: 'availableActions',
  transformation: `
    (status) => {
      if (status === 'pending') return ['approve', 'reject']
      if (status === 'approved') return ['revoke']
      return []
    }
  `
})
```

## Related Functions

### toggle_data_binding

Enable or disable a binding without removing it.

```typescript
await toggle_data_binding({
  bindingId: 'binding_123',
  enabled: false
})
```

### remove_data_binding

Permanently remove a binding.

```typescript
await remove_data_binding({
  bindingId: 'binding_123'
})
```

### list_data_bindings

List all bindings, optionally filtered by component.

```typescript
const result = await list_data_bindings({
  componentId: 'table-1' // Optional
})

console.log(result.bindings)
// [{ id, sourceComponentId, targetComponentId, enabled, ... }]
```

## Best Practices

### 1. Use Debouncing for Text Input

```typescript
{
  template: 'filter-to-multiple',
  sourceComponentId: 'search-input',
  targetComponentIds: ['table-1'],
  options: {
    debounce: 300 // Wait for user to stop typing
  }
}
```

### 2. Be Specific with Filter Keys

```typescript
{
  template: 'filter-to-multiple',
  sourceComponentId: 'filter-panel',
  targetComponentIds: ['table-1'],
  options: {
    filterKeys: ['category', 'status'] // Only sync specific filters
  }
}
```

### 3. Clean Up Bindings

Bindings automatically clean up when components unmount, but you can manually remove them:

```typescript
// Get all bindings for a component
const { bindings } = await list_data_bindings({ componentId: 'temp-chart' })

// Remove them all
await Promise.all(
  bindings.map(b => remove_data_binding({ bindingId: b.id }))
)
```

### 4. Start Disabled for Complex Bindings

```typescript
const bindingId = await create_data_binding({
  template: 'custom',
  sourceComponentId: 'complex-source',
  targetComponentId: 'complex-target',
  enabled: false, // Start disabled
  // ... rest of config
})

// Enable once ready
await toggle_data_binding({ bindingId, enabled: true })
```

## Common Patterns

### Dashboard Cards

```typescript
// Sum, average, min, max cards
const cardBindings = [
  { aggregationType: 'sum', cardId: 'total-revenue' },
  { aggregationType: 'avg', cardId: 'avg-order' },
  { aggregationType: 'min', cardId: 'min-order' },
  { aggregationType: 'max', cardId: 'max-order' }
].map(({ aggregationType, cardId }) =>
  create_data_binding({
    template: 'aggregation-to-summary',
    sourceComponentId: 'orders-table',
    targetComponentId: cardId,
    options: { aggregationType, aggregationField: 'amount' }
  })
)

await Promise.all(cardBindings)
```

### Explore Pattern (Table + Chart + Details)

```typescript
await Promise.all([
  create_data_binding({
    template: 'table-to-chart',
    sourceComponentId: 'data-table',
    targetComponentId: 'data-chart'
  }),
  create_data_binding({
    template: 'master-detail',
    sourceComponentId: 'data-table',
    targetComponentId: 'details-panel',
    options: { loadFullRecord: true }
  })
])
```

### Global Filter

```typescript
await create_data_binding({
  template: 'filter-to-multiple',
  sourceComponentId: 'global-filter',
  targetComponentIds: [
    'customers-table',
    'orders-table',
    'revenue-chart',
    'map-view'
  ],
  options: {
    debounce: 300,
    filterKeys: ['dateRange', 'category', 'status']
  }
})
```

## Troubleshooting

### Binding Not Triggering

1. Check component IDs match exactly
2. Verify source component is publishing events
3. Check triggerEvents includes the right event type
4. Ensure binding is enabled

### Data Not Transforming Correctly

1. Verify source path points to the right data
2. Check transformation function syntax
3. Test transformation in isolation
4. Check browser console for errors

### Performance Issues

1. Add debouncing for frequent updates
2. Limit filterKeys to only what's needed
3. Use specific paths instead of full objects
4. Consider disabling bindings when not visible

## API Reference

### create_data_binding(params)

**Parameters:**
- `template` (required): Template type
- `sourceComponentId` (required for most templates): Source component
- `targetComponentId` (required): Target component
- `targetComponentIds` (for filter-to-multiple): Array of targets
- `sourceDataPath` (for custom): Source data path
- `targetPropPath` (for custom): Target prop path
- `options` (optional): Template-specific options
- `transformation` (for custom): Transform function
- `enabled` (optional): Start enabled (default: true)
- `bidirectional` (optional): Two-way sync (default: false)
- `triggerEvents` (optional): Event types to trigger on

**Returns:**
```typescript
{
  success: boolean
  bindingIds: string[]
  bindings: Array<{
    id: string
    sourceComponentId: string
    targetComponentId: string
    enabled: boolean
    template: string
  }>
  message: string
}
```

## Implementation Details

The data binding system works by:

1. Subscribing to source component events via the context bus
2. Extracting source data using the configured path
3. Applying transformation if provided
4. Patching target component state via context bus events

All bindings are tracked and can be managed (enabled/disabled/removed) at runtime.
