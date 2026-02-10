import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'

interface CreatePlaylistInput {
  name: string
  description?: string
  is_public?: boolean
  track_ids?: string[]
}

interface CreatePlaylistSuccess {
  success: true
  playlist_id: string
  playlist_name: string
  playlist_url: string
  track_count: number
  is_public: boolean
  message: string
}

interface CreatePlaylistFailure {
  success: false
  error: string
  configured: boolean
}

type CreatePlaylistOutput = CreatePlaylistSuccess | CreatePlaylistFailure

/**
 * Create a Spotify playlist and optionally add tracks
 */
export default async function createPlaylist(
  input: CreatePlaylistInput,
  ctx: ToolContext
): Promise<CreatePlaylistOutput> {
  try {
    const {
      name,
      description = '',
      is_public = false,
      track_ids = []
    } = input

    if (!name || name.trim().length === 0) {
      return {
        success: false,
        error: 'Playlist name cannot be empty',
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

    // Get current user
    const userUrl = 'https://api.spotify.com/v1/me'
    const userResponse = await fetch(userUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!userResponse.ok) {
      throw new Error(`Failed to get user info: ${userResponse.status}`)
    }

    const userData = await userResponse.json()
    const userId = userData.id

    // Create playlist
    const createUrl = `https://api.spotify.com/v1/users/${userId}/playlists`
    const createPayload = {
      name,
      description,
      public: is_public
    }

    const startTime = Date.now()
    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createPayload)
    })

    if (!createResponse.ok) {
      const error = await createResponse.json().catch(() => ({}))
      throw new Error(`Failed to create playlist: ${createResponse.status} ${JSON.stringify(error)}`)
    }

    const playlistData = await createResponse.json()
    const playlistId = playlistData.id

    let addedCount = 0

    // Add tracks if provided
    if (track_ids && track_ids.length > 0) {
      const addUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`

      // Spotify limits to 100 tracks per request
      const chunks = []
      for (let i = 0; i < track_ids.length; i += 100) {
        chunks.push(track_ids.slice(i, i + 100))
      }

      for (const chunk of chunks) {
        const uris = chunk.map(id => `spotify:track:${id.replace('spotify:track:', '')}`)

        const addResponse = await fetch(addUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ uris })
        })

        if (addResponse.ok) {
          addedCount += chunk.length
        }
      }
    }

    const duration = Date.now() - startTime

    logger.info('Playlist created successfully', {
      operation: 'create_playlist',
      playlistId,
      name,
      trackCount: addedCount,
      duration
    })

    return {
      success: true,
      playlist_id: playlistId,
      playlist_name: name,
      playlist_url: playlistData.external_urls?.spotify || `https://open.spotify.com/playlist/${playlistId}`,
      track_count: addedCount,
      is_public,
      message: `Created ${is_public ? 'public' : 'private'} playlist "${name}"${addedCount > 0 ? ` with ${addedCount} tracks` : ''}`
    }
  } catch (error) {
    logger.error('Create playlist failed', {
      operation: 'create_playlist',
      error: formatError(error)
    })

    return {
      success: false,
      error: formatError(error),
      configured: true
    }
  }
}
