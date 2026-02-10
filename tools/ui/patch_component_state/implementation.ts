import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

type PatchMode = 'merge' | 'replace' | 'array_add' | 'array_remove' | 'array_update' | 'batch'

type AnimationType = 'flash' | 'fade' | 'bounce' | 'slide' | 'highlight'

interface AnimationConfig {
  type: AnimationType
  duration: number
  color?: string
}

interface ArrayAddOperation {
  mode: 'array_add'
  path: string
  items: any[]
  position?: 'start' | 'end'
}

interface ArrayRemoveOperation {
  mode: 'array_remove'
  path: string
  itemIds: string[]
  idField?: string
}

interface ArrayUpdateOperation {
  mode: 'array_update'
  path: string
  updates: Array<{ id: string; changes: Record<string, any> }>
  idField?: string
}

interface MergeOperation {
  mode: 'merge'
  propsPatch: Record<string, any>
}

interface ReplaceOperation {
  mode: 'replace'
  propsPatch: Record<string, any>
}

type BatchOperation = ArrayAddOperation | ArrayRemoveOperation | ArrayUpdateOperation | MergeOperation | ReplaceOperation

interface BatchOperationMode {
  mode: 'batch'
  operations: BatchOperation[]
}

interface PatchComponentStateInput {
  moduleId: string
  propsPatch?: Record<string, any>
  mode?: PatchMode
  animate?: boolean
  animation?: AnimationConfig
  // Array operations
  path?: string
  items?: any[]
  position?: 'start' | 'end'
  itemIds?: string[]
  idField?: string
  updates?: Array<{ id: string; changes: Record<string, any> }>
  // Batch operations
  operations?: BatchOperation[]
}

interface DeltaInfo {
  added?: any[]
  removed?: any[]
  updated?: any[]
  before?: any
  after?: any
}

interface PatchComponentStateSuccess {
  success: true
  component_patch: {
    moduleId: string
    propsPatch: Record<string, any>
    mode: PatchMode
    animate: boolean
    animation?: AnimationConfig
    timestamp: string
    delta?: DeltaInfo
  }
  space_id: string
}

interface PatchComponentStateFailure {
  success: false
  error: string
  space_id: string
}

type PatchComponentStateOutput = PatchComponentStateSuccess | PatchComponentStateFailure

/**
 * Helper: Get nested value from object using dot notation path
 */
function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    current = current[part]
  }
  return current
}

/**
 * Helper: Set nested value in object using dot notation path
 */
function setNestedValue(obj: any, path: string, value: any): Record<string, any> {
  const parts = path.split('.')
  const result = JSON.parse(JSON.stringify(obj)) // Deep clone

  let current = result
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current)) {
      current[part] = {}
    }
    current = current[part]
  }

  current[parts[parts.length - 1]] = value
  return result
}

/**
 * Helper: Process array_add operation
 */
function processArrayAdd(
  currentProps: Record<string, any>,
  path: string,
  items: any[],
  position: 'start' | 'end' = 'end'
): { props: Record<string, any>; delta: DeltaInfo } {
  const currentArray = getNestedValue(currentProps, path)

  if (!Array.isArray(currentArray)) {
    throw new Error(`Path "${path}" does not point to an array`)
  }

  const newArray = position === 'start'
    ? [...items, ...currentArray]
    : [...currentArray, ...items]

  const newProps = setNestedValue(currentProps, path, newArray)

  return {
    props: newProps,
    delta: {
      added: items,
      before: currentArray.length,
      after: newArray.length
    }
  }
}

/**
 * Helper: Process array_remove operation
 */
function processArrayRemove(
  currentProps: Record<string, any>,
  path: string,
  itemIds: string[],
  idField: string = 'id'
): { props: Record<string, any>; delta: DeltaInfo } {
  const currentArray = getNestedValue(currentProps, path)

  if (!Array.isArray(currentArray)) {
    throw new Error(`Path "${path}" does not point to an array`)
  }

  const itemIdsSet = new Set(itemIds)
  const removedItems: any[] = []
  const newArray = currentArray.filter((item) => {
    const shouldRemove = itemIdsSet.has(item[idField])
    if (shouldRemove) {
      removedItems.push(item)
    }
    return !shouldRemove
  })

  const newProps = setNestedValue(currentProps, path, newArray)

  return {
    props: newProps,
    delta: {
      removed: removedItems,
      before: currentArray.length,
      after: newArray.length
    }
  }
}

/**
 * Helper: Process array_update operation
 */
function processArrayUpdate(
  currentProps: Record<string, any>,
  path: string,
  updates: Array<{ id: string; changes: Record<string, any> }>,
  idField: string = 'id'
): { props: Record<string, any>; delta: DeltaInfo } {
  const currentArray = getNestedValue(currentProps, path)

  if (!Array.isArray(currentArray)) {
    throw new Error(`Path "${path}" does not point to an array`)
  }

  const updateMap = new Map(updates.map(u => [u.id, u.changes]))
  const updatedItems: any[] = []

  const newArray = currentArray.map((item) => {
    const changes = updateMap.get(item[idField])
    if (changes) {
      const updatedItem = { ...item, ...changes }
      updatedItems.push({
        id: item[idField],
        before: item,
        after: updatedItem
      })
      return updatedItem
    }
    return item
  })

  const newProps = setNestedValue(currentProps, path, newArray)

  return {
    props: newProps,
    delta: {
      updated: updatedItems
    }
  }
}

/**
 * Helper: Process batch operations
 */
function processBatchOperations(
  currentProps: Record<string, any>,
  operations: BatchOperation[]
): { props: Record<string, any>; delta: DeltaInfo } {
  let workingProps = { ...currentProps }
  const combinedDelta: DeltaInfo = {
    added: [],
    removed: [],
    updated: []
  }

  for (const op of operations) {
    let result: { props: Record<string, any>; delta?: DeltaInfo }

    switch (op.mode) {
      case 'array_add':
        result = processArrayAdd(workingProps, op.path, op.items, op.position)
        if (result.delta?.added) {
          combinedDelta.added!.push(...result.delta.added)
        }
        break

      case 'array_remove':
        result = processArrayRemove(workingProps, op.path, op.itemIds, op.idField)
        if (result.delta?.removed) {
          combinedDelta.removed!.push(...result.delta.removed)
        }
        break

      case 'array_update':
        result = processArrayUpdate(workingProps, op.path, op.updates, op.idField)
        if (result.delta?.updated) {
          combinedDelta.updated!.push(...result.delta.updated)
        }
        break

      case 'merge':
        result = {
          props: { ...workingProps, ...op.propsPatch }
        }
        break

      case 'replace':
        result = {
          props: op.propsPatch
        }
        break

      default:
        throw new Error(`Unknown batch operation mode: ${(op as any).mode}`)
    }

    workingProps = result.props
  }

  return {
    props: workingProps,
    delta: combinedDelta
  }
}

/**
 * patch_component_state - Streaming UI Tool
 *
 * Updates component props without remounting for smooth, flicker-free updates.
 * This is a streaming UI control tool - prop changes happen in real-time as
 * the tool call streams through.
 *
 * The patch is processed by:
 * 1. Server validates moduleId and propsPatch
 * 2. Returns success payload with component_patch object
 * 3. Client-side PortalExperienceStore listens for component_patch
 * 4. Finds existing interactive module by moduleId
 * 5. Merges or replaces props based on mode
 * 6. Updates component without unmounting (preserves state)
 * 7. Optionally animates transition if animate=true
 *
 * Modes:
 * - merge (default): { ...existingProps, ...propsPatch }
 * - replace: propsPatch (completely new props)
 * - array_add: Add items to array at path
 * - array_remove: Remove items from array by ID
 * - array_update: Update specific items in array
 * - batch: Execute multiple operations in sequence
 *
 * Use Cases:
 * - Real-time dashboard data updates
 * - Progressive loading (add items incrementally)
 * - Status changes (update badge/alert without flicker)
 * - Refinement (adjust visualization params)
 * - Highlight changes (flash updated values)
 *
 * Requirements:
 * - Component must already be mounted (via render_manifest)
 * - moduleId must match existing module's id
 * - propsPatch must be compatible with component's schema
 */
export default async function patchComponentStateTool(
  input: unknown,
  ctx: ToolContext
): Promise<PatchComponentStateOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required moduleId
    if (!params.moduleId || typeof params.moduleId !== 'string') {
      throw new Error('Missing required parameter: moduleId')
    }

    const moduleId = params.moduleId.trim()
    if (moduleId.length === 0) {
      throw new Error('moduleId cannot be empty')
    }

    // Validate mode
    const validModes: PatchMode[] = ['merge', 'replace', 'array_add', 'array_remove', 'array_update', 'batch']
    let mode: PatchMode = params.mode || 'merge'
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode: "${mode}". Must be one of: ${validModes.join(', ')}`)
    }

    // Validate animate
    const animate = params.animate !== false // Default to true

    // Validate animation config if provided
    let animation: AnimationConfig | undefined
    if (params.animation) {
      const validAnimationTypes: AnimationType[] = ['flash', 'fade', 'bounce', 'slide', 'highlight']

      if (!params.animation.type || !validAnimationTypes.includes(params.animation.type)) {
        throw new Error(`Invalid animation.type: "${params.animation.type}". Must be one of: ${validAnimationTypes.join(', ')}`)
      }

      if (typeof params.animation.duration !== 'number' || params.animation.duration <= 0) {
        throw new Error('animation.duration must be a positive number (milliseconds)')
      }

      if (params.animation.duration > 10000) {
        throw new Error('animation.duration cannot exceed 10000ms (10 seconds)')
      }

      animation = {
        type: params.animation.type,
        duration: params.animation.duration,
        color: params.animation.color
      }
    }

    // Process different modes
    let propsPatch: Record<string, any>
    let delta: DeltaInfo | undefined

    switch (mode) {
      case 'merge':
      case 'replace': {
        // Validate required propsPatch
        if (!params.propsPatch) {
          throw new Error('propsPatch is required for merge/replace mode')
        }

        // Coerce JSON string to object if needed
        if (typeof params.propsPatch === 'string') {
          try {
            propsPatch = JSON.parse(params.propsPatch)
          } catch {
            throw new Error('propsPatch must be a valid JSON object or object')
          }
        } else {
          propsPatch = params.propsPatch
        }

        if (typeof propsPatch !== 'object' || Array.isArray(propsPatch)) {
          throw new Error('propsPatch must be a non-array object')
        }

        if (Object.keys(propsPatch).length === 0) {
          throw new Error('propsPatch cannot be empty')
        }
        break
      }

      case 'array_add': {
        // Validate path
        if (!params.path || typeof params.path !== 'string') {
          throw new Error('path is required for array_add mode (dot notation path to array)')
        }

        // Validate items
        if (!params.items || !Array.isArray(params.items)) {
          throw new Error('items must be an array for array_add mode')
        }

        if (params.items.length === 0) {
          throw new Error('items cannot be empty for array_add mode')
        }

        // Validate position
        const position = params.position || 'end'
        if (position !== 'start' && position !== 'end') {
          throw new Error('position must be "start" or "end"')
        }

        // For array operations, we need current props from context
        // In a real implementation, this would fetch from layout store
        // For now, we'll create the patch instruction
        propsPatch = {
          _arrayOperation: {
            type: 'add',
            path: params.path,
            items: params.items,
            position
          }
        }

        delta = {
          added: params.items
        }
        break
      }

      case 'array_remove': {
        // Validate path
        if (!params.path || typeof params.path !== 'string') {
          throw new Error('path is required for array_remove mode (dot notation path to array)')
        }

        // Validate itemIds
        if (!params.itemIds || !Array.isArray(params.itemIds)) {
          throw new Error('itemIds must be an array for array_remove mode')
        }

        if (params.itemIds.length === 0) {
          throw new Error('itemIds cannot be empty for array_remove mode')
        }

        // Validate idField
        const idField = params.idField || 'id'
        if (typeof idField !== 'string') {
          throw new Error('idField must be a string')
        }

        propsPatch = {
          _arrayOperation: {
            type: 'remove',
            path: params.path,
            itemIds: params.itemIds,
            idField
          }
        }

        delta = {
          removed: params.itemIds.map(id => ({ [idField]: id }))
        }
        break
      }

      case 'array_update': {
        // Validate path
        if (!params.path || typeof params.path !== 'string') {
          throw new Error('path is required for array_update mode (dot notation path to array)')
        }

        // Validate updates
        if (!params.updates || !Array.isArray(params.updates)) {
          throw new Error('updates must be an array for array_update mode')
        }

        if (params.updates.length === 0) {
          throw new Error('updates cannot be empty for array_update mode')
        }

        // Validate each update has id and changes
        for (const update of params.updates) {
          if (!update.id) {
            throw new Error('Each update must have an "id" field')
          }
          if (!update.changes || typeof update.changes !== 'object') {
            throw new Error('Each update must have a "changes" object')
          }
        }

        // Validate idField
        const idField = params.idField || 'id'
        if (typeof idField !== 'string') {
          throw new Error('idField must be a string')
        }

        propsPatch = {
          _arrayOperation: {
            type: 'update',
            path: params.path,
            updates: params.updates,
            idField
          }
        }

        delta = {
          updated: params.updates.map(u => ({ id: u.id, changes: u.changes }))
        }
        break
      }

      case 'batch': {
        // Validate operations
        if (!params.operations || !Array.isArray(params.operations)) {
          throw new Error('operations must be an array for batch mode')
        }

        if (params.operations.length === 0) {
          throw new Error('operations cannot be empty for batch mode')
        }

        // Validate each operation
        for (const op of params.operations) {
          if (!op.mode) {
            throw new Error('Each batch operation must have a "mode" field')
          }
          if (!validModes.includes(op.mode) || op.mode === 'batch') {
            throw new Error(`Invalid batch operation mode: "${op.mode}". Batch operations cannot be nested.`)
          }
        }

        propsPatch = {
          _batchOperations: params.operations
        }

        // Delta will be computed by client when executing batch
        delta = {
          added: [],
          removed: [],
          updated: []
        }
        break
      }

      default:
        throw new Error(`Unhandled mode: ${mode}`)
    }

    // Log patch for debugging
    console.log('[patch_component_state]', {
      moduleId,
      mode,
      animate,
      animation,
      patchKeys: Object.keys(propsPatch),
      delta,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      component_patch: {
        moduleId,
        propsPatch,
        mode,
        animate,
        animation,
        timestamp: now(),
        delta
      },
      space_id: ctx.currentSpace
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: ctx.currentSpace
    }
  }
}
