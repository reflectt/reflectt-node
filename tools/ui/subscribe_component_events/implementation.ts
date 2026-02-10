import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'

interface SubscribeComponentEventsInput {
  events: string[]
  componentId?: string
  autoRespond?: Record<string, { action: string }>
}

interface SubscribeComponentEventsSuccess {
  success: true
  subscriptionId: string
  subscribedEvents: string[]
  componentId?: string
  autoRespond?: Record<string, { action: string }>
  message: string
}

interface SubscribeComponentEventsFailure {
  success: false
  error: string
}

type SubscribeComponentEventsOutput = SubscribeComponentEventsSuccess | SubscribeComponentEventsFailure

// Global subscription registry (persists across tool calls)
const activeSubscriptions = new Map<string, () => void>()

export default async function subscribeComponentEvents(
  input: SubscribeComponentEventsInput,
  ctx: ToolContext
): Promise<SubscribeComponentEventsOutput> {
  try {
    const { events, componentId, autoRespond } = input

    // Validate events array
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error('events must be a non-empty array')
    }

    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Create subscription callback
    const unsubscribe = contextBus.subscribe(
      componentId || 'all',
      (event) => {
        if (events.includes(event.type)) {
          console.log(`[EventSubscription ${subscriptionId}] Received event:`, {
            type: event.type,
            source: event.source,
            target: event.target,
            timestamp: event.timestamp,
            payload: event.payload
          })

          // If auto-respond is configured, log the action
          if (autoRespond && autoRespond[event.type]) {
            console.log(
              `[EventSubscription ${subscriptionId}] Auto-respond action:`,
              autoRespond[event.type].action
            )
            // TODO: Could trigger automatic AI responses here
            // For now, just log - AI will see events in next query
          }
        }
      }
    )

    // Store unsubscribe function
    activeSubscriptions.set(subscriptionId, unsubscribe)

    // Log active subscriptions count
    console.log(
      `[EventSubscription] Active subscriptions: ${activeSubscriptions.size}`,
      Array.from(activeSubscriptions.keys())
    )

    return {
      success: true,
      subscriptionId,
      subscribedEvents: events,
      componentId,
      autoRespond,
      message: `Successfully subscribed to ${events.join(', ')} events${componentId ? ` from component ${componentId}` : ' from all components'}. Subscription ID: ${subscriptionId}`
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}

/**
 * Cleanup helper - can be called to unsubscribe
 * Not exposed as a tool, but available for internal use
 */
export function unsubscribeComponentEvents(subscriptionId: string): boolean {
  const unsubscribe = activeSubscriptions.get(subscriptionId)
  if (unsubscribe) {
    unsubscribe()
    activeSubscriptions.delete(subscriptionId)
    console.log(`[EventSubscription] Unsubscribed: ${subscriptionId}`)
    return true
  }
  console.warn(`[EventSubscription] Subscription not found: ${subscriptionId}`)
  return false
}

/**
 * Get all active subscription IDs
 */
export function getActiveSubscriptions(): string[] {
  return Array.from(activeSubscriptions.keys())
}

/**
 * Clear all subscriptions (useful for cleanup)
 */
export function clearAllSubscriptions(): void {
  activeSubscriptions.forEach((unsubscribe, id) => {
    unsubscribe()
    console.log(`[EventSubscription] Cleared subscription: ${id}`)
  })
  activeSubscriptions.clear()
  console.log('[EventSubscription] All subscriptions cleared')
}
