import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface GetEntertainmentRecommendationsInput {
  based_on_content_id?: string
  content_type?: 'movie' | 'tv'
  genres?: string[]
  limit?: number
  min_rating?: number
}

interface RecommendedContent {
  id: number
  title: string
  description: string
  poster_path?: string
  release_date?: string
  vote_average: number
  popularity: number
  content_type: string
}

interface GetEntertainmentRecommendationsSuccess {
  success: true
  recommendations: RecommendedContent[]
  based_on?: string
  total: number
  message: string
}

interface GetEntertainmentRecommendationsFailure {
  success: false
  error: string
  configured: boolean
}

type GetEntertainmentRecommendationsOutput =
  | GetEntertainmentRecommendationsSuccess
  | GetEntertainmentRecommendationsFailure

/**
 * Get entertainment recommendations from TMDB
 */
export default async function getEntertainmentRecommendations(
  input: GetEntertainmentRecommendationsInput,
  ctx: ToolContext
): Promise<GetEntertainmentRecommendationsOutput> {
  try {
    const {
      based_on_content_id,
      content_type = 'movie',
      genres = [],
      limit = 10,
      min_rating = 6
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
    let recommendations: RecommendedContent[] = []
    let basedOnTitle: string | undefined

    // If based on a specific content, get recommendations from TMDB
    if (based_on_content_id) {
      const contentPath = content_type === 'movie' ? 'movie' : 'tv'
      const recommendUrl = `https://api.themoviedb.org/3/${contentPath}/${based_on_content_id}/recommendations?api_key=${apiKey}&language=en-US&page=1`

      const response = await fetch(recommendUrl)

      if (response.ok) {
        const data = await response.json()

        // Get the original content title for context
        try {
          const detailsUrl = `https://api.themoviedb.org/3/${contentPath}/${based_on_content_id}?api_key=${apiKey}`
          const detailsResponse = await fetch(detailsUrl)
          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json()
            basedOnTitle = detailsData.title || detailsData.name
          }
        } catch (error) {
          logger.warn('Failed to get content details', {
            operation: 'get_entertainment_recommendations'
          })
        }

        recommendations = data.results.slice(0, limit).map((item: any) => ({
          id: item.id,
          title: item.title || item.name,
          description: item.overview,
          poster_path: item.poster_path,
          release_date: item.release_date || item.first_air_date,
          vote_average: item.vote_average,
          popularity: item.popularity,
          content_type: content_type
        }))
      }
    }

    // If genres provided, get recommendations by genre
    if (genres && genres.length > 0) {
      // Get genre IDs
      const genreUrl = `https://api.themoviedb.org/3/genre/${content_type === 'movie' ? 'movie' : 'tv'}/list?api_key=${apiKey}&language=en-US`
      const genreResponse = await fetch(genreUrl)

      if (genreResponse.ok) {
        const genreData = await genreResponse.json()
        const genreIds = genreData.genres
          .filter((g: any) => genres.some(inputGenre => g.name.toLowerCase() === inputGenre.toLowerCase()))
          .map((g: any) => g.id)
          .join(',')

        if (genreIds) {
          const discoverUrl = `https://api.themoviedb.org/3/discover/${content_type === 'movie' ? 'movie' : 'tv'}?api_key=${apiKey}&with_genres=${genreIds}&sort_by=popularity.desc&vote_average.gte=${min_rating}&page=1`
          const discoverResponse = await fetch(discoverUrl)

          if (discoverResponse.ok) {
            const discoverData = await discoverResponse.json()

            const genreBasedRecs = discoverData.results.slice(0, limit).map((item: any) => ({
              id: item.id,
              title: item.title || item.name,
              description: item.overview,
              poster_path: item.poster_path,
              release_date: item.release_date || item.first_air_date,
              vote_average: item.vote_average,
              popularity: item.popularity,
              content_type: content_type
            }))

            // Merge with existing recommendations, avoiding duplicates
            const existingIds = new Set(recommendations.map(r => r.id))
            genreBasedRecs.forEach(rec => {
              if (!existingIds.has(rec.id) && recommendations.length < limit) {
                recommendations.push(rec)
              }
            })
          }
        }
      }
    }

    // If no recommendations yet, get popular content
    if (recommendations.length === 0) {
      const trendingUrl = `https://api.themoviedb.org/3/trending/${content_type}/week?api_key=${apiKey}`
      const trendingResponse = await fetch(trendingUrl)

      if (trendingResponse.ok) {
        const trendingData = await trendingResponse.json()
        recommendations = trendingData.results.slice(0, limit).map((item: any) => ({
          id: item.id,
          title: item.title || item.name,
          description: item.overview,
          poster_path: item.poster_path,
          release_date: item.release_date || item.first_air_date,
          vote_average: item.vote_average,
          popularity: item.popularity,
          content_type: content_type
        }))
      }
    }

    const duration = Date.now() - startTime

    logger.info('Entertainment recommendations retrieved', {
      operation: 'get_entertainment_recommendations',
      contentType: content_type,
      recommendationsCount: recommendations.length,
      duration
    })

    return {
      success: true,
      recommendations: recommendations.slice(0, limit),
      based_on: basedOnTitle,
      total: recommendations.length,
      message: `Found ${recommendations.length} ${content_type}${recommendations.length !== 1 ? 's' : ''} for you${basedOnTitle ? ` similar to "${basedOnTitle}"` : ''}`
    }
  } catch (error) {
    logger.error('Get entertainment recommendations failed', {
      operation: 'get_entertainment_recommendations',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: !!process.env.TMDB_API_KEY
    }
  }
}
