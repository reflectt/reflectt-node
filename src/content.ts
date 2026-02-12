/**
 * Content tracking: publication log + content calendar
 * Enables data-driven content decisions and coordination
 */

export interface ContentPublication {
  id: string
  title: string
  topic: string
  url: string
  platform: 'dev.to' | 'foragents.dev' | 'medium' | 'substack' | 'twitter' | 'linkedin' | 'other'
  publishedBy: string
  publishedAt: number
  createdAt: number
  tags?: string[]
  performance?: {
    views?: number
    reactions?: number
    comments?: number
    shares?: number
    lastChecked?: number
  }
  metadata?: Record<string, unknown>
}

export interface ContentCalendarItem {
  id: string
  title: string
  topic: string
  status: 'draft' | 'scheduled' | 'published'
  assignee?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  scheduledFor?: number
  publishedAt?: number
  platform?: string
  url?: string
  tags?: string[]
  notes?: string
  metadata?: Record<string, unknown>
}

export class ContentManager {
  private publications: ContentPublication[] = []
  private calendar: ContentCalendarItem[] = []

  /**
   * Log a published piece of content
   */
  async logPublication(data: {
    title: string
    topic: string
    url: string
    platform: ContentPublication['platform']
    publishedBy: string
    publishedAt?: number
    tags?: string[]
    metadata?: Record<string, unknown>
  }): Promise<ContentPublication> {
    const now = Date.now()
    const publication: ContentPublication = {
      id: `pub-${now}-${Math.random().toString(36).substr(2, 9)}`,
      title: data.title,
      topic: data.topic,
      url: data.url,
      platform: data.platform,
      publishedBy: data.publishedBy,
      publishedAt: data.publishedAt || now,
      createdAt: now,
      tags: data.tags,
      metadata: data.metadata,
    }

    this.publications.push(publication)

    // Also update calendar if this exists there
    const calendarItem = this.calendar.find(
      item => item.url === data.url || item.title === data.title
    )
    if (calendarItem) {
      calendarItem.status = 'published'
      calendarItem.publishedAt = publication.publishedAt
      calendarItem.url = data.url
      calendarItem.updatedAt = now
    }

    return publication
  }

  /**
   * Add or update a calendar item
   */
  async upsertCalendarItem(data: {
    id?: string
    title: string
    topic: string
    status: ContentCalendarItem['status']
    assignee?: string
    createdBy: string
    scheduledFor?: number
    publishedAt?: number
    platform?: string
    url?: string
    tags?: string[]
    notes?: string
    metadata?: Record<string, unknown>
  }): Promise<ContentCalendarItem> {
    const now = Date.now()

    if (data.id) {
      // Update existing
      const existing = this.calendar.find(item => item.id === data.id)
      if (existing) {
        Object.assign(existing, {
          ...data,
          updatedAt: now,
        })
        return existing
      }
    }

    // Create new
    const item: ContentCalendarItem = {
      id: data.id || `cal-${now}-${Math.random().toString(36).substr(2, 9)}`,
      title: data.title,
      topic: data.topic,
      status: data.status,
      assignee: data.assignee,
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
      scheduledFor: data.scheduledFor,
      publishedAt: data.publishedAt,
      platform: data.platform,
      url: data.url,
      tags: data.tags,
      notes: data.notes,
      metadata: data.metadata,
    }

    this.calendar.push(item)
    return item
  }

  /**
   * Get content calendar with filters
   */
  getCalendar(filters?: {
    status?: ContentCalendarItem['status']
    assignee?: string
    platform?: string
    tags?: string[]
    limit?: number
    since?: number
  }): ContentCalendarItem[] {
    let items = this.calendar

    if (filters?.status) {
      items = items.filter(item => item.status === filters.status)
    }

    if (filters?.assignee) {
      items = items.filter(item => item.assignee === filters.assignee)
    }

    if (filters?.platform) {
      items = items.filter(item => item.platform === filters.platform)
    }

    if (filters?.tags && filters.tags.length > 0) {
      items = items.filter(item =>
        item.tags?.some(tag => filters.tags!.includes(tag))
      )
    }

    if (filters?.since) {
      items = items.filter(item => item.updatedAt >= filters.since!)
    }

    // Sort by scheduled date (ascending) or updated date
    items.sort((a, b) => {
      const aDate = a.scheduledFor || a.updatedAt
      const bDate = b.scheduledFor || b.updatedAt
      return aDate - bDate
    })

    if (filters?.limit) {
      items = items.slice(0, filters.limit)
    }

    return items
  }

  /**
   * Get publication log with filters
   */
  getPublications(filters?: {
    platform?: ContentPublication['platform']
    publishedBy?: string
    tags?: string[]
    limit?: number
    since?: number
  }): ContentPublication[] {
    let pubs = this.publications

    if (filters?.platform) {
      pubs = pubs.filter(pub => pub.platform === filters.platform)
    }

    if (filters?.publishedBy) {
      pubs = pubs.filter(pub => pub.publishedBy === filters.publishedBy)
    }

    if (filters?.tags && filters.tags.length > 0) {
      pubs = pubs.filter(pub =>
        pub.tags?.some(tag => filters.tags!.includes(tag))
      )
    }

    if (filters?.since) {
      pubs = pubs.filter(pub => pub.publishedAt >= filters.since!)
    }

    // Sort by published date (descending, most recent first)
    pubs.sort((a, b) => b.publishedAt - a.publishedAt)

    if (filters?.limit) {
      pubs = pubs.slice(0, filters.limit)
    }

    return pubs
  }

  /**
   * Update performance metrics for a publication
   */
  async updatePerformance(
    id: string,
    performance: {
      views?: number
      reactions?: number
      comments?: number
      shares?: number
    }
  ): Promise<ContentPublication | null> {
    const pub = this.publications.find(p => p.id === id)
    if (!pub) return null

    pub.performance = {
      ...pub.performance,
      ...performance,
      lastChecked: Date.now(),
    }

    return pub
  }

  /**
   * Get a single publication by ID or URL
   */
  getPublication(idOrUrl: string): ContentPublication | null {
    return (
      this.publications.find(pub => pub.id === idOrUrl || pub.url === idOrUrl) ||
      null
    )
  }

  /**
   * Get a single calendar item by ID
   */
  getCalendarItem(id: string): ContentCalendarItem | null {
    return this.calendar.find(item => item.id === id) || null
  }

  /**
   * Delete a calendar item
   */
  async deleteCalendarItem(id: string): Promise<boolean> {
    const index = this.calendar.findIndex(item => item.id === id)
    if (index === -1) return false
    this.calendar.splice(index, 1)
    return true
  }

  /**
   * Get stats for the dashboard
   */
  getStats() {
    const now = Date.now()
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

    const publishedLast7Days = this.publications.filter(
      pub => pub.publishedAt >= sevenDaysAgo
    ).length

    const publishedLast30Days = this.publications.filter(
      pub => pub.publishedAt >= thirtyDaysAgo
    ).length

    const scheduled = this.calendar.filter(item => item.status === 'scheduled').length
    const drafts = this.calendar.filter(item => item.status === 'draft').length

    return {
      total_publications: this.publications.length,
      published_last_7_days: publishedLast7Days,
      published_last_30_days: publishedLast30Days,
      scheduled_count: scheduled,
      draft_count: drafts,
      calendar_items: this.calendar.length,
    }
  }
}

// Singleton instance
export const contentManager = new ContentManager()
