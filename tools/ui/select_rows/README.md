# Select Rows Tool

Programmatically selects rows in table components.

## Purpose

Allows AI to:
- Select specific rows by ID for batch operations
- Test selection-based workflows
- Trigger actions on selected data
- Simulate user row selection behavior
- Enable cross-component interactions (e.g., table selection → chart filter)

## Usage

```typescript
// Select specific rows by ID
await select_rows({
  componentId: 'users-table',
  rowIds: ['user-123', 'user-456', 'user-789']
})

// Select all rows
await select_rows({
  componentId: 'products-table',
  selectAll: true
})

// Add to existing selection (don't clear)
await select_rows({
  componentId: 'orders-table',
  rowIds: ['order-001', 'order-002'],
  clearExisting: false
})
```

## Parameters

- `componentId` (required): Module ID of the table component
- `rowIds` (optional): Array of row IDs to select (required if selectAll is false)
- `selectAll` (optional): Select all rows in the table (default: false)
- `clearExisting` (optional): Clear existing selection first (default: true)

## How It Works

### Context Bus Integration

The tool publishes selection changes via the context bus:

```typescript
contextBus.publish({
  type: 'selection_change',
  source: 'users-table',
  payload: {
    selectAll: false,
    rowIds: ['user-123', 'user-456'],
    clearExisting: true
  }
})
```

This allows other components to react to selection changes:
- Charts can auto-filter based on selected rows
- Summary panels can show statistics for selected items
- Action buttons can enable/disable based on selection

### DOM Interaction

The tool also tries to interact with the table's UI:
- Checks "select all" checkbox when `selectAll: true`
- Checks individual row checkboxes for specific row IDs
- Looks for checkboxes with `data-row-id` attributes

## Examples

### Batch Operations
```typescript
// Select multiple users for bulk delete
await select_rows({
  componentId: 'users-table',
  rowIds: ['user-101', 'user-102', 'user-103']
})

// Now click delete button
await click_element({
  componentId: 'users-table',
  elementSelector: 'button[data-action="delete-selected"]'
})
```

### Cross-Component Filtering
```typescript
// Select specific data points
await select_rows({
  componentId: 'sales-table',
  rowIds: ['sale-2024-01', 'sale-2024-02']
})

// Charts listening to the context bus will auto-filter
// to show only data for these selected rows
```

### Progressive Selection
```typescript
// Select first batch
await select_rows({
  componentId: 'items-table',
  rowIds: ['item-1', 'item-2']
})

// Add more to selection (without clearing)
await select_rows({
  componentId: 'items-table',
  rowIds: ['item-3', 'item-4'],
  clearExisting: false
})
```

### Select All for Export
```typescript
// Select all rows
await select_rows({
  componentId: 'customers-table',
  selectAll: true
})

// Trigger export
await click_element({
  componentId: 'customers-table',
  elementSelector: 'button[data-action="export"]'
})
```

## Row ID Requirements

Row IDs should be:
- Unique identifiers from your data
- Typically the primary key field (e.g., `id`, `_id`, `uuid`)
- Strings (numbers are converted to strings)

Example data structure:
```typescript
const tableData = [
  { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
  { id: 'user-456', name: 'Jane Smith', email: 'jane@example.com' },
  { id: 'user-789', name: 'Bob Johnson', email: 'bob@example.com' }
]

// Select by ID
await select_rows({
  componentId: 'users',
  rowIds: ['user-123', 'user-789']
})
```

## Integration with Components

### Table Components

Tables should:
1. Register with the context bus on mount
2. Subscribe to their own `selection_change` events
3. Update selection state when events are received
4. Use `data-row-id` attributes on checkboxes

Example:
```typescript
// In table component
useEffect(() => {
  const unsubscribe = contextBus.subscribe(componentId, (event) => {
    if (event.type === 'selection_change') {
      setSelectedRows(event.payload.rowIds)
    }
  })
  return unsubscribe
}, [componentId])
```

### Related Components

Charts, filters, or detail panels can subscribe to selection changes:

```typescript
// In chart component
useEffect(() => {
  const unsubscribe = contextBus.subscribe('users-table', (event) => {
    if (event.type === 'selection_change') {
      // Filter chart data based on selected rows
      filterChartData(event.payload.rowIds)
    }
  })
  return unsubscribe
}, [])
```

## Best Practices

1. Use meaningful, stable row IDs (not array indices)
2. Check component is registered with context bus before selecting
3. Use `clearExisting: false` for progressive/additive selection
4. Combine with other tools for complete workflows
5. Handle selection limits gracefully
6. Provide feedback to users about selected rows
7. Use `selectAll` sparingly for large datasets

## Error Handling

Returns detailed results:
- `rowsSelected`: Number of rows selected or 'all'
- `selectedIds`: Array of selected row IDs (unless selectAll)
- `error`: Error message if selection failed

Common errors:
- Component not found in context bus
- Component not rendered in DOM
- Invalid row IDs
- No rowIds provided when selectAll is false
