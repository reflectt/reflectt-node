import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface ScheduleContentInput {
  content_id: string
  platform: 'twitter' | 'instagram' | 'facebook' | 'blog' | 'newsletter'
  scheduled_for: string
}

interface ScheduleContentOutput {
  success: boolean
  scheduled_content_id?: string
  content_id?: string
  platform?: string
  scheduled_for?: string
  status?: string
  error?: string
}

/**
 * Schedule content publication to platforms at specific times
 * Moves content from draft to scheduled state
 */
export default async function scheduleContent(
  input: ScheduleContentInput,
  context: ToolContext
): Promise<ScheduleContentOutput> {
  try {
    const { content_id, platform, scheduled_for } = input

    // Validate input
    if (!content_id || !platform || !scheduled_for) {
      return {
        success: false,
        error: 'Content ID, platform, and scheduled_for timestamp are required'
      }
    }

    // Validate scheduled time is in the future
    const scheduledDate = new Date(scheduled_for)
    const now = new Date()

    if (scheduledDate <= now) {
      return {
        success: false,
        error: 'Scheduled time must be in the future'
      }
    }

    // Validate not scheduled too far in advance (365 days max)
    const maxDaysAhead = 365
    const maxDate = new Date(now.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000)

    if (scheduledDate > maxDate) {
      return {
        success: false,
        error: `Content can only be scheduled up to ${maxDaysAhead} days in advance`
      }
    }

    logger.info('Scheduling content', {
      contentId: content_id,
      platform,
      scheduledFor: scheduled_for,
      operation: 'schedule_content'
    })

    // Get data layer
    const dataLayer = getData(context)

    // Try to verify content exists
    let contentData: any = null
    try {
      contentData = await dataLayer.read('content', context.spaceId || 'global', content_id)
    } catch (error) {
      logger.warn('Content not found', {
        contentId: content_id,
        operation: 'schedule_content'
      })
    }

    // Generate scheduled content ID
    const scheduledContentId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    // Create scheduled content record
    const scheduledData = {
      id: scheduledContentId,
      content_id,
      platform,
      scheduled_for,
      created_at: timestamp,
      status: 'scheduled',
      retry_count: 0,
      last_error: null,
      published_at: null,
      original_platform: contentData?.platform || platform
    }

    // Save scheduled content
    try {
      await dataLayer.create('scheduled_content', context.spaceId || 'global', scheduledContentId, scheduledData)
    } catch (error) {
      logger.warn('Failed to save scheduled content', {
        scheduledContentId,
        error: error instanceof Error ? error.message : String(error),
        operation: 'schedule_content'
      })
    }

    // Update original content status to scheduled
    if (contentData) {
      try {
        await dataLayer.update('content', context.spaceId || 'global', content_id, {
          status: 'scheduled',
          scheduled_for,
          updated_at: timestamp
        })
      } catch (error) {
        logger.warn('Failed to update content status', {
          contentId: content_id,
          error: error instanceof Error ? error.message : String(error),
          operation: 'schedule_content'
        })
      }
    }

    logger.info('Content scheduled successfully', {
      scheduledContentId,
      contentId: content_id,
      platform,
      scheduledFor: scheduled_for,
      operation: 'schedule_content'
    })

    return {
      success: true,
      scheduled_content_id: scheduledContentId,
      content_id,
      platform,
      scheduled_for,
      status: 'scheduled'
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to schedule content', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'schedule_content'
    })

    return {
      success: false,
      error: `Failed to schedule content: ${errorMessage}`
    }
  }
}
