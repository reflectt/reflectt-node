# set_responsive_slots

Configure how slots behave at different screen sizes for responsive layouts.

## Purpose

This tool enables AI agents to create responsive layouts that adapt to different viewport sizes. Perfect for:
- **Mobile optimization**: Simplify layouts for small screens
- **Touch-friendly UI**: Convert complex layouts to drawer-based navigation
- **Progressive enhancement**: Add features as screen size increases
- **Responsive dashboards**: Adapt widget visibility to viewport
- **Multi-device experiences**: Consistent UX across all devices

## Parameters

### `mobile` (required)
Slot behavior on mobile devices (<768px).

Keys: `primary`, `secondary`, `sidebar`, `top`
Values: `visible`, `hidden`, `drawer`

### `tablet` (required)
Slot behavior on tablet devices (768-1023px).

Keys: `primary`, `secondary`, `sidebar`, `top`
Values: `visible`, `hidden`, `drawer`

### `desktop` (required)
Slot behavior on desktop devices (1024px+).

Keys: `primary`, `secondary`, `sidebar`, `top`
Values: `visible`, `hidden`, `drawer`

## Slot Behaviors

- **`visible`**: Slot is rendered inline at this screen size
- **`hidden`**: Slot is not rendered at this screen size
- **`drawer`**: Slot content is moved to a bottom drawer (mobile pattern)

## Example Usage

### Hide Sidebar on Mobile
```typescript
{
  "mobile": {
    "sidebar": "hidden"
  },
  "tablet": {
    "sidebar": "visible"
  },
  "desktop": {
    "sidebar": "visible"
  }
}
```

### Secondary as Drawer on Mobile
```typescript
{
  "mobile": {
    "secondary": "drawer"
  },
  "tablet": {
    "secondary": "visible"
  },
  "desktop": {
    "secondary": "visible"
  }
}
```

### Progressive Reveal Pattern
```typescript
{
  "mobile": {
    "sidebar": "hidden",
    "secondary": "hidden"
  },
  "tablet": {
    "sidebar": "hidden",
    "secondary": "visible"
  },
  "desktop": {
    "sidebar": "visible",
    "secondary": "visible"
  }
}
```

### Mobile-First Pattern
```typescript
{
  "mobile": {
    "primary": "visible",
    "secondary": "hidden",
    "sidebar": "hidden"
  },
  "tablet": {
    "primary": "visible",
    "secondary": "visible",
    "sidebar": "hidden"
  },
  "desktop": {
    "primary": "visible",
    "secondary": "visible",
    "sidebar": "visible"
  }
}
```

## Common Patterns

### Collapse Sidebar on Mobile
Perfect for apps with navigation sidebars that take too much space on mobile.

### Secondary as Drawer
Move secondary/detail content to a drawer on mobile for better focus.

### Progressive Reveal
Start minimal on mobile, progressively add features on tablet and desktop.

### Mobile-First
Show only essential content on mobile, enhance for larger screens.

## Implementation Notes

The responsive rules are stored in the layout store and automatically applied when the viewport size changes. The `useResponsiveSlots` hook listens to media queries and updates slot visibility accordingly.

The `drawer` behavior is a hint to the layout component that the slot should be rendered as a bottom drawer rather than inline. The actual drawer implementation is handled by the DynamicLayout component, which already has drawer support for mobile layouts.

## Browser Support

Uses standard CSS media queries supported by all modern browsers:
- Mobile: `(max-width: 767px)`
- Tablet: `(min-width: 768px) and (max-width: 1023px)`
- Desktop: `(min-width: 1024px)`

These breakpoints match Tailwind CSS defaults for consistency.
