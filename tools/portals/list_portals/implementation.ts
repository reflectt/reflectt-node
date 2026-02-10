import { type ToolContext } from '@/lib/tools/helpers/tool-context'
import { formatError } from '@/lib/tools/helpers'
import { DEFAULT_PORTAL_ID, mergePortalMetadata, readPortalMetadata } from '@/lib/portals/helpers'
import { getSupabaseClient } from '@/lib/data/utils/supabase-client'

interface ListPortalsInput {
  space_id?: string
  include_stats?: boolean
}

interface PortalInfo {
  portal_name: string
  display_name: string
  description: string
  agent_slug: string
  space_name: string
  created_at: string
  updated_at: string
  metadata: Record<string, any>
  stats?: {
    page_count: number
    workflow_count: number
    integration_count: number
  }
}

interface ListPortalsOutput {
  success: boolean
  space: string
  count: number
  portals: PortalInfo[]
  error?: string
}

function formatPortalLabel(portalName: string): string {
  const trimmed = portalName.trim()
  if (!trimmed) return 'Concierge'

  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function listPortalDirectories(ctx: ToolContext, target: 'global' | string | undefined): Promise<string[]> {
  try {
    return await ctx.listDirs(target, 'portals')
  } catch {
    return []
  }
}

async function buildPortalStats(
  ctx: ToolContext,
  target: 'global' | string | undefined,
  portalDir: string
): Promise<{ page_count: number; workflow_count: number; integration_count: number }> {
  const safeCountDirs = async (...segments: string[]) => {
    try {
      const dirs = await ctx.listDirs(target, ...segments)
      return dirs.length
    } catch {
      return 0
    }
  }

  return {
    page_count: await safeCountDirs('portals', portalDir, 'pages'),
    workflow_count: await safeCountDirs('portals', portalDir, 'workflows'),
    integration_count: await safeCountDirs('portals', portalDir, 'integrations'),
  }
}

async function listPortalsFromDatabase(
  spaceName: string,
  includeStats: boolean
): Promise<ListPortalsOutput> {
  try {
    const supabase = getSupabaseClient()

    // Query portals for this space
    const { data: portalRecords, error } = await supabase
      .from('portals')
      .select('*')
      .eq('space_id', spaceName)
      .order('name')

    if (error) {
      throw new Error(`Database query failed: ${error.message}`)
    }

    const portals: PortalInfo[] = []

    if (portalRecords && portalRecords.length > 0) {
      for (const record of portalRecords) {
        const portalInfo: PortalInfo = {
          portal_name: record.id || record.portal_id, // Use id (primary key)
          display_name: record.name || formatPortalLabel(record.id),
          description: record.description || '',
          agent_slug: 'operator:concierge', // Default since schema doesn't have agent_slug
          space_name: spaceName,
          created_at: record.created_at || '',
          updated_at: record.updated_at || '',
          metadata: { accent: record.accent, status: record.status },
        }

        // Stats are not readily available in database mode without additional queries
        // For now, we'll set them to 0 or omit them
        if (includeStats) {
          portalInfo.stats = {
            page_count: 0,
            workflow_count: 0,
            integration_count: 0,
          }
        }

        portals.push(portalInfo)
      }
    }

    // Always ensure concierge portal exists
    const hasConcierge = portals.some((portal) => portal.portal_name === DEFAULT_PORTAL_ID)

    if (!hasConcierge) {
      portals.unshift({
        portal_name: DEFAULT_PORTAL_ID,
        display_name: 'Concierge',
        description: 'Default concierge portal for guided assistance.',
        agent_slug: 'operator:concierge',
        space_name: spaceName,
        created_at: '',
        updated_at: '',
        metadata: { default: true, __source: 'default' },
        stats: includeStats
          ? { page_count: 0, workflow_count: 0, integration_count: 0 }
          : undefined,
      })
    }

    return {
      success: true,
      space: spaceName,
      count: portals.length,
      portals,
    }
  } catch (error) {
    throw new Error(`Failed to list portals from database: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function listPortalsImpl(
  input: ListPortalsInput,
  ctx: ToolContext
): Promise<ListPortalsOutput> {
  const requestedSpace = input.space_id?.trim()
  const spaceName = requestedSpace && requestedSpace.length > 0
    ? requestedSpace
    : ctx.currentSpace || 'default'

  // Check if we should use database
  const useDatabase = process.env.DATA_BACKEND === 'database' || process.env.DATA_BACKEND === 'both'

  if (useDatabase) {
    // Database mode: Query portals table
    return await listPortalsFromDatabase(spaceName, Boolean(input.include_stats))
  }

  // Filesystem mode: Original logic
  const target: 'global' | string | undefined = spaceName === ctx.currentSpace ? undefined : spaceName

  const portalDirs = await listPortalDirectories(ctx, target)
  const globalPortalDirs = await listPortalDirectories(ctx, 'global')
  const candidatePortalDirs = Array.from(new Set([...portalDirs, ...globalPortalDirs]))
  const includeStats = Boolean(input.include_stats)

  const portals: PortalInfo[] = []

  for (const portalDir of candidatePortalDirs) {
  const spaceMetadata = await readPortalMetadata(ctx, target, portalDir)
    const hasSpaceMetadata = spaceMetadata && Object.keys(spaceMetadata).length > 0
  const globalMetadata = await readPortalMetadata(ctx, 'global', portalDir)
    const hasGlobalMetadata = globalMetadata && Object.keys(globalMetadata).length > 0

    if (!hasSpaceMetadata && !hasGlobalMetadata) {
      continue
    }

    const experienceInSpace = hasSpaceMetadata ? spaceMetadata?.metadata?.experience : undefined
    const metadata = hasSpaceMetadata
      ? mergePortalMetadata(hasGlobalMetadata ? globalMetadata : undefined, spaceMetadata)
      : globalMetadata

    const source: 'space' | 'global' = hasSpaceMetadata ? 'space' : 'global'

    const portalName = metadata.portal_name?.trim() || portalDir
    const displayName = metadata.display_name?.trim() || formatPortalLabel(portalName)
    const description = metadata.description?.trim() || ''
    const agentSlug = metadata.agent_slug?.trim() || 'operator:concierge'
    const createdAt = metadata.created_at ?? ''
    const updatedAt = metadata.updated_at ?? ''
    const extraMetadataBase = metadata.metadata ?? {}
    const fallbackInjected = hasSpaceMetadata && !experienceInSpace && hasGlobalMetadata && Boolean(globalMetadata?.metadata?.experience)
    const extraMetadata = {
      ...extraMetadataBase,
      __source: source,
      ...(fallbackInjected ? { __fallback: true } : {})
    }

    const portalInfo: PortalInfo = {
      portal_name: portalName,
      display_name: displayName,
      description,
      agent_slug: agentSlug,
      space_name: spaceName,
      created_at: createdAt,
      updated_at: updatedAt,
      metadata: extraMetadata,
    }

    if (includeStats) {
      const statsTarget: 'global' | string | undefined = source === 'global' ? 'global' : target
      portalInfo.stats = await buildPortalStats(ctx, statsTarget, portalDir)
    }

    portals.push(portalInfo)
  }

  const hasConcierge = portals.some((portal) => portal.portal_name === DEFAULT_PORTAL_ID)

  if (!hasConcierge) {
    portals.unshift({
      portal_name: DEFAULT_PORTAL_ID,
      display_name: 'Concierge',
      description: 'Default concierge portal for guided assistance.',
      agent_slug: 'operator:concierge',
      space_name: spaceName,
      created_at: '',
      updated_at: '',
  metadata: { default: true, __source: 'default' },
      stats: includeStats
        ? { page_count: 0, workflow_count: 0, integration_count: 0 }
        : undefined,
    })
  }

  // Sort alphabetically but keep concierge first
  const concierge = portals.find((portal) => portal.portal_name === 'concierge')
  const rest = portals.filter((portal) => portal.portal_name !== 'concierge')
  rest.sort((a, b) => a.display_name.localeCompare(b.display_name))

  const ordered = concierge ? [concierge, ...rest] : rest

  return {
    success: true,
    space: spaceName,
    count: ordered.length,
    portals: ordered,
  }
}

export default async function listPortals(
  input: ListPortalsInput,
  ctx: ToolContext
): Promise<ListPortalsOutput> {
  try {
    return await listPortalsImpl(input, ctx)
  } catch (error) {
    return {
      success: false,
      space: ctx.currentSpace,
      count: 0,
      portals: [],
      error: formatError(error),
    }
  }
}
