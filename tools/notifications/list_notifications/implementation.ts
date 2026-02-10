import { type ToolContext } from '@/lib/tools/helpers'

interface ListNotificationsInput {
  user_id: string
  scope?: 'global' | 'space' | 'all'
  space_id?: string
  status?: 'unread' | 'read' | 'all'
  limit?: number
  include_meta?: boolean
}

interface NotificationRecord {
  id: string
  user_id: string
  scope: 'global' | 'space'
  space_id: string | null
  title: string
  message: string
  severity: 'info' | 'success' | 'warning' | 'error'
  category: string | null
  source: string | null
  status: 'unread' | 'read'
  read_at: string | null
  metadata?: Record<string, any>
  actions?: Array<Record<string, any>>
  expires_at: string | null
  created_at: string
  updated_at: string
}

interface ListNotificationsOutput {
  success: boolean
  notifications: NotificationRecord[]
  total: number
  unread_count?: number
  scopes?: Record<'global' | 'space', number>
  error?: string
}

async function loadNotificationsForTarget(
  ctx: ToolContext,
  target: 'global' | string | undefined,
  userId: string
): Promise<NotificationRecord[]> {
  try {
    if (!await ctx.fileExists(target, 'notifications', userId)) {
      return []
    }
  } catch {
    return []
  }

  let files: string[] = []
  try {
    files = await ctx.listFiles(target, 'notifications', userId, '.json')
  } catch {
    return []
  }

  const notifications: NotificationRecord[] = []
  for (const fileName of files) {
    try {
      const record = await ctx.readJson<NotificationRecord>(target, 'notifications', userId, fileName)
      if (record && record.id) {
        notifications.push(record)
      }
    } catch {
      // ignore malformed notification
    }
  }

  return notifications
}

export default async function listNotifications(
  input: ListNotificationsInput,
  ctx: ToolContext
): Promise<ListNotificationsOutput> {
  try {
    const {
      user_id,
      scope = 'all',
      space_id,
      status = 'all',
      limit = 50,
      include_meta = true,
    } = input

    if (!user_id?.trim()) {
      return {
        success: false,
        notifications: [],
        total: 0,
        error: 'user_id is required',
      }
    }

    const includeGlobal = scope === 'all' || scope === 'global'
    const includeSpace = scope === 'all' || scope === 'space'

    const resolvedSpaceId = space_id ?? ctx.currentSpace
    const spaceTarget: 'global' | string | undefined = resolvedSpaceId === ctx.currentSpace ? undefined : resolvedSpaceId

    const notifications: NotificationRecord[] = []
    const scopeCounts: Record<'global' | 'space', number> = {
      global: 0,
      space: 0,
    }

    if (includeGlobal) {
      const globalNotifications = await loadNotificationsForTarget(ctx, 'global', user_id)
      scopeCounts.global = globalNotifications.length
      notifications.push(...globalNotifications)
    }

    if (includeSpace) {
      const spaceNotifications = await loadNotificationsForTarget(ctx, spaceTarget, user_id)
      scopeCounts.space = spaceNotifications.length
      notifications.push(...spaceNotifications)
    }

    // Sort newest first based on created_at (fallback to updated_at)
    notifications.sort((a, b) => {
      const aDate = new Date(a.created_at || a.updated_at || 0).getTime()
      const bDate = new Date(b.created_at || b.updated_at || 0).getTime()
      return bDate - aDate
    })

    // Filter by status if requested
    const filtered = status === 'all'
      ? notifications
      : notifications.filter((n) => n.status === status)

    const limited = filtered.slice(0, limit)
    const unreadCount = notifications.filter((n) => n.status === 'unread').length

    const output: ListNotificationsOutput = {
      success: true,
      notifications: limited,
      total: limited.length,
    }

    if (include_meta) {
      output.unread_count = unreadCount
      output.scopes = scopeCounts
    }

    return output
  } catch (error) {
    return {
      success: false,
      notifications: [],
      total: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
