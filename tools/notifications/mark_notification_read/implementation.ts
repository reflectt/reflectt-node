import {
  type ToolContext,
  updateTimestamp,
} from '@/lib/tools/helpers'

interface MarkNotificationReadInput {
  user_id: string
  notification_id: string
  read?: boolean
  scope?: 'global' | 'space' | 'auto'
  space_id?: string
}

interface MarkNotificationReadOutput {
  success: boolean
  notification_id?: string
  status?: 'read' | 'unread'
  read_at?: string | null
  scope?: 'global' | 'space'
  space_id?: string | null
  error?: string
}

interface NotificationRecord {
  id: string
  status: 'read' | 'unread'
  read_at: string | null
  scope: 'global' | 'space'
  space_id: string | null
  [key: string]: any
}

export default async function markNotificationRead(
  input: MarkNotificationReadInput,
  ctx: ToolContext
): Promise<MarkNotificationReadOutput> {
  try {
    const {
      user_id,
      notification_id,
      read = true,
      scope = 'auto',
      space_id,
    } = input

    if (!user_id?.trim()) {
      return {
        success: false,
        error: 'user_id is required',
      }
    }

    if (!notification_id?.trim()) {
      return {
        success: false,
        error: 'notification_id is required',
      }
    }

    const desiredStatus: 'read' | 'unread' = read ? 'read' : 'unread'
    const nowIso = new Date().toISOString()

    const candidates: Array<{
      target: 'global' | string | undefined
      scope: 'global' | 'space'
      spaceId: string | null
    }> = []

    if (scope === 'global' || scope === 'auto') {
      candidates.push({ target: 'global', scope: 'global', spaceId: null })
    }

    if (scope === 'space' || scope === 'auto') {
      const resolvedSpaceId = space_id ?? ctx.currentSpace
      const target = resolvedSpaceId === ctx.currentSpace ? undefined : resolvedSpaceId
      candidates.push({ target, scope: 'space', spaceId: resolvedSpaceId })
    }

    for (const candidate of candidates) {
      try {
        if (!await ctx.fileExists(candidate.target, 'notifications', user_id, `${notification_id}.json`)) {
          continue
        }

        const record = await ctx.readJson<NotificationRecord>(
          candidate.target,
          'notifications',
          user_id,
          `${notification_id}.json`
        )

        record.status = desiredStatus
        record.read_at = read ? nowIso : null

        const updatedRecord = updateTimestamp(record)

        await ctx.writeJson(
          candidate.target,
          'notifications',
          user_id,
          `${notification_id}.json`,
          updatedRecord
        )

        return {
          success: true,
          notification_id,
          status: desiredStatus,
          read_at: updatedRecord.read_at ?? null,
          scope: candidate.scope,
          space_id: candidate.scope === 'space' ? candidate.spaceId : null,
        }
      } catch {
        // try next candidate
      }
    }

    return {
      success: false,
      error: `Notification ${notification_id} not found for user ${user_id}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
