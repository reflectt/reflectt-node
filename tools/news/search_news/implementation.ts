import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { newsapi } from '@/lib/integrations/news/newsapi-client'
import type { SearchNewsOptions, NewsArticle } from '@/lib/integrations/news/types'
import { isPaywalled } from '@/lib/integrations/news/types'
import { logger } from '@/lib/observability/logger'

interface SearchNewsInput extends SearchNewsOptions {
  // Extends SearchNewsOptions from types
}

interface SearchNewsSuccess {
  success: true
  articles: NewsArticle[]
  totalResults: number
  query: string
  sortBy: string
  cached: boolean
  paywallCount: number
  dateRange?: {
    from?: string
    to?: string
  }
  message: string
}

interface SearchNewsFailure {
  success: false
  error: string
  configured: boolean
}

type SearchNewsOutput = SearchNewsSuccess | SearchNewsFailure

// Simple in-memory cache for search results (24 hour TTL)
const searchCache = new Map<string, { data: NewsArticle[], timestamp: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Get cache key from options
 */
function getCacheKey(options: SearchNewsInput): string {
  const { q, from, to, language, sortBy, pageSize, page, sources, domains, excludeDomains } = options
  return `search:${q}:${from || ''}:${to || ''}:${language || ''}:${sortBy}:${pageSize}:${page}:${sources || ''}:${domains || ''}:${excludeDomains || ''}`
}

/**
 * Get from cache if available and fresh
 */
function getFromCache(key: string): NewsArticle[] | null {
  const cached = searchCache.get(key)
  if (!cached) return null

  const age = Date.now() - cached.timestamp
  if (age > CACHE_TTL) {
    searchCache.delete(key)
    return null
  }

  logger.debug('Search cache hit', {
    operation: 'search_news',
    cacheKey: key,
    age
  })

  return cached.data
}

/**
 * Save to cache
 */
function saveToCache(key: string, data: NewsArticle[]): void {
  searchCache.set(key, { data, timestamp: Date.now() })

  // Cleanup old entries (keep cache size under control)
  if (searchCache.size > 100) {
    const oldestKey = Array.from(searchCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0]
    searchCache.delete(oldestKey)
  }
}

export default async function searchNews(
  input: SearchNewsInput,
  ctx: ToolContext
): Promise<SearchNewsOutput> {
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
      q,
      from,
      to,
      language,
      sortBy = 'publishedAt',
      pageSize = 20,
      page = 1,
      sources,
      domains,
      excludeDomains
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
        query: q,
        sortBy,
        cached: true,
        paywallCount,
        dateRange: from || to ? { from, to } : undefined,
        message: `Retrieved ${cachedArticles.length} cached articles for "${q}"${from || to ? ` (${from || 'any'} to ${to || 'now'})` : ''}`
      }
    }

    // Search using NewsAPI
    const startTime = Date.now()
    const articles = await newsapi.searchNews({
      q,
      from,
      to,
      language,
      sortBy,
      pageSize,
      page,
      sources,
      domains,
      excludeDomains
    })
    const duration = Date.now() - startTime

    // Save to cache
    saveToCache(cacheKey, articles)

    // Count paywalled articles
    const paywallCount = articles.filter(isPaywalled).length

    logger.info('News search completed successfully', {
      operation: 'search_news',
      articlesCount: articles.length,
      query: q,
      sortBy,
      paywallCount,
      dateRange: from || to ? { from, to } : undefined,
      duration
    })

    return {
      success: true,
      articles,
      totalResults: articles.length,
      query: q,
      sortBy,
      cached: false,
      paywallCount,
      dateRange: from || to ? { from, to } : undefined,
      message: `Found ${articles.length} articles for "${q}"${from || to ? ` (${from || 'any'} to ${to || 'now'})` : ''}${paywallCount > 0 ? ` (${paywallCount} may be paywalled)` : ''}`
    }
  } catch (error) {
    logger.error('Search news failed', {
      operation: 'search_news',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: newsapi.isConfigured()
    }
  }
}
