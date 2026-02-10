import { type ToolContext, type SpaceTarget } from '@/lib/tools/helpers/tool-context'
import {
  validateAll,
  validateIdentifier,
  validateRequired,
  formatError,
} from '@/lib/tools/helpers'

interface DeletePortalInput {
  portal_name: string
  space_id?: string
  force?: boolean
}

interface DeletePortalOutput {
  success: boolean
  portal_name: string
  space: string
  path?: string
  message?: string
  error?: string
}

const DEFAULT_PORTAL_NAME = 'concierge'

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

async function deletePortalImpl(input: DeletePortalInput, ctx: ToolContext): Promise<DeletePortalOutput> {
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

  if (portalName === DEFAULT_PORTAL_NAME && !input.force) {
    throw new Error("Cannot delete the default concierge portal without setting 'force' to true.")
  }

  const portalDirSegments: [string, string] = ['portals', portalName]
  const portalJsonSegments: [string, string, string] = ['portals', portalName, 'portal.json']

  const exists = ctx.fileExists(target, ...portalJsonSegments) || (await ctx.listDirs(target, 'portals')).includes(portalName)
  if (!exists) {
    throw new Error(`Portal '${portalName}' does not exist in space '${spaceName}'.`)
  }

  await ctx.deleteDir(target, ...portalDirSegments)

  return {
    success: true,
    portal_name: portalName,
    space: spaceName,
    path: `${portalDirSegments.join('/')}/`,
    message: `Portal '${portalName}' deleted from space '${spaceName}'.`
  }
}

export default async function deletePortal(
  input: DeletePortalInput,
  ctx: ToolContext
): Promise<DeletePortalOutput> {
  try {
    return await deletePortalImpl(input, ctx)
  } catch (error) {
    return {
      success: false,
      portal_name: input.portal_name,
      space: input.space_id || ctx.currentSpace,
      error: formatError(error),
    }
  }
}
