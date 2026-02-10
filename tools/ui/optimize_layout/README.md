# Optimize Layout Tool

Analyzes the current UI layout state and provides actionable recommendations for improving UX, performance, mobile compatibility, and accessibility.

## Usage

```typescript
// General optimization analysis
const result = await optimizeLayout({
  focus: 'general'
})

// Focus on mobile compatibility
const mobileResult = await optimizeLayout({
  focus: 'mobile'
})

// Focus on performance
const perfResult = await optimizeLayout({
  focus: 'performance',
  applyRecommendations: true // Auto-apply safe optimizations
})
```

## Focus Areas

- **general**: Comprehensive analysis across all areas (default)
- **mobile**: Mobile-specific optimizations and compatibility checks
- **desktop**: Desktop layout optimization for large screens
- **performance**: Performance-focused analysis (component count, heavy components)
- **accessibility**: Accessibility and focus-related checks

## Response

```typescript
{
  success: boolean
  analysis: {
    issues: Array<{
      severity: 'error' | 'warning' | 'suggestion' | 'info'
      issue: string
      recommendation: string
      impact?: string
    }>
    optimizations: Array<{
      type: string
      action: string
      rationale: string
      safeToApply: boolean
    }>
  }
  applied?: string[] // If applyRecommendations=true
  recommendations?: Optimization[] // Top 5 recommendations
}
```

## Checks Performed

### Layout Issues
- Too many components in one slot (>3)
- Empty slots consuming screen space
- Layout mode mismatch (based on component types)

### Mobile Compatibility
- Three-column layouts on mobile
- Split layouts with multiple components
- Board layouts requiring horizontal scrolling

### Performance
- Too many components rendered simultaneously (>8)
- Multiple resource-intensive components (3D, video, games)
- Suggestions for tabs or lazy loading

### Desktop Optimization
- Underutilized screen space on large displays
- Suggestions for multi-column layouts

### Accessibility
- Deep component nesting
- Multiple components competing for attention
- Focus mode recommendations

## Safe Optimizations

When `applyRecommendations: true`, only safe optimizations are applied automatically:

- Hiding empty slots
- Other non-destructive changes

Layout changes always require explicit confirmation and are never auto-applied.
