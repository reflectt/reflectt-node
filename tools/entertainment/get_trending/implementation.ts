import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface GetTrendingInput {
  media_type?: 'movie' | 'tv' | 'all'
  time_window?: 'day' | 'week'
  limit?: number
}

interface TrendingItem {
  id: number
  title: string
  overview: string
  media_type: string
  poster_path?: string
  vote_average: number
  popularity: number
  release_date?: string
}

interface GetTrendingSuccess {
  success: true
  trending: TrendingItem[]
  media_type: string
  time_window: string
  total: number
  message: string
}

interface GetTrendingFailure {
  success: false
  error: string
  configured: boolean
}

type GetTrendingOutput = GetTrendingSuccess | GetTrendingFailure

/**
 * Get trending movies and TV shows
 */
export default async function getTrending(
  input: GetTrendingInput,
  ctx: ToolContext
): Promise<GetTrendingOutput> {
  try {
    const {
      media_type = 'all',
      time_window = 'week',
      limit = 10
    } = input

    const apiKey = process.env.TMDB_API_KEY
    if (!apiKey) {
      return {
        success: false,
        error: 'TMDB API key not configured. Set TMDB_API_KEY environment variable.',
        configured: false
      }
    }

    const startTime = Date.now()
    let allTrending: TrendingItem[] = []

    // Get trending based on media type
    if (media_type === 'movie' || media_type === 'all') {
      const movieUrl = `https://api.themoviedb.org/3/trending/movie/${time_window}?api_key=${apiKey}`
      const movieResponse = await fetch(movieUrl)

      if (movieResponse.ok) {
        const movieData = await movieResponse.json()
        allTrending = allTrending.concat(
          movieData.results.map((item: any) => ({
            id: item.id,
            title: item.title,
            overview: item.overview,
            media_type: 'movie',
            poster_path: item.poster_path,
            vote_average: item.vote_average,
            popularity: item.popularity,
            release_date: item.release_date
          }))
        )
      }
    }

    if (media_type === 'tv' || media_type === 'all') {
      const tvUrl = `https://api.themoviedb.org/3/trending/tv/${time_window}?api_key=${apiKey}`
      const tvResponse = await fetch(tvUrl)

      if (tvResponse.ok) {
        const tvData = await tvResponse.json()
        allTrending = allTrending.concat(
          tvData.results.map((item: any) => ({
            id: item.id,
            title: item.name,
            overview: item.overview,
            media_type: 'tv',
            poster_path: item.poster_path,
            vote_average: item.vote_average,
            popularity: item.popularity,
            release_date: item.first_air_date
          }))
        )
      }
    }

    // Sort by popularity and limit results
    const trending = allTrending
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, limit)

    const duration = Date.now() - startTime

    logger.info('Trending entertainment retrieved', {
      operation: 'get_trending',
      mediaType: media_type,
      timeWindow: time_window,
      trendingCount: trending.length,
      duration
    })

    const timeWindowText = time_window === 'day' ? 'today' : 'this week'

    return {
      success: true,
      trending,
      media_type,
      time_window,
      total: trending.length,
      message: `Found ${trending.length} trending ${media_type === 'all' ? 'items' : media_type}${media_type === 'all' ? 's' : ''} ${timeWindowText}`
    }
  } catch (error) {
    logger.error('Get trending failed', {
      operation: 'get_trending',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: !!process.env.TMDB_API_KEY
    }
  }
}
