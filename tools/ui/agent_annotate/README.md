# agent_annotate

Show floating annotation bubbles to narrate your actions in real-time.

## Purpose

Creates a guided tour experience where the AI explains what it's doing as it works. Perfect for:
- Narrating data analysis ("Analyzing your workflow metrics...")
- Highlighting findings ("Found 3 critical alerts!")
- Explaining component choices ("Building a chart to show trends")
- Providing context ("This data comes from your CRM")
- Celebrating success ("This campaign is crushing targets!")

## Usage

```typescript
// Screen-level narration (general updates)
agent_annotate({
  message: "Loading your portal experience...",
  target: { type: "screen" },
  severity: "working",
  duration: 2000
})

// Point at a slot while working
agent_annotate({
  message: "Analyzing workflow data from your database...",
  target: { type: "slot", slot: "primary" },
  icon: "🔍",
  severity: "working",
  duration: 3000
})

// Point at specific component after rendering
agent_annotate({
  message: "Notice this spike in conversions - up 25% this week!",
  target: { type: "module", slot: "primary", moduleId: "stat-grid-123" },
  icon: "✨",
  severity: "insight",
  duration: 5000
})

// Highlight an issue
agent_annotate({
  message: "Found 3 critical alerts that need your attention",
  target: { type: "module", slot: "sidebar", moduleId: "notification-center-456" },
  icon: "⚠️",
  severity: "warning",
  duration: 4000
})
```

## Best Practices

1. **Use during generation**: Call this as you work to narrate the process
2. **Keep it concise**: 1-2 sentences max
3. **Choose severity wisely**:
   - `working` = In progress (purple, animated)
   - `info` = General information (blue)
   - `insight` = Interesting finding (amber)
   - `success` = Positive outcome (green)
   - `warning` = Needs attention (red)
4. **Timing matters**: Use 2-3s for quick updates, 4-5s for insights worth reading
5. **Don't spam**: Use strategically for key moments, not every action

## Integration

Works in both:
- **Portal generation**: Narrate as you build the portal
- **Chat responses**: Explain as you render components

Annotations appear as floating bubbles that:
- Point at their target with an arrow
- Auto-dismiss after duration
- Can be manually closed if dismissable
- Stack nicely if multiple are shown

## Examples in Context

```typescript
// Portal generation flow
agent_annotate({ message: "Starting portal generation...", target: { type: "screen" } })

// Query data
agent_annotate({
  message: "Pulling live workflow metrics from your database...",
  target: { type: "slot", slot: "primary" },
  icon: "🔍",
  severity: "working"
})

// Render component
render_manifest({ ... stat-grid ... })

// Highlight insight
agent_annotate({
  message: "4 workflows running - 1 needs attention",
  target: { type: "module", slot: "primary", moduleId: "stat-grid" },
  icon: "💡",
  severity: "insight",
  duration: 5000
})
```
