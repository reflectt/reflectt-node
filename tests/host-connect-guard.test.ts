import { describe, expect, it } from 'vitest'
import { hostConnectGuard } from '../src/hostConnectGuard'

describe('hostConnectGuard', () => {
  it('allows when no existing enrollment', () => {
    expect(hostConnectGuard({ existingCloud: undefined, force: false }).allow).toBe(true)
  })

  it('blocks overwrite when already enrolled and --force not provided', () => {
    const res = hostConnectGuard({
      existingCloud: { hostId: 'host_123', cloudUrl: 'https://app.reflectt.ai', credential: 'tok' },
      force: false,
    })

    expect(res.allow).toBe(false)
    expect(res.warning).toContain('already enrolled')
    expect(res.warning).toContain('--force')
  })

  it('allows overwrite when already enrolled and --force provided', () => {
    const res = hostConnectGuard({
      existingCloud: { hostId: 'host_123', cloudUrl: 'https://app.reflectt.ai', credential: 'tok' },
      force: true,
    })

    expect(res.allow).toBe(true)
  })
})
