// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Secret Vault — Per-host encrypted credential storage
 *
 * Zero-knowledge architecture:
 * - Host Master Key (HMK) generated and stored locally, never leaves host
 * - Each secret has its own Data Encryption Key (DEK)
 * - Cloud stores only ciphertext + wrapped DEK
 * - AES-256-GCM for all encryption
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

// ── Types ──

export interface EncryptedPayload {
  ciphertext: string   // base64
  iv: string           // base64
  authTag: string      // base64
}

export interface EncryptedSecret {
  name: string
  scope: 'host' | 'project' | 'agent'
  encrypted_value: EncryptedPayload
  wrapped_dek: EncryptedPayload
  created_at: number
  rotated_at: number
  metadata?: Record<string, unknown>
}

export interface SecretMetadata {
  name: string
  scope: 'host' | 'project' | 'agent'
  created_at: number
  rotated_at: number
  metadata?: Record<string, unknown>
}

export interface AuditEntry {
  timestamp: number
  secretName: string
  action: 'create' | 'read' | 'rotate' | 'delete' | 'export' | 'import'
  actor: string
  hostId: string
  success: boolean
  metadata?: Record<string, unknown>
}

export interface SecretExportBundle {
  version: string
  exported_at: string
  host_id: string
  secrets: EncryptedSecret[]
}

// ── Constants ──

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

// ── Core Crypto ──

function encrypt(key: Buffer, plaintext: string): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

function decrypt(key: Buffer, payload: EncryptedPayload): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

// ── Secret Vault ──

export class SecretVault {
  private hmk: Buffer | null = null
  private secrets = new Map<string, EncryptedSecret>()
  private secretsDir: string
  private keyPath: string
  private storePath: string
  private auditPath: string
  private hostId: string

  constructor(reflecttHome: string, hostId: string = 'unknown') {
    this.secretsDir = join(reflecttHome, 'secrets')
    this.keyPath = join(this.secretsDir, 'host.key')
    this.storePath = join(this.secretsDir, 'vault.json')
    this.auditPath = join(this.secretsDir, 'audit.jsonl')
    this.hostId = hostId
  }

  /** Initialize vault — load or generate HMK, load stored secrets */
  init(): void {
    // Ensure directory exists
    if (!existsSync(this.secretsDir)) {
      mkdirSync(this.secretsDir, { recursive: true })
      try { chmodSync(this.secretsDir, 0o700) } catch {}
    }

    // Load or generate Host Master Key
    if (existsSync(this.keyPath)) {
      this.hmk = Buffer.from(readFileSync(this.keyPath, 'utf8').trim(), 'base64')
      if (this.hmk.length !== KEY_LENGTH) {
        throw new Error(`Invalid HMK length: expected ${KEY_LENGTH}, got ${this.hmk.length}`)
      }
      console.log('[Vault] Loaded Host Master Key')
    } else {
      this.hmk = randomBytes(KEY_LENGTH)
      writeFileSync(this.keyPath, this.hmk.toString('base64'), { mode: 0o600 })
      console.log('[Vault] Generated new Host Master Key')
    }

    // Load stored secrets
    if (existsSync(this.storePath)) {
      try {
        const data = JSON.parse(readFileSync(this.storePath, 'utf8'))
        if (Array.isArray(data.secrets)) {
          for (const s of data.secrets) {
            this.secrets.set(s.name, s)
          }
          console.log(`[Vault] Loaded ${this.secrets.size} encrypted secrets`)
        }
      } catch (err) {
        console.error('[Vault] Failed to load vault store:', (err as Error).message)
      }
    }
  }

  /** Create or update a secret */
  create(name: string, plaintext: string, scope: 'host' | 'project' | 'agent' = 'host', actor: string = 'system', metadata?: Record<string, unknown>): SecretMetadata {
    this.ensureInitialized()

    const dek = randomBytes(KEY_LENGTH)
    const encrypted_value = encrypt(dek, plaintext)
    const wrapped_dek = encrypt(this.hmk!, dek.toString('base64'))
    const now = Date.now()

    const secret: EncryptedSecret = {
      name,
      scope,
      encrypted_value,
      wrapped_dek,
      created_at: this.secrets.get(name)?.created_at ?? now,
      rotated_at: now,
      metadata,
    }

    this.secrets.set(name, secret)
    this.persist()
    this.audit(name, 'create', actor, true)

    // Zero the DEK from memory
    dek.fill(0)

    return this.toMetadata(secret)
  }

  /** Decrypt and return a secret value */
  read(name: string, actor: string = 'system'): string | null {
    this.ensureInitialized()

    const secret = this.secrets.get(name)
    if (!secret) {
      this.audit(name, 'read', actor, false, { reason: 'not_found' })
      return null
    }

    try {
      // Unwrap DEK
      const dekBase64 = decrypt(this.hmk!, secret.wrapped_dek)
      const dek = Buffer.from(dekBase64, 'base64')

      // Decrypt value
      const plaintext = decrypt(dek, secret.encrypted_value)

      // Zero DEK
      dek.fill(0)

      this.audit(name, 'read', actor, true)
      return plaintext
    } catch (err) {
      this.audit(name, 'read', actor, false, { reason: (err as Error).message })
      return null
    }
  }

  /** List all secret metadata (no plaintext) */
  list(): SecretMetadata[] {
    return Array.from(this.secrets.values()).map(s => this.toMetadata(s))
  }

  /** Delete a secret */
  delete(name: string, actor: string = 'system'): boolean {
    const existed = this.secrets.delete(name)
    if (existed) {
      this.persist()
      this.audit(name, 'delete', actor, true)
    }
    return existed
  }

  /** Rotate a secret's DEK (re-encrypt with new key) */
  rotate(name: string, actor: string = 'system'): SecretMetadata | null {
    this.ensureInitialized()

    const secret = this.secrets.get(name)
    if (!secret) return null

    try {
      // Decrypt with old DEK
      const oldDekBase64 = decrypt(this.hmk!, secret.wrapped_dek)
      const oldDek = Buffer.from(oldDekBase64, 'base64')
      const plaintext = decrypt(oldDek, secret.encrypted_value)
      oldDek.fill(0)

      // Re-encrypt with new DEK
      const newDek = randomBytes(KEY_LENGTH)
      const encrypted_value = encrypt(newDek, plaintext)
      const wrapped_dek = encrypt(this.hmk!, newDek.toString('base64'))
      newDek.fill(0)

      secret.encrypted_value = encrypted_value
      secret.wrapped_dek = wrapped_dek
      secret.rotated_at = Date.now()

      this.persist()
      this.audit(name, 'rotate', actor, true)

      return this.toMetadata(secret)
    } catch (err) {
      this.audit(name, 'rotate', actor, false, { reason: (err as Error).message })
      return null
    }
  }

  /** Export all secrets as encrypted bundle */
  export(actor: string = 'system'): SecretExportBundle {
    this.audit('*', 'export', actor, true, { count: this.secrets.size })

    return {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      host_id: this.hostId,
      secrets: Array.from(this.secrets.values()),
    }
  }

  /** Import secrets from bundle (re-wraps DEKs with current HMK) */
  import(bundle: SecretExportBundle, sourceHmk: Buffer, actor: string = 'system'): number {
    this.ensureInitialized()

    let imported = 0
    for (const secret of bundle.secrets) {
      try {
        // Unwrap DEK with source HMK
        const dekBase64 = decrypt(sourceHmk, secret.wrapped_dek)
        const dek = Buffer.from(dekBase64, 'base64')

        // Re-wrap DEK with our HMK
        const rewrapped = encrypt(this.hmk!, dekBase64)
        dek.fill(0)

        const imported_secret: EncryptedSecret = {
          ...secret,
          wrapped_dek: rewrapped,
          rotated_at: Date.now(),
        }

        this.secrets.set(secret.name, imported_secret)
        imported++
      } catch (err) {
        console.error(`[Vault] Failed to import secret ${secret.name}:`, (err as Error).message)
      }
    }

    this.persist()
    this.audit('*', 'import', actor, true, { count: imported, source_host: bundle.host_id })
    return imported
  }

  /** Get audit log entries */
  getAuditLog(limit: number = 100): AuditEntry[] {
    if (!existsSync(this.auditPath)) return []

    try {
      const lines = readFileSync(this.auditPath, 'utf8').trim().split('\n').filter(Boolean)
      return lines.slice(-limit).map(line => JSON.parse(line))
    } catch {
      return []
    }
  }

  /** Check if vault is initialized */
  isInitialized(): boolean {
    return this.hmk !== null
  }

  /** Get vault stats */
  getStats(): { initialized: boolean; secretCount: number; hostId: string } {
    return {
      initialized: this.isInitialized(),
      secretCount: this.secrets.size,
      hostId: this.hostId,
    }
  }

  // ── Private ──

  private ensureInitialized(): void {
    if (!this.hmk) {
      throw new Error('Vault not initialized — call init() first')
    }
  }

  private persist(): void {
    const data = {
      version: '1.0.0',
      updated_at: new Date().toISOString(),
      secrets: Array.from(this.secrets.values()),
    }
    writeFileSync(this.storePath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  private audit(
    secretName: string,
    action: AuditEntry['action'],
    actor: string,
    success: boolean,
    metadata?: Record<string, unknown>,
  ): void {
    const entry: AuditEntry = {
      timestamp: Date.now(),
      secretName,
      action,
      actor,
      hostId: this.hostId,
      success,
      metadata,
    }

    try {
      appendFileSync(this.auditPath, JSON.stringify(entry) + '\n')
    } catch {
      // Audit failure should not break operations
    }
  }

  private toMetadata(secret: EncryptedSecret): SecretMetadata {
    return {
      name: secret.name,
      scope: secret.scope,
      created_at: secret.created_at,
      rotated_at: secret.rotated_at,
      metadata: secret.metadata,
    }
  }
}
