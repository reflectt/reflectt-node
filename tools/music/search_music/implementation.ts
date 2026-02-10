import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface SearchMusicInput {
  query: string
  type?: 'track' | 'album' | 'artist' | 'playlist'
  limit?: number
  offset?: number
}

interface MusicResult {
  id: string
  name: string
  artist?: string
  album?: string
  type: string
  preview_url?: string
  spotify_url?: string
  image_url?: string
  duration_ms?: number
  popularity?: number
  release_date?: string
}

interface SearchMusicSuccess {
  success: true
  results: MusicResult[]
  total: number
  type: string
  query: string
  message: string
}

interface SearchMusicFailure {
  success: false
  error: string
  configured: boolean
}

type SearchMusicOutput = SearchMusicSuccess | SearchMusicFailure

/**
 * Search Spotify for music content
 *
 * Requires Spotify OAuth credentials to be set up
 */
export default async function searchMusic(
  input: SearchMusicInput,
  ctx: ToolContext
): Promise<SearchMusicOutput> {
  try {
    const {
      query,
      type = 'track',
      limit = 20,
      offset = 0
    } = input

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Search query cannot be empty',
        configured: true
      }
    }

    // Get Spotify OAuth credentials
    const credentials = await ctx.getOAuthCredentials('spotify')
    if (!credentials) {
      return {
        success: false,
        error: 'Spotify credentials not configured. Please authorize Spotify access first.',
        configured: false
      }
    }

    const accessToken = await ctx.getOAuthAccessToken(credentials)

    // Build Spotify search query
    const params = new URLSearchParams({
      q: query,
      type: type,
      limit: Math.min(limit, 50).toString(),
      offset: offset.toString()
    })

    const url = `https://api.spotify.com/v1/search?${params.toString()}`

    const startTime = Date.now()
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(`Spotify API error: ${response.status} ${JSON.stringify(error)}`)
    }

    const data = await response.json()
    const duration = Date.now() - startTime

    // Parse results based on type
    const results: MusicResult[] = []
    const typeKey = type === 'track' ? 'tracks' :
                    type === 'album' ? 'albums' :
                    type === 'artist' ? 'artists' : 'playlists'

    if (data[typeKey]?.items) {
      data[typeKey].items.forEach((item: any) => {
        const result: MusicResult = {
          id: item.id,
          name: item.name,
          type: type
        }

        if (type === 'track') {
          result.artist = item.artists?.[0]?.name
          result.album = item.album?.name
          result.preview_url = item.preview_url
          result.duration_ms = item.duration_ms
          result.popularity = item.popularity
          result.image_url = item.album?.images?.[0]?.url
        } else if (type === 'album') {
          result.artist = item.artists?.[0]?.name
          result.release_date = item.release_date
          result.image_url = item.images?.[0]?.url
        } else if (type === 'artist') {
          result.popularity = item.popularity
          result.image_url = item.images?.[0]?.url
        } else if (type === 'playlist') {
          result.artist = item.owner?.display_name
          result.image_url = item.images?.[0]?.url
        }

        result.spotify_url = item.external_urls?.spotify

        results.push(result)
      })
    }

    logger.info('Music search completed', {
      operation: 'search_music',
      query,
      type,
      resultsCount: results.length,
      duration
    })

    return {
      success: true,
      results,
      total: data[typeKey]?.total || results.length,
      type,
      query,
      message: `Found ${results.length} ${type}${results.length !== 1 ? 's' : ''} matching "${query}"`
    }
  } catch (error) {
    logger.error('Music search failed', {
      operation: 'search_music',
      error: formatError(error),
      query: input.query
    })

    return {
      success: false,
      error: formatError(error),
      configured: true
    }
  }
}
