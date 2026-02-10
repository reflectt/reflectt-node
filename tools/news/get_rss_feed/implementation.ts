import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { rssParser, getRSSFeedsByCategory } from '@/lib/integrations/news/rss-parser'
import type { NewsArticle } from '@/lib/integrations/news/types'
import { isPaywalled } from '@/lib/integrations/news/types'
import { logger } from '@/lib/observability/logger'

interface GetRSSFeedInput {
  url?: string
  urls?: string[]
  category?: 'technology' | 'business' | 'science' | 'general' | 'entertainment'
  maxItems?: number
  maxItemsPerFeed?: number
}

interface GetRSSFeedSuccess {
  success: true
  articles: NewsArticle[]
  totalResults: number
  feedsCount: number
  paywallCount: number
  message: string
}

interface GetRSSFeedFailure {
  success: false
  error: string
}

type GetRSSFeedOutput = GetRSSFeedSuccess | GetRSSFeedFailure

export default async function getRSSFeed(
  input: GetRSSFeedInput,
  ctx: ToolContext
): Promise<GetRSSFeedOutput> {
  try {
    const {
      url,
      urls,
      category,
      maxItems = 20,
      maxItemsPerFeed = 10
    } = input

    // Determine which feeds to parse
    let feedUrls: string[] = []

    if (url) {
      // Single feed
      feedUrls = [url]
    } else if (urls && urls.length > 0) {
      // Multiple feeds
      feedUrls = urls
    } else if (category) {
      // Use popular feeds from category
      feedUrls = getRSSFeedsByCategory(category)
    } else {
      return {
        success: false,
        error: 'Must provide url, urls, or category parameter'
      }
    }

    if (feedUrls.length === 0) {
      return {
        success: false,
        error: 'No RSS feed URLs available'
      }
    }

    // Parse feeds
    const startTime = Date.now()
    let articles: NewsArticle[]

    if (feedUrls.length === 1) {
      // Parse single feed
      articles = await rssParser.parseFeed({
        url: feedUrls[0],
        maxItems
      })
    } else {
      // Parse multiple feeds
      articles = await rssParser.parseMultipleFeeds(feedUrls, maxItemsPerFeed)
    }

    const duration = Date.now() - startTime

    // Count paywalled articles
    const paywallCount = articles.filter(isPaywalled).length

    logger.info('RSS feed(s) parsed successfully', {
      operation: 'get_rss_feed',
      feedsCount: feedUrls.length,
      articlesCount: articles.length,
      category,
      paywallCount,
      duration
    })

    return {
      success: true,
      articles,
      totalResults: articles.length,
      feedsCount: feedUrls.length,
      paywallCount,
      message: `Retrieved ${articles.length} articles from ${feedUrls.length} RSS feed${feedUrls.length > 1 ? 's' : ''}${category ? ` (${category})` : ''}${paywallCount > 0 ? ` (${paywallCount} may be paywalled)` : ''}`
    }
  } catch (error) {
    logger.error('Get RSS feed failed', {
      operation: 'get_rss_feed',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error)
    }
  }
}
