import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus, type ContextBusEvent } from '@/lib/components/context-bus'

interface GetComponentInteractionsInput {
  componentId: string
  since?: number
  includeEventTimeline?: boolean
  eventLimit?: number
}

interface EventSummary {
  type: string
  timestamp: number
  summary: string
  payload?: any
}

interface InteractionMetrics {
  totalEvents: number
  clicks: number
  dataUpdates: number
  selectionChanges: number
  filterChanges: number
  customEvents: number
  firstEvent?: number
  lastEvent?: number
  averageTimeBetweenEvents?: number
}

interface GetComponentInteractionsSuccess {
  success: true
  componentId: string
  timeRange: {
    since?: number
    until: number
  }
  metrics: InteractionMetrics
  recentEvents?: EventSummary[]
  activityTimeline?: {
    timestamp: number
    eventCount: number
  }[]
}

interface GetComponentInteractionsFailure {
  success: false
  error: string
}

type GetComponentInteractionsOutput =
  | GetComponentInteractionsSuccess
  | GetComponentInteractionsFailure

/**
 * Summarize an event for display
 */
function summarizeEvent(event: ContextBusEvent): string {
  switch (event.type) {
    case 'action_triggered':
      return `Action: ${event.payload?.action || 'unknown'}`
    case 'data_update':
      return `Data updated (${typeof event.payload === 'object' ? 'object' : typeof event.payload})`
    case 'selection_change':
      const selectionCount = Array.isArray(event.payload)
        ? event.payload.length
        : event.payload?.length || 1
      return `Selection changed (${selectionCount} items)`
    case 'filter_change':
      const filterCount = event.payload
        ? Object.keys(event.payload).length
        : 0
      return `Filters applied (${filterCount} filters)`
    case 'suggest_component':
      return `Component suggestion: ${event.payload?.componentId || 'unknown'}`
    case 'custom':
      return `Custom event: ${event.payload?.action || 'unknown'}`
    default:
      return `Event: ${event.type}`
  }
}

/**
 * Build activity timeline (events grouped by minute)
 */
function buildActivityTimeline(
  events: ContextBusEvent[],
  since?: number
): { timestamp: number; eventCount: number }[] {
  const minuteGroups = new Map<number, number>()

  events.forEach((event) => {
    if (since && event.timestamp < since) return

    // Round to nearest minute
    const minute = Math.floor(event.timestamp / 60000) * 60000
    minuteGroups.set(minute, (minuteGroups.get(minute) || 0) + 1)
  })

  return Array.from(minuteGroups.entries())
    .map(([timestamp, eventCount]) => ({ timestamp, eventCount }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

/**
 * Calculate interaction metrics
 */
function calculateMetrics(events: ContextBusEvent[]): InteractionMetrics {
  const metrics: InteractionMetrics = {
    totalEvents: events.length,
    clicks: 0,
    dataUpdates: 0,
    selectionChanges: 0,
    filterChanges: 0,
    customEvents: 0
  }

  if (events.length === 0) {
    return metrics
  }

  events.forEach((event) => {
    switch (event.type) {
      case 'action_triggered':
        metrics.clicks++
        break
      case 'data_update':
        metrics.dataUpdates++
        break
      case 'selection_change':
        metrics.selectionChanges++
        break
      case 'filter_change':
        metrics.filterChanges++
        break
      case 'custom':
        metrics.customEvents++
        break
    }
  })

  // Calculate timing metrics
  const timestamps = events.map((e) => e.timestamp).sort((a, b) => a - b)
  metrics.firstEvent = timestamps[0]
  metrics.lastEvent = timestamps[timestamps.length - 1]

  if (timestamps.length > 1) {
    const totalTime = metrics.lastEvent - metrics.firstEvent
    metrics.averageTimeBetweenEvents = totalTime / (timestamps.length - 1)
  }

  return metrics
}

export default async function getComponentInteractions(
  input: GetComponentInteractionsInput,
  ctx: ToolContext
): Promise<GetComponentInteractionsOutput> {
  try {
    const {
      componentId,
      since,
      includeEventTimeline = true,
      eventLimit = 10
    } = input

    // Get event history from context bus
    const allEvents = contextBus.getEventHistory()

    // Filter events for this component
    const relevantEvents = allEvents.filter((event) => {
      // Check if event is from or related to this component
      if (event.source === componentId) return true
      if (event.target === componentId) return true

      // Check if event payload references this component
      if (event.payload?.componentId === componentId) return true

      return false
    })

    // Apply time filter
    const filteredEvents = since
      ? relevantEvents.filter((e) => e.timestamp >= since)
      : relevantEvents

    // Calculate metrics
    const metrics = calculateMetrics(filteredEvents)

    // Build response
    const response: GetComponentInteractionsSuccess = {
      success: true,
      componentId,
      timeRange: {
        since,
        until: Date.now()
      },
      metrics
    }

    // Add recent events if requested
    if (includeEventTimeline) {
      const recentEvents = filteredEvents
        .slice(-eventLimit)
        .map((event) => ({
          type: event.type,
          timestamp: event.timestamp,
          summary: summarizeEvent(event),
          payload: event.payload
        }))

      response.recentEvents = recentEvents

      // Add activity timeline
      response.activityTimeline = buildActivityTimeline(filteredEvents, since)
    }

    return response
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
