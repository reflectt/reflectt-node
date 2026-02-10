/**
 * Click Element Tool Implementation
 *
 * Simulates clicking interactive elements in rendered components.
 * Supports finding elements by CSS selector, data attributes, or text content.
 */

interface ClickElementInput {
  componentId: string
  elementSelector: string
  waitForResponse?: boolean
}

interface ClickElementResult {
  success: boolean
  elementClicked?: string
  error?: string
  availableElements?: string[]
}

/**
 * Get all clickable elements in a component for error reporting
 */
function getClickableElements(containerEl: Element): string[] {
  const clickable = containerEl.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="submit"], input[type="button"]'
  )

  return Array.from(clickable).map((el) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const dataAction = el.getAttribute('data-action')
      ? `[data-action="${el.getAttribute('data-action')}"]`
      : ''
    const ariaLabel = el.getAttribute('aria-label')
      ? `[aria-label="${el.getAttribute('aria-label')}"]`
      : ''
    const text = el.textContent?.trim().substring(0, 30) || ''

    return `${tag}${id}${dataAction}${ariaLabel} "${text}"`
  })
}

/**
 * Click Element Tool
 *
 * Finds and clicks an element within a specific component.
 */
export async function click_element(
  input: ClickElementInput
): Promise<ClickElementResult> {
  try {
    // Find component in DOM by module ID
    const componentEl = document.querySelector(
      `[data-module-id="${input.componentId}"]`
    )

    if (!componentEl) {
      return {
        success: false,
        error: `Component not found in DOM: ${input.componentId}. Make sure the component has been rendered with render_manifest.`,
      }
    }

    // Try to find element by selector
    let targetEl = componentEl.querySelector(input.elementSelector) as HTMLElement

    // If selector fails, try finding by text content
    if (!targetEl) {
      const buttons = componentEl.querySelectorAll(
        'button, a, [role="button"], [role="link"]'
      )
      const selectorLower = input.elementSelector.toLowerCase()

      targetEl = Array.from(buttons).find((el) =>
        el.textContent?.trim().toLowerCase().includes(selectorLower)
      ) as HTMLElement
    }

    // If still not found, return helpful error
    if (!targetEl) {
      const available = getClickableElements(componentEl)
      return {
        success: false,
        error: `Element not found: "${input.elementSelector}" in component ${input.componentId}`,
        availableElements: available,
      }
    }

    // Check if element is visible and enabled
    const style = window.getComputedStyle(targetEl)
    if (style.display === 'none' || style.visibility === 'hidden') {
      return {
        success: false,
        error: `Element is hidden: "${input.elementSelector}"`,
      }
    }

    if (targetEl.hasAttribute('disabled')) {
      return {
        success: false,
        error: `Element is disabled: "${input.elementSelector}"`,
      }
    }

    // Trigger click event
    targetEl.click()

    // Wait for response if requested
    if (input.waitForResponse !== false) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    return {
      success: true,
      elementClicked: input.elementSelector,
    }
  } catch (error) {
    return {
      success: false,
      error: `Error clicking element: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
