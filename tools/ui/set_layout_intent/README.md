# Set Layout Intent Tool

**Category**: UI Control
**Version**: 2.0.0
**Purpose**: Set the UI layout intent to establish the right layout pattern before rendering components.

## Overview

The `set_layout_intent` tool establishes the layout pattern for the UI by selecting from 12 semantic intent types. This tool should be called **BEFORE** rendering components to ensure they are placed in the correct semantic slots.

## When to Use

Call this tool when:
- Starting a new user interaction that requires a specific UI pattern
- Switching between different types of content (e.g., from reading to comparing)
- The user explicitly requests a layout change
- You need to establish the visual structure before mounting components

## Layout Intents

### Content-Focused Intents

#### `focus`
- **Use Case**: Single document/artifact concentration (reading, editing)
- **Active Slots**: main, actions
- **Example**: "Show me the user guide", "Edit this document"

#### `dashboard`
- **Use Case**: Multi-metric overview (analytics, monitoring)
- **Active Slots**: hero, main, context, status
- **Example**: "Show me the sales dashboard", "Display system metrics"

#### `timeline`
- **Use Case**: Chronological feed (activity log, chat history)
- **Active Slots**: hero, main, status
- **Example**: "Show recent activity", "Display chat history"

### Comparison & Analysis Intents

#### `compare`
- **Use Case**: Side-by-side comparison (diff, A/B test)
- **Active Slots**: main, detail, actions
- **Example**: "Compare these two reports", "Show me the differences"

#### `split`
- **Use Case**: Multi-document parallel work
- **Active Slots**: main, detail
- **Example**: "Show both files side by side", "Work on two documents at once"

#### `hero-detail`
- **Use Case**: Master-detail pattern (list+preview, file browser)
- **Active Slots**: navigation, main, detail
- **Example**: "Browse files with preview", "Show list with details"

### Interactive & Spatial Intents

#### `spatial`
- **Use Case**: Maps/canvas/geographic data
- **Active Slots**: main, context, actions
- **Example**: "Show map view", "Display geographic data"

#### `canvas`
- **Use Case**: Creative workspace (design tool, whiteboard)
- **Active Slots**: main, context, actions
- **Example**: "Open design workspace", "Create a whiteboard"

#### `grid-explore`
- **Use Case**: Gallery/exploratory browsing
- **Active Slots**: hero, main, context
- **Example**: "Show image gallery", "Browse collection"

### Workflow Intents

#### `wizard`
- **Use Case**: Multi-step workflow (onboarding, checkout)
- **Active Slots**: hero, main, actions
- **Example**: "Start setup wizard", "Begin checkout process"

#### `tabs`
- **Use Case**: Categorical organization (settings, profiles)
- **Active Slots**: navigation, main
- **Example**: "Show settings tabs", "Organize by category"

#### `modal-over`
- **Use Case**: Interrupt workflow (confirmations, forms)
- **Active Slots**: background, overlay
- **Example**: "Show confirmation dialog", "Display form overlay"

## Parameters

### `intent` (required)
- **Type**: `string`
- **Enum**: See Layout Intents section above
- **Description**: The layout intent to activate

### `clearComponents` (optional)
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Whether to clear ephemeral components when changing intent

## Return Value

### Success Response
```typescript
{
  success: true,
  intent: "dashboard",
  message: "Layout intent set to 'dashboard'. Ephemeral components cleared.",
  space_id: "reflectt"
}
```

### Error Response
```typescript
{
  success: false,
  error: "Invalid intent specified",
  space_id: "reflectt"
}
```

## Usage Examples

### Example 1: Dashboard View
```json
{
  "intent": "dashboard"
}
```

### Example 2: Reading Focus
```json
{
  "intent": "focus"
}
```

### Example 3: Side-by-Side Comparison
```json
{
  "intent": "compare"
}
```

### Example 4: Wizard Workflow
```json
{
  "intent": "wizard"
}
```

## Behavior

When `set_layout_intent` is called:

1. **Ephemeral Components Cleared**: All components with `lifecycle: 'ephemeral'` are removed
2. **Persistent Components Retained**: Components with `lifecycle: 'persistent'` remain
3. **Slots Activated**: Only slots defined in the intent configuration become visible
4. **Transition Applied**: A smooth animation transition occurs (duration varies by intent)
5. **History Recorded**: The intent change is recorded in layout history

## Best Practices

1. **Call First**: Always call `set_layout_intent` before `render_manifest`
2. **Match User Intent**: Choose the layout that best matches the user's goal
3. **Consider Content**: Different content types work better with different layouts
4. **Preserve Navigation**: Use persistent lifecycle for navigation components

## Common Patterns

### Pattern 1: Show Dashboard
```typescript
// 1. Set intent
await set_layout_intent({ intent: "dashboard" })

// 2. Render components
await render_manifest({
  components: [
    { componentId: "kpi-grid", slot: "hero" },
    { componentId: "sales-chart", slot: "main" },
    { componentId: "filters", slot: "context" }
  ]
})
```

### Pattern 2: Compare Documents
```typescript
// 1. Set intent
await set_layout_intent({ intent: "compare" })

// 2. Render components
await render_manifest({
  components: [
    { componentId: "document-viewer", slot: "main", props: { doc: "v1" } },
    { componentId: "document-viewer", slot: "detail", props: { doc: "v2" } }
  ]
})
```

### Pattern 3: Wizard Flow
```typescript
// 1. Set intent
await set_layout_intent({ intent: "wizard" })

// 2. Render components
await render_manifest({
  components: [
    { componentId: "progress-bar", slot: "hero" },
    { componentId: "step-form", slot: "main" },
    { componentId: "wizard-actions", slot: "actions" }
  ]
})
```

## Related Tools

- **render_manifest**: Render components into semantic slots
- **get_layout_state**: Inspect current layout state

## Notes

- Intent changes trigger ephemeral component cleanup automatically
- Transition durations vary by intent (200-400ms)
- Layout history is limited to last 10 changes
- Mobile/tablet breakpoints may adapt intent configurations
