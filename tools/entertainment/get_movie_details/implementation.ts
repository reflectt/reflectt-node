import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface GetMovieDetailsInput {
  movie_id: number
  include_cast?: boolean
  include_crew?: boolean
  include_videos?: boolean
  include_reviews?: boolean
}

interface CastMember {
  id: number
  name: string
  character: string
  profile_path?: string
}

interface CrewMember {
  id: number
  name: string
  job: string
  department: string
}

interface Video {
  id: string
  name: string
  type: string
  site: string
  key: string
  url?: string
}

interface Review {
  id: string
  author: string
  content: string
  rating?: number
}

interface GetMovieDetailsSuccess {
  success: true
  id: number
  title: string
  overview: string
  release_date?: string
  runtime?: number
  budget?: number
  revenue?: number
  genres?: Array<{ id: number; name: string }>
  vote_average: number
  popularity: number
  poster_path?: string
  backdrop_path?: string
  cast?: CastMember[]
  crew?: CrewMember[]
  videos?: Video[]
  reviews?: Review[]
  message: string
}

interface GetMovieDetailsFailure {
  success: false
  error: string
  configured: boolean
}

type GetMovieDetailsOutput = GetMovieDetailsSuccess | GetMovieDetailsFailure

/**
 * Get detailed information about a movie from TMDB
 */
export default async function getMovieDetails(
  input: GetMovieDetailsInput,
  ctx: ToolContext
): Promise<GetMovieDetailsOutput> {
  try {
    const {
      movie_id,
      include_cast = true,
      include_crew = true,
      include_videos = true,
      include_reviews = false
    } = input

    const apiKey = process.env.TMDB_API_KEY
    if (!apiKey) {
      return {
        success: false,
        error: 'TMDB API key not configured. Set TMDB_API_KEY environment variable.',
        configured: false
      }
    }

    // Build append_to_response parameter
    const appendParams: string[] = []
    if (include_cast || include_crew) appendParams.push('credits')
    if (include_videos) appendParams.push('videos')
    if (include_reviews) appendParams.push('reviews')

    // Get main movie details
    const params = new URLSearchParams({
      api_key: apiKey
    })

    if (appendParams.length > 0) {
      params.append('append_to_response', appendParams.join(','))
    }

    const url = `https://api.themoviedb.org/3/movie/${movie_id}?${params.toString()}`

    const startTime = Date.now()
    const response = await fetch(url)

    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: false,
          error: `Movie with ID ${movie_id} not found`,
          configured: true
        }
      }

      const error = await response.json().catch(() => ({}))
      throw new Error(`TMDB API error: ${response.status} ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    const duration = Date.now() - startTime

    // Build response
    const result: GetMovieDetailsSuccess = {
      success: true,
      id: data.id,
      title: data.title,
      overview: data.overview,
      release_date: data.release_date,
      runtime: data.runtime,
      budget: data.budget,
      revenue: data.revenue,
      genres: data.genres,
      vote_average: data.vote_average,
      popularity: data.popularity,
      poster_path: data.poster_path,
      backdrop_path: data.backdrop_path,
      message: `Retrieved details for "${data.title}" (${data.release_date?.split('-')[0] || 'N/A'})`
    }

    // Add cast if requested
    if (include_cast && data.credits?.cast) {
      result.cast = data.credits.cast.slice(0, 10).map((actor: any) => ({
        id: actor.id,
        name: actor.name,
        character: actor.character,
        profile_path: actor.profile_path
      }))
    }

    // Add crew if requested
    if (include_crew && data.credits?.crew) {
      result.crew = data.credits.crew
        .filter((person: any) => ['Director', 'Writer', 'Producer'].includes(person.job))
        .slice(0, 10)
        .map((person: any) => ({
          id: person.id,
          name: person.name,
          job: person.job,
          department: person.department
        }))
    }

    // Add videos if requested
    if (include_videos && data.videos?.results) {
      result.videos = data.videos.results
        .filter((video: any) => ['Trailer', 'Clip', 'Teaser'].includes(video.type))
        .slice(0, 5)
        .map((video: any) => ({
          id: video.id,
          name: video.name,
          type: video.type,
          site: video.site,
          key: video.key,
          url: video.site === 'YouTube' ? `https://www.youtube.com/watch?v=${video.key}` : undefined
        }))
    }

    // Add reviews if requested
    if (include_reviews && data.reviews?.results) {
      result.reviews = data.reviews.results.slice(0, 3).map((review: any) => ({
        id: review.id,
        author: review.author,
        content: review.content.substring(0, 200) + (review.content.length > 200 ? '...' : ''),
        rating: review.author_details?.rating
      }))
    }

    logger.info('Movie details retrieved', {
      operation: 'get_movie_details',
      movieId: movie_id,
      title: data.title,
      duration
    })

    return result
  } catch (error) {
    logger.error('Get movie details failed', {
      operation: 'get_movie_details',
      error: formatError(error),
      movieId: input.movie_id
    })

    return {
      success: false,
      error: formatError(error),
      configured: !!process.env.TMDB_API_KEY
    }
  }
}
