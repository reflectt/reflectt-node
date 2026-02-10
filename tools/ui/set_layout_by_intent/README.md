# set_layout_by_intent

Set layout based on user intent instead of explicit mode. The system intelligently chooses the optimal layout based on what you're trying to accomplish.

## Intent Types

- **analyze**: Deep dive into data
  - Small datasets → Split view (data + tools)
  - Large datasets → Dashboard (multiple metrics)
  - Mobile → Feed (vertical scrolling)

- **compare**: Side-by-side comparison
  - → Split view (equal space, easy eye movement)

- **explore**: Browse and discover
  - Many items → Dashboard (grid browsing)
  - Mobile → Feed (vertical scrolling)
  - Desktop → Master-detail (list + preview)

- **focus**: Concentrate on single item
  - → Fullscreen (removes distractions)

- **present**: Show to others
  - Single item → Fullscreen (clean presentation)
  - Multiple items → Dashboard (organized grid)

- **edit**: Modify content
  - Admin/complex → Three-column (IDE-style)
  - Simple → Split (edit + preview)

- **monitor**: Watch live updates
  - Many metrics → Dashboard (multiple indicators)
  - Activity feed → Feed (chronological)

- **collaborate**: Work with others
  - Task management → Board (Kanban columns)
  - General → Dashboard (shared workspace)

## Context

Optional context helps refine the layout selection:

- **dataVolume**: `small` | `medium` | `large`
- **timeConstraint**: `quick` | `detailed`
- **userRole**: `viewer` | `editor` | `admin`

The system also automatically detects:
- Device type (mobile/tablet/desktop)
- Component count and types
- Current viewport size

## Examples

```typescript
// Deep analysis of data
{
  intent: "analyze",
  context: {
    dataVolume: "large"
  }
}
// → Dashboard layout

// Compare two reports
{
  intent: "compare"
}
// → Split layout

// Focus on single document
{
  intent: "focus"
}
// → Fullscreen layout

// Edit content as admin
{
  intent: "edit",
  context: {
    userRole: "admin"
  }
}
// → Three-column layout

// Monitor live metrics
{
  intent: "monitor",
  context: {
    dataVolume: "large"
  }
}
// → Dashboard layout
```

## Response

The tool returns:

```typescript
{
  success: true,
  layout_update: {
    mode: "dashboard",
    animate: true,
    timestamp: "2024-01-01T00:00:00Z"
  },
  intent_analysis: {
    intent: "analyze",
    selectedMode: "dashboard",
    reasoning: [
      "Multiple analysis views needed",
      "Dashboard organizes metrics effectively",
      "Quick overview of all data points"
    ],
    confidence: 0.85,
    alternatives: [
      {
        mode: "three-column",
        reasoning: ["Alternative: IDE-style for deep analysis"],
        confidence: 0.7
      }
    ]
  }
}
```

## Benefits

- **Intuitive**: Specify what you want to do, not how to do it
- **Adaptive**: Considers device, data, and user context
- **Transparent**: Explains reasoning for layout choice
- **Smart**: Suggests alternatives if confidence is moderate
- **Consistent**: Uses proven patterns for each intent

## Integration

This tool uses the `LayoutAnalyzer.selectLayoutByIntent()` method which:
1. Analyzes the user's intent
2. Gathers context (components, device, data volume)
3. Applies intent-specific heuristics
4. Returns best layout with reasoning and confidence

The layout is then applied automatically via the streaming UI system.
