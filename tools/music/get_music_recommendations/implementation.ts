import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface GetMusicRecommendationsInput {
  seed_tracks?: string[]
  seed_artists?: string[]
  seed_genres?: string[]
  limit?: number
  target_energy?: number
  target_danceability?: number
  target_tempo?: number
  target_popularity?: number
}

interface RecommendedTrack {
  id: string
  name: string
  artist: string
  album: string
  preview_url?: string
  spotify_url?: string
  image_url?: string
  duration_ms: number
  popularity: number
  energy?: number
  danceability?: number
  tempo?: number
}

interface GetMusicRecommendationsSuccess {
  success: true
  recommendations: RecommendedTrack[]
  seeds: {
    tracks: string[]
    artists: string[]
    genres: string[]
  }
  message: string
}

interface GetMusicRecommendationsFailure {
  success: false
  error: string
  configured: boolean
}

type GetMusicRecommendationsOutput = GetMusicRecommendationsSuccess | GetMusicRecommendationsFailure

/**
 * Get personalized music recommendations from Spotify
 */
export default async function getMusicRecommendations(
  input: GetMusicRecommendationsInput,
  ctx: ToolContext
): Promise<GetMusicRecommendationsOutput> {
  try {
    const {
      seed_tracks = [],
      seed_artists = [],
      seed_genres = [],
      limit = 20,
      target_energy,
      target_danceability,
      target_tempo,
      target_popularity
    } = input

    // Validate seeds
    const totalSeeds = (seed_tracks?.length || 0) + (seed_artists?.length || 0) + (seed_genres?.length || 0)
    if (totalSeeds === 0) {
      return {
        success: false,
        error: 'Please provide at least one seed (track, artist, or genre)',
        configured: true
      }
    }

    if (totalSeeds > 5) {
      return {
        success: false,
        error: 'Maximum 5 seeds total (tracks + artists + genres)',
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

    // Build query parameters
    const params = new URLSearchParams()

    if (seed_tracks && seed_tracks.length > 0) {
      params.append('seed_tracks', seed_tracks.join(','))
    }
    if (seed_artists && seed_artists.length > 0) {
      params.append('seed_artists', seed_artists.join(','))
    }
    if (seed_genres && seed_genres.length > 0) {
      params.append('seed_genres', seed_genres.join(','))
    }

    params.append('limit', Math.min(limit, 100).toString())

    // Add audio feature targets
    if (target_energy !== undefined) {
      params.append('target_energy', target_energy.toString())
    }
    if (target_danceability !== undefined) {
      params.append('target_danceability', target_danceability.toString())
    }
    if (target_tempo !== undefined) {
      params.append('target_tempo', target_tempo.toString())
    }
    if (target_popularity !== undefined) {
      params.append('target_popularity', target_popularity.toString())
    }

    const url = `https://api.spotify.com/v1/recommendations?${params.toString()}`

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

    // Parse recommendations
    const recommendations: RecommendedTrack[] = data.tracks.map((track: any) => ({
      id: track.id,
      name: track.name,
      artist: track.artists?.[0]?.name || 'Unknown',
      album: track.album?.name || 'Unknown',
      preview_url: track.preview_url,
      spotify_url: track.external_urls?.spotify,
      image_url: track.album?.images?.[0]?.url,
      duration_ms: track.duration_ms,
      popularity: track.popularity,
      energy: track.energy,
      danceability: track.danceability,
      tempo: track.tempo
    }))

    logger.info('Music recommendations retrieved', {
      operation: 'get_music_recommendations',
      seedCount: totalSeeds,
      recommendationsCount: recommendations.length,
      duration
    })

    return {
      success: true,
      recommendations,
      seeds: {
        tracks: seed_tracks || [],
        artists: seed_artists || [],
        genres: seed_genres || []
      },
      message: `Found ${recommendations.length} recommended tracks based on your selection`
    }
  } catch (error) {
    logger.error('Get music recommendations failed', {
      operation: 'get_music_recommendations',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: true
    }
  }
}
