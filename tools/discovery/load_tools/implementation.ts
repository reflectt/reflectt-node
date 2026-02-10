import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { loadToolDefinition, type ToolDefinition } from '@/lib/tools/helpers/tool-loader'
import { getDiscoverySessionManager } from '@/lib/tools/discovery-session'
import { getToolDefinition } from '@/lib/tools/tool-registry-cache'

interface LoadToolsInput {
  tool_names: string[]
}

interface LoadToolsOutput {
  success: boolean
  loaded_count: number
  failed_tools: string[]
  already_loaded: string[]
  total_requested: number
  session_id: string
  message: string
}

export default async function loadTools(
  input: LoadToolsInput,
  context: ToolContext
): Promise<LoadToolsOutput> {
  try {
    const { tool_names } = input
    if (!tool_names || tool_names.length === 0) {
      return {
        success: false, loaded_count: 0, failed_tools: [], already_loaded: [],
        total_requested: 0, session_id: '', message: 'No tool names provided'
      }
    }
    const sessionId = context.conversationId || 'session_' + Date.now()
    const discoveryManager = getDiscoverySessionManager()
    const session = discoveryManager.getOrCreateSession(sessionId, context.conversationId)
    const failedTools: string[] = []
    const alreadyLoaded: string[] = []
    const toolsToLoad = new Map<string, ToolDefinition>()
    for (const toolName of tool_names) {
      if (session.loaded_tool_names.has(toolName)) {
        alreadyLoaded.push(toolName)
        continue
      }
      let toolDef = getToolDefinition(toolName)
      if (!toolDef) {
        const globalDir = context.resolvePath('global')
        toolDef = loadToolDefinition(toolName, globalDir)
      }
      if (!toolDef) {
        failedTools.push(toolName)
        continue
      }
      toolsToLoad.set(toolName, toolDef)
    }
    const loadedCount = discoveryManager.loadTools(sessionId, toolsToLoad)

    // Track load event
    if (loadedCount > 0) {
      const { getSearchTracker } = await import('@/lib/tools/discovery-search-tracker')
      const tracker = getSearchTracker()
      tracker.recordToolLoad(
        Array.from(toolsToLoad.keys()),
        sessionId,
        context.conversationId
      )
    }

    let message = ''
    if (loadedCount > 0) {
      message = 'Successfully loaded ' + loadedCount + ' tools'
    }
    if (alreadyLoaded.length > 0) {
      message += ' | ' + alreadyLoaded.length + ' already loaded'
    }
    if (failedTools.length > 0) {
      message += ' | Failed: ' + failedTools.join(', ')
    }
    return {
      success: loadedCount > 0 || alreadyLoaded.length > 0,
      loaded_count: loadedCount, failed_tools: failedTools,
      already_loaded: alreadyLoaded, total_requested: tool_names.length,
      session_id: sessionId, message
    }
  } catch (error: any) {
    return {
      success: false, loaded_count: 0,
      failed_tools: input.tool_names || [], already_loaded: [],
      total_requested: input.tool_names?.length || 0,
      session_id: '', message: 'Error: ' + error.message
    }
  }
}
