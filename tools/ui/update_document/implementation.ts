import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

/**
 * update_document - Office Suite AI Tool
 *
 * Allows AI agents to programmatically modify document content in the DocumentEditor
 * component. Supports various operations (replace, insert, append, prepend) with
 * multiple content formats (HTML, Markdown, plain text).
 *
 * This tool enables AI to:
 * - Generate and insert content based on user prompts
 * - Rewrite or improve existing sections
 * - Append research findings or generated text
 * - Replace selections with AI-enhanced versions
 * - Clear and regenerate entire documents
 *
 * Use Cases:
 * - "Add a summary paragraph at the beginning"
 * - "Replace the second section with a more detailed explanation"
 * - "Append the meeting notes to the document"
 * - "Clear the document and start fresh with a new outline"
 *
 * Component Integration:
 * The tool uses patch_component_state with special editor commands to manipulate
 * the Tiptap editor content. The DocumentEditor component processes these commands
 * and updates the editor state accordingly.
 *
 * @param input - Document update parameters
 * @param ctx - Tool execution context
 * @returns Success with update details or error
 */
export default async function updateDocumentTool(
  input: unknown,
  ctx: ToolContext
): Promise<UpdateDocumentOutput> {
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

    // Validate operation
    const validOperations = ['replace', 'insert', 'append', 'prepend', 'clear']
    const operation = params.operation || 'append'
    if (!validOperations.includes(operation)) {
      throw new Error(`Invalid operation: "${operation}". Must be one of: ${validOperations.join(', ')}`)
    }

    // Validate content (not required for 'clear')
    let content = ''
    if (operation !== 'clear') {
      if (params.content === undefined || params.content === null) {
        throw new Error(`operation "${operation}" requires content parameter`)
      }
      if (typeof params.content !== 'string') {
        throw new Error('content must be a string')
      }
      content = params.content
    }

    // Validate format
    const format = params.format || 'text'
    const validFormats = ['html', 'markdown', 'text']
    if (!validFormats.includes(format)) {
      throw new Error(`Invalid format: "${format}". Must be one of: ${validFormats.join(', ')}`)
    }

    // Validate position (required for 'insert')
    let position: number | undefined
    if (operation === 'insert') {
      if (params.position === undefined || params.position === null) {
        throw new Error('operation "insert" requires position parameter')
      }
      if (typeof params.position !== 'number') {
        throw new Error('position must be a number')
      }
      if (params.position < 0) {
        throw new Error('position must be non-negative')
      }
      position = Math.floor(params.position)
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

    // Validate applyFormatting
    const applyFormatting = params.applyFormatting !== false

    // Validate autoSave
    const autoSave = params.autoSave !== false

    // Convert content based on format
    let processedContent = content
    if (format === 'markdown') {
      // For markdown, we'll let the editor's Turndown/Tiptap handle conversion
      // Mark it specially so the component knows to process it
      processedContent = `<!-- markdown -->${content}`
    } else if (format === 'text') {
      // Convert plain text to HTML paragraphs
      processedContent = `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`
    }
    // HTML format passes through as-is

    // Build the document update command
    const documentUpdate: any = {
      _editorCommand: {
        type: operation,
        content: processedContent,
        format,
        applyFormatting,
        position,
        selection,
        autoSave
      }
    }

    console.log('[update_document]', {
      moduleId,
      operation,
      format,
      contentLength: content.length,
      hasPosition: position !== undefined,
      hasSelection: selection !== undefined,
      applyFormatting,
      autoSave,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      document_update: {
        moduleId,
        operation,
        format,
        contentLength: content.length,
        processedContentLength: processedContent.length,
        position,
        selection,
        applyFormatting,
        autoSave,
        propsPatch: documentUpdate,
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

// Types
interface UpdateDocumentSuccess {
  success: true
  document_update: {
    moduleId: string
    operation: string
    format: string
    contentLength: number
    processedContentLength: number
    position?: number
    selection?: { start: number; end: number }
    applyFormatting: boolean
    autoSave: boolean
    propsPatch: Record<string, any>
    timestamp: string
  }
  space_id: string
}

interface UpdateDocumentFailure {
  success: false
  error: string
  space_id: string
}

type UpdateDocumentOutput = UpdateDocumentSuccess | UpdateDocumentFailure
