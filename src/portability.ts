// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Portability Module — One-click config + secrets export/import
 *
 * Escape hatch for users: export everything needed to move to self-hosted
 * or another reflectt-node instance. No lock-in.
 *
 * Export bundle includes:
 *   - Team config (TEAM.md, TEAM-ROLES.yaml, TEAM-STANDARDS.md)
 *   - Server config (config.json — cloud credentials redacted)
 *   - Encrypted secrets (vault export — ciphertext only, requires HMK)
 *   - Webhook routes + delivery config
 *   - Provisioning state (hostId, cloud URL — credentials redacted)
 *
 * Import path re-hydrates a fresh ~/.reflectt/ from a bundle.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, basename, relative } from 'node:path'
import { REFLECTT_HOME } from './config.js'
import { SecretVault } from './secrets.js'
import { getProvisioningManager } from './provisioning.js'
import { getWebhookDeliveryManager } from './webhooks.js'

// ── Types ──

export interface ExportBundle {
  version: '1.0.0'
  format: 'reflectt-export'
  exportedAt: string
  exportedFrom: {
    hostId: string | null
    hostName: string
    reflecttHome: string
  }
  teamConfig: {
    teamMd: string | null
    teamRolesYaml: string | null
    teamStandardsMd: string | null
  }
  serverConfig: Record<string, unknown> | null  // config.json (credentials redacted)
  secrets: {
    vaultExport: ReturnType<SecretVault['export']> | null
    secretCount: number
    note: string
  }
  webhooks: {
    routes: Array<Record<string, unknown>>
    deliveryConfig: Record<string, unknown>
  }
  provisioning: {
    phase: string
    hostId: string | null
    hostName: string
    cloudUrl: string
    webhookCount: number
    // credential intentionally omitted
  }
  customFiles: Array<{
    path: string  // relative to REFLECTT_HOME
    content: string
  }>
}

export interface ImportResult {
  success: boolean
  message: string
  imported: {
    teamConfig: boolean
    serverConfig: boolean
    webhookConfig: boolean
    customFiles: number
  }
  warnings: string[]
}

// Files to include in custom files export
const EXPORTABLE_EXTENSIONS = ['.md', '.yaml', '.yml', '.json', '.toml', '.txt']
const EXCLUDED_DIRS = ['data', 'secrets', 'logs', 'cache', 'node_modules', '.git']
const EXCLUDED_FILES = ['config.json', 'provisioning.json', 'server.pid']

// ── Export ──

export function exportBundle(vault: SecretVault | null): ExportBundle {
  const provisioning = getProvisioningManager()
  const webhookDelivery = getWebhookDeliveryManager()
  const provStatus = provisioning.getStatus()

  // Team config files
  const teamMd = safeRead(join(REFLECTT_HOME, 'TEAM.md'))
  const teamRolesYaml = safeRead(join(REFLECTT_HOME, 'TEAM-ROLES.yaml'))
  const teamStandardsMd = safeRead(join(REFLECTT_HOME, 'TEAM-STANDARDS.md'))

  // Server config (redact credentials)
  let serverConfig: Record<string, unknown> | null = null
  const configPath = join(REFLECTT_HOME, 'config.json')
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
      serverConfig = redactConfig(raw)
    } catch {}
  }

  // Vault export (encrypted — requires HMK to decrypt)
  let vaultExport: ReturnType<SecretVault['export']> | null = null
  let secretCount = 0
  if (vault?.isInitialized()) {
    vaultExport = vault.export('portability-export')
    secretCount = vault.getStats().secretCount
  }

  // Webhook routes + config
  const webhookRoutes = provisioning.getWebhooks().map(w => ({
    id: w.id,
    provider: w.provider,
    path: w.path,
    events: w.events,
    active: w.active,
    // secret intentionally omitted — stored in vault
  }))

  // Custom files (anything in REFLECTT_HOME that's not excluded)
  const customFiles = collectCustomFiles(REFLECTT_HOME)

  return {
    version: '1.0.0',
    format: 'reflectt-export',
    exportedAt: new Date().toISOString(),
    exportedFrom: {
      hostId: provStatus.hostId,
      hostName: provStatus.hostName,
      reflecttHome: REFLECTT_HOME,
    },
    teamConfig: {
      teamMd,
      teamRolesYaml,
      teamStandardsMd,
    },
    serverConfig,
    secrets: {
      vaultExport,
      secretCount,
      note: 'Secrets are encrypted with the Host Master Key (HMK). To import on a new host, you need the HMK file (~/.reflectt/secrets/host.key) from the source host.',
    },
    webhooks: {
      routes: webhookRoutes,
      deliveryConfig: webhookDelivery.getConfig() as unknown as Record<string, unknown>,
    },
    provisioning: {
      phase: provStatus.phase,
      hostId: provStatus.hostId,
      hostName: provStatus.hostName,
      cloudUrl: provStatus.cloudUrl,
      webhookCount: provStatus.webhooks.length,
    },
    customFiles,
  }
}

// ── Import ──

export function importBundle(
  bundle: ExportBundle,
  options: {
    overwrite?: boolean
    skipSecrets?: boolean
    skipConfig?: boolean
  } = {}
): ImportResult {
  const warnings: string[] = []
  const imported = {
    teamConfig: false,
    serverConfig: false,
    webhookConfig: false,
    customFiles: 0,
  }

  // Validate bundle format
  if (bundle.format !== 'reflectt-export' || !bundle.version) {
    return {
      success: false,
      message: 'Invalid export bundle format',
      imported,
      warnings: ['Bundle missing format or version field'],
    }
  }

  // Ensure REFLECTT_HOME exists
  if (!existsSync(REFLECTT_HOME)) {
    mkdirSync(REFLECTT_HOME, { recursive: true })
  }

  // Import team config
  if (bundle.teamConfig) {
    const teamFiles: Array<[string, string | null]> = [
      ['TEAM.md', bundle.teamConfig.teamMd],
      ['TEAM-ROLES.yaml', bundle.teamConfig.teamRolesYaml],
      ['TEAM-STANDARDS.md', bundle.teamConfig.teamStandardsMd],
    ]

    for (const [filename, content] of teamFiles) {
      if (content) {
        const filePath = join(REFLECTT_HOME, filename)
        if (existsSync(filePath) && !options.overwrite) {
          warnings.push(`Skipped ${filename} (already exists, use overwrite=true)`)
        } else {
          writeFileSync(filePath, content, 'utf-8')
          imported.teamConfig = true
        }
      }
    }
  }

  // Import server config (without credentials — user must re-enroll)
  if (bundle.serverConfig && !options.skipConfig) {
    const configPath = join(REFLECTT_HOME, 'config.json')
    if (existsSync(configPath) && !options.overwrite) {
      warnings.push('Skipped config.json (already exists)')
    } else {
      // Merge with existing if present, otherwise write fresh
      let existing: Record<string, unknown> = {}
      if (existsSync(configPath)) {
        try { existing = JSON.parse(readFileSync(configPath, 'utf-8')) } catch {}
      }

      // Don't overwrite cloud credentials from bundle (they're redacted anyway)
      const merged = { ...bundle.serverConfig }
      if (existing.cloud) {
        merged.cloud = existing.cloud
      }

      writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8')
      imported.serverConfig = true
      warnings.push('Cloud credentials not imported — re-enroll this host with a new join token')
    }
  }

  // Import webhook config
  if (bundle.webhooks?.routes?.length) {
    const provisioning = getProvisioningManager()
    for (const route of bundle.webhooks.routes) {
      provisioning.addWebhookRoute({
        provider: route.provider as string,
        path: route.path as string || `/webhooks/${route.provider}`,
        events: (route.events as string[]) || [],
        active: route.active !== false,
      })
    }
    imported.webhookConfig = true
  }

  // Import webhook delivery config
  if (bundle.webhooks?.deliveryConfig) {
    const webhookDelivery = getWebhookDeliveryManager()
    webhookDelivery.updateConfig(bundle.webhooks.deliveryConfig as any)
  }

  // Import custom files
  if (bundle.customFiles?.length) {
    for (const file of bundle.customFiles) {
      const filePath = join(REFLECTT_HOME, file.path)
      const dir = join(filePath, '..')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      if (existsSync(filePath) && !options.overwrite) {
        warnings.push(`Skipped ${file.path} (already exists)`)
      } else {
        writeFileSync(filePath, file.content, 'utf-8')
        imported.customFiles++
      }
    }
  }

  // Secrets note
  if (bundle.secrets?.secretCount && bundle.secrets.secretCount > 0) {
    warnings.push(
      `${bundle.secrets.secretCount} encrypted secrets in bundle. ` +
      'To import: copy host.key from source host to ~/.reflectt/secrets/host.key, ' +
      'then POST /secrets/import with the vault export data.'
    )
  }

  return {
    success: true,
    message: `Import complete. ${warnings.length} warning(s).`,
    imported,
    warnings,
  }
}

// ── Helpers ──

function safeRead(filePath: string): string | null {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8')
    }
  } catch {}
  return null
}

function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...config }

  // Redact cloud credentials
  if (redacted.cloud && typeof redacted.cloud === 'object') {
    const cloud = { ...(redacted.cloud as Record<string, unknown>) }
    if (cloud.credential) cloud.credential = '[REDACTED]'
    if (cloud.hostId) cloud.hostId = '[REDACTED — re-enroll on new host]'
    redacted.cloud = cloud
  }

  // Redact any keys that look like secrets
  for (const key of Object.keys(redacted)) {
    if (/token|secret|password|credential|key/i.test(key) && typeof redacted[key] === 'string') {
      redacted[key] = '[REDACTED]'
    }
  }

  return redacted
}

function collectCustomFiles(root: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = []

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const relPath = relative(root, fullPath)

      // Skip excluded dirs
      if (EXCLUDED_DIRS.some(d => relPath.startsWith(d))) continue

      try {
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          walk(fullPath)
          continue
        }

        if (!stat.isFile()) continue

        // Skip excluded files
        if (EXCLUDED_FILES.includes(basename(fullPath))) continue

        // Skip files already handled (team config)
        if (['TEAM.md', 'TEAM-ROLES.yaml', 'TEAM-STANDARDS.md'].includes(basename(fullPath))) continue

        // Only include text files with exportable extensions
        const ext = basename(fullPath).includes('.')
          ? '.' + basename(fullPath).split('.').pop()
          : ''
        if (!EXPORTABLE_EXTENSIONS.includes(ext)) continue

        // Size limit: 1MB per file
        if (stat.size > 1_000_000) continue

        const content = readFileSync(fullPath, 'utf-8')
        files.push({ path: relPath, content })
      } catch {
        // Skip unreadable files
      }
    }
  }

  walk(root)
  return files
}
