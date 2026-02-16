// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

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

interface ModelStats {
  model: string
  total: number
  completed: number
  avgCycleTimeMs: number
  reviewPassRate: number
  _cycleTimes: number[]
  _reviewPasses: number
  _reviewTotal: number
}

interface ModelAnalytics {
  totalTracked: number
  totalUntracked: number
  models: Array<{
    model: string
    total: number
    completed: number
    avgCycleTimeMs: number
    reviewPassRate: number
  }>
}

interface AgentModelAnalytics {
  agent: string
  models: string[]
  total: number
  completed: number
  avgCycleTimeMs: number
  reviewPassRate: number
}

interface MetricsSummary {
  tasks: TaskAnalytics
  content?: ContentPerformance
  timestamp: number
}

interface DailyFunnelChannel {
  channel: string
  utmSource?: string
  visits: number
  signups: number
  activations: number
  signupRate: number
  activationRate: number
}

interface DailyFunnelMetrics {
  day: string
  timezone: string
  totals: {
    visits: number
    signups: number
    activations: number
    signupRate: number
    activationRate: number
  }
  channels: DailyFunnelChannel[]
  generatedAt: number
  note: string
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

  private inferChannelFromPath(page: string): string {
    const raw = (page || '').toLowerCase()
    const query = raw.includes('?') ? raw.split('?')[1] : ''
    const utmMatch = query.match(/(?:^|&)utm_source=([^&]+)/)
    if (utmMatch?.[1]) {
      return decodeURIComponent(utmMatch[1])
    }

    if (raw.includes('twitter') || raw.includes('x.com')) return 'twitter'
    if (raw.includes('linkedin')) return 'linkedin'
    if (raw.includes('discord')) return 'discord'
    if (raw.includes('github')) return 'github'
    if (raw.includes('google')) return 'google'
    if (raw.includes('direct')) return 'direct'
    return 'unknown'
  }

  async getDailyFunnelMetrics(timezone = 'America/Vancouver'): Promise<DailyFunnelMetrics> {
    const analytics = await this.getForAgentsAnalytics('24h')
    const topPages = analytics?.topPages || []

    const channels = new Map<string, DailyFunnelChannel>()
    for (const page of topPages) {
      const channel = this.inferChannelFromPath(page.page)
      const existing = channels.get(channel) || {
        channel,
        utmSource: channel === 'unknown' ? undefined : channel,
        visits: 0,
        signups: 0,
        activations: 0,
        signupRate: 0,
        activationRate: 0,
      }
      existing.visits += page.views || 0
      channels.set(channel, existing)
    }

    if (channels.size === 0) {
      channels.set('unknown', {
        channel: 'unknown',
        visits: analytics?.pageviews || 0,
        signups: 0,
        activations: 0,
        signupRate: 0,
        activationRate: 0,
      })
    }

    const rows = Array.from(channels.values()).map((row) => ({
      ...row,
      signupRate: row.visits > 0 ? row.signups / row.visits : 0,
      activationRate: row.visits > 0 ? row.activations / row.visits : 0,
    }))

    const visits = rows.reduce((sum, row) => sum + row.visits, 0)
    const signups = rows.reduce((sum, row) => sum + row.signups, 0)
    const activations = rows.reduce((sum, row) => sum + row.activations, 0)

    const now = Date.now()
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now))

    return {
      day,
      timezone,
      totals: {
        visits,
        signups,
        activations,
        signupRate: visits > 0 ? signups / visits : 0,
        activationRate: visits > 0 ? activations / visits : 0,
      },
      channels: rows.sort((a, b) => b.visits - a.visits),
      generatedAt: now,
      note: 'Funnel structure is live; signups/activations are placeholders until instrumentation is wired.',
    }
  }

  /**
   * Model performance analytics: tasks per model, avg cycle time, review pass rates
   */
  getModelAnalytics(since?: number): ModelAnalytics {
    const tasks = taskManager.listTasks()
    const filtered = since ? tasks.filter(t => t.createdAt >= since) : tasks
    const completed = filtered.filter(t => t.status === 'done')

    const byModel: Record<string, ModelStats> = {}

    for (const task of filtered) {
      const model = (task.metadata?.model as string) || 'unknown'
      if (!byModel[model]) {
        byModel[model] = {
          model,
          total: 0,
          completed: 0,
          avgCycleTimeMs: 0,
          reviewPassRate: 0,
          _cycleTimes: [],
          _reviewPasses: 0,
          _reviewTotal: 0,
        }
      }
      byModel[model].total++
      if (task.status === 'done') {
        byModel[model].completed++
        const cycleTime = task.updatedAt - task.createdAt
        if (cycleTime > 0) byModel[model]._cycleTimes.push(cycleTime)
        
        byModel[model]._reviewTotal++
        if (task.metadata?.reviewer_approved) {
          byModel[model]._reviewPasses++
        }
      }
    }

    // Finalize averages
    const models = Object.values(byModel).map(m => {
      const ct = m._cycleTimes
      return {
        model: m.model,
        total: m.total,
        completed: m.completed,
        avgCycleTimeMs: ct.length > 0 ? Math.round(ct.reduce((s, v) => s + v, 0) / ct.length) : 0,
        reviewPassRate: m._reviewTotal > 0 ? Math.round((m._reviewPasses / m._reviewTotal) * 100) / 100 : 0,
      }
    }).sort((a, b) => b.completed - a.completed)

    return {
      totalTracked: filtered.filter(t => t.metadata?.model).length,
      totalUntracked: filtered.filter(t => !t.metadata?.model).length,
      models,
    }
  }

  /**
   * Per-agent model + performance stats
   */
  getAgentModelAnalytics(since?: number): AgentModelAnalytics[] {
    const tasks = taskManager.listTasks()
    const filtered = since ? tasks.filter(t => t.createdAt >= since) : tasks

    const byAgent: Record<string, {
      agent: string
      models: Set<string>
      total: number
      completed: number
      cycleTimes: number[]
      reviewPasses: number
      reviewTotal: number
    }> = {}

    for (const task of filtered) {
      const agent = task.assignee || 'unassigned'
      if (!byAgent[agent]) {
        byAgent[agent] = { agent, models: new Set(), total: 0, completed: 0, cycleTimes: [], reviewPasses: 0, reviewTotal: 0 }
      }
      const model = task.metadata?.model as string
      if (model) byAgent[agent].models.add(model)
      byAgent[agent].total++

      if (task.status === 'done') {
        byAgent[agent].completed++
        const ct = task.updatedAt - task.createdAt
        if (ct > 0) byAgent[agent].cycleTimes.push(ct)
        byAgent[agent].reviewTotal++
        if (task.metadata?.reviewer_approved) byAgent[agent].reviewPasses++
      }
    }

    return Object.values(byAgent).map(a => ({
      agent: a.agent,
      models: Array.from(a.models),
      total: a.total,
      completed: a.completed,
      avgCycleTimeMs: a.cycleTimes.length > 0
        ? Math.round(a.cycleTimes.reduce((s, v) => s + v, 0) / a.cycleTimes.length)
        : 0,
      reviewPassRate: a.reviewTotal > 0
        ? Math.round((a.reviewPasses / a.reviewTotal) * 100) / 100
        : 0,
    })).sort((a, b) => b.completed - a.completed)
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
