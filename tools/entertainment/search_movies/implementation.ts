import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface SearchMoviesInput {
  query: string
  year?: number
  limit?: number
  page?: number
}

interface MovieResult {
  id: number
  title: string
  overview: string
  release_date?: string
  poster_path?: string
  vote_average: number
  popularity: number
  genre_ids?: number[]
  media_type?: string
}

interface SearchMoviesSuccess {
  success: true
  movies: MovieResult[]
  total_results: number
  query: string
  message: string
}

interface SearchMoviesFailure {
  success: false
  error: string
  configured: boolean
}

type SearchMoviesOutput = SearchMoviesSuccess | SearchMoviesFailure

/**
 * Search for movies on TMDB
 */
export default async function searchMovies(
  input: SearchMoviesInput,
  ctx: ToolContext
): Promise<SearchMoviesOutput> {
  try {
    const {
      query,
      year,
      limit = 10,
      page = 1
    } = input

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Search query cannot be empty',
        configured: true
      }
    }

    const apiKey = process.env.TMDB_API_KEY
    if (!apiKey) {
      return {
        success: false,
        error: 'TMDB API key not configured. Set TMDB_API_KEY environment variable. Get key from https://www.themoviedb.org/settings/api',
        configured: false
      }
    }

    // Build query parameters
    const params = new URLSearchParams({
      api_key: apiKey,
      query: query,
      page: page.toString(),
      include_adult: 'false'
    })

    if (year) {
      params.append('year', year.toString())
    }

    const url = `https://api.themoviedb.org/3/search/movie?${params.toString()}`

    const startTime = Date.now()
    const response = await fetch(url)

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(`TMDB API error: ${response.status} ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    const duration = Date.now() - startTime

    // Parse and limit results
    const movies: MovieResult[] = data.results.slice(0, limit).map((movie: any) => ({
      id: movie.id,
      title: movie.title,
      overview: movie.overview,
      release_date: movie.release_date,
      poster_path: movie.poster_path,
      vote_average: movie.vote_average,
      popularity: movie.popularity,
      genre_ids: movie.genre_ids
    }))

    logger.info('Movies search completed', {
      operation: 'search_movies',
      query,
      moviesCount: movies.length,
      duration
    })

    return {
      success: true,
      movies,
      total_results: data.total_results,
      query,
      message: `Found ${movies.length} movies matching "${query}"${year ? ` from ${year}` : ''}`
    }
  } catch (error) {
    logger.error('Movie search failed', {
      operation: 'search_movies',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: !!process.env.TMDB_API_KEY
    }
  }
}
