# patch_component_state

**Category**: `ui`  
**Type**: Streaming UI Control Tool

## Overview

`patch_component_state` updates component props without remounting, enabling smooth, flicker-free updates to already-rendered interactive components. This is a **streaming UI control tool** that applies prop changes in real-time as the tool call streams through.

Unlike `render_manifest` which mounts new components, this tool **patches existing ones** - preserving component state, animations, and user interactions while updating data or configuration.

## When to Use

- **Real-time data updates**: Dashboard metrics, live counters, streaming logs
- **Progressive loading**: Add items incrementally to lists/tables/galleries
- **Status changes**: Update badges, alerts, or indicators without flicker
- **Progressive refinement**: Adjust visualization parameters, filters, or zoom levels
- **Highlight changes**: Flash updated values with animations
- **Multi-step processes**: Update progress bars, status text, or completion states
- **Error recovery**: Replace error state with corrected data

**Don't use for**:
- Initial component mounting (use `render_manifest`)
- Changing component type (use `render_manifest` with different componentId)
- Major structural changes (unmount old, mount new)

## Input Shape

### Basic Update (Merge/Replace)
```json
{
  "moduleId": "cost-dashboard-main",
  "propsPatch": {
    "currentSpend": 847.23,
    "percentOfBudget": 84.7,
    "trend": "increasing"
  },
  "mode": "merge",
  "animate": true
}
```

### Array Add (Incremental)
```json
{
  "moduleId": "query-results-table",
  "mode": "array_add",
  "path": "data.rows",
  "items": [
    { "id": "row-6", "name": "Alice", "status": "active" },
    { "id": "row-7", "name": "Bob", "status": "pending" }
  ],
  "position": "end",
  "animation": {
    "type": "slide",
    "duration": 300
  }
}
```

### Array Update (Change Specific Items)
```json
{
  "moduleId": "task-board",
  "mode": "array_update",
  "path": "tasks",
  "updates": [
    { "id": "task-1", "changes": { "status": "completed" } },
    { "id": "task-3", "changes": { "status": "in-progress", "assignee": "Alice" } }
  ],
  "animation": {
    "type": "flash",
    "duration": 500,
    "color": "#22c55e"
  }
}
```

### Array Remove (Delete Items by ID)
```json
{
  "moduleId": "notification-list",
  "mode": "array_remove",
  "path": "notifications",
  "itemIds": ["notif-1", "notif-2", "notif-5"],
  "idField": "id"
}
```

### Batch Operations (Multiple Changes)
```json
{
  "moduleId": "dashboard",
  "mode": "batch",
  "operations": [
    { "mode": "merge", "propsPatch": { "title": "Updated Dashboard" } },
    { "mode": "array_add", "path": "widgets", "items": [{ "id": "w1", "type": "chart" }] },
    { "mode": "array_update", "path": "metrics", "updates": [{ "id": "m1", "changes": { "value": 42 } }] }
  ]
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `moduleId` | string | **Yes** | ID of the interactive module to update (must match existing module's `id` from `render_manifest`) |
| `propsPatch` | object | Conditional | Required for `merge` and `replace` modes. Partial props to merge with or replace existing props. |
| `mode` | string | No | Operation mode: `'merge'` (default), `'replace'`, `'array_add'`, `'array_remove'`, `'array_update'`, or `'batch'` |
| `animate` | boolean | No | Enable smooth animated transition for prop changes (default: `true`). Set to `false` for instant updates. |
| `animation` | object | No | Custom animation config: `{ type, duration, color }`. Types: `'flash'`, `'fade'`, `'bounce'`, `'slide'`, `'highlight'` |
| `path` | string | Conditional | Required for array operations. Dot notation path to array property (e.g., `'data.rows'`, `'items'`) |
| `items` | array | Conditional | Required for `array_add`. Array of items to add to the target array |
| `position` | string | No | For `array_add`: `'start'` or `'end'` (default: `'end'`) |
| `itemIds` | array | Conditional | Required for `array_remove`. Array of item IDs to remove from the target array |
| `idField` | string | No | Field name to use as unique identifier for array items (default: `'id'`) |
| `updates` | array | Conditional | Required for `array_update`. Array of `{ id, changes }` objects specifying which items to update |
| `operations` | array | Conditional | Required for `batch` mode. Array of operations to execute in sequence |

### Mode Behavior

**Merge mode** (default):
```javascript
// Existing props: { budget: 1000, currentSpend: 500, department: "Engineering" }
// Patch: { currentSpend: 600 }
// Result: { budget: 1000, currentSpend: 600, department: "Engineering" }
```

**Replace mode**:
```javascript
// Existing props: { budget: 1000, currentSpend: 500, department: "Engineering" }
// Patch: { currentSpend: 600 }
// Result: { currentSpend: 600 }
// Warning: budget and department are lost!
```

## Usage Examples

### Example 1: Real-time Dashboard Update

```json
{
  "moduleId": "cost-dashboard-main",
  "propsPatch": {
    "currentSpend": 1247.89,
    "percentOfBudget": 124.8,
    "alert": "Budget exceeded!",
    "alertSeverity": "error"
  },
  "mode": "merge",
  "animate": true
}
```

**AI Narration**:
> "I've updated the cost dashboard - you're now at $1,247.89 (124.8% of budget). The alert indicator is now red to highlight the overage."

### Example 2: Progressive Table Loading

```json
{
  "moduleId": "query-results-table",
  "propsPatch": {
    "rows": [
      { "id": 1, "name": "Alice", "status": "active" },
      { "id": 2, "name": "Bob", "status": "active" },
      { "id": 3, "name": "Charlie", "status": "pending" }
    ],
    "totalRows": 3,
    "loadingMore": true
  },
  "mode": "merge",
  "animate": true
}
```

**AI Narration**:
> "Loading first 3 rows... I'll add more as they become available."

*Later:*
```json
{
  "moduleId": "query-results-table",
  "propsPatch": {
    "rows": [
      { "id": 1, "name": "Alice", "status": "active" },
      { "id": 2, "name": "Bob", "status": "active" },
      { "id": 3, "name": "Charlie", "status": "pending" },
      { "id": 4, "name": "Diana", "status": "active" },
      { "id": 5, "name": "Eve", "status": "active" }
    ],
    "totalRows": 5,
    "loadingMore": false
  },
  "mode": "replace",
  "animate": true
}
```

**AI Narration**:
> "All 5 rows loaded successfully!"

### Example 3: Workflow Status Update

```json
{
  "moduleId": "workflow-board",
  "propsPatch": {
    "stages": [
      { "name": "Planning", "count": 3, "status": "complete" },
      { "name": "Development", "count": 5, "status": "in-progress", "highlight": true },
      { "name": "Testing", "count": 2, "status": "pending" },
      { "name": "Deployment", "count": 0, "status": "pending" }
    ],
    "activeStage": "Development"
  },
  "mode": "merge",
  "animate": true
}
```

**AI Narration**:
> "Planning stage complete! Moving to Development with 5 active tasks."

### Example 4: Error State Recovery

**Initial render** (via render_manifest):
```json
{
  "id": "data-viz-main",
  "componentId": "vision:image-gallery",
  "slot": "primary",
  "props": {
    "images": [],
    "status": "loading",
    "message": "Fetching visualizations..."
  }
}
```

**Error occurs** (patch):
```json
{
  "moduleId": "data-viz-main",
  "propsPatch": {
    "status": "error",
    "message": "Failed to load images from S3",
    "retryable": true
  },
  "mode": "merge",
  "animate": false
}
```

**Recovery** (patch):
```json
{
  "moduleId": "data-viz-main",
  "propsPatch": {
    "images": [
      { "url": "https://...", "caption": "Chart 1" },
      { "url": "https://...", "caption": "Chart 2" }
    ],
    "status": "success",
    "message": null,
    "retryable": false
  },
  "mode": "merge",
  "animate": true
}
```

**AI Narration**:
> "Encountered a temporary error fetching images... Retrying... Success! Gallery now shows 2 visualizations."

### Example 5: Filter/Config Adjustment

```json
{
  "moduleId": "knowledge-graph",
  "propsPatch": {
    "filters": {
      "nodeTypes": ["agent", "tool", "concept"],
      "dateRange": { "start": "2024-01-01", "end": "2024-12-31" },
      "minConnections": 3
    },
    "layout": "force-directed",
    "zoom": 1.5
  },
  "mode": "merge",
  "animate": true
}
```

**AI Narration**:
> "I've applied filters to show agents, tools, and concepts with at least 3 connections from 2024. Zoomed in for better detail."

### Example 6: Instant Update (No Animation)

```json
{
  "moduleId": "audio-player",
  "propsPatch": {
    "isPlaying": false,
    "currentTime": 0,
    "trackIndex": 2
  },
  "mode": "merge",
  "animate": false
}
```

**AI Narration**:
> "Skipped to track 3."

### Example 7: Incremental Array Updates with Animation

**Add new rows to table with slide animation:**
```json
{
  "moduleId": "query-results-table",
  "mode": "array_add",
  "path": "data.rows",
  "items": [
    { "id": "row-11", "name": "Alice Chen", "email": "alice@example.com", "status": "active" },
    { "id": "row-12", "name": "Bob Smith", "email": "bob@example.com", "status": "pending" }
  ],
  "position": "end",
  "animation": {
    "type": "slide",
    "duration": 300
  }
}
```

**AI Narration**:
> "Adding 2 more rows to the table... Done! Now showing 12 total results."

### Example 8: Update Specific Array Items with Flash

**Mark tasks as completed with green flash:**
```json
{
  "moduleId": "task-board",
  "mode": "array_update",
  "path": "tasks",
  "updates": [
    { "id": "task-5", "changes": { "status": "completed", "completedAt": "2024-01-15T10:30:00Z" } },
    { "id": "task-7", "changes": { "status": "completed", "completedAt": "2024-01-15T10:30:00Z" } }
  ],
  "idField": "id",
  "animation": {
    "type": "flash",
    "duration": 500,
    "color": "#22c55e"
  }
}
```

**AI Narration**:
> "Marked tasks 5 and 7 as completed. Great progress!"

### Example 9: Remove Items from List

**Delete dismissed notifications:**
```json
{
  "moduleId": "notification-center",
  "mode": "array_remove",
  "path": "notifications",
  "itemIds": ["notif-123", "notif-456", "notif-789"],
  "idField": "id"
}
```

**AI Narration**:
> "Removed 3 dismissed notifications from your inbox."

### Example 10: Batch Operations

**Update dashboard title, add widget, and update metrics in one call:**
```json
{
  "moduleId": "analytics-dashboard",
  "mode": "batch",
  "operations": [
    {
      "mode": "merge",
      "propsPatch": {
        "title": "Q1 2024 Analytics",
        "lastUpdated": "2024-01-15T10:30:00Z"
      }
    },
    {
      "mode": "array_add",
      "path": "widgets",
      "items": [
        {
          "id": "widget-revenue",
          "type": "line-chart",
          "title": "Revenue Trend",
          "data": [100, 150, 200]
        }
      ],
      "position": "end"
    },
    {
      "mode": "array_update",
      "path": "metrics",
      "updates": [
        { "id": "total-users", "changes": { "value": 1247, "change": "+5.2%" } },
        { "id": "active-sessions", "changes": { "value": 89, "change": "-2.1%" } }
      ]
    }
  ],
  "animation": {
    "type": "fade",
    "duration": 400
  }
}
```

**AI Narration**:
> "Updated your Q1 dashboard: added revenue trend widget and refreshed user metrics."

### Example 11: Nested Path Updates

**Update deeply nested configuration:**
```json
{
  "moduleId": "chart-visualization",
  "mode": "array_update",
  "path": "config.series",
  "updates": [
    {
      "id": "series-1",
      "changes": {
        "color": "#3b82f6",
        "visible": true,
        "lineWidth": 2
      }
    }
  ],
  "animation": {
    "type": "bounce",
    "duration": 400
  }
}
```

**AI Narration**:
> "Adjusted the chart series styling - now using blue with medium line width."

## Output/Response

### Success Response

```json
{
  "success": true,
  "component_patch": {
    "moduleId": "cost-dashboard-main",
    "propsPatch": {
      "currentSpend": 1247.89,
      "percentOfBudget": 124.8
    },
    "mode": "merge",
    "animate": true,
    "timestamp": "2024-01-15T10:30:45.123Z"
  },
  "space_id": "global"
}
```

The `component_patch` object is the **streaming payload** detected by the client-side PortalExperienceStore.

### Error Response

```json
{
  "success": false,
  "error": "moduleId 'nonexistent-module' not found in current portal state",
  "space_id": "global"
}
```

## How It Works (Behavior Flow)

```
1. AI calls patch_component_state(moduleId, propsPatch, mode, animate)
2. Server validates:
   - moduleId is non-empty string
   - propsPatch is non-empty object
   - mode is 'merge' or 'replace'
   - animate is boolean
3. Server returns success with component_patch payload
4. Tool call streams to client
5. PortalExperienceStore detects component_patch key
6. Store finds existing module by moduleId
7. Store applies patch:
   - merge mode: { ...existingProps, ...propsPatch }
   - replace mode: propsPatch
8. Component re-renders with new props (no unmount!)
9. If animate=true, CSS transitions smooth the change
10. Component state (scroll position, focus, local state) preserved
```

## Best Practices

### ✅ Do:
- **Use merge mode by default** - Safer, preserves unpatched props
- **Animate by default** - Smoother UX, users track changes better
- **Narrate significant changes** - "Updated budget to $1,247.89"
- **Validate moduleId exists** - Patch will silently fail if ID doesn't match
- **Use for incremental updates** - Add rows, update metrics, adjust filters
- **Preserve component state** - Don't patch props that reset user interactions (scroll, focus, selections)
- **Batch related changes** - One patch with multiple prop updates is better than multiple patches

### ❌ Don't:
- **Don't use replace mode carelessly** - You'll lose props not in the patch
- **Don't patch component type** - Use render_manifest to switch components
- **Don't patch before mounting** - Component must exist first
- **Don't spam patches** - Debounce rapid updates (e.g., live metrics every 100ms)
- **Don't break component schema** - Ensure propsPatch matches component's expected props
- **Don't disable animation without reason** - Instant changes are jarring

### When to Disable Animation
- Media controls (play/pause, skip)
- User-initiated actions (click, type)
- Rapid updates (> 10 per second)
- Binary state changes (on/off, show/hide)

### When to Use Replace Mode
- **Complete data refresh** - New query results, different dataset
- **State reset** - Clear filters, reset to defaults
- **Mode switch** - Dashboard view → chart view (same component, different config)
- **Error recovery** - Replace error state with fresh valid state

## Integration with AI Expression Patterns

### Progressive Revelation Pattern
```typescript
// Step 1: Mount empty table
render_manifest({ id: "results-table", componentId: "data:query-results-table", props: { rows: [], status: "loading" } })

// Step 2: Add first batch (patch)
patch_component_state({ moduleId: "results-table", propsPatch: { rows: [...first10], totalRows: 10, status: "loading-more" } })

// Step 3: Add second batch (patch)
patch_component_state({ moduleId: "results-table", propsPatch: { rows: [...all25], totalRows: 25, status: "complete" } })
```

### Real-time Monitoring Pattern
```typescript
// Initial dashboard
render_manifest({ id: "cost-dash", componentId: "cost:cost-dashboard", props: { currentSpend: 500, budget: 1000 } })

// Update every 30 seconds
setInterval(() => {
  patch_component_state({
    moduleId: "cost-dash",
    propsPatch: { currentSpend: fetchLatestSpend() },
    animate: true
  })
}, 30000)
```

### Error Recovery Pattern
```typescript
// Show error (patch)
patch_component_state({ moduleId: "data-viz", propsPatch: { status: "error", message: "Timeout" }, animate: false })

// Recover (patch)
patch_component_state({ moduleId: "data-viz", propsPatch: { status: "success", message: null, data: [...] }, animate: true })
```

## Error Handling

### Common Errors

**Missing moduleId**:
```
Missing required parameter: moduleId
```

**Empty moduleId**:
```
moduleId cannot be empty
```

**Invalid propsPatch**:
```
propsPatch must be a non-array object
```

**Empty propsPatch**:
```
propsPatch cannot be empty
```

**Invalid mode**:
```
Invalid mode: "invalid". Must be one of: merge, replace
```

**Module not found** (client-side):
```
moduleId 'nonexistent-module' not found in current portal state
```

### Debugging Tips

1. **Check moduleId matches**: Ensure ID used in `render_manifest` matches ID in `patch_component_state`
2. **Verify component is mounted**: Use browser DevTools to confirm module exists in PortalExperienceStore
3. **Inspect patch payload**: Console should log `[patch_component_state]` with details
4. **Test in isolation**: Patch one prop at a time to identify issues
5. **Check component schema**: Ensure propsPatch keys match component's prop types

## Related Tools

- **render_manifest**: Mount components initially (use first)
- **show_notification**: Alert users to changes ("Dashboard updated!")
- **update_theme**: Change mood to match new data context (error theme for overage)
- **set_ui_layout**: Adjust layout when content grows/shrinks

## Notes

- This is a **streaming UI tool** - changes happen as the tool call streams
- Component must already be mounted (via `render_manifest`)
- Uses `component_patch` as special key for client-side detection
- Preserves React component state (scroll, focus, local state)
- Animate transitions via CSS (opacity, transform, color)
- Maximum patch size: ~100KB (practical limit for smooth streaming)
