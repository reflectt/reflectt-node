# Screenshot Component Tool

Capture screenshots of components or entire layouts for visual testing and debugging.

## Purpose

This tool enables visual testing and documentation by capturing high-quality screenshots of rendered components. Screenshots are automatically saved to a session history that can be used for visual regression testing with the `compare_screenshots` tool.

## Features

- Capture individual components or entire layouts
- Multiple image formats (PNG, JPEG, WebP)
- Configurable quality and resolution
- Full-page captures for scrollable content
- Automatic history management (keeps last 20)
- Retina quality (2x resolution)
- Transparent backgrounds
- CORS support for external images

## Usage Examples

### Basic Component Screenshot

```typescript
{
  componentId: "table-results"
}
```

### High-Quality PNG for Documentation

```typescript
{
  componentId: "dashboard-1",
  format: "png",
  quality: 1.0
}
```

### Full-Page Capture

```typescript
{
  componentId: "long-form-1",
  fullPage: true
}
```

### Entire Layout Capture

```typescript
{
  // No componentId captures entire layout
  format: "jpeg",
  quality: 0.85
}
```

### One-Off Screenshot (No History)

```typescript
{
  componentId: "dialog-1",
  saveToHistory: false
}
```

## Output

```typescript
{
  success: true,
  screenshot: {
    id: "screenshot-1699123456-abc123",
    dataUrl: "data:image/png;base64,iVBORw0KG...",
    dimensions: { width: 1600, height: 1200 },
    timestamp: 1699123456789,
    sizeKB: 245,
    format: "png"
  },
  historyCount: 5
}
```

## Visual Regression Testing Workflow

1. **Baseline**: Capture initial screenshot
   ```typescript
   screenshot_component({ componentId: "table-1" })
   // Note the returned ID
   ```

2. **Make Changes**: Modify component state or props
   ```typescript
   patch_component_state({
     moduleId: "table-1",
     propsPatch: { theme: "dark" }
   })
   ```

3. **Compare**: Capture new screenshot and compare
   ```typescript
   screenshot_component({ componentId: "table-1" })
   // Compare using IDs from both captures
   compare_screenshots({
     screenshot1Id: "screenshot-1699123456-abc123",
     screenshot2Id: "screenshot-1699123789-def456"
   })
   ```

## Technical Details

- Uses `html2canvas` library for DOM-to-canvas rendering
- Captures at 2x scale for retina displays
- Handles lazy-loaded images and cross-origin content
- Maximum 20 screenshots in session history
- Screenshot IDs are unique per session

## Common Use Cases

1. **Visual Regression Testing**: Compare before/after component changes
2. **Bug Documentation**: Capture and share UI issues
3. **Design Review**: Generate UI previews for stakeholders
4. **Test Artifacts**: Save test evidence for reports
5. **UI State Documentation**: Record component variations

## Limitations

- Large screenshots (full-page) may take several seconds
- Some CSS properties may not render perfectly (filters, transforms)
- WebGL/Canvas content may not capture correctly
- Extremely large pages may cause memory issues
- Screenshots are stored in memory (cleared on page reload)

## Related Tools

- `compare_screenshots`: Compare two screenshots for visual differences
- `get_component_diff`: Compare component state/props changes
- `debug_component_render`: Debug rendering issues before screenshots
