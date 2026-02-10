import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { newsapi } from '@/lib/integrations/news/newsapi-client'
import type { GetHeadlinesOptions, NewsArticle } from '@/lib/integrations/news/types'
import { isPaywalled } from '@/lib/integrations/news/types'
import { logger } from '@/lib/observability/logger'

interface GetHeadlinesInput extends GetHeadlinesOptions {
  // Extends GetHeadlinesOptions from types
}

interface GetHeadlinesSuccess {
  success: true
  articles: NewsArticle[]
  totalResults: number
  category?: string
  country: string
  cached: boolean
  paywallCount: number
  message: string
}

interface GetHeadlinesFailure {
  success: false
  error: string
  configured: boolean
}

type GetHeadlinesOutput = GetHeadlinesSuccess | GetHeadlinesFailure

// Simple in-memory cache for headlines (1 hour TTL)
const headlineCache = new Map<string, { data: NewsArticle[], timestamp: number }>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

/**
 * Get cache key from options
 */
function getCacheKey(options: GetHeadlinesInput): string {
  const { category, country, q, pageSize, page } = options
  return `headlines:${category || 'all'}:${country}:${q || ''}:${pageSize}:${page}`
}

/**
 * Get from cache if available and fresh
 */
function getFromCache(key: string): NewsArticle[] | null {
  const cached = headlineCache.get(key)
  if (!cached) return null

  const age = Date.now() - cached.timestamp
  if (age > CACHE_TTL) {
    headlineCache.delete(key)
    return null
  }

  logger.debug('Headlines cache hit', {
    operation: 'get_headlines',
    cacheKey: key,
    age
  })

  return cached.data
}

/**
 * Save to cache
 */
function saveToCache(key: string, data: NewsArticle[]): void {
  headlineCache.set(key, { data, timestamp: Date.now() })

  // Cleanup old entries (keep cache size under control)
  if (headlineCache.size > 100) {
    const oldestKey = Array.from(headlineCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0]
    headlineCache.delete(oldestKey)
  }
}

export default async function getHeadlines(
  input: GetHeadlinesInput,
  ctx: ToolContext
): Promise<GetHeadlinesOutput> {
  try {
    // Check if NewsAPI is configured
    if (!newsapi.isConfigured()) {
      return {
        success: false,
        error: 'NewsAPI not configured. Set NEWSAPI_API_KEY environment variable. Get API key from https://newsapi.org/register',
        configured: false
      }
    }

    const {
      category,
      country = 'us',
      q,
      pageSize = 20,
      page = 1
    } = input

    // Check cache first
    const cacheKey = getCacheKey(input)
    const cachedArticles = getFromCache(cacheKey)

    if (cachedArticles) {
      const paywallCount = cachedArticles.filter(isPaywalled).length

      return {
        success: true,
        articles: cachedArticles,
        totalResults: cachedArticles.length,
        category,
        country,
        cached: true,
        paywallCount,
        message: `Retrieved ${cachedArticles.length} cached headlines${category ? ` in ${category}` : ''}${q ? ` for "${q}"` : ''} from ${country.toUpperCase()}`
      }
    }

    // Fetch from NewsAPI
    const startTime = Date.now()
    const articles = await newsapi.getHeadlines({
      category,
      country,
      q,
      pageSize,
      page
    })
    const duration = Date.now() - startTime

    // Save to cache
    saveToCache(cacheKey, articles)

    // Count paywalled articles
    const paywallCount = articles.filter(isPaywalled).length

    logger.info('Headlines fetched successfully', {
      operation: 'get_headlines',
      articlesCount: articles.length,
      category,
      country,
      query: q,
      paywallCount,
      duration
    })

    return {
      success: true,
      articles,
      totalResults: articles.length,
      category,
      country,
      cached: false,
      paywallCount,
      message: `Retrieved ${articles.length} top headlines${category ? ` in ${category}` : ''}${q ? ` for "${q}"` : ''} from ${country.toUpperCase()}${paywallCount > 0 ? ` (${paywallCount} may be paywalled)` : ''}`
    }
  } catch (error) {
    logger.error('Get headlines failed', {
      operation: 'get_headlines',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: newsapi.isConfigured()
    }
  }
}
