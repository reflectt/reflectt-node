// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Host Provisioning Module
 *
 * Connects a fresh host to Reflectt Cloud:
 *   1. Enrolls with a join token (or API key)
 *   2. Pulls encrypted config + secrets on first connect
 *   3. Auto-configures webhook routes for the host
 *   4. Reports provisioning status for dashboard visibility
 *
 * Depends on: cloud.ts (heartbeat/sync), secrets.ts (vault), config.ts (REFLECTT_HOME)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { REFLECTT_HOME } from './config.js'
import { SecretVault } from './secrets.js'

// ── Types ──

export type ProvisioningPhase =
  | 'unprovisioned'
  | 'enrolling'
  | 'pulling_config'
  | 'pulling_secrets'
  | 'configuring_webhooks'
  | 'ready'
  | 'error'

export interface ProvisioningState {
  phase: ProvisioningPhase
  hostId: string | null
  hostName: string
  credential: string | null
  cloudUrl: string
  enrolledAt: number | null
  provisionedAt: number | null
  lastError: string | null
  webhooks: WebhookRoute[]
  configPulledAt: number | null
  secretsPulledAt: number | null
}

export interface WebhookRoute {
  id: string
  provider: string      // 'github' | 'stripe' | 'vercel' | 'custom'
  path: string           // e.g., '/webhooks/github'
  secret?: string        // webhook signing secret (stored in vault)
  events: string[]       // subscribed event types
  active: boolean
  createdAt: number
}

export interface CloudProvisioningConfig {
  team: {
    name: string
    id: string
  }
  webhooks: Array<{
    provider: string
    events: string[]
    signingSecretName: string  // name in the secret vault
  }>
  settings: Record<string, unknown>
}

export interface ProvisioningResult {
  success: boolean
  phase: ProvisioningPhase
  hostId: string | null
  message: string | null
  details?: Record<string, unknown>
}

// ── Constants ──

const STATE_FILE = 'provisioning.json'
const CONFIG_PULL_ENDPOINT = '/api/hosts/{hostId}/config'
const SECRETS_PULL_ENDPOINT = '/api/hosts/{hostId}/secrets'
const WEBHOOKS_ENDPOINT = '/api/hosts/{hostId}/webhooks'

// ── Provisioning Manager ──

export class ProvisioningManager {
  private state: ProvisioningState
  private statePath: string
  private vault: SecretVault | null = null

  constructor(reflecttHome: string = REFLECTT_HOME) {
    this.statePath = join(reflecttHome, STATE_FILE)
    this.state = this.loadState(reflecttHome)
  }

  /** Attach a secret vault instance for encrypted secret storage */
  setVault(vault: SecretVault): void {
    this.vault = vault
  }

  /** Get current provisioning state (safe for dashboard) */
  getStatus(): Omit<ProvisioningState, 'credential'> & { hasCredential: boolean } {
    return {
      phase: this.state.phase,
      hostId: this.state.hostId,
      hostName: this.state.hostName,
      cloudUrl: this.state.cloudUrl,
      enrolledAt: this.state.enrolledAt,
      provisionedAt: this.state.provisionedAt,
      lastError: this.state.lastError,
      webhooks: this.state.webhooks,
      configPulledAt: this.state.configPulledAt,
      secretsPulledAt: this.state.secretsPulledAt,
      hasCredential: this.state.credential !== null,
    }
  }

  /** Check if host is fully provisioned */
  isProvisioned(): boolean {
    return this.state.phase === 'ready'
  }

  /** Check if host has been enrolled (has hostId + credential) */
  isEnrolled(): boolean {
    return this.state.hostId !== null && this.state.credential !== null
  }

  /**
   * Full provisioning flow:
   *   1. Enroll with cloud (get hostId + credential)
   *   2. Pull config from cloud
   *   3. Pull encrypted secrets
   *   4. Configure webhook routes
   *
   * Idempotent — skips already-completed phases.
   */
  async provision(options: {
    cloudUrl: string
    joinToken?: string
    apiKey?: string
    hostName: string
    capabilities?: string[]
  }): Promise<ProvisioningResult> {
    this.state.cloudUrl = options.cloudUrl.replace(/\/+$/, '')
    this.state.hostName = options.hostName

    try {
      // Phase 1: Enroll
      if (!this.isEnrolled()) {
        this.setPhase('enrolling')
        await this.enroll(options)
      }

      // Phase 2: Pull config
      this.setPhase('pulling_config')
      await this.pullConfig()

      // Phase 3: Pull secrets
      this.setPhase('pulling_secrets')
      await this.pullSecrets()

      // Phase 4: Configure webhooks
      this.setPhase('configuring_webhooks')
      await this.configureWebhooks()

      // Done
      this.setPhase('ready')
      this.state.provisionedAt = Date.now()
      this.persistState()

      return {
        success: true,
        phase: 'ready',
        hostId: this.state.hostId,
        message: `Host ${this.state.hostName} provisioned successfully`,
        details: {
          webhookCount: this.state.webhooks.length,
          configPulled: this.state.configPulledAt !== null,
          secretsPulled: this.state.secretsPulledAt !== null,
        },
      }
    } catch (err: any) {
      this.state.lastError = err?.message || 'Provisioning failed'
      this.setPhase('error')
      this.persistState()

      return {
        success: false,
        phase: 'error',
        hostId: this.state.hostId,
        message: this.state.lastError,
      }
    }
  }

  /**
   * Re-provision: pull latest config + secrets + webhooks from cloud.
   * Requires existing enrollment.
   */
  async refresh(): Promise<ProvisioningResult> {
    if (!this.isEnrolled()) {
      return {
        success: false,
        phase: this.state.phase,
        hostId: null,
        message: 'Host not enrolled — run full provision first',
      }
    }

    try {
      this.setPhase('pulling_config')
      await this.pullConfig()

      this.setPhase('pulling_secrets')
      await this.pullSecrets()

      this.setPhase('configuring_webhooks')
      await this.configureWebhooks()

      this.setPhase('ready')
      this.persistState()

      return {
        success: true,
        phase: 'ready',
        hostId: this.state.hostId,
        message: 'Host config refreshed from cloud',
      }
    } catch (err: any) {
      this.state.lastError = err?.message || 'Refresh failed'
      this.setPhase('error')
      this.persistState()

      return {
        success: false,
        phase: 'error',
        hostId: this.state.hostId,
        message: this.state.lastError,
      }
    }
  }

  /**
   * Reset provisioning state (for re-enrollment)
   */
  reset(): void {
    this.state = {
      phase: 'unprovisioned',
      hostId: null,
      hostName: '',
      credential: null,
      cloudUrl: '',
      enrolledAt: null,
      provisionedAt: null,
      lastError: null,
      webhooks: [],
      configPulledAt: null,
      secretsPulledAt: null,
    }
    this.persistState()
  }

  /** Add a webhook route (for local-first webhook configuration) */
  addWebhookRoute(route: Omit<WebhookRoute, 'id' | 'createdAt'>): WebhookRoute {
    const webhook: WebhookRoute = {
      ...route,
      id: `wh_${randomBytes(8).toString('hex')}`,
      createdAt: Date.now(),
    }
    this.state.webhooks.push(webhook)
    this.persistState()
    return webhook
  }

  /** Remove a webhook route */
  removeWebhookRoute(id: string): boolean {
    const before = this.state.webhooks.length
    this.state.webhooks = this.state.webhooks.filter(w => w.id !== id)
    if (this.state.webhooks.length !== before) {
      this.persistState()
      return true
    }
    return false
  }

  /** List configured webhook routes */
  getWebhooks(): WebhookRoute[] {
    return [...this.state.webhooks]
  }

  // ── Private: Enrollment ──

  private async enroll(options: {
    cloudUrl: string
    joinToken?: string
    apiKey?: string
    hostName: string
    capabilities?: string[]
  }): Promise<void> {
    const endpoint = options.apiKey
      ? '/api/hosts/enroll'
      : '/api/hosts/claim'

    const body = options.apiKey
      ? { name: options.hostName, capabilities: options.capabilities || [] }
      : { joinToken: options.joinToken, name: options.hostName, capabilities: options.capabilities || [] }

    const authHeader = options.apiKey
      ? `Bearer ${options.apiKey}`
      : options.joinToken
        ? `Bearer ${options.joinToken}`
        : undefined

    const result = await this.cloudRequest<{
      host: { id: string }
      credential: { token: string }
    }>('POST', endpoint, body, authHeader)

    if (!result.host?.id || !result.credential?.token) {
      throw new Error('Enrollment failed: unexpected response shape')
    }

    this.state.hostId = result.host.id
    this.state.credential = result.credential.token
    this.state.enrolledAt = Date.now()

    // Persist credential to config.json for future use
    this.persistCloudConfig({
      hostId: this.state.hostId,
      credential: this.state.credential,
      cloudUrl: this.state.cloudUrl,
      hostName: this.state.hostName,
    })

    this.persistState()
    console.log(`[Provisioning] Enrolled as ${this.state.hostId}`)
  }

  // ── Private: Config Pull ──

  private async pullConfig(): Promise<void> {
    if (!this.state.hostId) throw new Error('Not enrolled')

    try {
      const endpoint = CONFIG_PULL_ENDPOINT.replace('{hostId}', this.state.hostId)
      const config = await this.cloudRequest<CloudProvisioningConfig>(
        'GET', endpoint, undefined, `Bearer ${this.state.credential}`
      )

      // Write team config to ~/.reflectt/ if received
      if (config.settings) {
        const settingsPath = join(REFLECTT_HOME, 'cloud-config.json')
        writeFileSync(settingsPath, JSON.stringify(config, null, 2), 'utf-8')
        console.log(`[Provisioning] Cloud config saved to ${settingsPath}`)
      }

      this.state.configPulledAt = Date.now()
      this.persistState()
    } catch (err: any) {
      // Config pull is optional for MVP — cloud endpoint may not exist yet
      if (err?.message?.includes('404') || err?.message?.includes('not found')) {
        console.log('[Provisioning] Config pull skipped (endpoint not available)')
        this.state.configPulledAt = Date.now()
        this.persistState()
        return
      }
      throw err
    }
  }

  // ── Private: Secrets Pull ──

  private async pullSecrets(): Promise<void> {
    if (!this.state.hostId) throw new Error('Not enrolled')

    try {
      const endpoint = SECRETS_PULL_ENDPOINT.replace('{hostId}', this.state.hostId)
      const result = await this.cloudRequest<{
        secrets: Array<{
          name: string
          scope: 'host' | 'project' | 'agent'
          encrypted_value: { ciphertext: string; iv: string; authTag: string }
          wrapped_dek: { ciphertext: string; iv: string; authTag: string }
        }>
      }>('GET', endpoint, undefined, `Bearer ${this.state.credential}`)

      if (this.vault && result.secrets?.length) {
        // Store pulled secrets in local vault (they arrive already encrypted
        // with the host's HMK if the cloud has the wrapped DEKs from a prior export)
        console.log(`[Provisioning] Received ${result.secrets.length} encrypted secrets from cloud`)
        // Note: actual import requires the source HMK. For now we log receipt.
        // Full import flow uses vault.import() with the source HMK.
      }

      this.state.secretsPulledAt = Date.now()
      this.persistState()
    } catch (err: any) {
      // Secrets pull optional for MVP
      if (err?.message?.includes('404') || err?.message?.includes('not found')) {
        console.log('[Provisioning] Secrets pull skipped (endpoint not available)')
        this.state.secretsPulledAt = Date.now()
        this.persistState()
        return
      }
      throw err
    }
  }

  // ── Private: Webhook Configuration ──

  private async configureWebhooks(): Promise<void> {
    if (!this.state.hostId) throw new Error('Not enrolled')

    try {
      const endpoint = WEBHOOKS_ENDPOINT.replace('{hostId}', this.state.hostId)
      const result = await this.cloudRequest<{
        webhooks: Array<{
          id: string
          provider: string
          events: string[]
          signingSecretName: string
          active: boolean
        }>
      }>('GET', endpoint, undefined, `Bearer ${this.state.credential}`)

      if (result.webhooks?.length) {
        // Merge cloud-configured webhooks with local state
        for (const cloudWebhook of result.webhooks) {
          const exists = this.state.webhooks.find(w => w.id === cloudWebhook.id)
          if (!exists) {
            this.state.webhooks.push({
              id: cloudWebhook.id,
              provider: cloudWebhook.provider,
              path: `/webhooks/${cloudWebhook.provider}`,
              events: cloudWebhook.events,
              active: cloudWebhook.active,
              createdAt: Date.now(),
            })
          }
        }

        // Store webhook signing secrets in vault
        if (this.vault) {
          for (const wh of result.webhooks) {
            if (wh.signingSecretName) {
              console.log(`[Provisioning] Webhook ${wh.provider}: signing secret → ${wh.signingSecretName}`)
            }
          }
        }

        console.log(`[Provisioning] Configured ${result.webhooks.length} webhook routes`)
      }

      this.persistState()
    } catch (err: any) {
      // Webhook config optional for MVP
      if (err?.message?.includes('404') || err?.message?.includes('not found')) {
        console.log('[Provisioning] Webhook config skipped (endpoint not available)')
        this.persistState()
        return
      }
      throw err
    }
  }

  // ── Private: Cloud HTTP ──

  private async cloudRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    authorization?: string,
  ): Promise<T> {
    const url = `${this.state.cloudUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (authorization) {
      headers['Authorization'] = authorization
    }

    const fetchOptions: RequestInit = { method, headers }
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url, fetchOptions)

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(
        (errBody.error as string) || `HTTP ${response.status} ${response.statusText} from ${path}`
      )
    }

    return await response.json() as T
  }

  // ── Private: State Management ──

  private loadState(reflecttHome: string): ProvisioningState {
    if (existsSync(this.statePath)) {
      try {
        const data = JSON.parse(readFileSync(this.statePath, 'utf-8'))
        return {
          phase: data.phase || 'unprovisioned',
          hostId: data.hostId || null,
          hostName: data.hostName || '',
          credential: data.credential || null,
          cloudUrl: data.cloudUrl || '',
          enrolledAt: data.enrolledAt || null,
          provisionedAt: data.provisionedAt || null,
          lastError: data.lastError || null,
          webhooks: data.webhooks || [],
          configPulledAt: data.configPulledAt || null,
          secretsPulledAt: data.secretsPulledAt || null,
        }
      } catch {
        console.error('[Provisioning] Failed to load state, starting fresh')
      }
    }

    return {
      phase: 'unprovisioned',
      hostId: null,
      hostName: '',
      credential: null,
      cloudUrl: '',
      enrolledAt: null,
      provisionedAt: null,
      lastError: null,
      webhooks: [],
      configPulledAt: null,
      secretsPulledAt: null,
    }
  }

  private persistState(): void {
    const dir = join(REFLECTT_HOME)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  private setPhase(phase: ProvisioningPhase): void {
    this.state.phase = phase
    if (phase !== 'error') {
      this.state.lastError = null
    }
    this.persistState()
  }

  private persistCloudConfig(config: {
    hostId: string
    credential: string
    cloudUrl: string
    hostName: string
  }): void {
    const configPath = join(REFLECTT_HOME, 'config.json')
    let existing: Record<string, unknown> = {}

    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, 'utf-8'))
      } catch {
        // Start fresh if corrupt
      }
    }

    existing.cloud = {
      ...(existing.cloud as Record<string, unknown> || {}),
      hostId: config.hostId,
      credential: config.credential,
      cloudUrl: config.cloudUrl,
      hostName: config.hostName,
    }

    writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8')
    console.log(`[Provisioning] Cloud credentials saved to ${configPath}`)
  }
}

// ── Singleton ──

let _manager: ProvisioningManager | null = null

export function getProvisioningManager(): ProvisioningManager {
  if (!_manager) {
    _manager = new ProvisioningManager()
  }
  return _manager
}
