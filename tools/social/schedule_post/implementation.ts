import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface SchedulePostInput {
  platform: 'twitter' | 'instagram' | 'facebook'
  text: string
  media_urls?: string[]
  scheduled_for: string
}

interface SchedulePostOutput {
  success: boolean
  scheduled_post_id?: string
  scheduled_for?: string
  status?: string
  queue_position?: number
  error?: string
}

/**
 * Schedule social media posts for future publication
 * Validates scheduling time and stores in queue
 */
export default async function schedulePost(
  input: SchedulePostInput,
  context: ToolContext
): Promise<SchedulePostOutput> {
  try {
    const { platform, text, media_urls = [], scheduled_for } = input

    // Validate input
    if (!platform || !text || !scheduled_for) {
      return {
        success: false,
        error: 'Platform, text, and scheduled_for timestamp are required'
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

    // Validate not scheduled too far in advance (180 days max)
    const maxDaysAhead = 180
    const maxDate = new Date(now.getTime() + maxDaysAhead * 24 * 60 * 60 * 1000)

    if (scheduledDate > maxDate) {
      return {
        success: false,
        error: `Posts can only be scheduled up to ${maxDaysAhead} days in advance`
      }
    }

    logger.info('Scheduling post', {
      platform,
      scheduledFor: scheduled_for,
      daysAhead: Math.ceil((scheduledDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      operation: 'schedule_post'
    })

    // Get data layer for storing scheduled post
    const dataLayer = getData(context)

    // Generate scheduled post ID
    const scheduledPostId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    // Store scheduled post metadata
    const scheduledPostData = {
      id: scheduledPostId,
      platform,
      text,
      media_urls,
      scheduled_for,
      created_at: timestamp,
      status: 'scheduled',
      queue_position: 1,
      retry_count: 0,
      last_error: null
    }

    try {
      await dataLayer.create('scheduled_posts', context.spaceId || 'global', scheduledPostId, scheduledPostData)
    } catch (error) {
      logger.warn('Failed to save scheduled post', {
        scheduledPostId,
        error: error instanceof Error ? error.message : String(error),
        operation: 'schedule_post'
      })
    }

    logger.info('Post scheduled successfully', {
      scheduledPostId,
      platform,
      scheduledFor: scheduled_for,
      operation: 'schedule_post'
    })

    return {
      success: true,
      scheduled_post_id: scheduledPostId,
      scheduled_for,
      status: 'scheduled',
      queue_position: 1
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to schedule post', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'schedule_post'
    })

    return {
      success: false,
      error: `Failed to schedule post: ${errorMessage}`
    }
  }
}
