import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface DateRange {
  start_date: string
  end_date: string
}

interface ArchiveContentInput {
  content_ids?: string[]
  date_range?: DateRange
}

interface ArchiveContentOutput {
  success: boolean
  archived_count?: number
  archived_ids?: string[]
  total_size_mb?: number
  archive_location?: string
  error?: string
}

/**
 * Archive old or inactive content for storage
 * Moves content to archive and removes from active listings
 */
export default async function archiveContent(
  input: ArchiveContentInput,
  context: ToolContext
): Promise<ArchiveContentOutput> {
  try {
    const { content_ids = [], date_range } = input

    // Validate input - need either content_ids or date_range
    if ((!content_ids || content_ids.length === 0) && !date_range) {
      return {
        success: false,
        error: 'Either content_ids array or date_range is required'
      }
    }

    // Validate content_ids if provided
    if (content_ids && content_ids.length > 1000) {
      return {
        success: false,
        error: 'Cannot archive more than 1000 items at once'
      }
    }

    // If date_range provided, validate dates
    let startDate: Date | null = null
    let endDate: Date | null = null

    if (date_range) {
      try {
        startDate = new Date(date_range.start_date)
        endDate = new Date(date_range.end_date)

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return {
            success: false,
            error: 'Invalid date format in date_range'
          }
        }

        if (startDate >= endDate) {
          return {
            success: false,
            error: 'start_date must be before end_date'
          }
        }
      } catch (error) {
        return {
          success: false,
          error: 'Invalid date format'
        }
      }
    }

    logger.info('Archiving content', {
      contentCount: content_ids.length,
      hasDateRange: !!date_range,
      operation: 'archive_content'
    })

    // Get data layer
    const dataLayer = getData(context)

    // Collect content to archive
    const contentToArchive: string[] = []
    let totalSize = 0

    if (content_ids && content_ids.length > 0) {
      // Archive specific content IDs
      contentToArchive.push(...content_ids)
    } else if (date_range && startDate && endDate) {
      // Archive content within date range (mock implementation)
      // In real implementation, would query database for content in date range
      for (let i = 0; i < Math.floor(Math.random() * 20) + 5; i++) {
        contentToArchive.push(`content_${Date.now()}_${i}`)
      }
    }

    // Process archive
    const archiveId = `archive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const timestamp = new Date().toISOString()

    const archivedIds: string[] = []

    // Archive each piece of content
    for (const cId of contentToArchive) {
      try {
        // Try to read the content
        let contentData: any = null
        try {
          contentData = await dataLayer.read('content', context.spaceId || 'global', cId)
          totalSize += contentData?.character_count || 0
        } catch (error) {
          logger.warn('Content not found for archival', {
            contentId: cId,
            operation: 'archive_content'
          })
          continue
        }

        // Create archive record
        const archiveRecord = {
          original_id: cId,
          archived_at: timestamp,
          content_data: contentData,
          archive_id: archiveId,
          restored: false
        }

        // Save archive record
        await dataLayer.create('archived_content', context.spaceId || 'global', cId, archiveRecord)

        // Update original content status
        await dataLayer.update('content', context.spaceId || 'global', cId, {
          status: 'archived',
          archived_at: timestamp,
          updated_at: timestamp
        })

        archivedIds.push(cId)
      } catch (error) {
        logger.warn('Failed to archive content', {
          contentId: cId,
          error: error instanceof Error ? error.message : String(error),
          operation: 'archive_content'
        })
      }
    }

    // Create archive manifest
    const archiveManifest = {
      id: archiveId,
      archived_count: archivedIds.length,
      archived_ids: archivedIds,
      created_at: timestamp,
      date_range: date_range,
      total_size_bytes: totalSize,
      status: 'completed'
    }

    // Save manifest
    try {
      await dataLayer.create('archive_manifests', context.spaceId || 'global', archiveId, archiveManifest)
    } catch (error) {
      logger.warn('Failed to save archive manifest', {
        archiveId,
        error: error instanceof Error ? error.message : String(error),
        operation: 'archive_content'
      })
    }

    const sizeInMb = parseFloat((totalSize / (1024 * 1024)).toFixed(2))

    logger.info('Content archived successfully', {
      archiveId,
      archivedCount: archivedIds.length,
      totalSizeMb: sizeInMb,
      operation: 'archive_content'
    })

    return {
      success: true,
      archived_count: archivedIds.length,
      archived_ids: archivedIds,
      total_size_mb: sizeInMb,
      archive_location: `s3://archives/${context.spaceId || 'global'}/${archiveId}`
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('Failed to archive content', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      operation: 'archive_content'
    })

    return {
      success: false,
      error: `Failed to archive content: ${errorMessage}`
    }
  }
}
