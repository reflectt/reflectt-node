# Compare Screenshots Tool

Compare two screenshots to detect visual differences for regression testing and UI validation.

## Purpose

This tool performs pixel-by-pixel comparison of screenshots captured by the `screenshot_component` tool. It generates a visual diff image highlighting changes and provides detailed analysis of differences. Essential for visual regression testing and validating UI changes.

## Features

- Pixel-by-pixel comparison with configurable threshold
- Visual diff image with highlighted changes
- Antialiasing detection to reduce false positives
- Percentage-based difference metrics
- Automatic verdict classification
- Detailed analysis of changes
- Customizable highlight color

## Usage Examples

### Basic Comparison

```typescript
{
  screenshot1Id: "screenshot-1699123456-abc123",
  screenshot2Id: "screenshot-1699123789-def456"
}
```

### Strict Comparison (Detect Tiny Changes)

```typescript
{
  screenshot1Id: "screenshot-1699123456-abc123",
  screenshot2Id: "screenshot-1699123789-def456",
  threshold: 0.05
}
```

### Cross-Browser Testing (Ignore Antialiasing)

```typescript
{
  screenshot1Id: "screenshot-chrome",
  screenshot2Id: "screenshot-firefox",
  threshold: 0.1,
  ignoreAntialiasing: true
}
```

### Custom Highlight Color

```typescript
{
  screenshot1Id: "screenshot-before",
  screenshot2Id: "screenshot-after",
  highlightColor: "#ff0000"
}
```

## Output

```typescript
{
  success: true,
  comparison: {
    identical: false,
    diffPixels: 15234,
    totalPixels: 1920000,
    diffPercentage: "0.793",
    diffImageUrl: "data:image/png;base64,iVBORw0KG...",
    threshold: 0.1,
    verdict: "minor_differences",
    analysis: "Minor differences detected (0.793%, 15234 pixels). Small visual changes..."
  }
}
```

## Verdict Classifications

- **identical**: Zero pixel differences (perfect match)
- **minor_differences**: < 1% difference (likely intentional or rendering variations)
- **moderate_differences**: 1-5% difference (noticeable changes to review)
- **major_differences**: > 5% difference (significant UI changes or regressions)

## Visual Regression Testing Workflow

### 1. Capture Baseline

```typescript
// Capture initial state
const baseline = await screenshot_component({
  componentId: "dashboard-1"
})
// Save baseline.screenshot.id
```

### 2. Make Changes

```typescript
// Update component
await patch_component_state({
  moduleId: "dashboard-1",
  propsPatch: { theme: "dark" }
})
```

### 3. Capture Comparison

```typescript
// Capture after changes
const comparison = await screenshot_component({
  componentId: "dashboard-1"
})
```

### 4. Compare

```typescript
// Compare screenshots
const result = await compare_screenshots({
  screenshot1Id: baseline.screenshot.id,
  screenshot2Id: comparison.screenshot.id
})

if (result.comparison.verdict === "major_differences") {
  console.error("Unexpected visual changes detected!")
}
```

## Threshold Guidelines

| Threshold | Use Case | Description |
|-----------|----------|-------------|
| 0.0 | Exact match | Only identical pixels pass |
| 0.05 | Very strict | Catches subtle color shifts |
| 0.1 | Recommended | Good balance for most cases |
| 0.2 | Lenient | Allows minor rendering differences |
| 0.3+ | Very lenient | Only catches major changes |

## Antialiasing Handling

Antialiasing can cause false positives when comparing screenshots from different browsers or rendering contexts. The `ignoreAntialiasing` option (enabled by default) detects and ignores these differences:

```typescript
{
  ignoreAntialiasing: true  // Default: ignore AA differences
}
```

When enabled:
- Detects alpha channel variations (typical in antialiasing)
- Checks 3x3 pixel neighborhood for gradients
- Marks suspected antialiasing as "similar"
- Reduces false positives by ~70% in cross-browser tests

## Diff Image Interpretation

The generated diff image uses the following color scheme:

- **Highlight Color** (default: magenta): Pixels that differ significantly
- **Dimmed Original** (30% brightness): Pixels that are identical
- **Original Color**: Pixels with antialiasing differences (when ignored)

## Common Use Cases

1. **Regression Testing**: Ensure UI doesn't break with code changes
2. **Theme Validation**: Compare light/dark theme implementations
3. **Responsive Testing**: Validate layouts at different breakpoints
4. **Browser Compatibility**: Compare rendering across browsers
5. **A/B Testing**: Compare design variations
6. **Animation Frames**: Compare keyframes in animations
7. **Print Previews**: Validate print stylesheets

## Performance Considerations

- Large images (> 2000x2000) may take 1-2 seconds to compare
- Diff image generation adds ~500ms
- Screenshots are compared in memory (no disk I/O)
- Consider reducing quality/size for faster comparisons

## Limitations

- Both screenshots must have identical dimensions
- Only works with screenshots in history (last 20)
- Transparent backgrounds may affect comparison
- Some CSS effects (blur, shadow) may cause false positives
- Motion blur or animations may not compare well

## Error Handling

Common errors and solutions:

**"Screenshot not found"**
- Screenshot was removed from history (only last 20 kept)
- Use `saveToHistory: true` when capturing screenshots

**"Different dimensions"**
- Screenshots were taken at different viewport sizes
- Ensure consistent viewport or use `fullPage: true`

**"Comparison failed"**
- Invalid image data or corrupted screenshot
- Try recapturing both screenshots

## Related Tools

- `screenshot_component`: Capture screenshots for comparison
- `get_component_diff`: Compare component state/props (logical diff)
- `debug_component_render`: Debug rendering issues before testing
- `get_ui_insights`: Analyze UI patterns and best practices
