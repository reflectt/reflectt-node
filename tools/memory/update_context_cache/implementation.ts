import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { searchConversations } from '@/lib/conversations/storage-v2'
import { synthesizeContext } from '@/lib/memory/context-synthesis'
import type { ContextCache, RecentActivity } from '@/lib/memory/types'

interface UpdateContextCacheInput {
  user_id: string
  force_refresh?: boolean
  cache_duration_hours?: number
}

export default async function update_context_cache(
  input: UpdateContextCacheInput,
  context: ToolContext
) {
  const {
    user_id,
    force_refresh = false,
    cache_duration_hours = 24
  } = input

  try {
    const cacheSegments = ['memory', 'users', user_id, 'context_cache.json']

    // Check if cache exists and is valid
    let existingCache: ContextCache | null = null
    if (!force_refresh) {
      try {
        existingCache = await context.readJson<ContextCache>('global', ...cacheSegments)

        // Check if cache is still valid
        const cacheAge = Date.now() - new Date(existingCache.last_updated).getTime()
        const ttl = existingCache.ttl || 86400 // 24 hours default
        if (cacheAge < ttl * 1000) {
          return {
            success: true,
            cache: existingCache,
            from_cache: true,
            message: 'Cache is still valid, not refreshing'
          }
        }
      } catch {
        // No cache exists
      }
    }

    // Get recent conversations (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const searchResult = await searchConversations(
      {
        user_id,
        date_from: sevenDaysAgo,
        status: 'completed',
        limit: 20
      },
      context,
      'global'
    )

    // Build recent activity summaries
    const recentActivity: RecentActivity[] = searchResult.conversations.map(conv => {
      // Determine outcome
      let outcome: 'success' | 'failed' | 'partial' = 'success'
      if (conv.status === 'failed') {
        outcome = 'failed'
      } else if (conv.status === 'completed' && conv.tool_count === 0) {
        outcome = 'partial' // Completed but didn't do anything
      }

      return {
        conversation_id: conv.id,
        timestamp: conv.created_at,
        summary: `Used ${conv.agent_slug} for ${conv.conversation_type}`,
        intent: conv.conversation_type,
        outcome,
        key_decisions: [], // Would need full conversation to extract
        relevance_score: 1.0, // All recent activity is relevant
        agent_slug: conv.agent_slug
      }
    })

    // Load user profile for preferences
    let keyPreferences = {}
    try {
      const profileSegments = ['memory', 'users', user_id, 'profile.json']
      const profile = await context.readJson('global', ...profileSegments)
      keyPreferences = profile.preferences || {}
    } catch {
      // No profile exists
    }

    // Generate context summary
    const contextSummary = recentActivity.length > 0
      ? `User has had ${recentActivity.length} interactions in the past 7 days, primarily using ${getMostUsedAgent(recentActivity)}.`
      : 'No recent activity in the past 7 days.'

    // Active projects/goals (placeholder - would integrate with task system)
    const activeProjects: string[] = []

    // Current goals (from knowledge graph if available)
    const currentGoals: string[] = []
    try {
      const kgSegments = ['memory', 'users', user_id, 'knowledge_graph.json']
      const kg = await context.readJson('global', ...kgSegments)
      const goalFacts = kg.facts.filter((f: any) => f.type === 'goal')
      currentGoals.push(...goalFacts.map((f: any) => f.fact))
    } catch {
      // No knowledge graph
    }

    // Build cache
    const ttl = cache_duration_hours * 3600 // Convert to seconds
    const cache: ContextCache = {
      user_id,
      last_updated: new Date().toISOString(),
      recent_activity: recentActivity,
      active_tasks: [], // Would integrate with task system
      context_summary: contextSummary,
      ttl
    }

    // Save cache
    await context.ensureDir('global', 'memory', 'users', user_id)
    await context.writeJson('global', ...cacheSegments, cache)

    return {
      success: true,
      cache: {
        recent_activity_summary: contextSummary,
        active_projects: activeProjects,
        current_goals: currentGoals,
        key_preferences: keyPreferences,
        generated_at: cache.last_updated,
        expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
        activity_count: recentActivity.length
      },
      from_cache: false
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      cache: {
        recent_activity_summary: 'Failed to generate cache',
        active_projects: [],
        current_goals: [],
        key_preferences: {},
        generated_at: new Date().toISOString(),
        expires_at: new Date().toISOString()
      },
      from_cache: false
    }
  }
}

/**
 * Helper to get most frequently used agent
 */
function getMostUsedAgent(activities: RecentActivity[]): string {
  const agentCounts = new Map<string, number>()

  activities.forEach(activity => {
    const count = agentCounts.get(activity.agent_slug) || 0
    agentCounts.set(activity.agent_slug, count + 1)
  })

  let maxAgent = 'various agents'
  let maxCount = 0

  agentCounts.forEach((count, agent) => {
    if (count > maxCount) {
      maxCount = count
      maxAgent = agent
    }
  })

  return maxAgent
}
