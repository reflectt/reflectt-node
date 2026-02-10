# set_ui_layout

**Category**: `ui`  
**Type**: Streaming UI Control Tool

## Overview

`set_ui_layout` orchestrates the spatial arrangement of content across the application. Control layout modes (standard/split/sidebar-focus/fullscreen), adjust split ratios, configure slot visibility, and display top banners. Layout changes stream in real-time for smooth transitions.

## When to Use

- **Deep-dive analysis**: Switch to split view (dashboard + metrics side-by-side)
- **Immersive experiences**: Fullscreen mode for galleries, workflows, visualizations
- **Critical alerts**: Top banner for important announcements
- **Focus mode**: Sidebar-focus to emphasize tools/components
- **Compare views**: Split mode with adjustable ratio
- **Progressive revelation**: Standard → split → fullscreen as user explores

## Layout Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `standard` | Chat-first with optional sidebar (default) | Normal conversation |
| `split` | Chat + primary/secondary panes side-by-side | Multi-pane analysis |
| `sidebar-focus` | Sidebar emphasized, chat collapsed | Tool exploration |
| `fullscreen` | Content panes only, chat hidden | Immersive experiences |

## Quick Examples

### Example 1: Split View for Analysis
```json
{
  "mode": "split",
  "splitRatio": 0.66,
  "slots": {
    "primary": { "visible": true },
    "secondary": { "visible": true },
    "sidebar": { "visible": true, "collapsed": false }
  },
  "animate": true
}
```
**AI**: "I've arranged the cost dashboard on the left with live metrics on the right."

### Example 2: Fullscreen Immersive
```json
{
  "mode": "fullscreen",
  "slots": {
    "primary": { "visible": true },
    "sidebar": { "visible": false }
  },
  "animate": true
}
```
**AI**: "Switching to fullscreen for an immersive view of your workflow board."

### Example 3: Critical Banner
```json
{
  "mode": "standard",
  "slots": {
    "top": { "visible": true }
  },
  "topBanner": {
    "message": "Budget exceeded by 24.8% - immediate action required",
    "severity": "error",
    "dismissable": false,
    "action": {
      "label": "Review Spending",
      "prompt": "show me detailed cost breakdown"
    }
  },
  "animate": true
}
```
**AI**: "I've added a critical alert banner. Click 'Review Spending' to dive deeper."

### Example 4: Equal Split Compare
```json
{
  "mode": "split",
  "splitRatio": 0.5,
  "slots": {
    "primary": { "visible": true },
    "secondary": { "visible": true }
  },
  "animate": true
}
```
**AI**: "Showing both agent registries side-by-side for comparison."

## Parameters

### mode (required)
- `standard`: Chat + optional sidebar
- `split`: Chat + primary + secondary panes
- `sidebar-focus`: Sidebar emphasized
- `fullscreen`: Content only (no chat)

### splitRatio (optional, default: 0.66)
- For `split` mode only
- Range: 0.1-0.9
- 0.66 = 2/3 left, 1/3 right
- 0.5 = equal split
- 0.7 = larger left pane

### slots (optional)
Configure slot visibility:
```json
{
  "sidebar": { "visible": true, "collapsed": false },
  "top": { "visible": true },
  "primary": { "visible": true },
  "secondary": { "visible": true }
}
```

### topBanner (optional)
Top banner configuration (requires `slots.top.visible = true`):
```json
{
  "message": "Banner text (1-200 chars)",
  "severity": "info" | "success" | "warning" | "error",
  "dismissable": true,
  "action": {
    "label": "Button text",
    "prompt": "Prompt to send when clicked"
  }
}
```

### animate (optional, default: true)
Enable smooth transitions.

## Best Practices

✅ **Do:**
- Animate by default for smooth UX
- Use split mode for multi-pane analysis
- Use fullscreen for immersive focus
- Match banner severity to urgency
- Provide banner actions for next steps
- Narrate layout changes to users

❌ **Don't:**
- Don't change layout excessively
- Don't hide critical UI without reason
- Don't use fullscreen for simple tasks
- Don't make banners dismissable if critical

## Integration Patterns

### Progressive Deep-Dive
```typescript
// 1. Start standard
set_ui_layout({ mode: "standard" })

// 2. User asks question → split view
set_ui_layout({ mode: "split", splitRatio: 0.66 })
render_manifest({ slot: "primary", componentId: "cost:cost-dashboard" })
render_manifest({ slot: "secondary", componentId: "data:query-results-table" })

// 3. User wants focus → fullscreen
set_ui_layout({ mode: "fullscreen" })
```

### Alert + Dashboard
```typescript
set_ui_layout({
  mode: "split",
  slots: { top: { visible: true }, primary: { visible: true } },
  topBanner: {
    message: "Budget alert: $1,247 / $1,000",
    severity: "warning",
    action: { label: "View Details", prompt: "show cost breakdown" }
  }
})
render_manifest({ slot: "primary", componentId: "cost:cost-dashboard" })
```

## Output

### Success
```json
{
  "success": true,
  "layout_update": {
    "mode": "split",
    "splitRatio": 0.66,
    "slots": { ... },
    "animate": true,
    "timestamp": "2024-01-15T10:30:45.123Z"
  },
  "space_id": "global"
}
```

### Error
```json
{
  "success": false,
  "error": "Invalid mode: 'invalid-mode'. Must be one of: standard, split, sidebar-focus, fullscreen",
  "space_id": "global"
}
```

## Related Tools

- **render_manifest**: Mount components in slots after layout set
- **update_theme**: Match mood to layout (aurora for immersive)
- **show_notification**: Lighter alternative to top banner
- **patch_component_state**: Update components after layout change
