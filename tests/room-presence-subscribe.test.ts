import { afterEach, describe, expect, it, vi } from 'vitest'

describe('room-presence-store subscribe behavior', () => {
  const originalEnv = { ...process.env }

  afterEach(async () => {
    process.env = { ...originalEnv }
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('tracks a non-human node sentinel after subscribe so presence sync can populate', async () => {
    const track = vi.fn().mockResolvedValue('ok')
    const unsubscribe = vi.fn().mockResolvedValue('ok')
    const removeChannel = vi.fn().mockResolvedValue('ok')
    let subscribeHandler: ((status: string) => void) | null = null

    const channel: any = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((handler: (status: string) => void) => {
        subscribeHandler = handler
        return channel
      }),
      track,
      presenceState: vi.fn(() => ({})),
      unsubscribe,
    }

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn(() => ({
        channel: vi.fn(() => channel),
        removeChannel,
      })),
    }))

    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
    process.env.REFLECTT_HOST_ID = 'host-123'

    const mod = await import('../src/room-presence-store.js')
    expect(mod.initRoomPresenceStore()).toBe(true)
    expect(track).not.toHaveBeenCalled()

    expect(subscribeHandler).toBeTypeOf('function')
    subscribeHandler?.('SUBSCRIBED')
    await Promise.resolve()

    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'listener',
      id: 'node:host-123',
      hostId: 'host-123',
    }))

    await mod.shutdownRoomPresenceStore()
    expect(unsubscribe).toHaveBeenCalled()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
