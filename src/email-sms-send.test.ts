// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Tests for email/SMS send validation logic.
 * The actual cloud relay is tested via integration; here we test
 * the validation layer that runs before any network call.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmailSend(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const from = typeof body.from === 'string' ? body.from.trim() : ''
  if (!from) return { valid: false, error: 'from is required' }
  if (!body.to) return { valid: false, error: 'to is required' }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  if (!subject) return { valid: false, error: 'subject is required' }
  if (!body.html && !body.text) return { valid: false, error: 'html or text body is required' }
  return { valid: true }
}

function validateSmsSend(body: Record<string, unknown>): { valid: boolean; error?: string } {
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!to) return { valid: false, error: 'to is required (phone number)' }
  const msgBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!msgBody) return { valid: false, error: 'body is required' }
  return { valid: true }
}

describe('email send validation', () => {
  it('accepts valid email payload', () => {
    const r = validateEmailSend({
      from: 'agent@reflectt.ai',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Hi there',
    })
    assert.equal(r.valid, true)
  })

  it('accepts html body', () => {
    const r = validateEmailSend({
      from: 'agent@reflectt.ai',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    })
    assert.equal(r.valid, true)
  })

  it('rejects missing from', () => {
    const r = validateEmailSend({ to: 'a@b.com', subject: 'Hi', text: 'body' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('from'))
  })

  it('rejects missing to', () => {
    const r = validateEmailSend({ from: 'a@b.com', subject: 'Hi', text: 'body' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('to'))
  })

  it('rejects missing subject', () => {
    const r = validateEmailSend({ from: 'a@b.com', to: 'b@c.com', text: 'body' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('subject'))
  })

  it('rejects missing body', () => {
    const r = validateEmailSend({ from: 'a@b.com', to: 'b@c.com', subject: 'Hi' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('html or text'))
  })
})

describe('SMS send validation', () => {
  it('accepts valid SMS payload', () => {
    const r = validateSmsSend({ to: '+14155551234', body: 'Hello' })
    assert.equal(r.valid, true)
  })

  it('rejects missing to', () => {
    const r = validateSmsSend({ body: 'Hello' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('to'))
  })

  it('rejects missing body', () => {
    const r = validateSmsSend({ to: '+14155551234' })
    assert.equal(r.valid, false)
    assert.ok(r.error?.includes('body'))
  })

  it('rejects empty body', () => {
    const r = validateSmsSend({ to: '+14155551234', body: '   ' })
    assert.equal(r.valid, false)
  })

  it('rejects empty to', () => {
    const r = validateSmsSend({ to: '  ', body: 'Hello' })
    assert.equal(r.valid, false)
  })
})
