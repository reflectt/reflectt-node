import {
  formatError,
  now,
  validateAll,
  validateIdentifier,
  validateRequired
} from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  DEFAULT_PORTAL_ID,
  mergePortalMetadata,
  readPortalMetadata,
  resolvePortalSpaceTarget
} from '@/lib/portals/helpers'

interface UpsertPortalExperienceInput {
  portal_id?: string
  space_id?: string
  experience: Record<string, any>
  merge?: boolean
  ensure_directories?: boolean
}

interface UpsertPortalExperienceOutput {
  success: boolean
  portal_id: string
  space: string
  operation: 'created' | 'updated'
  experience: Record<string, any>
  metadata: Record<string, any>
  ensured_directories?: string[]
  warning?: string
  error?: string
}

const DEFAULT_AGENT_SLUG = 'operator:concierge'

function formatPortalLabel(portalName: string): string {
  const trimmed = portalName.trim()
  if (!trimmed) return 'Concierge'

  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default async function upsert_portal_experience(
  input: UpsertPortalExperienceInput,
  ctx: ToolContext
): Promise<UpsertPortalExperienceOutput> {
  try {
    const validation = validateAll([
      () => validateRequired(input.experience, 'experience'),
      () => validateIdentifier(input.portal_id ?? DEFAULT_PORTAL_ID, 'portal_id'),
      () => input.space_id ? validateIdentifier(input.space_id, 'space_id') : { valid: true, errors: [] }
    ])

    if (!validation.valid) {
      throw new Error(validation.errors[0].message)
    }

    if (!isPlainObject(input.experience)) {
      throw new Error('experience must be an object')
    }

    const portalIdRaw = input.portal_id ?? DEFAULT_PORTAL_ID
    const portalId = portalIdRaw.trim() || DEFAULT_PORTAL_ID
    const mergeExperience = Boolean(input.merge)
    const ensureDirectories = input.ensure_directories !== false

    const { spaceName, target } = resolvePortalSpaceTarget(input.space_id, ctx)

    const spaceRecord = await readPortalMetadata(ctx, target, portalId)
    const hasSpaceRecord = Boolean(spaceRecord && Object.keys(spaceRecord).length > 0)
    const globalRecord = await readPortalMetadata(ctx, 'global', portalId)

    const mergedBase = mergePortalMetadata(globalRecord ?? undefined, spaceRecord ?? undefined)

    const record = { ...mergedBase }
    const metadata = { ...(record.metadata ?? {}) }
    const existingExperience = isPlainObject(metadata.experience) ? metadata.experience : undefined

    metadata.experience = mergeExperience
      ? { ...(existingExperience ?? {}), ...input.experience }
      : { ...input.experience }

    const timestamp = now()

    if (!record.portal_name) {
      record.portal_name = portalId
    }

    if (!record.display_name) {
      record.display_name = formatPortalLabel(portalId)
    }

    if (!record.created_at) {
      record.created_at = timestamp
    }

    record.updated_at = timestamp
    record.agent_slug = record.agent_slug?.trim() || DEFAULT_AGENT_SLUG
    record.metadata = metadata

    const ensured: string[] = []

    if (ensureDirectories) {
      await ctx.ensureDir(target, 'portals', portalId)
      ensured.push(ctx.resolvePath(target, 'portals', portalId))
      const subdirs = ['pages', 'workflows', 'integrations']
      for (const subdir of subdirs) {
        await ctx.ensureDir(target, 'portals', portalId, subdir)
        ensured.push(ctx.resolvePath(target, 'portals', portalId, subdir))
      }
    }

    await ctx.writeJson(target, 'portals', portalId, 'portal.json', record)

    return {
      success: true,
      portal_id: portalId,
      space: spaceName,
      operation: hasSpaceRecord ? 'updated' : 'created',
      experience: metadata.experience,
      metadata,
      ensured_directories: ensured.length > 0 ? ensured : undefined,
      warning: !hasSpaceRecord && globalRecord ? 'Portal previously relied on global defaults; a space-specific override was created.' : undefined
    }
  } catch (error) {
    return {
      success: false,
      portal_id: input.portal_id ?? DEFAULT_PORTAL_ID,
      space: input.space_id ?? (ctx.currentSpace || 'default'),
      operation: 'updated',
      experience: input.experience ?? {},
      metadata: {},
      error: formatError(error)
    }
  }
}
