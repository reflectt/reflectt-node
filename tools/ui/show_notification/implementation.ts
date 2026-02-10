import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'
type NotificationPosition = 'top-right' | 'top-center' | 'bottom-right'
type NotificationActionType = 'dismiss' | 'prompt'

interface NotificationAction {
  label: string
  action: NotificationActionType
  prompt?: string
}

interface ShowNotificationInput {
  message: string
  severity: NotificationSeverity
  title?: string
  duration?: number
  actions?: NotificationAction[]
  position?: NotificationPosition
}

interface ShowNotificationSuccess {
  success: true
  notification: {
    id: string
    message: string
    severity: NotificationSeverity
    title?: string
    duration: number
    actions?: NotificationAction[]
    position: NotificationPosition
    timestamp: string
  }
  space_id: string
}

interface ShowNotificationFailure {
  success: false
  error: string
  space_id: string
}

type ShowNotificationOutput = ShowNotificationSuccess | ShowNotificationFailure

function generateNotificationId(): string {
  return `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * show_notification - Streaming UI Tool
 * 
 * Triggers toast/alert notifications in the UI. This is a streaming UI control
 * tool - the notification appears as the tool call streams through.
 * 
 * The notification is processed by:
 * 1. Server validates parameters and generates unique notification ID
 * 2. Returns success payload with notification object
 * 3. Client-side chat UI listens for tool calls with notification key
 * 4. Renders toast/alert with appropriate styling based on severity
 * 5. Auto-dismisses after duration or shows persistent notification
 * 6. Action buttons trigger prompts or dismiss notification
 * 
 * Severity Styles:
 * - info: Blue/sky tones, info icon
 * - success: Green/emerald tones, checkmark icon
 * - warning: Amber/orange tones, warning icon
 * - error: Red/rose tones, alert icon
 * 
 * Use Cases:
 * - Success: "Workflow deployed successfully!"
 * - Error: "Build failed - 3 tests failing"
 * - Warning: "Budget threshold exceeded"
 * - Info: "New agent available in registry"
 */
export default async function showNotificationTool(
  input: unknown,
  ctx: ToolContext
): Promise<ShowNotificationOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required fields
    if (!params.message || typeof params.message !== 'string') {
      throw new Error('Missing required parameter: message')
    }

    if (!params.severity || typeof params.severity !== 'string') {
      throw new Error('Missing required parameter: severity')
    }

    const message = params.message.trim()
    if (message.length === 0) {
      throw new Error('Message cannot be empty')
    }

    if (message.length > 500) {
      throw new Error('Message too long (max 500 characters)')
    }

    // Validate severity
    const validSeverities: NotificationSeverity[] = ['info', 'success', 'warning', 'error']
    const severity = params.severity as NotificationSeverity

    if (!validSeverities.includes(severity)) {
      throw new Error(`Invalid severity: "${params.severity}". Must be one of: ${validSeverities.join(', ')}`)
    }

    // Validate optional title
    let title: string | undefined = undefined
    if (params.title) {
      if (typeof params.title !== 'string') {
        throw new Error('Title must be a string')
      }
      title = params.title.trim()
      if (title.length > 100) {
        throw new Error('Title too long (max 100 characters)')
      }
      if (title.length === 0) {
        title = undefined
      }
    }

    // Validate duration
    let duration = 5000 // Default 5 seconds
    if (params.duration !== undefined) {
      // Coerce string to number if needed (Claude sometimes passes "5000" instead of 5000)
      const dur = typeof params.duration === 'string' ? parseFloat(params.duration) : params.duration
      if (typeof dur !== 'number' || isNaN(dur)) {
        throw new Error('Duration must be a number')
      }
      if (dur < 0 || dur > 30000) {
        throw new Error('Duration must be between 0 and 30000ms')
      }
      duration = dur
    }

    // Validate actions
    let actions: NotificationAction[] | undefined = undefined
    if (params.actions) {
      if (!Array.isArray(params.actions)) {
        throw new Error('Actions must be an array')
      }
      if (params.actions.length > 3) {
        throw new Error('Maximum 3 actions allowed')
      }

      actions = []
      for (const action of params.actions) {
        if (!action || typeof action !== 'object') {
          throw new Error('Each action must be an object')
        }
        if (!action.label || typeof action.label !== 'string') {
          throw new Error('Each action must have a label string')
        }
        if (!action.action || typeof action.action !== 'string') {
          throw new Error('Each action must have an action type')
        }
        if (action.action !== 'dismiss' && action.action !== 'prompt') {
          throw new Error(`Invalid action type: "${action.action}". Must be 'dismiss' or 'prompt'`)
        }
        if (action.action === 'prompt' && (!action.prompt || typeof action.prompt !== 'string')) {
          throw new Error('Action type "prompt" requires a prompt string')
        }

        actions.push({
          label: action.label.trim(),
          action: action.action as NotificationActionType,
          prompt: action.prompt ? action.prompt.trim() : undefined
        })
      }
    }

    // Validate position
    const validPositions: NotificationPosition[] = ['top-right', 'top-center', 'bottom-right']
    let position: NotificationPosition = 'top-right'
    if (params.position) {
      if (!validPositions.includes(params.position)) {
        throw new Error(`Invalid position: "${params.position}". Must be one of: ${validPositions.join(', ')}`)
      }
      position = params.position as NotificationPosition
    }

    const notificationId = generateNotificationId()

    // Log notification for debugging
    console.log('[show_notification]', {
      id: notificationId,
      severity,
      title,
      message: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
      duration,
      hasActions: !!actions,
      position,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      notification: {
        id: notificationId,
        message,
        severity,
        title,
        duration,
        actions,
        position,
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
