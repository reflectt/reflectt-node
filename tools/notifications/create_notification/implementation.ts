import { v4 as uuidv4 } from 'uuid'
import {
  type ToolContext,
  addTimestamps,
} from '@/lib/tools/helpers'

interface NotificationAction {
  label: string
  action: string
  payload?: Record<string, any>
}

interface CreateNotificationInput {
  user_id: string
  title: string
  message: string
  scope?: 'global' | 'space'
  space_id?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  category?: string
  source?: string
  metadata?: Record<string, any>
  actions?: NotificationAction[]
  expires_at?: string
}

interface CreateNotificationOutput {
  success: boolean
  notification_id?: string
  scope?: 'global' | 'space'
  space_id?: string | null
  notification_path?: string
  status?: 'unread' | 'read'
  error?: string
}

export default async function createNotification(
  input: CreateNotificationInput,
  ctx: ToolContext
): Promise<CreateNotificationOutput> {
  try {
    const {
      user_id,
      title,
      message,
      scope,
      space_id,
      severity = 'info',
      category,
      source,
      metadata = {},
      actions = [],
      expires_at,
    } = input

    if (!user_id?.trim()) {
      return {
        success: false,
        error: 'user_id is required',
      }
    }

    if (!title?.trim()) {
      return {
        success: false,
        error: 'title is required',
      }
    }

    if (!message?.trim()) {
      return {
        success: false,
        error: 'message is required',
      }
    }

    const resolvedScope: 'global' | 'space' = scope ?? (space_id ? 'space' : 'global')

    let storageTarget: 'global' | string | undefined
    let resolvedSpaceId: string | null = null

    if (resolvedScope === 'global') {
      storageTarget = 'global'
    } else {
      resolvedSpaceId = space_id ?? ctx.currentSpace
      storageTarget = resolvedSpaceId === ctx.currentSpace ? undefined : resolvedSpaceId
    }

    const notificationId = uuidv4()

    await ctx.ensureDir(storageTarget, 'notifications', user_id)

    const notificationRecord = addTimestamps({
      id: notificationId,
      user_id,
      scope: resolvedScope,
      space_id: resolvedScope === 'space' ? resolvedSpaceId : null,
      title,
      message,
      severity,
      category: category ?? null,
      source: source ?? null,
      status: 'unread' as const,
      read_at: null,
      metadata,
      actions: Array.isArray(actions) ? actions : [],
      expires_at: expires_at ?? null,
    })

    const fileName = `${notificationId}.json`
    await ctx.writeJson(storageTarget, 'notifications', user_id, fileName, notificationRecord)

    const notificationPath = ctx.resolvePath(storageTarget ?? undefined, 'notifications', user_id, fileName)

    return {
      success: true,
      notification_id: notificationId,
      scope: resolvedScope,
      space_id: resolvedScope === 'space' ? resolvedSpaceId : null,
      notification_path: notificationPath,
      status: 'unread',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
