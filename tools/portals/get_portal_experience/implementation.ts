import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  DEFAULT_PORTAL_ID,
  loadPortalDefinition
} from '@/lib/portals/helpers'

interface GetPortalExperienceInput {
  portal_id?: string
  space_id?: string
  include_metadata?: boolean
}

interface GetPortalExperienceOutput {
  success: boolean
  portal_id: string
  space?: string
  source?: 'space' | 'global'
  fallback_applied?: boolean
  has_experience?: boolean
  experience?: Record<string, any>
  metadata?: Record<string, any>
  warnings?: string[]
  error?: string
}

export default async function get_portal_experience(
  input: GetPortalExperienceInput,
  ctx: ToolContext
): Promise<GetPortalExperienceOutput> {
  try {
    const portalId = (input.portal_id ?? DEFAULT_PORTAL_ID).trim() || DEFAULT_PORTAL_ID

    const result = await loadPortalDefinition(ctx, {
      portalId,
      spaceId: input.space_id
    })

    if (!result) {
      return {
        success: false,
        portal_id: portalId,
        error: `Portal "${portalId}" not found`
      }
    }

    const experience = result.metadata.metadata?.experience
    const hasExperience = Boolean(experience && Object.keys(experience).length > 0)

    const response: GetPortalExperienceOutput = {
      success: true,
      portal_id: portalId,
      space: result.space,
      source: result.source,
      fallback_applied: result.fallbackApplied,
      has_experience: hasExperience,
      experience: hasExperience ? experience : {},
    }

    if (input.include_metadata) {
      response.metadata = result.metadata
    }

    if (!hasExperience) {
      response.warnings = [
        'No experience manifest found for this portal. Agents can create one by storing `metadata.experience` via upsert_portal.'
      ]
    }

    return response
  } catch (error) {
    return {
      success: false,
      portal_id: input.portal_id ?? DEFAULT_PORTAL_ID,
      error: formatError(error)
    }
  }
}
