# Click Element Tool

Simulates clicking interactive elements in rendered components.

## Purpose

Allows AI to trigger user interactions programmatically, such as:
- Submitting forms
- Opening dialogs or drawers
- Navigating to different views
- Triggering actions like delete, save, or refresh
- Testing interactive workflows

## Usage

```typescript
// Click a button by data attribute
await click_element({
  componentId: 'form-1',
  elementSelector: 'button[data-action="submit"]'
})

// Click a button by text content
await click_element({
  componentId: 'dialog-1',
  elementSelector: 'Save Changes'
})

// Click immediately without waiting
await click_element({
  componentId: 'toolbar-1',
  elementSelector: '#refresh-btn',
  waitForResponse: false
})
```

## Parameters

- `componentId` (required): Module ID of the component containing the element
- `elementSelector` (required): CSS selector, data attribute, or button text
- `waitForResponse` (optional): Wait 500ms for component to respond (default: true)

## Finding Elements

The tool tries multiple strategies to find the element:

1. **CSS Selector**: Standard CSS selectors like `button`, `.class`, `#id`, `[data-action="submit"]`
2. **Data Attributes**: `[data-action="save"]`, `[data-testid="submit-btn"]`
3. **ARIA Labels**: `[aria-label="Close dialog"]`
4. **Text Content**: If selector fails, searches for buttons/links containing the text

## Error Handling

If the element is not found, the tool returns:
- Error message
- List of all clickable elements in the component for debugging

## Examples

```typescript
// Submit a form
await click_element({
  componentId: 'checkout-form',
  elementSelector: 'button[type="submit"]'
})

// Close a dialog by ARIA label
await click_element({
  componentId: 'confirmation-dialog',
  elementSelector: '[aria-label="Close"]'
})

// Click by visible text (fallback)
await click_element({
  componentId: 'toolbar',
  elementSelector: 'Export'
})

// Click a specific table row action
await click_element({
  componentId: 'users-table',
  elementSelector: 'button[data-row-id="123"][data-action="edit"]'
})
```

## Best Practices

1. Use specific selectors with data attributes for reliability
2. Check component is rendered before clicking
3. Use meaningful data attributes in your components for easier automation
4. Wait for responses when triggering async actions
5. Handle errors gracefully and report available elements
