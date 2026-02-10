/**
 * Validate Component Render Tool Implementation
 *
 * Validates that a component has rendered successfully with correct props and data.
 * Waits for component to mount, checks visibility, and validates props and data.
 */

import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface ValidateComponentRenderInput {
  componentId: string
  expectedProps?: Record<string, any>
  expectedData?: Record<string, any>
  timeout?: number
}

interface ValidationResult {
  mounted: boolean
  visible: boolean
  propsMatch: boolean
  dataMatch: boolean
  errors: string[]
}

interface ValidateComponentRenderSuccess {
  success: true
  componentId: string
  validation: ValidationResult
  details?: {
    actualProps?: Record<string, any>
    actualData?: any
    slot?: string
    componentType?: string
  }
}

interface ValidateComponentRenderFailure {
  success: false
  error: string
}

type ValidateComponentRenderOutput =
  | ValidateComponentRenderSuccess
  | ValidateComponentRenderFailure

/**
 * Find module by ID in layout store
 */
function findModuleById(componentId: string, slots: any): {
  module: any
  slot: string
  slotVisible: boolean
} | null {
  for (const [slotName, slotConfig] of Object.entries<any>(slots)) {
    const modules = slotConfig.modules || []
    const module = modules.find((m: any) => m.id === componentId)

    if (module) {
      return {
        module,
        slot: slotName,
        slotVisible: slotConfig.visible !== false
      }
    }
  }

  return null
}

/**
 * Check if element is visible in viewport
 */
function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  const computedStyle = window.getComputedStyle(element)

  // Check basic visibility
  if (
    computedStyle.display === 'none' ||
    computedStyle.visibility === 'hidden' ||
    computedStyle.opacity === '0'
  ) {
    return false
  }

  // Check if element has dimensions
  if (rect.width === 0 || rect.height === 0) {
    return false
  }

  return true
}

/**
 * Wait for component to mount in DOM
 */
async function waitForComponent(
  componentId: string,
  timeout: number
): Promise<Element | null> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    // Try multiple selectors
    const selectors = [
      `[data-component-id="${componentId}"]`,
      `[data-module-id="${componentId}"]`,
      `#${componentId}`
    ]

    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element) {
        return element
      }
    }

    // Wait 100ms before checking again
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return null
}

/**
 * Deep equality check for objects
 */
function deepEqual(a: any, b: any): boolean {
  // Handle primitives and null
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return false

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((val, idx) => deepEqual(val, b[idx]))
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length !== keysB.length) return false

    return keysA.every((key) => deepEqual(a[key], b[key]))
  }

  return false
}

/**
 * Validate props match
 */
function validateProps(
  expectedProps: Record<string, any>,
  actualProps: Record<string, any> | undefined
): { match: boolean; errors: string[] } {
  const errors: string[] = []

  if (!actualProps) {
    return {
      match: false,
      errors: ['Component has no props']
    }
  }

  for (const [key, expectedValue] of Object.entries(expectedProps)) {
    const actualValue = actualProps[key]

    if (!deepEqual(actualValue, expectedValue)) {
      const expected = JSON.stringify(expectedValue)
      const actual = JSON.stringify(actualValue)
      errors.push(
        `Prop "${key}" mismatch: expected ${expected}, got ${actual}`
      )
    }
  }

  return {
    match: errors.length === 0,
    errors
  }
}

/**
 * Validate data match
 */
function validateData(
  expectedData: Record<string, any>,
  context: any
): { match: boolean; errors: string[] } {
  const errors: string[] = []

  if (!context?.data) {
    return {
      match: false,
      errors: ['Component has no context data']
    }
  }

  for (const [key, expectedValue] of Object.entries(expectedData)) {
    const actualValue = context.data[key]

    if (!deepEqual(actualValue, expectedValue)) {
      const expected = JSON.stringify(expectedValue)
      const actual = JSON.stringify(actualValue)
      errors.push(
        `Data "${key}" mismatch: expected ${expected}, got ${actual}`
      )
    }
  }

  return {
    match: errors.length === 0,
    errors
  }
}

export default async function validateComponentRender(
  input: ValidateComponentRenderInput,
  ctx: ToolContext
): Promise<ValidateComponentRenderOutput> {
  try {
    const { componentId, expectedProps, expectedData, timeout = 5000 } = input

    const errors: string[] = []
    let mounted = false
    let visible = false
    let propsMatch = true
    let dataMatch = true

    // Wait for component to mount
    const element = await waitForComponent(componentId, timeout)

    if (!element) {
      return {
        success: true,
        componentId,
        validation: {
          mounted: false,
          visible: false,
          propsMatch: false,
          dataMatch: false,
          errors: [
            `Component did not mount within ${timeout}ms timeout. Check if component ID is correct and component is being rendered.`
          ]
        }
      }
    }

    mounted = true

    // Check visibility
    visible = isElementVisible(element)
    if (!visible) {
      errors.push(
        'Component is mounted but not visible. Check CSS styles and slot visibility.'
      )
    }

    // Get module from layout store
    const layoutState = useLayoutStore.getState()
    const moduleInfo = findModuleById(componentId, layoutState.slots)

    if (!moduleInfo) {
      errors.push(
        'Component element found in DOM but not registered in layout store. This may indicate a rendering issue.'
      )
    }

    const module = moduleInfo?.module
    const context = contextBus.getContext(componentId)

    // Validate props if expected
    if (expectedProps && module) {
      const propsValidation = validateProps(expectedProps, module.props)
      propsMatch = propsValidation.match
      if (!propsMatch) {
        errors.push(...propsValidation.errors)
      }
    } else if (expectedProps && !module) {
      propsMatch = false
      errors.push('Cannot validate props - component not found in layout store')
    }

    // Validate data if expected
    if (expectedData) {
      const dataValidation = validateData(expectedData, context)
      dataMatch = dataValidation.match
      if (!dataMatch) {
        errors.push(...dataValidation.errors)
      }
    }

    // Build success result
    const allValid = mounted && visible && propsMatch && dataMatch
    const validation: ValidationResult = {
      mounted,
      visible,
      propsMatch,
      dataMatch,
      errors
    }

    const result: ValidateComponentRenderSuccess = {
      success: true,
      componentId,
      validation
    }

    // Add details for debugging
    if (!allValid) {
      result.details = {
        actualProps: module?.props,
        actualData: context?.data,
        slot: moduleInfo?.slot,
        componentType: module?.componentId
      }
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
