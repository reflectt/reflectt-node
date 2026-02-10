/**
 * Agent Annotate Tool - Streaming UI Tool
 *
 * Allows agents to show floating annotation bubbles that narrate their actions.
 * Creates a guided tour experience where the AI explains what it's doing in real-time.
 *
 * This is a streaming UI control tool - the payload is returned and handled client-side
 * by the UI as the tool call streams in.
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { formatError } from '@/lib/tools/helpers'

interface AgentAnnotateInput {
  message: string
  target: {
    type: 'screen' | 'slot' | 'module'
    slot?: 'primary' | 'secondary' | 'sidebar'
    moduleId?: string
  }
  icon?: string
  severity?: 'info' | 'working' | 'success' | 'insight' | 'warning'
  duration?: number
  position?: 'top' | 'bottom' | 'left' | 'right' | 'top-right'
}

interface AgentAnnotateSuccess {
  success: true
  annotation: {
    id: string
    target: {
      type: 'screen' | 'slot' | 'module'
      slot?: 'primary' | 'secondary' | 'sidebar'
      moduleId?: string
    }
    message: string
    icon: string
    severity: 'info' | 'working' | 'success' | 'insight' | 'warning'
    duration: number
    position: 'top' | 'bottom' | 'left' | 'right' | 'top-right'
    animate: boolean
    dismissable: boolean
    timestamp: string
  }
  space_id: string
}

interface AgentAnnotateFailure {
  success: false
  error: string
  space_id: string
}

type AgentAnnotateOutput = AgentAnnotateSuccess | AgentAnnotateFailure

export default async function agent_annotate(
  input: unknown,
  ctx: ToolContext
): Promise<AgentAnnotateOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    if (!params.message || typeof params.message !== 'string') {
      throw new Error('Missing required parameter: message')
    }

    if (!params.target || typeof params.target !== 'object') {
      throw new Error('Missing required parameter: target')
    }

    if (!params.target.type || !['screen', 'slot', 'module'].includes(params.target.type)) {
      throw new Error('Invalid target.type: must be "screen", "slot", or "module"')
    }

    // Generate unique ID for this annotation
    const annotationId = `annotation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Default icon based on severity
    const defaultIcons = {
      info: '💬',
      working: '⚙️',
      success: '✅',
      insight: '💡',
      warning: '⚠️'
    }

    const severity = (params.severity || 'info') as AgentAnnotateInput['severity']
    const icon = params.icon || defaultIcons[severity!]

    console.log('[agent_annotate]', {
      id: annotationId,
      message: params.message,
      target: params.target,
      severity,
      spaceId: ctx.currentSpace
    })

    return {
      success: true,
      annotation: {
        id: annotationId,
        target: params.target,
        message: params.message,
        icon,
        severity: severity!,
        duration: params.duration ?? 3000,
        position: params.position || (params.target.type === 'screen' ? 'top-right' : 'top'),
        animate: true,
        dismissable: true,
        timestamp: new Date().toISOString()
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
