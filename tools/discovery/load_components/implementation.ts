import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { componentRegistry, type ComponentRegistryEntry } from '@/components/component-registry'
import { getDiscoverySessionManager } from '@/lib/tools/discovery-session'
import * as fs from 'fs'
import * as path from 'path'

interface LoadComponentsInput {
  component_ids: string[]
}

interface LoadComponentsOutput {
  success: boolean
  loaded_count: number
  failed_components: string[]
  already_loaded: string[]
  total_requested: number
  session_id: string
  message: string
  components?: Array<{
    id: string
    name: string
    description: string
    required_props: string[]
    prop_examples?: any[]
  }>
}

function loadComponentFullSchema(componentId: string, entry: ComponentRegistryEntry): any {
  try {
    const parts = componentId.split(':')
    const domainName = parts.length > 1 ? parts[0] : (entry.domain || '')
    const compName = parts.length > 1 ? parts[1] : componentId
    const componentsDir = path.join(process.cwd(), 'components', 'domains')
    const defPath = path.join(componentsDir, domainName, compName, 'definition.json')
    
    if (fs.existsSync(defPath)) {
      const content = fs.readFileSync(defPath, 'utf-8')
      return JSON.parse(content)
    }
    return null
  } catch (err) {
    return null
  }
}

export default async function loadComponents(
  input: LoadComponentsInput,
  context: ToolContext
): Promise<LoadComponentsOutput> {
  try {
    const { component_ids } = input
    if (!component_ids || component_ids.length === 0) {
      return {
        success: false, loaded_count: 0, failed_components: [], already_loaded: [],
        total_requested: 0, session_id: '', message: 'No component IDs provided'
      }
    }

    const sessionId = context.conversationId || 'session_' + Date.now()
    const discoveryManager = getDiscoverySessionManager()
    const session = discoveryManager.getOrCreateSession(sessionId, context.conversationId)

    const failedComponents: string[] = []
    const alreadyLoaded: string[] = []
    const componentsToLoad = new Map<string, ComponentRegistryEntry>()

    for (const componentId of component_ids) {
      if (session.loaded_component_ids.has(componentId)) {
        alreadyLoaded.push(componentId)
        continue
      }

      const entry = componentRegistry[componentId]
      if (!entry) {
        failedComponents.push(componentId)
        continue
      }

      const fullSchema = loadComponentFullSchema(componentId, entry)
      const enrichedEntry = fullSchema ? { ...entry, fullDefinition: fullSchema } : entry
      componentsToLoad.set(componentId, enrichedEntry)
    }

    const loadedCount = discoveryManager.loadComponents(sessionId, componentsToLoad)

    // Track load event
    if (loadedCount > 0) {
      const { getSearchTracker } = await import('@/lib/tools/discovery-search-tracker')
      const tracker = getSearchTracker()
      tracker.recordComponentLoad(
        Array.from(componentsToLoad.keys()),
        sessionId,
        context.conversationId
      )
    }

    let message = ''
    if (loadedCount > 0) {
      message = 'Successfully loaded ' + loadedCount + ' component(s)'
    }
    if (alreadyLoaded.length > 0) {
      message += ' | ' + alreadyLoaded.length + ' already loaded'
    }
    if (failedComponents.length > 0) {
      message += ' | Failed: ' + failedComponents.join(', ')
    }

    // Build component info with prop examples
    const componentInfo = Array.from(componentsToLoad.entries()).map(([id, entry]) => {
      const fullDef = (entry as any).fullDefinition
      const required = fullDef?.dataSchema?.required || []

      return {
        id,
        name: fullDef?.name || entry.displayName || entry.name || id,
        description: fullDef?.description || entry.description || '',
        required_props: required,
        prop_examples: fullDef?.prop_examples
      }
    })

    return {
      success: loadedCount > 0 || alreadyLoaded.length > 0,
      loaded_count: loadedCount, failed_components: failedComponents,
      already_loaded: alreadyLoaded, total_requested: component_ids.length,
      session_id: sessionId, message,
      components: componentInfo
    }
  } catch (error: any) {
    return {
      success: false, loaded_count: 0,
      failed_components: input.component_ids || [], already_loaded: [],
      total_requested: input.component_ids?.length || 0,
      session_id: '', message: 'Error: ' + error.message
    }
  }
}
