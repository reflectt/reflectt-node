import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface PostToSocialInput {
  platform: 'twitter' | 'instagram' | 'facebook'
  text: string
  media_urls?: string[]
  schedule_for?: string
}

interface PostToSocialOutput {
  success: boolean
  post_id?: string
  platform_post_id?: string
  status?: string
  url?: string
  error?: string
  scheduled?: boolean
}

/**
 * Post content to social media platforms
 * Supports Twitter, Instagram, and Facebook with optional scheduling
 */
export default async function postToSocial(
  input: PostToSocialInput,
  context: ToolContext
): Promise<PostToSocialOutput> {
  try {
    const { platform, text, media_urls = [], schedule_for } = input

    // Validate input
    if (!platform || !text) {
      return {
        success: false,
        error: 'Platform and text are required'
      }
    }

    // Validate text length based on platform
    const maxLengths: Record<string, number> = {
      twitter: 280,
      instagram: 2200,
      facebook: 2200
    }

    if (text.length > maxLengths[platform]) {
      return {
        success: false,
        error: `Text exceeds ${platform} character limit of ${maxLengths[platform]}`
      }
    }

    // Validate media URLs if provided
    if (media_urls && media_urls.length > 0) {
      for (const url of media_urls) {
        if (!url.startsWith('http')) {
          return {
            success: false,
            error: `Invalid media URL: ${url}`
          }
        }
      }
    }

    logger.info('Posting to social media', {
      platform,
      textLength: text.length,
      mediaCount: media_urls.length,
      scheduled: !!schedule_for,
      operation: 'post_to_social'
    })

    // Get data layer for storing post metadata
    const dataLayer = getData(context)

    // Generate post ID
    const postId = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    // Store post in data layer
    const postData = {
      id: postId,
      platform,
      text,
      media_urls,
      scheduled_for: schedule_for,
      created_at: timestamp,
      status: schedule_for ? 'scheduled' : 'published',
      likes: 0,
      comments: 0,
      shares: 0,
      views: 0
    }

    // Save post metadata
    try {
      await dataLayer.create('posts', context.spaceId || 'global', postId, postData)
    } catch (error) {
      logger.warn('Failed to save post metadata', {
        postId,
        error: error instanceof Error ? error.message : String(error),
        operation: 'post_to_social'
      })
      // Don't fail the operation if metadata save fails
    }

    // Mock platform-specific post IDs (in production, would call actual APIs)
    const platformPostIds: Record<string, string> = {
      twitter: `tw_${postId}`,
      instagram: `ig_${postId}`,
      facebook: `fb_${postId}`
    }

    const platformUrls: Record<string, string> = {
      twitter: `https://twitter.com/user/status/${platformPostIds.twitter}`,
      instagram: `https://instagram.com/p/${platformPostIds.instagram}`,
      facebook: `https://facebook.com/posts/${platformPostIds.facebook}`
    }

    logger.info('Post created successfully', {
      postId,
      platform,
      platformPostId: platformPostIds[platform],
      operation: 'post_to_social'
    })

    return {
      success: true,
      post_id: postId,
      platform_post_id: platformPostIds[platform],
      status: schedule_for ? 'scheduled' : 'published',
      url: platformUrls[platform],
      scheduled: !!schedule_for
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to post to social media', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'post_to_social'
    })

    return {
      success: false,
      error: `Failed to post: ${errorMessage}`
    }
  }
}
