/**
 * Fill Form Tool Implementation
 *
 * Fills out form fields and optionally submits the form.
 * Supports text inputs, textareas, selects, checkboxes, and radio buttons.
 */

interface FillFormInput {
  componentId: string
  fields: Record<string, any>
  submit?: boolean
}

interface FillFormResult {
  success: boolean
  fieldsFilled?: string[]
  errors?: string[]
  submitted?: boolean
}

/**
 * Set value for different input types
 */
function setFieldValue(field: HTMLElement, value: any): boolean {
  try {
    if (field instanceof HTMLInputElement) {
      if (field.type === 'checkbox') {
        field.checked = Boolean(value)
        field.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      } else if (field.type === 'radio') {
        // For radio buttons, we need to find the radio with the matching value
        const form = field.closest('form') || field.closest('[data-module-id]')
        if (form) {
          const radio = form.querySelector(
            `input[name="${field.name}"][value="${value}"]`
          ) as HTMLInputElement
          if (radio) {
            radio.checked = true
            radio.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          }
        }
        return false
      } else {
        field.value = String(value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
        field.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
    } else if (field instanceof HTMLTextAreaElement) {
      field.value = String(value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    } else if (field instanceof HTMLSelectElement) {
      field.value = String(value)
      field.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }

    return false
  } catch (error) {
    console.error(`Error setting field value:`, error)
    return false
  }
}

/**
 * Fill Form Tool
 *
 * Fills out form fields by name or data-field attribute.
 */
export async function fill_form(input: FillFormInput): Promise<FillFormResult> {
  try {
    // Find form component in DOM
    const formEl = document.querySelector(
      `[data-module-id="${input.componentId}"]`
    )

    if (!formEl) {
      return {
        success: false,
        errors: [
          `Form component not found: ${input.componentId}. Make sure the component has been rendered with render_manifest.`,
        ],
      }
    }

    const filled: string[] = []
    const errors: string[] = []

    // Fill each field
    for (const [fieldName, value] of Object.entries(input.fields)) {
      // Try finding by name attribute first
      let field = formEl.querySelector(
        `input[name="${fieldName}"], textarea[name="${fieldName}"], select[name="${fieldName}"]`
      ) as HTMLElement

      // If not found, try data-field attribute
      if (!field) {
        field = formEl.querySelector(
          `[data-field="${fieldName}"]`
        ) as HTMLElement
      }

      // If still not found, try id
      if (!field) {
        field = formEl.querySelector(`#${fieldName}`) as HTMLElement
      }

      if (!field) {
        errors.push(`Field not found: "${fieldName}"`)
        continue
      }

      // Set the value based on field type
      const success = setFieldValue(field, value)

      if (success) {
        filled.push(fieldName)
      } else {
        errors.push(`Failed to set value for field: "${fieldName}"`)
      }
    }

    // Submit if requested
    let submitted = false
    if (input.submit) {
      // Try finding submit button
      const submitBtn = formEl.querySelector(
        'button[type="submit"], input[type="submit"], button[data-action="submit"]'
      ) as HTMLButtonElement

      if (submitBtn) {
        submitBtn.click()
        submitted = true
        // Wait for submission to process
        await new Promise((resolve) => setTimeout(resolve, 500))
      } else {
        // Try triggering form submit event
        const form = formEl.querySelector('form') as HTMLFormElement
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          submitted = true
          await new Promise((resolve) => setTimeout(resolve, 500))
        } else {
          errors.push('Submit requested but no submit button or form element found')
        }
      }
    }

    return {
      success: errors.length === 0,
      fieldsFilled: filled,
      errors: errors.length > 0 ? errors : undefined,
      submitted,
    }
  } catch (error) {
    return {
      success: false,
      errors: [
        `Error filling form: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
}
