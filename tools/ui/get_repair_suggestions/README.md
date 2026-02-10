# Get Repair Suggestions Tool

Get AI-powered repair suggestions for component errors with intelligent analysis and automatic fixes.

## Purpose

This tool analyzes component errors and provides actionable repair suggestions based on error patterns, component context, and best practices. It can optionally attempt automatic fixes for common issues, making error recovery faster and more reliable.

## Features

- Pattern-based error recognition
- Context-aware suggestions
- Automatic fix capabilities
- Confidence scoring for suggestions
- Detailed reasoning for each suggestion
- Error history tracking
- Severity classification
- Manual step-by-step guidance

## Usage Examples

### Basic Error Analysis

```typescript
{
  componentId: "table-1",
  errorMessage: "Component not rendering"
}
```

### With Error Type Specification

```typescript
{
  componentId: "form-1",
  errorMessage: "Required prop 'data' is missing",
  errorType: "props"
}
```

### With Auto-Fix Attempt

```typescript
{
  componentId: "table-results",
  errorMessage: "Performance degradation with 5000 items",
  errorType: "performance",
  autoFix: true
}
```

### Limited Suggestions

```typescript
{
  componentId: "chart-1",
  errorMessage: "Data loading failed",
  errorType: "data",
  maxSuggestions: 3
}
```

### Without Context (Faster)

```typescript
{
  componentId: "dialog-1",
  errorMessage: "Click handler not responding",
  errorType: "interaction",
  includeContext: false
}
```

## Output

```typescript
{
  success: true,
  suggestions: [
    {
      id: "enable-pagination",
      severity: "medium",
      description: "Enable pagination to improve performance",
      autoFixable: true,
      confidence: "90%",
      reasoning: [
        "Large datasets cause slow rendering",
        "Pagination reduces items per page",
        "Improves initial load time significantly"
      ],
      autoFix: {
        action: "patch_component_state",
        params: {
          propsPatch: { pageSize: 50, showPagination: true }
        }
      }
    },
    {
      id: "enable-virtualization",
      severity: "medium",
      description: "Enable virtualization for large lists",
      autoFixable: true,
      confidence: "95%",
      reasoning: [
        "Virtualization renders only visible items",
        "Dramatically improves performance for long lists",
        "Reduces memory usage"
      ]
    }
  ],
  autoFixAttempted: true,
  autoFixResult: {
    success: true,
    appliedFix: "enable-pagination"
  },
  errorAnalysis: {
    errorType: "performance",
    severity: "medium",
    affectedComponent: "table-results",
    timestamp: 1699123456789
  },
  context: {
    componentType: "DataTable",
    hasProps: true,
    hasState: true,
    recentErrors: 2
  }
}
```

## Error Types

### render
Component rendering failures, mount errors, or display issues.

**Example:**
```typescript
{
  errorType: "render",
  errorMessage: "Component failed to render"
}
```

### props
Missing, invalid, or incorrect prop types.

**Example:**
```typescript
{
  errorType: "props",
  errorMessage: "Required prop 'data' is undefined"
}
```

### data
Data loading failures, invalid data structures, or data sync issues.

**Example:**
```typescript
{
  errorType: "data",
  errorMessage: "Failed to load data from API"
}
```

### interaction
Event handler errors, click failures, or user interaction issues.

**Example:**
```typescript
{
  errorType: "interaction",
  errorMessage: "Button click handler not responding"
}
```

### performance
Slow rendering, lag, freezing, or resource issues.

**Example:**
```typescript
{
  errorType: "performance",
  errorMessage: "Table rendering is slow with 10000 rows"
}
```

## Suggestion Severity Levels

- **critical**: Component cannot function (requires immediate fix)
- **high**: Major functionality impaired (fix soon)
- **medium**: Noticeable issues (fix when convenient)
- **low**: Minor issues or optimizations (nice to have)

## Auto-Fix Capabilities

The tool can automatically fix these common issues:

1. **Performance Issues**
   - Enable pagination
   - Enable virtualization
   - Reduce page size

2. **Visibility Issues**
   - Expand collapsed slots
   - Show hidden components

3. **State Issues**
   - Refresh component state
   - Reset to defaults

4. **Interaction Issues**
   - Enable disabled elements
   - Fix event handlers

## Error Recovery Workflow

### 1. Detect Error

```typescript
// Component fails to render or shows error
```

### 2. Get Suggestions

```typescript
const result = await get_repair_suggestions({
  componentId: "table-1",
  errorMessage: "Component not rendering",
  errorType: "render"
})
```

### 3. Review Suggestions

```typescript
result.suggestions.forEach(suggestion => {
  console.log(`${suggestion.severity}: ${suggestion.description}`)
  console.log(`Confidence: ${suggestion.confidence}`)
  console.log('Reasoning:', suggestion.reasoning)
})
```

### 4. Apply Fix

```typescript
// Manual fix
if (suggestion.manualSteps) {
  suggestion.manualSteps.forEach(step => {
    console.log(`- ${step}`)
  })
}

// Or try auto-fix
const autoFixResult = await get_repair_suggestions({
  componentId: "table-1",
  errorMessage: "Component not rendering",
  autoFix: true
})
```

## Common Error Patterns

### Missing Required Props

**Error:** "Required prop 'data' is missing"

**Suggestions:**
- Add missing prop with correct type
- Review component documentation
- Use get_component_props to see all required props

### Component Not Rendering

**Error:** "Component not rendering"

**Suggestions:**
- Check if component is in collapsed slot
- Verify component meets render conditions
- Try recreating component

### Performance Degradation

**Error:** "Rendering is slow"

**Suggestions:**
- Enable pagination
- Enable virtualization
- Reduce data size

### Data Loading Failed

**Error:** "Failed to load data"

**Suggestions:**
- Retry data loading
- Verify data source configuration
- Check authentication

## Context Analysis

When `includeContext: true` (default), the tool examines:

- **Component Props**: Identifies null/undefined values, empty arrays/objects
- **Component State**: Checks for state inconsistencies
- **Component Type**: Provides type-specific suggestions
- **Error History**: Considers previous errors for patterns

## Performance Considerations

- With context: ~100-200ms (recommended)
- Without context: ~20-50ms (faster, less accurate)
- Auto-fix adds: ~50-100ms per fix attempt

## Limitations

- Suggestions are based on known patterns (may not cover all cases)
- Auto-fix only available for safe, common issues
- Some errors require manual debugging
- Context analysis requires component in DOM
- Error history limited to 50 most recent errors

## Integration with Other Tools

### With debug_component_render

```typescript
// First, debug the rendering
const debugInfo = await debug_component_render({
  componentId: "table-1"
})

// If errors found, get suggestions
if (debugInfo.issues.length > 0) {
  const suggestions = await get_repair_suggestions({
    componentId: "table-1",
    errorMessage: debugInfo.issues[0].description,
    errorType: "render"
  })
}
```

### With inspect_component_state

```typescript
// Inspect state first
const state = await inspect_component_state({
  componentId: "form-1"
})

// Get suggestions for state issues
const suggestions = await get_repair_suggestions({
  componentId: "form-1",
  errorMessage: "Form validation failing",
  errorType: "interaction"
})
```

### With screenshot_component

```typescript
// Capture error state
await screenshot_component({
  componentId: "table-1"
})

// Get repair suggestions
const suggestions = await get_repair_suggestions({
  componentId: "table-1",
  errorMessage: "Visual rendering issue"
})

// Apply fix and screenshot again
// Compare with compare_screenshots
```

## Error Statistics

Get overall error statistics:

```typescript
import { getErrorStatistics } from './implementation'

const stats = getErrorStatistics()
// {
//   totalErrors: 15,
//   errorsByType: { render: 5, props: 7, data: 3 },
//   errorsByComponent: { "table-1": 8, "form-1": 7 },
//   commonErrors: [
//     { message: "Component not rendering", count: 5 },
//     { message: "Missing required prop", count: 3 }
//   ]
// }
```

## Best Practices

1. **Specify Error Type**: Provides more targeted suggestions
2. **Include Context**: More accurate analysis (default)
3. **Try Auto-Fix First**: Safe and fast for common issues
4. **Review Reasoning**: Understand why suggestions are made
5. **Check Confidence**: Prioritize high-confidence suggestions
6. **Use Error History**: Identify recurring issues

## Related Tools

- `debug_component_render`: Debug rendering issues
- `inspect_component_state`: Examine component state/props
- `get_component_props`: View component prop requirements
- `screenshot_component`: Document error states
- `patch_component_state`: Apply manual fixes
