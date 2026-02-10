import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface InspectComponentTreeInput {
  componentId?: string
  includeProps?: boolean
  includeSlotInfo?: boolean
  includeRelationships?: boolean
}

interface ComponentTreeNode {
  id: string
  type: string
  slot: string
  order: number
  props?: Record<string, any>
  label?: string
}

interface SlotInfo {
  name: string
  visible: boolean
  moduleCount: number
  modules: string[]
}

interface ComponentRelationship {
  source: string
  target: string
  type: 'data_flow' | 'event_subscription' | 'same_slot' | 'potential_interaction'
  description: string
}

interface InspectComponentTreeSuccess {
  success: true
  tree: {
    layout: string
    totalSlots: number
    totalComponents: number
    slots?: SlotInfo[]
    components: ComponentTreeNode[]
    relationships?: ComponentRelationship[]
    focusedComponent?: {
      id: string
      relatedComponents: string[]
      subscribers: string[]
      eventSources: string[]
    }
  }
}

interface InspectComponentTreeFailure {
  success: false
  error: string
}

type InspectComponentTreeOutput = InspectComponentTreeSuccess | InspectComponentTreeFailure

/**
 * Find relationships between components based on context bus data
 */
function findRelationships(
  allModules: ComponentTreeNode[],
  includeRelationships: boolean
): ComponentRelationship[] {
  if (!includeRelationships) return []

  const relationships: ComponentRelationship[] = []
  const allContexts = contextBus.query(() => true)
  const eventHistory = contextBus.getEventHistory(100)

  // Find event subscriptions and data flows
  const eventMap = new Map<string, Set<string>>()

  eventHistory.forEach((event) => {
    const source = event.source
    // Infer targets from event types and context
    if (event.type === 'selection_change' || event.type === 'filter_change') {
      // These events might affect other components
      allContexts.forEach((ctx) => {
        if (ctx.id !== source) {
          if (!eventMap.has(source)) {
            eventMap.set(source, new Set())
          }
          eventMap.get(source)?.add(ctx.id)
        }
      })
    }
  })

  // Add event-based relationships
  eventMap.forEach((targets, source) => {
    targets.forEach((target) => {
      relationships.push({
        source,
        target,
        type: 'event_subscription',
        description: `${target} subscribes to events from ${source}`
      })
    })
  })

  // Find components in the same slot (potential interactions)
  const slotGroups = new Map<string, string[]>()
  allModules.forEach((module) => {
    if (!slotGroups.has(module.slot)) {
      slotGroups.set(module.slot, [])
    }
    slotGroups.get(module.slot)?.push(module.id)
  })

  slotGroups.forEach((components, slot) => {
    if (components.length > 1) {
      for (let i = 0; i < components.length - 1; i++) {
        for (let j = i + 1; j < components.length; j++) {
          relationships.push({
            source: components[i],
            target: components[j],
            type: 'same_slot',
            description: `Both components are in slot: ${slot}`
          })
        }
      }
    }
  })

  return relationships
}

/**
 * Get detailed information about a specific component's relationships
 */
function getFocusedComponentInfo(componentId: string, allModules: ComponentTreeNode[]) {
  const eventHistory = contextBus.getEventHistory(100)
  const relatedComponents = new Set<string>()
  const subscribers = new Set<string>()
  const eventSources = new Set<string>()

  // Find events published by this component
  eventHistory
    .filter((e) => e.source === componentId)
    .forEach((e) => {
      // Add potential subscribers
      allModules.forEach((m) => {
        if (m.id !== componentId) {
          subscribers.add(m.id)
        }
      })
    })

  // Find events this component might be subscribed to
  eventHistory
    .filter((e) => e.source !== componentId)
    .forEach((e) => {
      eventSources.add(e.source)
    })

  // Find components in the same slot
  const focusedModule = allModules.find((m) => m.id === componentId)
  if (focusedModule) {
    allModules
      .filter((m) => m.slot === focusedModule.slot && m.id !== componentId)
      .forEach((m) => relatedComponents.add(m.id))
  }

  return {
    id: componentId,
    relatedComponents: Array.from(relatedComponents),
    subscribers: Array.from(subscribers),
    eventSources: Array.from(eventSources)
  }
}

export default async function inspectComponentTree(
  input: InspectComponentTreeInput,
  ctx: ToolContext
): Promise<InspectComponentTreeOutput> {
  try {
    const {
      componentId,
      includeProps = false,
      includeSlotInfo = true,
      includeRelationships = true
    } = input

    // Get layout state
    const layoutState = useLayoutStore.getState()
    const allModules: ComponentTreeNode[] = []

    // Collect all modules from all slots
    Object.entries(layoutState.slots).forEach(([slotName, slotConfig]) => {
      const modules = slotConfig.modules || []
      modules.forEach((module: any, index: number) => {
        const node: ComponentTreeNode = {
          id: module.id,
          type: module.componentId,
          slot: slotName,
          order: index,
          label: module.label
        }

        if (includeProps && module.props) {
          node.props = module.props
        }

        allModules.push(node)
      })
    })

    // Build slot information
    const slots: SlotInfo[] = []
    if (includeSlotInfo) {
      Object.entries(layoutState.slots).forEach(([slotName, slotConfig]) => {
        const modules = slotConfig.modules || []
        slots.push({
          name: slotName,
          visible: slotConfig.visible !== false,
          moduleCount: modules.length,
          modules: modules.map((m: any) => m.id)
        })
      })
    }

    // Find relationships
    const relationships = findRelationships(allModules, includeRelationships)

    // Build response
    const tree: InspectComponentTreeSuccess['tree'] = {
      layout: layoutState.mode || 'standard',
      totalSlots: Object.keys(layoutState.slots).length,
      totalComponents: allModules.length,
      components: allModules
    }

    if (includeSlotInfo) {
      tree.slots = slots
    }

    if (includeRelationships) {
      tree.relationships = relationships
    }

    // Add focused component information if requested
    if (componentId) {
      tree.focusedComponent = getFocusedComponentInfo(componentId, allModules)
    }

    return {
      success: true,
      tree
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
