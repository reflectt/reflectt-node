import { describe, expect, it, vi } from 'vitest'
import { createGitHubIdentityProvider } from '../src/github-identity.js'

class FakeVault {
  private map = new Map<string, string>()
  set(k: string, v: string) { this.map.set(k, v) }
  read(name: string) { return this.map.get(name) ?? null }
}

describe('GitHubIdentityProvider', () => {
  it('falls back to PAT env vars when mode=pat', async () => {
    process.env.GITHUB_TOKEN = 'pat_123'

    const provider = createGitHubIdentityProvider({
      config: { mode: 'pat' },
      // no vault
    })

    const tok = await provider.getToken()
    expect(tok?.source).toBe('pat')
    expect(tok?.token).toBe('pat_123')
  })

  it('uses app installation token when configured (sets Authorization header)', async () => {
    delete process.env.GITHUB_TOKEN
    delete process.env.GH_TOKEN

    const vault = new FakeVault()

    // Generate a real RSA keypair so signing works.
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    })

    vault.set('pk', privateKey)
    vault.set('appId', '123')
    vault.set('instId', '456')

    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      expect(init?.method).toBe('POST')
      expect(init?.headers?.Authorization).toMatch(/^Bearer /)
      return {
        ok: true,
        json: async () => ({ token: 'inst_tok_abc', expires_at: new Date(Date.now() + 60_000).toISOString() }),
      } as any
    })

    const provider = createGitHubIdentityProvider({
      config: {
        mode: 'app_installation',
        app: {
          privateKeySecretName: 'pk',
          appIdSecretName: 'appId',
          installationIdSecretName: 'instId',
        },
      },
      vault: vault as any,
      fetchImpl: fetchImpl as any,
    })

    const tok = await provider.getToken()
    expect(tok).toEqual({ token: 'inst_tok_abc', source: 'app_installation' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
