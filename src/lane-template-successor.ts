// SPDX-License-Identifier: Apache-2.0

import { promises as fs } from 'fs'
import { join } from 'path'
import type { Task } from './types.js'

export interface LaneTemplateSuccessorConfig {
  enabled: boolean
  onStatus: 'done'
  titlePattern: string
  descriptionPattern: string
  priority: Task['priority']
  tags?: string[]
  doneCriteriaTemplate?: string[]
  metadata?: Record<string, unknown>
}

export interface LaneTemplateRule {
  id: string
  when?: { parentMetadataKeyPresent?: string }
  action: 'create' | 'skip'
}

export interface LaneTemplate {
  lane: string
  version: number
  defaultReviewer?: string
  successor: LaneTemplateSuccessorConfig
  rules?: LaneTemplateRule[]
}

export async function loadLaneTemplate(lane: string): Promise<LaneTemplate | null> {
  const normalized = String(lane || '').trim().toLowerCase()
  if (!normalized) return null

  const path = join(process.cwd(), 'defaults', 'lane-templates', `${normalized}.json`)
  try {
    const raw = await fs.readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as LaneTemplate
    return parsed
  } catch {
    return null
  }
}

function render(pattern: string, parent: Task, nextScope: string): string {
  return pattern
    .replaceAll('{{parent.id}}', parent.id)
    .replaceAll('{{parent.title}}', parent.title)
    .replaceAll('{{next.scope}}', nextScope)
}

function shouldCreate(template: LaneTemplate, parent: Task): boolean {
  const rules = template.rules || []
  if (rules.length === 0) return true

  const meta = (parent.metadata || {}) as Record<string, unknown>
  for (const rule of rules) {
    if (rule.when?.parentMetadataKeyPresent) {
      const key = rule.when.parentMetadataKeyPresent
      const has = typeof meta[key] === 'string'
        ? String(meta[key]).trim().length > 0
        : meta[key] !== undefined && meta[key] !== null
      if (!has) {
        return rule.action !== 'create'
      }
    }
  }

  return true
}

export function buildSuccessorTaskData(parent: Task, template: LaneTemplate): Omit<Task, 'id' | 'createdAt' | 'updatedAt'> | null {
  if (template.successor.enabled !== true) return null
  if (template.successor.onStatus !== 'done') return null

  if (!shouldCreate(template, parent)) return null

  const meta = (parent.metadata || {}) as Record<string, unknown>
  const nextScopeRaw = meta.next_scope
  const nextScope = typeof nextScopeRaw === 'string' ? nextScopeRaw.trim() : ''
  if (!nextScope) return null

  const successorMetadata: Record<string, unknown> = {
    ...(template.successor.metadata || {}),
    parent_task_id: parent.id,
    lane_template: template.lane,
    lane_template_version: template.version,
    next_scope: nextScope,
  }

  return {
    title: render(template.successor.titlePattern, parent, nextScope),
    description: render(template.successor.descriptionPattern, parent, nextScope),
    status: 'todo',
    assignee: parent.assignee,
    reviewer: template.defaultReviewer || parent.reviewer,
    done_criteria: template.successor.doneCriteriaTemplate || ['Follow-up scope validated and shipped'],
    createdBy: 'lane-template-successor',
    priority: template.successor.priority || parent.priority || 'P2',
    tags: template.successor.tags || ['autogen', `lane:${template.lane}`],
    metadata: successorMetadata,
    teamId: parent.teamId,
  }
}
