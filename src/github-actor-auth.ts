// SPDX-License-Identifier: Apache-2.0
// GitHub per-actor token resolution + safe helpers.

import type { SecretVault } from './secrets.js'

let vaultRef: SecretVault | null = null

export function initGitHubActorAuth(vault: SecretVault): void {
  vaultRef = vault
}

export interface GitHubActorTokenResult {
  token: string
  source: 'vault' | 'env'
  secretName?: string
  envKey?: string
}

/**
 * Resolve a GitHub token for a given actor.
 *
 * Resolution order:
 *  1) SecretVault: `github.pat.<actor>` (recommended)
 *  2) SecretVault: `github.pat.reviewer` (fallback shared reviewer/bot identity)
 *  3) Environment: `GH_TOKEN_<ACTOR>` / `GITHUB_TOKEN_<ACTOR>` (optional)
 *  4) Environment: `GH_TOKEN` / `GITHUB_TOKEN` (legacy)
 */
export function resolveGitHubTokenForActor(actor: string): GitHubActorTokenResult | null {
  const a = (actor || '').trim()
  const actorKey = a || 'unknown'

  // Vault secrets (preferred)
  if (vaultRef) {
    const byActor = `github.pat.${actorKey}`
    const v1 = vaultRef.read(byActor, `github-actor-auth:${actorKey}`)
    if (v1 && v1.trim()) return { token: v1.trim(), source: 'vault', secretName: byActor }

    const reviewer = 'github.pat.reviewer'
    const v2 = vaultRef.read(reviewer, `github-actor-auth:${actorKey}`)
    if (v2 && v2.trim()) return { token: v2.trim(), source: 'vault', secretName: reviewer }
  }

  // Env overrides per actor
  const upper = actorKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  const actorEnvKeys = [`GH_TOKEN_${upper}`, `GITHUB_TOKEN_${upper}`]
  for (const k of actorEnvKeys) {
    const v = process.env[k]
    if (v && v.trim()) return { token: v.trim(), source: 'env', envKey: k }
  }

  // Legacy env
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    const v = process.env[k]
    if (v && v.trim()) return { token: v.trim(), source: 'env', envKey: k }
  }

  return null
}

export function buildGhEnvWithToken(token: string): NodeJS.ProcessEnv {
  // gh CLI uses GH_TOKEN; some libs read GITHUB_TOKEN.
  return {
    ...process.env,
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  }
}
