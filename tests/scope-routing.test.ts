import { describe, it, expect } from 'vitest'
import { deriveScopeId } from '../src/scope-routing.js'

describe('scope routing', () => {
  it('uses explicit scope override', () => {
    expect(deriveScopeId({ scope_id: 'team:xyz', channel: 'general' })).toBe('team:xyz')
  })

  it('maps general/ops to team scope', () => {
    expect(deriveScopeId({ channel: 'general' })).toBe('team:default')
    expect(deriveScopeId({ channel: 'ops' })).toBe('team:default')
  })

  it('maps task-comments to task scope when task_id known', () => {
    expect(deriveScopeId({ channel: 'task-comments', task_id: 'task-123' })).toBe('task:task-123')
  })

  it('falls back to team scope for task channels without task_id', () => {
    expect(deriveScopeId({ channel: 'task-comments' })).toBe('team:default')
  })

  it('maps dm:* channel to user scope', () => {
    expect(deriveScopeId({ channel: 'dm:ryan' })).toBe('user:ryan')
  })

  it('maps peer to user scope when channel does not encode it', () => {
    expect(deriveScopeId({ channel: 'dm', peer: 'ryan' })).toBe('user:ryan')
  })
})
