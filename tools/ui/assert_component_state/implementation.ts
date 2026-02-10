/**
 * Assert Component State Tool Implementation
 *
 * Asserts that component state matches expectations.
 * Returns error if any assertion fails, making it ideal for testing workflows.
 */

import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface AssertComponentStateInput {
  componentId: string
  assertions: {
    exists?: boolean
    visible?: boolean
    hasData?: boolean
    rowCount?: number
    hasSelection?: boolean
    propEquals?: Record<string, any>
  }
}

interface AssertComponentStateSuccess {
  success: true
  message: string
  componentId: string
  assertionsPassed: number
}

interface AssertComponentStateFailure {
  success: false
  error: string
  failures: string[]
  componentId: string
}

type AssertComponentStateOutput =
  | AssertComponentStateSuccess
  | AssertComponentStateFailure

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
 * Get DOM element for component
 */
function getComponentElement(componentId: string): Element | null {
  if (typeof document === 'undefined') {
    return null
  }

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

export default async function assertComponentState(
  input: AssertComponentStateInput,
  ctx: ToolContext
): Promise<AssertComponentStateOutput> {
  try {
    const { componentId, assertions } = input
    const failures: string[] = []
    let assertionCount = 0

    // Get component data
    const layoutState = useLayoutStore.getState()
    const moduleInfo = findModuleById(componentId, layoutState.slots)
    const element = getComponentElement(componentId)
    const context = contextBus.getContext(componentId)

    // Assert exists
    if (assertions.exists !== undefined) {
      assertionCount++
      const exists = moduleInfo !== null

      if (exists !== assertions.exists) {
        if (assertions.exists) {
          failures.push(
            `Expected component to exist in layout store, but it was not found. Component may not have been rendered or may have been unmounted.`
          )
        } else {
          failures.push(
            `Expected component to NOT exist in layout store, but it was found in slot "${moduleInfo?.slot}".`
          )
        }
      }
    }

    // Assert visible
    if (assertions.visible !== undefined) {
      assertionCount++

      if (!element) {
        if (assertions.visible) {
          failures.push(
            `Expected component to be visible, but it is not mounted in DOM. Component may not have rendered yet.`
          )
        }
      } else {
        const visible = isElementVisible(element)

        if (visible !== assertions.visible) {
          if (assertions.visible) {
            failures.push(
              `Expected component to be visible, but it is hidden. Check CSS display, visibility, and opacity properties, or slot visibility.`
            )
          } else {
            failures.push(
              `Expected component to be hidden, but it is visible in DOM.`
            )
          }
        }
      }
    }

    // Assert has data
    if (assertions.hasData !== undefined) {
      assertionCount++
      const hasData = !!(
        context?.data &&
        (Array.isArray(context.data)
          ? context.data.length > 0
          : Object.keys(context.data).length > 0)
      )

      if (hasData !== assertions.hasData) {
        if (assertions.hasData) {
          failures.push(
            `Expected component to have data, but context data is ${context?.data ? 'empty' : 'null/undefined'}. Component may not have loaded data yet.`
          )
        } else {
          failures.push(
            `Expected component to have no data, but context contains data.`
          )
        }
      }
    }

    // Assert row count
    if (assertions.rowCount !== undefined) {
      assertionCount++
      const rowCount = Array.isArray(context?.data) ? context.data.length : 0

      if (rowCount !== assertions.rowCount) {
        failures.push(
          `Expected row count to be ${assertions.rowCount}, but got ${rowCount}. ${!Array.isArray(context?.data) ? 'Component data is not an array.' : ''}`
        )
      }
    }

    // Assert has selection
    if (assertions.hasSelection !== undefined) {
      assertionCount++
      const hasSelection = !!(
        context?.selection &&
        (Array.isArray(context.selection)
          ? context.selection.length > 0
          : true)
      )

      if (hasSelection !== assertions.hasSelection) {
        if (assertions.hasSelection) {
          failures.push(
            `Expected component to have active selection, but selection is ${context?.selection ? 'empty' : 'null/undefined'}. No items are selected.`
          )
        } else {
          failures.push(
            `Expected component to have no selection, but selection exists with ${Array.isArray(context?.selection) ? context.selection.length : 'data'}.`
          )
        }
      }
    }

    // Assert prop equals
    if (assertions.propEquals) {
      for (const [propKey, expectedValue] of Object.entries(
        assertions.propEquals
      )) {
        assertionCount++

        if (!moduleInfo) {
          failures.push(
            `Cannot check prop "${propKey}" - component not found in layout store.`
          )
          continue
        }

        const actualValue = moduleInfo.module?.props?.[propKey]

        if (!deepEqual(actualValue, expectedValue)) {
          const expected = JSON.stringify(expectedValue)
          const actual = JSON.stringify(actualValue)
          failures.push(
            `Expected prop "${propKey}" to equal ${expected}, but got ${actual}.`
          )
        }
      }
    }

    // Return result
    if (failures.length > 0) {
      return {
        success: false,
        error: `${failures.length} of ${assertionCount} assertions failed for component "${componentId}"`,
        failures,
        componentId
      }
    }

    return {
      success: true,
      message: `All ${assertionCount} assertions passed for component "${componentId}"`,
      componentId,
      assertionsPassed: assertionCount
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      failures: [formatError(error)],
      componentId: input.componentId
    }
  }
}
