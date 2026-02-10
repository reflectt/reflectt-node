# Create Nested Layout Tool

Create layouts within layouts (nested/composite layouts) for complex multi-level UI structures.

## Purpose

Enable complex UI patterns that combine multiple layout modes:
- Tabs inside dashboard cells
- Split views with tabbed details
- Accordions with split content
- Dashboard grids inside tabs
- Master-detail with tabbed detail views

## Usage

### Using Templates (Recommended)

Templates provide pre-configured common patterns:

```typescript
// Tabbed Dashboard - Multiple dashboards in tabs
{
  "parentSlot": "primary",
  "template": "tabbedDashboard",
  "label": "Analytics Dashboards",
  "templateConfig": {
    "tabLabels": ["Overview", "Sales", "Marketing", "Operations"]
  }
}

// Split with Tabs - Data on left, tabbed details on right
{
  "parentSlot": "primary",
  "template": "splitWithTabs",
  "label": "User Management",
  "templateConfig": {
    "leftLabel": "User List",
    "rightTabLabels": ["Profile", "Activity", "Settings", "Permissions"]
  }
}

// Accordion with Splits - Collapsible sections with split content
{
  "parentSlot": "primary",
  "template": "accordionWithSplits",
  "label": "Project Phases",
  "templateConfig": {
    "sectionTitles": ["Planning", "Development", "Testing", "Deployment"]
  }
}

// Dashboard in Tab - Dashboard grid inside a tab
{
  "parentSlot": "primary",
  "template": "dashboardInTab",
  "label": "Metrics Dashboard"
}

// Master-Detail with Tabs - List on left, tabbed details on right
{
  "parentSlot": "primary",
  "template": "masterDetailWithTabs",
  "label": "Product Catalog",
  "templateConfig": {
    "tabLabels": ["Overview", "Specifications", "Reviews", "Related"]
  }
}
```

### Manual Configuration

For custom nested layouts:

```typescript
// Tabs with custom configuration
{
  "parentSlot": "primary",
  "nestedMode": "tabs",
  "label": "Custom Tabs",
  "configuration": {
    "tabsConfig": {
      "tabs": [
        { "label": "Tab 1", "icon": "📊", "slot": "primary" },
        { "label": "Tab 2", "icon": "📈", "slot": "primary" },
        { "label": "Tab 3", "icon": "📉", "slot": "primary" }
      ],
      "position": "top"
    }
  }
}

// Accordion with custom sections
{
  "parentSlot": "secondary",
  "nestedMode": "accordion",
  "label": "Help Sections",
  "configuration": {
    "accordionConfig": {
      "sections": [
        { "title": "Getting Started", "icon": "🚀", "slot": "primary", "expanded": true },
        { "title": "Advanced Features", "icon": "⚡", "slot": "primary", "expanded": false },
        { "title": "Troubleshooting", "icon": "🔧", "slot": "primary", "expanded": false }
      ],
      "allowMultiple": false
    }
  }
}

// Split with custom ratio
{
  "parentSlot": "primary",
  "nestedMode": "split",
  "label": "Code & Preview",
  "configuration": {
    "splitRatio": 0.6
  }
}

// Dashboard nested layout
{
  "parentSlot": "primary",
  "nestedMode": "dashboard",
  "label": "Widget Grid"
}
```

## Supported Nested Modes

All layout modes can be nested:

- **tabs** - Tabbed interface
- **accordion** - Collapsible sections
- **split** - Split view with divider
- **dashboard** - Grid of widgets
- **master-detail** - List and detail panes
- **board** - Kanban-style columns
- **feed** - Vertical timeline
- **three-column** - IDE-style layout
- **app-shell** - Traditional app structure
- **standard** - Standard layout with sidebar

## Common Patterns

### Multi-Dashboard Application
```typescript
// Root: tabs mode
// Each tab: dashboard mode with widgets

{
  "parentSlot": "primary",
  "template": "tabbedDashboard",
  "templateConfig": {
    "tabLabels": ["Sales", "Marketing", "Operations", "Finance"]
  }
}
```

### Data Explorer
```typescript
// Root: split mode
// Left: data table
// Right: tabs with charts/details

{
  "parentSlot": "primary",
  "template": "splitWithTabs",
  "templateConfig": {
    "leftLabel": "Data",
    "rightTabLabels": ["Chart", "Details", "Export"]
  }
}
```

### Settings Panel
```typescript
// Root: accordion mode
// Each section: different settings group

{
  "parentSlot": "sidebar",
  "template": "accordionWithSplits",
  "templateConfig": {
    "sectionTitles": ["General", "Appearance", "Privacy", "Advanced"]
  }
}
```

### Product Catalog
```typescript
// Root: master-detail mode
// Left: product list
// Right: tabs with product info

{
  "parentSlot": "primary",
  "template": "masterDetailWithTabs",
  "templateConfig": {
    "tabLabels": ["Overview", "Specs", "Reviews", "Related"]
  }
}
```

## After Creating Nested Layout

After creating a nested layout, populate it with components:

1. Use `render_manifest` to add components to the nested layout's slots
2. Specify the nested slot path when mounting components
3. Use `set_ui_layout` to adjust nested layout configuration

Example workflow:
```typescript
// 1. Create nested layout
create_nested_layout({
  parentSlot: "primary",
  template: "tabbedDashboard",
  templateConfig: { tabLabels: ["Sales", "Marketing"] }
})

// 2. Add components to first tab
render_manifest({
  slot: "primary",
  // Components for first dashboard
})

// 3. Add components to second tab
render_manifest({
  slot: "primary",
  // Components for second dashboard
})
```

## Best Practices

1. **Use Templates First** - Templates handle common patterns correctly
2. **Label Clearly** - Give descriptive labels to nested layouts
3. **Limit Nesting Depth** - Avoid more than 2 levels of nesting
4. **Consider Mobile** - Nested layouts adapt but test responsiveness
5. **Populate Incrementally** - Add components after creating structure

## Limitations

- Maximum 2 levels of nesting recommended
- Some layout combinations may not make sense (e.g., tabs inside tabs)
- Performance impact with many nested components
- Mobile devices may show simplified versions

## Related Tools

- `set_ui_layout` - Change top-level layout mode
- `render_manifest` - Add components to slots
- `set_responsive_slots` - Configure mobile behavior
- `optimize_layout` - Get layout recommendations
