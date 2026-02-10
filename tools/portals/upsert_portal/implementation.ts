import { type ToolContext, type SpaceTarget } from '@/lib/tools/helpers/tool-context'
import {
  validateAll,
  validateIdentifier,
  validateRequired,
  formatError,
  now,
} from '@/lib/tools/helpers'

interface UpsertPortalInput {
  portal_name: string
  display_name?: string
  description?: string
  agent_slug?: string
  metadata?: Record<string, any>
  space_id?: string
  ensure_directories?: boolean
}

interface UpsertPortalOutput {
  success: boolean
  portal_name: string
  space: string
  path?: string
  created_at?: string
  updated_at?: string
  message?: string
  error?: string
}

interface ExistingPortalRecord {
  portal_name?: string
  display_name?: string
  description?: string
  agent_slug?: string
  created_at?: string
  updated_at?: string
  metadata?: Record<string, any>
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

function resolveSpaceTarget(spaceId: string | undefined, ctx: ToolContext): { spaceName: string; target: SpaceTarget } {
  const trimmed = spaceId?.trim()
  const fallback = ctx.currentSpace || 'default'
  const spaceName = trimmed && trimmed.length > 0 ? trimmed : fallback

  let target: SpaceTarget
  if (spaceName === ctx.currentSpace) {
    target = undefined
  } else if (spaceName === 'global') {
    target = 'global'
  } else {
    target = spaceName
  }

  return { spaceName, target }
}

function mergeMetadata(existing: Record<string, any> | undefined, incoming: Record<string, any> | undefined): Record<string, any> {
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {}
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    return { ...base, ...incoming }
  }
  return base
}

async function upsertPortalImpl(input: UpsertPortalInput, ctx: ToolContext): Promise<UpsertPortalOutput> {
  const validation = validateAll([
    () => validateRequired(input.portal_name, 'portal_name'),
    () => validateIdentifier(input.portal_name, 'portal_name'),
    () => input.space_id ? validateIdentifier(input.space_id, 'space_id') : { valid: true, errors: [] },
  ])

  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  const portalName = input.portal_name.trim()
  const { spaceName, target } = resolveSpaceTarget(input.space_id, ctx)

  const portalDirSegments: [string, string] = ['portals', portalName]
  const portalJsonSegments: [string, string, string] = ['portals', portalName, 'portal.json']

  let existing: ExistingPortalRecord | undefined
  const portalExists = ctx.fileExists(target, ...portalJsonSegments)

  if (portalExists) {
    existing = await ctx.readJson<ExistingPortalRecord>(target, ...portalJsonSegments)
  }

  const createdAt = existing?.created_at ?? now()
  const updatedAt = now()

  const displayName = input.display_name?.trim() || existing?.display_name || formatPortalLabel(portalName)
  const description = input.description?.trim() ?? existing?.description ?? ''
  const agentSlug = input.agent_slug?.trim() || existing?.agent_slug || DEFAULT_AGENT_SLUG
  const metadata = mergeMetadata(existing?.metadata, input.metadata)

  await ctx.ensureDir(target, ...portalDirSegments)

  if (input.ensure_directories !== false) {
    const subdirs = ['pages', 'workflows', 'integrations']
    for (const subdir of subdirs) {
      await ctx.ensureDir(target, 'portals', portalName, subdir)
    }
  }

  const record = {
    portal_name: portalName,
    display_name: displayName,
    description,
    agent_slug: agentSlug,
    created_at: createdAt,
    updated_at: updatedAt,
    metadata,
  }

  await ctx.writeJson(target, ...portalJsonSegments, record)

  return {
    success: true,
    portal_name: portalName,
    space: spaceName,
    path: `${portalDirSegments.join('/')}/`,
    created_at: createdAt,
    updated_at: updatedAt,
    message: portalExists
      ? `Portal '${portalName}' updated in space '${spaceName}'.`
      : `Portal '${portalName}' created in space '${spaceName}'.`,
  }
}

export default async function upsertPortal(
  input: UpsertPortalInput,
  ctx: ToolContext
): Promise<UpsertPortalOutput> {
  try {
    return await upsertPortalImpl(input, ctx)
  } catch (error) {
    return {
      success: false,
      portal_name: input.portal_name,
      space: input.space_id || ctx.currentSpace,
      error: formatError(error),
    }
  }
}

