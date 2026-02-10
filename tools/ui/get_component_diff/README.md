# Get Component Diff Tool

Compares current component state with previous state to identify what changed. Useful for debugging state mutations and understanding component evolution.

## Usage

```typescript
// Compare with previous state
const diff = await getComponentDiff({
  componentId: 'my-table-1'
})

// Compare with specific snapshot (future feature)
const snapshotDiff = await getComponentDiff({
  componentId: 'my-table-1',
  compareToSnapshot: 'snapshot-123'
})
```

## Response

```typescript
{
  success: boolean
  componentId: string
  diff: {
    props: Array<{
      path: string
      type: 'added' | 'removed' | 'modified' | 'unchanged'
      oldValue?: any
      newValue?: any
    }>
    slotChanged: {
      from: string
      to: string
    } | null
    summary: string
  } | null
  message?: string // If no previous state
  error?: string // If component not found
}
```

## Use Cases

### Debugging State Changes
```typescript
// After a state mutation, check what changed
const result = await getComponentDiff({ componentId: 'table-1' })
console.log(result.diff.summary) // "3 props modified, slot changed"
```

### Tracking Component Evolution
```typescript
// Monitor how props evolve over time
const changes = result.diff.props.filter(c => c.type === 'modified')
changes.forEach(change => {
  console.log(`${change.path}: ${change.oldValue} -> ${change.newValue}`)
})
```

### Slot Movement Tracking
```typescript
// Check if component moved between slots
if (result.diff.slotChanged) {
  console.log(`Moved from ${result.diff.slotChanged.from} to ${result.diff.slotChanged.to}`)
}
```

## Diff Types

- **added**: New properties that didn't exist before
- **removed**: Properties that were deleted
- **modified**: Properties whose values changed
- **unchanged**: No change (not included in results)

## Path Notation

Nested property paths use dot notation:
- `rows[0].name`: First row's name field
- `columns.length`: Array length change
- `config.theme.primary`: Nested object property

## Limitations

- Compares with the most recent history entry
- History depth limited by `maxHistorySize` in layout store (default: 20)
- Snapshot comparison not yet implemented (compareToSnapshot parameter reserved for future use)
