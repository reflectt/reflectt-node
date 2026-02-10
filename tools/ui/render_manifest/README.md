# Render Manifest Tool

**Category**: UI Control
**Version**: 2.0.0
**Purpose**: Render components into semantic layout slots after setting layout intent.

## Overview

The `render_manifest` tool renders components into the UI using the semantic slot system. This tool should be called **AFTER** `set_layout_intent` to ensure components are placed in the correct layout pattern.

## Format

V2.0.0 uses a simplified, direct component array format with semantic slots:

```jsonc
{
  "components": [
    {
      "componentId": "cost-dashboard",
      "slot": "main",
      "props": { "period": "7d" },
      "lifecycle": "ephemeral",
      "size": "comfortable",
      "priority": 500
    }
  ]
}
```

## Semantic Slots

### Content Slots

#### `main`
- **Purpose**: Primary focus content
- **Max Components**: 10
- **Default Lifecycle**: ephemeral
- **Use Cases**: Documents, dashboards, primary views

#### `hero`
- **Purpose**: Page header/banner
- **Max Components**: 1 (enforced)
- **Default Lifecycle**: ephemeral
- **Use Cases**: Page titles, KPI summaries, breadcrumbs

#### `detail`
- **Purpose**: Inspector/properties panel
- **Max Components**: 5
- **Default Lifecycle**: ephemeral
- **Use Cases**: Detail views, property panels, previews

### Supporting Slots

#### `context`
- **Purpose**: Supporting info/sidebars
- **Max Components**: 3
- **Default Lifecycle**: persistent
- **Use Cases**: Filters, metadata, related items

#### `navigation`
- **Purpose**: Menus/breadcrumbs
- **Max Components**: 1
- **Default Lifecycle**: persistent
- **Use Cases**: Main navigation, breadcrumbs

#### `status`
- **Purpose**: Notifications/alerts
- **Max Components**: 5
- **Default Lifecycle**: ambient
- **Use Cases**: Toast notifications, status indicators

### Action & Overlay Slots

#### `actions`
- **Purpose**: Toolbars/FABs
- **Max Components**: 1
- **Default Lifecycle**: persistent
- **Use Cases**: Action buttons, toolbars

#### `overlay`
- **Purpose**: Modals/dialogs
- **Max Components**: 3
- **Default Lifecycle**: ephemeral
- **Use Cases**: Modals, dialogs, popovers

#### `background`
- **Purpose**: Ambient visuals
- **Max Components**: 1
- **Default Lifecycle**: ephemeral
- **Use Cases**: Background patterns, ambient effects

## Component Lifecycle

### `persistent`
- **Behavior**: Stays until explicitly removed
- **Use Cases**: Navigation, toolbars, persistent sidebars
- **Intent Changes**: Retained across intent changes

### `ephemeral`
- **Behavior**: Cleared on intent change
- **Use Cases**: Main content, temporary views
- **Intent Changes**: Automatically removed

### `ambient`
- **Behavior**: Auto-expires after TTL
- **Use Cases**: Notifications, temporary alerts
- **Intent Changes**: Removed if TTL expires

## Component Sizing

- **compact**: Small padding, reduced font size (p-3, text-sm)
- **comfortable**: Default comfortable spacing (p-6)
- **spacious**: Large padding, increased font size (p-8, text-lg)
- **fill**: No padding, fills container (p-0, w-full, h-full)

## Parameters (v2.0.0)

### `components` (recommended)
Array of components to render:

```typescript
{
  componentId: string        // Required: Component ID from registry
  slot: SemanticSlot         // Required: Target semantic slot
  props?: object             // Optional: Component props
  lifecycle?: string         // Optional: 'persistent' | 'ephemeral' | 'ambient'
  size?: string              // Optional: 'compact' | 'comfortable' | 'spacious' | 'fill'
  priority?: number          // Optional: 0-1000 (default 500)
  ttl?: number               // Optional: Time to live in ms (for ambient)
  label?: string             // Optional: Human-readable label
}
```

### Legacy Parameters

#### `render_manifest` (legacy)
Original format - still supported but deprecated.

#### `slotConfig` (legacy)
Batch operation format - use `components` array instead.

## Usage Examples

### Example 1: Dashboard (v2.0.0 Format)

```json
// Step 1: Set intent
{
  "intent": "dashboard"
}

// Step 2: Render components
{
  "components": [
    {
      "componentId": "kpi-grid",
      "slot": "hero",
      "props": { "metrics": ["revenue", "users", "conversion"] },
      "lifecycle": "ephemeral"
    },
    {
      "componentId": "sales-chart",
      "slot": "main",
      "props": { "period": "30d" },
      "lifecycle": "ephemeral",
      "size": "comfortable"
    },
    {
      "componentId": "filter-panel",
      "slot": "context",
      "props": { "filters": ["date", "region"] },
      "lifecycle": "persistent"
    }
  ]
}
```

### Example 2: Comparison View

```json
// Step 1: Set intent
{
  "intent": "compare"
}

// Step 2: Render components
{
  "components": [
    {
      "componentId": "document-viewer",
      "slot": "main",
      "props": { "docId": "v1", "title": "Version 1" }
    },
    {
      "componentId": "document-viewer",
      "slot": "detail",
      "props": { "docId": "v2", "title": "Version 2" }
    },
    {
      "componentId": "diff-toolbar",
      "slot": "actions",
      "props": { "mode": "unified" },
      "lifecycle": "persistent"
    }
  ]
}
```

### Example 3: Notifications (Ambient Lifecycle)

```json
{
  "components": [
    {
      "componentId": "toast-notification",
      "slot": "status",
      "props": {
        "message": "Changes saved successfully",
        "type": "success"
      },
      "lifecycle": "ambient",
      "ttl": 5000,
      "size": "compact"
    }
  ]
}
```

### Example 4: Wizard Flow

```json
// Step 1: Set intent
{
  "intent": "wizard"
}

// Step 2: Render components
{
  "components": [
    {
      "componentId": "progress-indicator",
      "slot": "hero",
      "props": { "currentStep": 2, "totalSteps": 5 },
      "lifecycle": "persistent"
    },
    {
      "componentId": "step-form",
      "slot": "main",
      "props": { "step": "billing", "data": {} }
    },
    {
      "componentId": "wizard-controls",
      "slot": "actions",
      "props": { "canGoBack": true, "canGoNext": false },
      "lifecycle": "persistent"
    }
  ]
}
```

## Component Priority

When a slot reaches its max component capacity, the lowest priority component is removed:

```json
{
  "components": [
    {
      "componentId": "banner-1",
      "slot": "hero",
      "priority": 800,  // High priority
      "props": { "type": "critical" }
    },
    {
      "componentId": "banner-2",
      "slot": "hero",
      "priority": 500,  // Normal priority - will be removed
      "props": { "type": "info" }
    }
  ]
}
```

Since `hero` slot has max 1 component, only `banner-1` (priority 800) will be rendered.

## Return Value

### Success Response (v2.0.0)

```typescript
{
  success: true,
  render_manifest: {
    type: "render_manifest",
    timestamp: 1699564800000,
    interactiveModules: [...]
  },
  mounted_components: [
    "cost-dashboard-1699564800000-abc123",
    "filter-panel-1699564800001-def456"
  ],
  space_id: "reflectt"
}
```

### Error Response

```typescript
{
  success: false,
  error: "Component not found: unknown-component",
  space_id: "reflectt",
  errorDetails: {
    type: "component_not_found",
    componentId: "unknown-component",
    suggestion: "Check component ID spelling..."
  }
}
```

## Workflow Best Practices

### 1. Always Set Intent First

```typescript
// BAD - No intent set
await render_manifest({ components: [...] })

// GOOD - Intent set first
await set_layout_intent({ intent: "dashboard" })
await render_manifest({ components: [...] })
```

### 2. Choose Appropriate Lifecycle

```typescript
// Navigation - persistent
{
  componentId: "main-nav",
  slot: "navigation",
  lifecycle: "persistent"  // Survives intent changes
}

// Content - ephemeral
{
  componentId: "article",
  slot: "main",
  lifecycle: "ephemeral"  // Cleared on intent change
}

// Notifications - ambient
{
  componentId: "toast",
  slot: "status",
  lifecycle: "ambient",  // Auto-expires
  ttl: 5000
}
```

### 3. Use Priority for Important Components

```typescript
{
  components: [
    {
      componentId: "critical-alert",
      slot: "hero",
      priority: 900,  // Ensure this shows even if slot is full
      props: { severity: "critical" }
    }
  ]
}
```

## Related Tools

- **set_layout_intent**: Set layout pattern before rendering (REQUIRED)
- **get_layout_state**: Inspect current layout and components

## Notes

- Always call `set_layout_intent` before `render_manifest`
- Component IDs must exist in the component registry
- Slot capacity is enforced - lowest priority components are removed
- Ephemeral components are cleared on intent change
- Persistent components survive intent changes
- Ambient components auto-expire after TTL
