import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface TrackWatchListInput {
  action: 'add' | 'remove' | 'list' | 'check'
  content_id?: string
  content_type?: 'movie' | 'tv'
  title?: string
}

interface WatchListItem {
  id: string
  content_id: string
  content_type: 'movie' | 'tv'
  title: string
  added_at: string
  notes?: string
}

interface TrackWatchListSuccess {
  success: true
  action: string
  watch_list?: WatchListItem[]
  item?: WatchListItem | boolean
  total?: number
  message: string
}

interface TrackWatchListFailure {
  success: false
  error: string
}

type TrackWatchListOutput = TrackWatchListSuccess | TrackWatchListFailure

/**
 * Manage watch list for movies and TV shows
 *
 * Uses data layer for persistence
 */
export default async function trackWatchList(
  input: TrackWatchListInput,
  ctx: ToolContext
): Promise<TrackWatchListOutput> {
  try {
    const {
      action,
      content_id,
      content_type = 'movie',
      title
    } = input

    // Get user context
    const userId = ctx.userId
    const spaceId = ctx.spaceId

    if (!userId) {
      return {
        success: false,
        error: 'User ID is required. Please log in first.'
      }
    }

    const dataLayer = getData(ctx)

    // Get or create watch list
    const watchListPath = ctx.resolvePath(undefined, 'watch_list')
    let watchList: WatchListItem[] = []

    try {
      const existingList = await dataLayer.read('watch_list', spaceId, userId)
      if (existingList && Array.isArray(existingList)) {
        watchList = existingList
      }
    } catch {
      // Watch list doesn't exist yet, create empty array
    }

    const startTime = Date.now()

    switch (action) {
      case 'add': {
        if (!content_id) {
          return {
            success: false,
            error: 'content_id is required for add action'
          }
        }

        // Check if already in watch list
        const exists = watchList.some(item => item.content_id === content_id)
        if (exists) {
          return {
            success: true,
            action: 'add',
            item: true,
            message: `"${title || content_id}" is already in your watch list`
          }
        }

        const newItem: WatchListItem = {
          id: `${content_id}-${Date.now()}`,
          content_id,
          content_type,
          title: title || `Movie/Show #${content_id}`,
          added_at: new Date().toISOString()
        }

        watchList.push(newItem)

        // Save updated list
        await dataLayer.upsert('watch_list', spaceId, userId, watchList)

        logger.info('Added to watch list', {
          operation: 'track_watch_list',
          contentId: content_id,
          userId
        })

        return {
          success: true,
          action: 'add',
          item: newItem,
          total: watchList.length,
          message: `Added "${newItem.title}" to your watch list`
        }
      }

      case 'remove': {
        if (!content_id) {
          return {
            success: false,
            error: 'content_id is required for remove action'
          }
        }

        const originalLength = watchList.length
        watchList = watchList.filter(item => item.content_id !== content_id)

        if (watchList.length === originalLength) {
          return {
            success: true,
            action: 'remove',
            item: false,
            total: watchList.length,
            message: `Item not found in watch list`
          }
        }

        // Save updated list
        await dataLayer.upsert('watch_list', spaceId, userId, watchList)

        logger.info('Removed from watch list', {
          operation: 'track_watch_list',
          contentId: content_id,
          userId
        })

        return {
          success: true,
          action: 'remove',
          item: true,
          total: watchList.length,
          message: `Removed from your watch list`
        }
      }

      case 'list': {
        logger.info('Watch list retrieved', {
          operation: 'track_watch_list',
          action: 'list',
          count: watchList.length,
          userId
        })

        return {
          success: true,
          action: 'list',
          watch_list: watchList,
          total: watchList.length,
          message: `Your watch list contains ${watchList.length} item${watchList.length !== 1 ? 's' : ''}`
        }
      }

      case 'check': {
        if (!content_id) {
          return {
            success: false,
            error: 'content_id is required for check action'
          }
        }

        const item = watchList.find(w => w.content_id === content_id)

        return {
          success: true,
          action: 'check',
          item: !!item,
          message: item
            ? `"${item.title}" is in your watch list`
            : `"${title || content_id}" is not in your watch list`
        }
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}`
        }
    }
  } catch (error) {
    logger.error('Watch list operation failed', {
      operation: 'track_watch_list',
      error: formatError(error),
      action: input.action
    })

    return {
      success: false,
      error: formatError(error)
    }
  }
}
