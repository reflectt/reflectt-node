# Fill Form Tool

Programmatically fills out form fields and optionally submits the form.

## Purpose

Allows AI to:
- Fill out forms automatically based on user data or context
- Test form workflows and validation
- Automate data entry tasks
- Pre-populate forms with known values
- Simulate user input for demonstrations

## Usage

```typescript
// Fill a contact form
await fill_form({
  componentId: 'contact-form',
  fields: {
    name: 'John Doe',
    email: 'john@example.com',
    message: 'Hello world!'
  }
})

// Fill and submit a form
await fill_form({
  componentId: 'signup-form',
  fields: {
    username: 'johndoe',
    email: 'john@example.com',
    password: 'secure123',
    terms: true
  },
  submit: true
})

// Fill a form with various field types
await fill_form({
  componentId: 'user-settings',
  fields: {
    displayName: 'John Doe',
    bio: 'Software developer',
    country: 'US',
    notifications: true,
    theme: 'dark'
  }
})
```

## Parameters

- `componentId` (required): Module ID of the form component
- `fields` (required): Object mapping field names to values
- `submit` (optional): Whether to submit the form after filling (default: false)

## Supported Field Types

### Text Inputs
```typescript
fields: {
  username: 'johndoe',
  email: 'john@example.com',
  age: '25'
}
```

### Textareas
```typescript
fields: {
  bio: 'A long description...',
  comment: 'This is a comment'
}
```

### Checkboxes
```typescript
fields: {
  subscribe: true,
  terms: true,
  marketing: false
}
```

### Radio Buttons
```typescript
fields: {
  gender: 'male',
  plan: 'premium'
}
```

### Select Dropdowns
```typescript
fields: {
  country: 'US',
  state: 'CA',
  category: 'technology'
}
```

## Field Matching

The tool tries multiple strategies to find fields:

1. **Name attribute**: `<input name="email" />`
2. **Data-field attribute**: `<input data-field="email" />`
3. **ID attribute**: `<input id="email" />`

## Form Submission

When `submit: true`:

1. Looks for submit button: `button[type="submit"]`, `input[type="submit"]`, `button[data-action="submit"]`
2. Falls back to triggering form's submit event
3. Waits 500ms for submission to process

## Error Handling

Returns detailed results:
- `fieldsFilled`: Array of successfully filled field names
- `errors`: Array of error messages for fields that couldn't be filled
- `submitted`: Whether the form was submitted

## Examples

### Contact Form
```typescript
await fill_form({
  componentId: 'contact-form-1',
  fields: {
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1-555-0123',
    subject: 'Product Inquiry',
    message: 'I am interested in your product...'
  },
  submit: true
})
```

### User Profile
```typescript
await fill_form({
  componentId: 'profile-settings',
  fields: {
    displayName: 'Jane Smith',
    bio: 'Product designer passionate about UX',
    website: 'https://janesmith.com',
    location: 'San Francisco, CA',
    emailNotifications: true,
    theme: 'light'
  }
})
```

### Search Filter
```typescript
await fill_form({
  componentId: 'search-filters',
  fields: {
    query: 'react components',
    category: 'development',
    minPrice: '10',
    maxPrice: '100',
    inStock: true
  }
})
```

## Best Practices

1. Use meaningful field names that match your form's name attributes
2. Provide type-appropriate values (booleans for checkboxes, strings for text)
3. Handle validation errors gracefully
4. Check the result to ensure all fields were filled successfully
5. Use data-field attributes for complex forms with dynamic field names
6. Test forms incrementally before submitting
