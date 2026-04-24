/**
 * openclaw-models-types.ts
 *
 * Wire types for the OpenClaw models capability publish-up seam.
 *
 * Bounded contract: only normalized fields the panel actually needs.
 * NO raw `status` / `configured` blobs from the `openclaw models` CLI —
 * plugin normalizes before POST so node never receives secret-bearing
 * config or accidental path/env leakage.
 */

export type AuthState = 'authenticated' | 'missing' | 'invalid'

export interface ProviderEntry {
  id: string
  authState: AuthState
  authProfile?: string
}

export interface ModelEntry {
  key: string
  provider: string
  displayName: string | null
  available: boolean
  reason?: string
  aliases?: string[]
  contextWindow?: number
  capabilities?: string[]
}

export interface ModelsCatalog {
  models: ModelEntry[]
  providers: ProviderEntry[]
}

export interface ModelsEnvelope {
  evaluatedAt: number
  publishedAt: number
  maxAgeMs?: number
  ok: boolean
  errors: string[]
  cliVersion: string | null
  catalog: ModelsCatalog | null
}

export interface CachedEnvelope {
  envelope: ModelsEnvelope
  receivedAt: number
}
