/**
 * Analytics Manager
 * 
 * Integrates with external services:
 * - Vercel Analytics API
 * - dev.to API
 * - Internal task metrics
 */

import { taskManager } from './tasks.js'
import type { Task } from './types.js'

interface VercelAnalytics {
  pageviews: number
  visitors: number
  topPages: Array<{ page: string; views: number }>
  period: string
}

interface DevToArticle {
  id: number
  title: string
  url: string
  views: number
  reactions: number
  comments: number
  published_at: string
}

interface ContentPerformance {
  devto: {
    articles: DevToArticle[]
    totalViews: number
    totalReactions: number
  }
  foragents: VercelAnalytics
}

interface TaskAnalytics {
  total: number
  completed: number
  completionRate: number
  avgCycleTimeMs: number
  blockedCount: number
  blockerFrequency: number
  byPriority: Record<string, { total: number; completed: number; avgCycleTimeMs: number }>
  byAssignee: Record<string, { total: number; completed: number; avgCycleTimeMs: number }>
}

interface MetricsSummary {
  tasks: TaskAnalytics
  content?: ContentPerformance
  timestamp: number
}

class AnalyticsManager {
  private vercelToken?: string
  private devtoApiKey?: string
  private vercelTeamId?: string
  private vercelProjectId?: string

  constructor() {
    this.vercelToken = process.env.VERCEL_TOKEN
    this.devtoApiKey = process.env.DEVTO_API_KEY
    this.vercelTeamId = process.env.VERCEL_TEAM_ID
    this.vercelProjectId = process.env.VERCEL_PROJECT_ID
  }

  /**
   * Fetch Vercel Analytics for forAgents.dev
   */
  async getForAgentsAnalytics(period: '1h' | '24h' | '7d' | '30d' = '7d'): Promise<VercelAnalytics | null> {
    if (!this.vercelToken || !this.vercelProjectId) {
      console.warn('[Analytics] Vercel token or project ID not configured')
      return null
    }

    try {
      // Vercel Analytics API endpoint
      const teamQuery = this.vercelTeamId ? `?teamId=${this.vercelTeamId}` : ''
      const url = `https://api.vercel.com/v1/analytics/${this.vercelProjectId}/stats${teamQuery}`

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.vercelToken}`,
        },
      })

      if (!response.ok) {
        console.error(`[Analytics] Vercel API error: ${response.status}`)
        return null
      }

      const data = await response.json() as any

      // Transform to our format
      return {
        pageviews: data.pageviews || 0,
        visitors: data.visitors || 0,
        topPages: data.topPages || [],
        period,
      }
    } catch (err) {
      console.error('[Analytics] Failed to fetch Vercel analytics:', err)
      return null
    }
  }

  /**
   * Fetch dev.to article performance
   */
  async getDevToPerformance(): Promise<DevToArticle[]> {
    if (!this.devtoApiKey) {
      console.warn('[Analytics] dev.to API key not configured')
      return []
    }

    try {
      // Fetch user's published articles
      const response = await fetch('https://dev.to/api/articles/me/published', {
        headers: {
          'api-key': this.devtoApiKey,
        },
      })

      if (!response.ok) {
        console.error(`[Analytics] dev.to API error: ${response.status}`)
        return []
      }

      const articles = await response.json() as any[]

      return articles.map((article: any) => ({
        id: article.id,
        title: article.title,
        url: article.url,
        views: article.page_views_count || 0,
        reactions: article.public_reactions_count || 0,
        comments: article.comments_count || 0,
        published_at: article.published_at,
      }))
    } catch (err) {
      console.error('[Analytics] Failed to fetch dev.to articles:', err)
      return []
    }
  }

  /**
   * Get aggregated content performance
   */
  async getContentPerformance(): Promise<ContentPerformance> {
    const [devtoArticles, foragentsAnalytics] = await Promise.all([
      this.getDevToPerformance(),
      this.getForAgentsAnalytics(),
    ])

    const totalViews = devtoArticles.reduce((sum, a) => sum + a.views, 0)
    const totalReactions = devtoArticles.reduce((sum, a) => sum + a.reactions, 0)

    return {
      devto: {
        articles: devtoArticles,
        totalViews,
        totalReactions,
      },
      foragents: foragentsAnalytics || {
        pageviews: 0,
        visitors: 0,
        topPages: [],
        period: '7d',
      },
    }
  }

  /**
   * Calculate task analytics from task data
   */
  getTaskAnalytics(since?: number): TaskAnalytics {
    const tasks = taskManager.listTasks()
    const filteredTasks = since ? tasks.filter(t => t.createdAt >= since) : tasks

    const completed = filteredTasks.filter(t => t.status === 'done')
    const blocked = filteredTasks.filter(t => t.status === 'blocked')

    // Calculate cycle times for completed tasks
    const cycleTimes = completed
      .map(t => t.updatedAt - t.createdAt)
      .filter(ct => ct > 0)

    const avgCycleTimeMs = cycleTimes.length > 0
      ? cycleTimes.reduce((sum, ct) => sum + ct, 0) / cycleTimes.length
      : 0

    // Group by priority
    const byPriority: Record<string, { total: number; completed: number; avgCycleTimeMs: number }> = {}
    for (const task of filteredTasks) {
      const priority = task.priority || 'P3'
      if (!byPriority[priority]) {
        byPriority[priority] = { total: 0, completed: 0, avgCycleTimeMs: 0 }
      }
      byPriority[priority].total++
      if (task.status === 'done') {
        byPriority[priority].completed++
      }
    }

    // Calculate avg cycle time per priority
    for (const priority in byPriority) {
      const priorityCompleted = completed.filter(t => (t.priority || 'P3') === priority)
      const priorityCycleTimes = priorityCompleted
        .map(t => t.updatedAt - t.createdAt)
        .filter(ct => ct > 0)
      
      byPriority[priority].avgCycleTimeMs = priorityCycleTimes.length > 0
        ? priorityCycleTimes.reduce((sum, ct) => sum + ct, 0) / priorityCycleTimes.length
        : 0
    }

    // Group by assignee
    const byAssignee: Record<string, { total: number; completed: number; avgCycleTimeMs: number }> = {}
    for (const task of filteredTasks) {
      if (task.assignee) {
        if (!byAssignee[task.assignee]) {
          byAssignee[task.assignee] = { total: 0, completed: 0, avgCycleTimeMs: 0 }
        }
        byAssignee[task.assignee].total++
        if (task.status === 'done') {
          byAssignee[task.assignee].completed++
        }
      }
    }

    // Calculate avg cycle time per assignee
    for (const assignee in byAssignee) {
      const assigneeCompleted = completed.filter(t => t.assignee === assignee)
      const assigneeCycleTimes = assigneeCompleted
        .map(t => t.updatedAt - t.createdAt)
        .filter(ct => ct > 0)
      
      byAssignee[assignee].avgCycleTimeMs = assigneeCycleTimes.length > 0
        ? assigneeCycleTimes.reduce((sum, ct) => sum + ct, 0) / assigneeCycleTimes.length
        : 0
    }

    return {
      total: filteredTasks.length,
      completed: completed.length,
      completionRate: filteredTasks.length > 0 ? completed.length / filteredTasks.length : 0,
      avgCycleTimeMs,
      blockedCount: blocked.length,
      blockerFrequency: filteredTasks.length > 0 ? blocked.length / filteredTasks.length : 0,
      byPriority,
      byAssignee,
    }
  }

  /**
   * Get summary metrics dashboard
   */
  async getMetricsSummary(includeContent = true): Promise<MetricsSummary> {
    const tasks = this.getTaskAnalytics()
    const content = includeContent ? await this.getContentPerformance() : undefined

    return {
      tasks,
      content,
      timestamp: Date.now(),
    }
  }
}

export const analyticsManager = new AnalyticsManager()
