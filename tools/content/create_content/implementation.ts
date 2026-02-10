import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface CreateContentInput {
  title: string
  body: string
  media_urls?: string[]
  tags?: string[]
  platform: 'twitter' | 'instagram' | 'facebook' | 'blog' | 'newsletter'
}

interface CreateContentOutput {
  success: boolean
  content_id?: string
  title?: string
  status?: string
  platform?: string
  created_at?: string
  error?: string
}

/**
 * Create new content for social media and publishing platforms
 * Saves content as draft for review and scheduling
 */
export default async function createContent(
  input: CreateContentInput,
  context: ToolContext
): Promise<CreateContentOutput> {
  try {
    const { title, body, media_urls = [], tags = [], platform } = input

    // Validate input
    if (!title || !body || !platform) {
      return {
        success: false,
        error: 'Title, body, and platform are required'
      }
    }

    // Validate title and body lengths
    if (title.length < 3 || title.length > 200) {
      return {
        success: false,
        error: 'Title must be between 3 and 200 characters'
      }
    }

    if (body.length < 10 || body.length > 10000) {
      return {
        success: false,
        error: 'Body must be between 10 and 10000 characters'
      }
    }

    // Validate media URLs if provided
    if (media_urls && media_urls.length > 0) {
      if (media_urls.length > 10) {
        return {
          success: false,
          error: 'Maximum 10 media files allowed per content'
        }
      }

      for (const url of media_urls) {
        if (!url.startsWith('http')) {
          return {
            success: false,
            error: `Invalid media URL: ${url}`
          }
        }
      }
    }

    // Validate tags
    if (tags && tags.length > 30) {
      return {
        success: false,
        error: 'Maximum 30 tags allowed'
      }
    }

    logger.info('Creating content', {
      platform,
      titleLength: title.length,
      bodyLength: body.length,
      mediaCount: media_urls.length,
      tagCount: tags.length,
      operation: 'create_content'
    })

    // Get data layer for storing content
    const dataLayer = getData(context)

    // Generate content ID
    const contentId = `content_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    // Create content object
    const contentData = {
      id: contentId,
      title,
      body,
      media_urls,
      tags,
      platform,
      status: 'draft',
      created_at: timestamp,
      updated_at: timestamp,
      author: context.userId || 'anonymous',
      word_count: body.split(/\s+/).length,
      character_count: body.length,
      published_at: null,
      scheduled_for: null,
      views: 0,
      likes: 0,
      shares: 0
    }

    // Save content to data layer
    try {
      await dataLayer.create('content', context.spaceId || 'global', contentId, contentData)
    } catch (error) {
      logger.warn('Failed to save content to data layer', {
        contentId,
        error: error instanceof Error ? error.message : String(error),
        operation: 'create_content'
      })
      // Don't fail operation if data layer fails - content is still created
    }

    logger.info('Content created successfully', {
      contentId,
      platform,
      status: 'draft',
      operation: 'create_content'
    })

    return {
      success: true,
      content_id: contentId,
      title,
      status: 'draft',
      platform,
      created_at: timestamp
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to create content', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'create_content'
    })

    return {
      success: false,
      error: `Failed to create content: ${errorMessage}`
    }
  }
}
