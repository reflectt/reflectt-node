// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { promises as fs } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './config.js'

export interface ResearchRequest {
  id: string
  title: string
  question: string
  requestedBy: string
  owner?: string
  category?: 'market' | 'competitor' | 'customer' | 'other'
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  status: 'open' | 'in_progress' | 'answered' | 'archived'
  taskId?: string
  dueAt?: number
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface ResearchFinding {
  id: string
  requestId: string
  title: string
  summary: string
  author: string
  confidence?: 'low' | 'medium' | 'high'
  artifactUrl?: string
  highlights?: string[]
  createdAt: number
  metadata?: Record<string, unknown>
}

const REQUESTS_FILE = join(DATA_DIR, 'research.requests.jsonl')
const FINDINGS_FILE = join(DATA_DIR, 'research.findings.jsonl')

class ResearchManager {
  private requests = new Map<string, ResearchRequest>()
  private findings: ResearchFinding[] = []
  private initialized = false

  constructor() {
    this.load().catch(err => console.error('[Research] Failed to initialize:', err))
  }

  private async load(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      try {
        const raw = await fs.readFile(REQUESTS_FILE, 'utf-8')
        for (const line of raw.split('\n').filter(Boolean)) {
          try {
            const item = JSON.parse(line) as ResearchRequest
            this.requests.set(item.id, item)
          } catch {}
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
      }

      try {
        const raw = await fs.readFile(FINDINGS_FILE, 'utf-8')
        for (const line of raw.split('\n').filter(Boolean)) {
          try {
            const item = JSON.parse(line) as ResearchFinding
            this.findings.push(item)
          } catch {}
        }
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
      }

      this.findings.sort((a, b) => b.createdAt - a.createdAt)
    } finally {
      this.initialized = true
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.initialized) return
    await new Promise(resolve => setTimeout(resolve, 50))
    if (!this.initialized) await this.load()
  }

  private async persistRequests(): Promise<void> {
    const lines = Array.from(this.requests.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(item => JSON.stringify(item))
    await fs.writeFile(REQUESTS_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8')
  }

  private async persistFindings(): Promise<void> {
    const lines = this.findings
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(item => JSON.stringify(item))
    await fs.writeFile(FINDINGS_FILE, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8')
  }

  async createRequest(data: {
    title: string
    question: string
    requestedBy: string
    owner?: string
    category?: ResearchRequest['category']
    priority?: ResearchRequest['priority']
    status?: ResearchRequest['status']
    taskId?: string
    dueAt?: number
    metadata?: Record<string, unknown>
  }): Promise<ResearchRequest> {
    await this.ensureReady()
    const now = Date.now()
    const item: ResearchRequest = {
      id: `rreq-${now}-${Math.random().toString(36).slice(2, 9)}`,
      title: data.title,
      question: data.question,
      requestedBy: data.requestedBy,
      owner: data.owner,
      category: data.category,
      priority: data.priority,
      status: data.status || 'open',
      taskId: data.taskId,
      dueAt: data.dueAt,
      metadata: data.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.requests.set(item.id, item)
    await this.persistRequests()
    return item
  }

  async updateRequest(id: string, updates: Partial<Omit<ResearchRequest, 'id' | 'createdAt'>>): Promise<ResearchRequest | undefined> {
    await this.ensureReady()
    const existing = this.requests.get(id)
    if (!existing) return undefined

    const updated: ResearchRequest = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }

    this.requests.set(id, updated)
    await this.persistRequests()
    return updated
  }

  async getRequest(id: string): Promise<ResearchRequest | undefined> {
    await this.ensureReady()
    return this.requests.get(id)
  }

  async createFinding(data: {
    requestId: string
    title: string
    summary: string
    author: string
    confidence?: ResearchFinding['confidence']
    artifactUrl?: string
    highlights?: string[]
    metadata?: Record<string, unknown>
  }): Promise<ResearchFinding> {
    await this.ensureReady()

    const request = this.requests.get(data.requestId)
    if (!request) {
      throw new Error('requestId not found')
    }

    const now = Date.now()
    const finding: ResearchFinding = {
      id: `rfind-${now}-${Math.random().toString(36).slice(2, 9)}`,
      requestId: data.requestId,
      title: data.title,
      summary: data.summary,
      author: data.author,
      confidence: data.confidence,
      artifactUrl: data.artifactUrl,
      highlights: data.highlights,
      metadata: data.metadata,
      createdAt: now,
    }

    this.findings.unshift(finding)
    await this.persistFindings()

    if (request.status !== 'answered') {
      await this.updateRequest(request.id, { status: 'answered' })
    }

    return finding
  }

  async listRequests(filters?: {
    status?: ResearchRequest['status']
    owner?: string
    category?: ResearchRequest['category']
    limit?: number
  }): Promise<ResearchRequest[]> {
    await this.ensureReady()
    let rows = Array.from(this.requests.values())

    if (filters?.status) rows = rows.filter(r => r.status === filters.status)
    if (filters?.owner) rows = rows.filter(r => r.owner === filters.owner)
    if (filters?.category) rows = rows.filter(r => r.category === filters.category)

    rows.sort((a, b) => {
      const aDue = a.dueAt || Number.MAX_SAFE_INTEGER
      const bDue = b.dueAt || Number.MAX_SAFE_INTEGER
      if (aDue !== bDue) return aDue - bDue
      return b.updatedAt - a.updatedAt
    })

    if (filters?.limit && filters.limit > 0) rows = rows.slice(0, filters.limit)
    return rows
  }

  async listFindings(filters?: {
    requestId?: string
    author?: string
    limit?: number
  }): Promise<ResearchFinding[]> {
    await this.ensureReady()
    let rows = this.findings.slice()

    if (filters?.requestId) rows = rows.filter(f => f.requestId === filters.requestId)
    if (filters?.author) rows = rows.filter(f => f.author === filters.author)
    if (filters?.limit && filters.limit > 0) rows = rows.slice(0, filters.limit)

    return rows
  }
}

export const researchManager = new ResearchManager()
