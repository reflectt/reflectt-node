// SPDX-License-Identifier: Apache-2.0
// GitHub Identity Provider — supports PAT fallback and GitHub App installation tokens.

import type { SecretVault } from './secrets.js'
import { createSign } from 'node:crypto'

export type GitHubIdentityMode = 'pat' | 'app_installation'

export interface GitHubIdentityConfig {
  mode: GitHubIdentityMode
  /** Only used for PAT mode (optional). If unset we fall back to env vars. */
  patEnvKeys?: string[]
  /** Vault secret names for App mode. */
  app?: {
    /** PEM private key for GitHub App (PKCS#1 or PKCS#8). */
    privateKeySecretName: string
    /** GitHub App ID (not client id). */
    appIdSecretName: string
    /** GitHub App installation ID to mint tokens for. */
    installationIdSecretName: string
  }
}

export interface GitHubIdentityProvider {
  /** Returns an OAuth token suitable for `Authorization: Bearer <token>` */
  getToken(): Promise<{ token: string; source: 'pat' | 'app_installation' } | null>
  getMode(): GitHubIdentityMode
}

type CachedToken = {
  token: string
  // epoch ms
  expiresAt: number
}

function readEnvToken(keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k]
    if (v && v.trim()) return v.trim()
  }
  return null
}

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function signJwtRS256(payload: Record<string, unknown>, privateKeyPem: string): string {
  const header = { alg: 'RS256', typ: 'JWT' }
  const headerPart = base64Url(JSON.stringify(header))
  const payloadPart = base64Url(JSON.stringify(payload))
  const toSign = `${headerPart}.${payloadPart}`

  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  signer.end()

  const signature = signer.sign(privateKeyPem)
  return `${toSign}.${base64Url(signature)}`
}

export function createGitHubIdentityProvider(opts: {
  config: GitHubIdentityConfig
  vault?: SecretVault
  fetchImpl?: typeof fetch
}): GitHubIdentityProvider {
  const config = opts.config
  const fetchImpl = opts.fetchImpl ?? fetch

  const patEnvKeys = config.patEnvKeys ?? ['GITHUB_TOKEN', 'GH_TOKEN']

  let cached: CachedToken | null = null

  async function getAppInstallationToken(): Promise<string | null> {
    if (!opts.vault) return null
    if (!config.app) return null

    const privateKey = opts.vault.read(config.app.privateKeySecretName, 'github-identity')
    const appId = opts.vault.read(config.app.appIdSecretName, 'github-identity')
    const installationId = opts.vault.read(config.app.installationIdSecretName, 'github-identity')

    if (!privateKey || !appId || !installationId) return null

    // Return cached token if still valid with 60s buffer.
    const now = Date.now()
    if (cached && cached.expiresAt - 60_000 > now) return cached.token

    const iat = Math.floor(now / 1000) - 30
    const exp = iat + 9 * 60 // 9m (GitHub max is 10m for app JWT)

    const jwt = signJwtRS256(
      {
        iat,
        exp,
        iss: Number(appId),
      },
      privateKey,
    )

    const res = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!res.ok) return null

    const json = (await res.json()) as any
    const token = typeof json?.token === 'string' ? json.token : null
    const expiresAtIso = typeof json?.expires_at === 'string' ? json.expires_at : null

    if (!token || !expiresAtIso) return null

    const expiresAt = Date.parse(expiresAtIso)
    if (!Number.isFinite(expiresAt)) return null

    cached = { token, expiresAt }
    return token
  }

  return {
    getMode() {
      return config.mode
    },

    async getToken() {
      if (config.mode === 'app_installation') {
        const token = await getAppInstallationToken()
        if (token) return { token, source: 'app_installation' }
        // fall back to PAT env if app mode misconfigured
      }

      const pat = readEnvToken(patEnvKeys)
      if (pat) return { token: pat, source: 'pat' }

      return null
    },
  }
}
