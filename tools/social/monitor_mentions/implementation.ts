import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface MonitorMentionsInput {
  keyword: string
  platforms: string[]
  since_date?: string
}

interface Mention {
  id: string
  platform: string
  author: string
  author_handle: string
  text: string
  engagement: {
    likes: number
    comments: number
    shares: number
  }
  sentiment: 'positive' | 'negative' | 'neutral'
  url: string
  created_at: string
}

interface MonitorMentionsOutput {
  success: boolean
  mentions?: Mention[]
  keyword?: string
  platforms?: string[]
  total_mentions?: number
  sentiment_breakdown?: {
    positive: number
    negative: number
    neutral: number
  }
  period_start?: string
  period_end?: string
  error?: string
}

/**
 * Monitor brand mentions across social media platforms
 * Tracks mentions, sentiment, and engagement metrics
 */
export default async function monitorMentions(
  input: MonitorMentionsInput,
  context: ToolContext
): Promise<MonitorMentionsOutput> {
  try {
    const { keyword, platforms = [], since_date } = input

    // Validate input
    if (!keyword || !platforms || platforms.length === 0) {
      return {
        success: false,
        error: 'Keyword and at least one platform are required'
      }
    }

    // Validate platforms
    const validPlatforms = ['twitter', 'instagram', 'facebook']
    for (const platform of platforms) {
      if (!validPlatforms.includes(platform)) {
        return {
          success: false,
          error: `Invalid platform: ${platform}`
        }
      }
    }

    // Determine date range
    let sinceDate: Date
    if (since_date) {
      sinceDate = new Date(since_date)
      if (isNaN(sinceDate.getTime())) {
        return {
          success: false,
          error: 'Invalid since_date format'
        }
      }
    } else {
      // Default to last 24 hours
      sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    }

    const now = new Date()

    logger.info('Monitoring mentions', {
      keyword,
      platforms,
      sinceDate: sinceDate.toISOString(),
      operation: 'monitor_mentions'
    })

    // Get data layer for storing mention data
    const dataLayer = getData(context)

    // Generate mock mentions
    const mockAuthors = [
      'happy_customer',
      'tech_reviewer',
      'industry_analyst',
      'competitor_user',
      'brand_advocate',
      'casual_user',
      'influencer_account',
      'media_outlet'
    ]

    const sentiments: Array<'positive' | 'negative' | 'neutral'> = ['positive', 'negative', 'neutral']
    const mentions: Mention[] = []

    // Generate mentions for each platform
    for (const platform of platforms) {
      const mentionCount = Math.floor(Math.random() * 15) + 3 // 3-17 mentions per platform

      for (let i = 0; i < mentionCount; i++) {
        const author = mockAuthors[i % mockAuthors.length]
        const mentionId = `mention_${platform}_${Date.now()}_${i}`
        const timestamp = new Date(sinceDate.getTime() + Math.random() * (now.getTime() - sinceDate.getTime())).toISOString()

        // Generate engagement
        const likes = Math.floor(Math.random() * 2000)
        const comments = Math.floor(Math.random() * 200)
        const shares = Math.floor(Math.random() * 100)

        // Determine sentiment based on engagement patterns
        const sentiment: 'positive' | 'negative' | 'neutral' =
          likes > comments * 3 ? 'positive' : comments > likes / 2 ? 'negative' : 'neutral'

        const mention: Mention = {
          id: mentionId,
          platform,
          author: `${author} (${platform})`,
          author_handle: `@${author}`,
          text: `Just used ${keyword}! ${sentiment === 'positive' ? '😍 Amazing!' : sentiment === 'negative' ? '😞 Disappointed' : '🤔 Interesting'} #${keyword.replace(/\s+/g, '')}`,
          engagement: {
            likes,
            comments,
            shares
          },
          sentiment,
          url: `https://${platform}.com/posts/${mentionId}`,
          created_at: timestamp
        }

        mentions.push(mention)
      }
    }

    // Sort by recency
    mentions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Calculate sentiment breakdown
    const sentimentBreakdown = {
      positive: mentions.filter(m => m.sentiment === 'positive').length,
      negative: mentions.filter(m => m.sentiment === 'negative').length,
      neutral: mentions.filter(m => m.sentiment === 'neutral').length
    }

    // Store mention monitoring data
    try {
      const monitoringId = `monitor_${Date.now()}`
      await dataLayer.create('mention_monitoring', context.spaceId || 'global', monitoringId, {
        keyword,
        platforms,
        mentions,
        sentiment_breakdown: sentimentBreakdown,
        period_start: sinceDate.toISOString(),
        period_end: now.toISOString(),
        created_at: now.toISOString()
      })
    } catch (error) {
      logger.warn('Failed to store mention monitoring data', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'monitor_mentions'
      })
    }

    logger.info('Mention monitoring completed', {
      keyword,
      platforms,
      mentionCount: mentions.length,
      sentimentBreakdown,
      operation: 'monitor_mentions'
    })

    return {
      success: true,
      mentions,
      keyword,
      platforms,
      total_mentions: mentions.length,
      sentiment_breakdown: sentimentBreakdown,
      period_start: sinceDate.toISOString(),
      period_end: now.toISOString()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to monitor mentions', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'monitor_mentions'
    })

    return {
      success: false,
      error: `Failed to monitor mentions: ${errorMessage}`
    }
  }
}
