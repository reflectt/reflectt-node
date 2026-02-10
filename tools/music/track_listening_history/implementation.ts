import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface TrackListeningHistoryInput {
  limit?: number
  after_timestamp?: number
  before_timestamp?: number
}

interface PlayedTrack {
  id: string
  name: string
  artist: string
  album: string
  played_at: string
  played_at_unix: number
  preview_url?: string
  spotify_url?: string
  image_url?: string
  duration_ms: number
  context?: {
    type: string
    name: string
  }
}

interface TrackListeningHistorySuccess {
  success: true
  tracks: PlayedTrack[]
  total: number
  message: string
}

interface TrackListeningHistoryFailure {
  success: false
  error: string
  configured: boolean
}

type TrackListeningHistoryOutput = TrackListeningHistorySuccess | TrackListeningHistoryFailure

/**
 * Get user's recently played tracks
 */
export default async function trackListeningHistory(
  input: TrackListeningHistoryInput,
  ctx: ToolContext
): Promise<TrackListeningHistoryOutput> {
  try {
    const {
      limit = 20,
      after_timestamp,
      before_timestamp
    } = input

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
    const params = new URLSearchParams({
      limit: Math.min(limit, 50).toString()
    })

    if (after_timestamp) {
      params.append('after', after_timestamp.toString())
    }
    if (before_timestamp) {
      params.append('before', before_timestamp.toString())
    }

    const url = `https://api.spotify.com/v1/me/player/recently-played?${params.toString()}`

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

    // Parse recently played tracks
    const tracks: PlayedTrack[] = data.items.map((item: any) => {
      const playedAtDate = new Date(item.played_at)

      return {
        id: item.track.id,
        name: item.track.name,
        artist: item.track.artists?.[0]?.name || 'Unknown',
        album: item.track.album?.name || 'Unknown',
        played_at: item.played_at,
        played_at_unix: playedAtDate.getTime(),
        preview_url: item.track.preview_url,
        spotify_url: item.track.external_urls?.spotify,
        image_url: item.track.album?.images?.[0]?.url,
        duration_ms: item.track.duration_ms,
        context: item.context ? {
          type: item.context.type,
          name: item.context.href?.includes('/playlist/') ? 'Playlist' : item.context.type
        } : undefined
      }
    })

    logger.info('Listening history retrieved', {
      operation: 'track_listening_history',
      trackCount: tracks.length,
      duration
    })

    return {
      success: true,
      tracks,
      total: tracks.length,
      message: `Retrieved ${tracks.length} recently played tracks`
    }
  } catch (error) {
    logger.error('Get listening history failed', {
      operation: 'track_listening_history',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: true
    }
  }
}
