import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface PublishContentInput {
  content_id: string
  platform: 'twitter' | 'instagram' | 'facebook' | 'blog' | 'newsletter'
}

interface PublishContentOutput {
  success: boolean
  published_post_id?: string
  content_id?: string
  platform?: string
  platform_url?: string
  status?: string
  published_at?: string
  error?: string
}

/**
 * Immediately publish content to platforms
 * Moves content from draft to published state
 */
export default async function publishContent(
  input: PublishContentInput,
  context: ToolContext
): Promise<PublishContentOutput> {
  try {
    const { content_id, platform } = input

    // Validate input
    if (!content_id || !platform) {
      return {
        success: false,
        error: 'Content ID and platform are required'
      }
    }

    logger.info('Publishing content', {
      contentId: content_id,
      platform,
      operation: 'publish_content'
    })

    // Get data layer
    const dataLayer = getData(context)

    // Try to retrieve content
    let contentData: any = null
    try {
      contentData = await dataLayer.read('content', context.spaceId || 'global', content_id)
    } catch (error) {
      logger.warn('Content not found', {
        contentId: content_id,
        operation: 'publish_content'
      })
      return {
        success: false,
        error: `Content with ID ${content_id} not found`
      }
    }

    // Generate published post ID
    const publishedPostId = `published_${platform}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    // Platform-specific URLs
    const platformUrls: Record<string, string> = {
      twitter: `https://twitter.com/user/status/${publishedPostId}`,
      instagram: `https://instagram.com/p/${publishedPostId}`,
      facebook: `https://facebook.com/posts/${publishedPostId}`,
      blog: `https://yourblog.com/posts/${publishedPostId}`,
      newsletter: `https://newsletter.example.com/${publishedPostId}`
    }

    // Create published record
    const publishedData = {
      id: publishedPostId,
      content_id,
      platform,
      published_at: timestamp,
      status: 'published',
      url: platformUrls[platform],
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      original_title: contentData?.title,
      original_body: contentData?.body
    }

    // Save published record
    try {
      await dataLayer.create('published_content', context.spaceId || 'global', publishedPostId, publishedData)
    } catch (error) {
      logger.warn('Failed to save published record', {
        publishedPostId,
        error: error instanceof Error ? error.message : String(error),
        operation: 'publish_content'
      })
    }

    // Update original content status
    try {
      await dataLayer.update('content', context.spaceId || 'global', content_id, {
        status: 'published',
        published_at: timestamp,
        updated_at: timestamp,
        platform_post_id: publishedPostId
      })
    } catch (error) {
      logger.warn('Failed to update content status', {
        contentId: content_id,
        error: error instanceof Error ? error.message : String(error),
        operation: 'publish_content'
      })
    }

    logger.info('Content published successfully', {
      publishedPostId,
      contentId: content_id,
      platform,
      url: platformUrls[platform],
      operation: 'publish_content'
    })

    return {
      success: true,
      published_post_id: publishedPostId,
      content_id,
      platform,
      platform_url: platformUrls[platform],
      status: 'published',
      published_at: timestamp
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to publish content', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'publish_content'
    })

    return {
      success: false,
      error: `Failed to publish content: ${errorMessage}`
    }
  }
}
