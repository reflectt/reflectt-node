# Get Layout State Tool

**Category**: UI Control
**Version**: 1.0.0
**Purpose**: Inspect current layout state including intent, visible slots, and mounted components.

## Overview

The `get_layout_state` tool provides introspection into the current UI layout state. Use this tool to understand what's currently rendered before making layout changes.

## When to Use

Call this tool when:
- You need to understand the current layout before making changes
- Debugging layout issues
- Verifying that components were mounted correctly
- Checking which slots are currently visible
- Understanding the current intent state

## Parameters

This tool takes no parameters. Simply call it to get the current state:

```json
{}
```

## Return Value

### Success Response

```typescript
{
  success: true,
  state: {
    currentIntent: "dashboard",
    previousIntent: "focus",
    breakpoint: "desktop",
    isTransitioning: false,
    slots: [
      {
        slot: "hero",
        visible: true,
        componentCount: 1,
        components: [
          {
            id: "kpi-grid-1699564800000-abc123",
            componentId: "kpi-grid",
            lifecycle: "ephemeral",
            size: "comfortable",
            priority: 500,
            label: "KPI Overview"
          }
        ]
      },
      {
        slot: "main",
        visible: true,
        componentCount: 2,
        components: [
          {
            id: "sales-chart-1699564800001-def456",
            componentId: "sales-chart",
            lifecycle: "ephemeral",
            size: "comfortable",
            priority: 500
          },
          {
            id: "revenue-table-1699564800002-ghi789",
            componentId: "revenue-table",
            lifecycle: "ephemeral",
            size: "compact",
            priority: 400
          }
        ]
      },
      {
        slot: "context",
        visible: true,
        componentCount: 1,
        components: [
          {
            id: "filter-panel-1699564800003-jkl012",
            componentId: "filter-panel",
            lifecycle: "persistent",
            size: "comfortable",
            priority: 500
          }
        ]
      }
    ]
  },
  space_id: "reflectt"
}
```

### Error Response

```typescript
{
  success: false,
  error: "Failed to get layout state",
  space_id: "reflectt"
}
```

## Response Fields

### Top-Level State

#### `currentIntent`
- **Type**: `string`
- **Description**: Currently active layout intent
- **Values**: `'focus'`, `'dashboard'`, `'compare'`, etc.

#### `previousIntent`
- **Type**: `string | null`
- **Description**: Previous layout intent (before last change)
- **Values**: Intent name or `null` if no previous intent

#### `breakpoint`
- **Type**: `string`
- **Description**: Current responsive breakpoint
- **Values**: `'mobile'`, `'tablet'`, `'desktop'`, `'wide'`

#### `isTransitioning`
- **Type**: `boolean`
- **Description**: Whether layout is currently animating a transition
- **Values**: `true` during transitions, `false` otherwise

### Slot Information

Each slot object contains:

#### `slot`
- **Type**: `string`
- **Description**: Semantic slot name
- **Values**: `'hero'`, `'main'`, `'detail'`, etc.

#### `visible`
- **Type**: `boolean`
- **Description**: Whether slot is currently visible (based on intent)
- **Note**: Only visible slots are included in the response

#### `componentCount`
- **Type**: `number`
- **Description**: Number of components currently in the slot
- **Range**: `0` to slot's max capacity

#### `components`
- **Type**: `array`
- **Description**: Array of component metadata objects

### Component Information

Each component object contains:

#### `id`
- **Type**: `string`
- **Description**: Unique component instance ID
- **Format**: `{componentId}-{timestamp}-{random}`

#### `componentId`
- **Type**: `string`
- **Description**: Component type identifier from registry

#### `lifecycle`
- **Type**: `string`
- **Description**: Component lifecycle type
- **Values**: `'persistent'`, `'ephemeral'`, `'ambient'`

#### `size`
- **Type**: `string`
- **Description**: Component size variant
- **Values**: `'compact'`, `'comfortable'`, `'spacious'`, `'fill'`

#### `priority`
- **Type**: `number`
- **Description**: Component priority (for slot capacity management)
- **Range**: `0-1000`

#### `label`
- **Type**: `string | undefined`
- **Description**: Optional human-readable label

## Usage Examples

### Example 1: Check Current State Before Change

```typescript
// Get current state
const state = await get_layout_state({})

console.log(`Current intent: ${state.state.currentIntent}`)
console.log(`Visible slots: ${state.state.slots.map(s => s.slot).join(', ')}`)

// Make informed decision
if (state.state.currentIntent !== 'compare') {
  await set_layout_intent({ intent: 'compare' })
}
```

### Example 2: Verify Component Was Mounted

```typescript
// Mount a component
await render_manifest({
  components: [
    {
      componentId: "sales-dashboard",
      slot: "main"
    }
  ]
})

// Verify it was mounted
const state = await get_layout_state({})
const mainSlot = state.state.slots.find(s => s.slot === 'main')
const hasDashboard = mainSlot?.components.some(c => c.componentId === 'sales-dashboard')

console.log(`Dashboard mounted: ${hasDashboard}`)
```

### Example 3: Debug Layout Issues

```typescript
const state = await get_layout_state({})

console.log('Layout Debugging Info:')
console.log(`- Intent: ${state.state.currentIntent}`)
console.log(`- Breakpoint: ${state.state.breakpoint}`)
console.log(`- Transitioning: ${state.state.isTransitioning}`)

state.state.slots.forEach(slot => {
  console.log(`\n${slot.slot} slot:`)
  console.log(`  - Visible: ${slot.visible}`)
  console.log(`  - Components: ${slot.componentCount}`)
  slot.components.forEach(c => {
    console.log(`    - ${c.componentId} (${c.lifecycle}, priority: ${c.priority})`)
  })
})
```

### Example 4: Check Slot Capacity

```typescript
const state = await get_layout_state({})

// Check if hero slot is at capacity (max 1)
const heroSlot = state.state.slots.find(s => s.slot === 'hero')
if (heroSlot && heroSlot.componentCount >= 1) {
  console.log('Hero slot is full, new component will replace existing')
}
```

## Common Patterns

### Pattern 1: Conditional Layout Changes

```typescript
const state = await get_layout_state({})

// Only change intent if different
if (state.state.currentIntent !== 'dashboard') {
  await set_layout_intent({ intent: 'dashboard' })
}

// Then render components
await render_manifest({
  components: [...]
})
```

### Pattern 2: Component Existence Check

```typescript
const state = await get_layout_state({})

// Check if a specific component is already mounted
const hasNavigation = state.state.slots
  .find(s => s.slot === 'navigation')
  ?.components.some(c => c.componentId === 'main-nav')

if (!hasNavigation) {
  await render_manifest({
    components: [
      {
        componentId: "main-nav",
        slot: "navigation",
        lifecycle: "persistent"
      }
    ]
  })
}
```

### Pattern 3: Layout State Reporting

```typescript
const state = await get_layout_state({})

// Generate human-readable report
const report = {
  layout: state.state.currentIntent,
  device: state.state.breakpoint,
  totalComponents: state.state.slots.reduce((sum, s) => sum + s.componentCount, 0),
  activeSlots: state.state.slots.map(s => s.slot),
  persistentComponents: state.state.slots
    .flatMap(s => s.components)
    .filter(c => c.lifecycle === 'persistent')
    .map(c => c.componentId)
}

console.log('Layout Report:', report)
```

## Interpretation Guide

### Intent States

- **focus**: Single-content view, minimal UI
- **dashboard**: Multi-widget overview
- **compare**: Side-by-side comparison
- **hero-detail**: List with preview
- **timeline**: Chronological feed
- **spatial**: Map/canvas view
- **wizard**: Step-by-step flow
- **canvas**: Creative workspace
- **split**: Multi-document parallel
- **tabs**: Tabbed organization
- **modal-over**: Modal overlays
- **grid-explore**: Gallery browsing

### Breakpoints

- **mobile**: < 640px width
- **tablet**: 640px - 1024px
- **desktop**: 1024px - 1920px
- **wide**: > 1920px

### Lifecycle Meanings

- **persistent**: Survives intent changes (e.g., navigation)
- **ephemeral**: Cleared on intent change (e.g., content)
- **ambient**: Auto-expires after TTL (e.g., notifications)

## Related Tools

- **set_layout_intent**: Change layout intent
- **render_manifest**: Mount components into slots

## Notes

- Only visible slots are returned (based on current intent)
- Component IDs are unique instance IDs (not just component types)
- Empty slots are included if they're visible
- Transitioning state is temporary (duration varies by intent)
- Breakpoint is detected automatically based on viewport size
