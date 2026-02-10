import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

/**
 * execute_document_command - Office Suite AI Tool
 *
 * Executes AI commands that are detected but not processed by the DocumentEditor.
 * The editor recognizes slash commands (/summarize, /translate, etc.) and fires
 * events, but needs AI processing to generate the actual content. This tool handles
 * that AI execution and applies results back to the document.
 *
 * This completes the AI command loop:
 * 1. User types /summarize in editor
 * 2. Editor detects command and fires event
 * 3. Agent receives event and calls this tool
 * 4. Tool processes command with AI
 * 5. Results are inserted back into document
 *
 * Use Cases:
 * - "/summarize the document" - Condense content
 * - "/translate to Spanish" - Translate content
 * - "/improve" - Enhance writing quality
 * - "/continue" - Extend the current paragraph
 * - "/format" - Improve document structure
 * - "/rewrite formal" - Change tone/style
 * - "/outline" - Generate outline from content
 *
 * Component Integration:
 * The tool triggers the DocumentEditor's AI command handlers through component
 * events, which process the content and update the editor with AI-generated results.
 *
 * @param input - AI command parameters
 * @param ctx - Tool execution context
 * @returns Success with command execution details or error
 */
export default async function executeDocumentCommandTool(
  input: unknown,
  ctx: ToolContext
): Promise<ExecuteDocumentCommandOutput> {
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

    // Validate command
    const validCommands = ['summarize', 'translate', 'format', 'continue', 'improve', 'rewrite', 'outline']
    if (!params.command || typeof params.command !== 'string') {
      throw new Error('Missing required parameter: command')
    }
    const command = params.command.trim().toLowerCase()
    if (!validCommands.includes(command)) {
      throw new Error(`Invalid command: "${command}". Must be one of: ${validCommands.join(', ')}`)
    }

    // Validate command-specific params
    const commandParams = params.params || {}
    if (typeof commandParams !== 'object' || Array.isArray(commandParams)) {
      throw new Error('params must be an object')
    }

    // Validate params based on command
    if (command === 'translate' && !commandParams.language) {
      throw new Error('translate command requires params.language (e.g., "Spanish", "French")')
    }

    if (command === 'summarize' && commandParams.length) {
      const validLengths = ['short', 'medium', 'long']
      if (!validLengths.includes(commandParams.length)) {
        throw new Error(`params.length must be one of: ${validLengths.join(', ')}`)
      }
    }

    // Validate selection
    let selection: { start: number; end: number } | undefined
    if (params.selection) {
      if (typeof params.selection !== 'object' || params.selection === null) {
        throw new Error('selection must be an object')
      }
      if (typeof params.selection.start !== 'number' || typeof params.selection.end !== 'number') {
        throw new Error('selection must have numeric start and end properties')
      }
      if (params.selection.start < 0 || params.selection.end < 0) {
        throw new Error('selection start and end must be non-negative')
      }
      if (params.selection.start > params.selection.end) {
        throw new Error('selection start must not exceed end')
      }
      selection = {
        start: Math.floor(params.selection.start),
        end: Math.floor(params.selection.end)
      }
    }

    // Validate replaceOriginal
    const replaceOriginal = params.replaceOriginal !== false

    // Validate streamResponse
    const streamResponse = params.streamResponse !== false

    // Build command execution payload
    const aiCommand: any = {
      _aiCommand: {
        command,
        params: commandParams,
        selection,
        replaceOriginal,
        streamResponse,
        timestamp: now()
      }
    }

    // Generate user intent description for better AI context
    const intentDescription = generateIntentDescription(command, commandParams, selection)

    console.log('[execute_document_command]', {
      moduleId,
      command,
      params: commandParams,
      hasSelection: selection !== undefined,
      replaceOriginal,
      streamResponse,
      intent: intentDescription,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      command_execution: {
        moduleId,
        command,
        params: commandParams,
        selection,
        replaceOriginal,
        streamResponse,
        intentDescription,
        propsPatch: aiCommand,
        timestamp: now()
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

/**
 * Generate human-readable intent description for AI context
 */
function generateIntentDescription(
  command: string,
  params: Record<string, any>,
  selection?: { start: number; end: number }
): string {
  const scope = selection ? 'selected text' : 'entire document'

  switch (command) {
    case 'summarize':
      const length = params.length || 'medium'
      return `Create a ${length} summary of the ${scope}`

    case 'translate':
      return `Translate the ${scope} to ${params.language}`

    case 'format':
      return `Improve the formatting and structure of the ${scope}`

    case 'continue':
      return `Continue writing from where the ${scope} ends, maintaining style and context`

    case 'improve':
      const tone = params.tone ? ` with ${params.tone} tone` : ''
      return `Improve the writing quality of the ${scope}${tone}`

    case 'rewrite':
      const style = params.style ? ` in ${params.style} style` : ''
      return `Rewrite the ${scope}${style} while preserving meaning`

    case 'outline':
      return `Generate an outline from the ${scope}`

    default:
      return `Execute ${command} command on the ${scope}`
  }
}

// Types
interface ExecuteDocumentCommandSuccess {
  success: true
  command_execution: {
    moduleId: string
    command: string
    params: Record<string, any>
    selection?: { start: number; end: number }
    replaceOriginal: boolean
    streamResponse: boolean
    intentDescription: string
    propsPatch: Record<string, any>
    timestamp: string
  }
  space_id: string
}

interface ExecuteDocumentCommandFailure {
  success: false
  error: string
  space_id: string
}

type ExecuteDocumentCommandOutput = ExecuteDocumentCommandSuccess | ExecuteDocumentCommandFailure
