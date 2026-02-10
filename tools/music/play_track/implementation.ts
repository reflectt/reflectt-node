import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface PlayTrackInput {
  track_id: string
  device_id?: string
  include_now_playing?: boolean
}

interface TrackInfo {
  id: string
  name: string
  artist: string
  album: string
  duration_ms: number
  image_url?: string
  spotify_url?: string
}

interface PlaybackState {
  is_playing: boolean
  device: {
    id: string
    name: string
    type: string
  }
}

interface PlayTrackSuccess {
  success: true
  now_playing?: TrackInfo
  playback_state?: PlaybackState
  message: string
}

interface PlayTrackFailure {
  success: false
  error: string
  configured: boolean
}

type PlayTrackOutput = PlayTrackSuccess | PlayTrackFailure

/**
 * Play a track on Spotify
 *
 * Requires Spotify Premium and an active device
 */
export default async function playTrack(
  input: PlayTrackInput,
  ctx: ToolContext
): Promise<PlayTrackOutput> {
  try {
    const {
      track_id,
      device_id,
      include_now_playing = true
    } = input

    if (!track_id || track_id.trim().length === 0) {
      return {
        success: false,
        error: 'Track ID cannot be empty',
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

    // Normalize track ID (remove 'spotify:track:' prefix if present)
    const normalizedId = track_id.replace('spotify:track:', '')

    // Get devices first if no device_id specified
    let targetDeviceId = device_id
    if (!targetDeviceId) {
      const devicesUrl = 'https://api.spotify.com/v1/me/player/devices'
      const devicesResponse = await fetch(devicesUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (devicesResponse.ok) {
        const devicesData = await devicesResponse.json()
        const activeDevice = devicesData.devices?.find((d: any) => d.is_active)
        if (activeDevice) {
          targetDeviceId = activeDevice.id
        }
      }
    }

    // Play track
    const playUrl = 'https://api.spotify.com/v1/me/player/play'
    const playPayload: any = {
      uris: [`spotify:track:${normalizedId}`]
    }

    if (targetDeviceId) {
      playPayload.device_id = targetDeviceId
    }

    const startTime = Date.now()
    const playResponse = await fetch(playUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(playPayload)
    })

    if (!playResponse.ok) {
      const error = await playResponse.json().catch(() => ({}))
      throw new Error(`Failed to play track: ${playResponse.status} ${JSON.stringify(error)}`)
    }

    const duration = Date.now() - startTime

    let nowPlaying: TrackInfo | undefined
    let playbackState: PlaybackState | undefined

    // Get now playing info if requested
    if (include_now_playing) {
      try {
        const currentUrl = 'https://api.spotify.com/v1/me/player/currently-playing'
        const currentResponse = await fetch(currentUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        })

        if (currentResponse.ok) {
          const currentData = await currentResponse.json()
          if (currentData.item) {
            nowPlaying = {
              id: currentData.item.id,
              name: currentData.item.name,
              artist: currentData.item.artists?.[0]?.name || 'Unknown',
              album: currentData.item.album?.name || 'Unknown',
              duration_ms: currentData.item.duration_ms,
              image_url: currentData.item.album?.images?.[0]?.url,
              spotify_url: currentData.item.external_urls?.spotify
            }

            playbackState = {
              is_playing: currentData.is_playing,
              device: {
                id: currentData.device?.id || 'unknown',
                name: currentData.device?.name || 'Unknown Device',
                type: currentData.device?.type || 'unknown'
              }
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to get now playing info', {
          operation: 'play_track',
          error: formatError(error)
        })
      }
    }

    logger.info('Track playback started', {
      operation: 'play_track',
      trackId: normalizedId,
      duration,
      hasNowPlaying: !!nowPlaying
    })

    return {
      success: true,
      now_playing: nowPlaying,
      playback_state: playbackState,
      message: nowPlaying
        ? `Now playing: "${nowPlaying.name}" by ${nowPlaying.artist}`
        : 'Track playback started'
    }
  } catch (error) {
    logger.error('Play track failed', {
      operation: 'play_track',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: true
    }
  }
}
