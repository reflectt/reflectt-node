// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import type { Task } from '../src/types.js'
import { buildSuccessorTaskData } from '../src/lane-template-successor.js'

const baseTask: Task = {
  id: 'task-parent-1',
  title: 'Parent task',
  status: 'done',
  assignee: 'rhythm',
  reviewer: 'coo',
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 2,
  metadata: {
    lane: 'ops',
    next_scope: 'implement successor hook',
  },
}

const template = {
  lane: 'ops',
  version: 1,
  defaultReviewer: 'coo',
  successor: {
    enabled: true,
    onStatus: 'done' as const,
    titlePattern: 'ops follow-up: {{parent.title}}',
    descriptionPattern: 'Follow-up for {{parent.id}}. Scope: {{next.scope}}',
    priority: 'P2' as const,
    tags: ['autogen', 'lane:ops'],
    doneCriteriaTemplate: ['a', 'b'],
    metadata: { generated_by: 'lane-template-successor' },
  },
  rules: [{ id: 'require-next-scope', when: { parentMetadataKeyPresent: 'next_scope' }, action: 'create' as const }],
}

describe('lane-template successor builder', () => {
  it('builds successor when next_scope exists', () => {
    const result = buildSuccessorTaskData(baseTask, template)
    expect(result).not.toBeNull()
    expect(result?.title).toBe('ops follow-up: Parent task')
    expect(result?.description).toContain('implement successor hook')
    expect((result?.metadata as any).parent_task_id).toBe('task-parent-1')
  })

  it('returns null when next_scope is missing', () => {
    const task = { ...baseTask, metadata: { lane: 'ops' } }
    const result = buildSuccessorTaskData(task, template)
    expect(result).toBeNull()
  })

  it('returns null when successor feature disabled', () => {
    const disabled = { ...template, successor: { ...template.successor, enabled: false } }
    const result = buildSuccessorTaskData(baseTask, disabled)
    expect(result).toBeNull()
  })
})
