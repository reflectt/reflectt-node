/**
 * Component Diff Tool
 *
 * Compares current component state with previous state to identify changes.
 * Helps with debugging state mutations and understanding component evolution.
 */

import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface DiffInput {
  componentId: string
  compareToSnapshot?: string
}

interface PropChange {
  path: string
  type: 'added' | 'removed' | 'modified' | 'unchanged'
  oldValue?: any
  newValue?: any
}

interface ComponentDiff {
  props: PropChange[]
  slotChanged: {
    from: string
    to: string
  } | null
  summary: string
}

interface DiffResult {
  success: boolean
  componentId: string
  diff: ComponentDiff | null
  message?: string
  error?: string
}

/**
 * Find a module by ID in slots configuration
 */
function findModuleById(moduleId: string, slots: any): any | null {
  for (const slotConfig of Object.values(slots)) {
    const slot = slotConfig as any
    if (slot.modules && Array.isArray(slot.modules)) {
      const module = slot.modules.find((m: any) => m.id === moduleId)
      if (module) {
        return module
      }
    }
  }
  return null
}

/**
 * Find which slot a module is in
 */
function findSlotForModule(moduleId: string, slots: any): string | null {
  for (const [slotName, slotConfig] of Object.entries(slots)) {
    const slot = slotConfig as any
    if (slot.modules && Array.isArray(slot.modules)) {
      if (slot.modules.some((m: any) => m.id === moduleId)) {
        return slotName
      }
    }
  }
  return null
}

/**
 * Deep diff two objects and return changes
 */
function deepDiff(oldObj: any, newObj: any, path: string = ''): PropChange[] {
  const changes: PropChange[] = []

  // Handle null/undefined
  if (oldObj === null || oldObj === undefined) {
    if (newObj === null || newObj === undefined) {
      return changes
    }
    changes.push({
      path: path || 'root',
      type: 'added',
      newValue: newObj
    })
    return changes
  }

  if (newObj === null || newObj === undefined) {
    changes.push({
      path: path || 'root',
      type: 'removed',
      oldValue: oldObj
    })
    return changes
  }

  // Handle primitives
  if (typeof oldObj !== 'object' || typeof newObj !== 'object') {
    if (oldObj !== newObj) {
      changes.push({
        path: path || 'value',
        type: 'modified',
        oldValue: oldObj,
        newValue: newObj
      })
    }
    return changes
  }

  // Handle arrays
  if (Array.isArray(oldObj) && Array.isArray(newObj)) {
    if (oldObj.length !== newObj.length) {
      changes.push({
        path: path ? `${path}.length` : 'length',
        type: 'modified',
        oldValue: oldObj.length,
        newValue: newObj.length
      })
    }

    const maxLength = Math.max(oldObj.length, newObj.length)
    for (let i = 0; i < maxLength; i++) {
      const itemPath = path ? `${path}[${i}]` : `[${i}]`
      if (i >= oldObj.length) {
        changes.push({
          path: itemPath,
          type: 'added',
          newValue: newObj[i]
        })
      } else if (i >= newObj.length) {
        changes.push({
          path: itemPath,
          type: 'removed',
          oldValue: oldObj[i]
        })
      } else {
        changes.push(...deepDiff(oldObj[i], newObj[i], itemPath))
      }
    }
    return changes
  }

  // Handle objects
  const oldKeys = new Set(Object.keys(oldObj))
  const newKeys = new Set(Object.keys(newObj))

  // Check for removed keys
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      changes.push({
        path: path ? `${path}.${key}` : key,
        type: 'removed',
        oldValue: oldObj[key]
      })
    }
  }

  // Check for added and modified keys
  for (const key of newKeys) {
    const propPath = path ? `${path}.${key}` : key
    if (!oldKeys.has(key)) {
      changes.push({
        path: propPath,
        type: 'added',
        newValue: newObj[key]
      })
    } else {
      changes.push(...deepDiff(oldObj[key], newObj[key], propPath))
    }
  }

  return changes
}

/**
 * Generate human-readable summary of changes
 */
function generateDiffSummary(propChanges: PropChange[], slotChanged: boolean): string {
  const parts: string[] = []

  const added = propChanges.filter(c => c.type === 'added').length
  const removed = propChanges.filter(c => c.type === 'removed').length
  const modified = propChanges.filter(c => c.type === 'modified').length

  if (added > 0) parts.push(`${added} prop${added > 1 ? 's' : ''} added`)
  if (removed > 0) parts.push(`${removed} prop${removed > 1 ? 's' : ''} removed`)
  if (modified > 0) parts.push(`${modified} prop${modified > 1 ? 's' : ''} modified`)
  if (slotChanged) parts.push('slot changed')

  if (parts.length === 0) {
    return 'No changes detected'
  }

  return parts.join(', ')
}

/**
 * Get component state diff
 */
export async function getComponentDiff(input: DiffInput): Promise<DiffResult> {
  const layoutState = useLayoutStore.getState()
  const module = findModuleById(input.componentId, layoutState.slots)

  console.log('[Component Diff] Analyzing component:', input.componentId)

  if (!module) {
    return {
      success: false,
      componentId: input.componentId,
      diff: null,
      error: 'Component not found in current layout'
    }
  }

  const currentState = {
    props: module.props || {},
    slot: findSlotForModule(module.id, layoutState.slots)
  }

  // Get previous state from history
  const history = layoutState.history
  if (history.length === 0) {
    return {
      success: true,
      componentId: input.componentId,
      diff: null,
      message: 'No previous state to compare (history is empty)'
    }
  }

  const previousEntry = history[history.length - 1]
  const previousModule = findModuleById(input.componentId, previousEntry.slots)

  if (!previousModule) {
    return {
      success: true,
      componentId: input.componentId,
      diff: null,
      message: 'Component did not exist in previous state'
    }
  }

  const previousState = {
    props: previousModule.props || {},
    slot: findSlotForModule(previousModule.id, previousEntry.slots)
  }

  console.log('[Component Diff] Comparing states:', {
    previousSlot: previousState.slot,
    currentSlot: currentState.slot,
    previousPropsKeys: Object.keys(previousState.props),
    currentPropsKeys: Object.keys(currentState.props)
  })

  // Calculate diff
  const propsDiff = deepDiff(previousState.props, currentState.props)
  const slotChanged = previousState.slot !== currentState.slot

  const diff: ComponentDiff = {
    props: propsDiff,
    slotChanged: slotChanged ? {
      from: previousState.slot || 'unknown',
      to: currentState.slot || 'unknown'
    } : null,
    summary: generateDiffSummary(propsDiff, slotChanged)
  }

  console.log('[Component Diff] Analysis complete:', diff.summary)

  return {
    success: true,
    componentId: input.componentId,
    diff
  }
}
