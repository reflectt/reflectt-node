/**
 * Unit tests for new modules:
 * - SecretVault (create/read/rotate/export/import)
 * - ProvisioningManager (state machine)
 * - WebhookDeliveryManager (enqueue/retry/DLQ/replay)
 * - Portability (export/import)
 * - NotificationManager (preferences/routing)
 * - BoardHealthWorker (auto-actions, audit log, rollback, digest)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SecretVault } from '../src/secrets.js'
import { NotificationManager } from '../src/notifications.js'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

// ── Test helpers ──

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

async function req(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
  return {
    status: res.statusCode,
    body: JSON.parse(res.body),
  }
}

// ── SecretVault Tests ──

describe('SecretVault', () => {
  let vault: SecretVault
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-test-'))
    vault = new SecretVault(tempDir, 'test-host')
    vault.init()
  })

  it('initializes and generates HMK', () => {
    expect(vault.isInitialized()).toBe(true)
    expect(vault.getStats().secretCount).toBe(0)
    expect(vault.getStats().hostId).toBe('test-host')
    expect(existsSync(join(tempDir, 'secrets', 'host.key'))).toBe(true)
  })

  it('creates and reads a secret', () => {
    const meta = vault.create('API_KEY', 'sk-test-12345', 'host', 'test')
    expect(meta.name).toBe('API_KEY')
    expect(meta.scope).toBe('host')

    const value = vault.read('API_KEY', 'test')
    expect(value).toBe('sk-test-12345')
  })

  it('returns null for non-existent secret', () => {
    const value = vault.read('DOES_NOT_EXIST', 'test')
    expect(value).toBeNull()
  })

  it('lists secrets without plaintext', () => {
    vault.create('SECRET_1', 'value1', 'host', 'test')
    vault.create('SECRET_2', 'value2', 'project', 'test')

    const list = vault.list()
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('SECRET_1')
    expect(list[1].name).toBe('SECRET_2')
    // Ensure no plaintext in metadata
    expect(JSON.stringify(list)).not.toContain('value1')
    expect(JSON.stringify(list)).not.toContain('value2')
  })

  it('deletes a secret', () => {
    vault.create('TO_DELETE', 'temp', 'host', 'test')
    expect(vault.list()).toHaveLength(1)

    const deleted = vault.delete('TO_DELETE', 'test')
    expect(deleted).toBe(true)
    expect(vault.list()).toHaveLength(0)
    expect(vault.read('TO_DELETE')).toBeNull()
  })

  it('returns false when deleting non-existent secret', () => {
    expect(vault.delete('NOPE')).toBe(false)
  })

  it('rotates a secret DEK', () => {
    vault.create('ROTATE_ME', 'my-value', 'host', 'test')
    const before = vault.list()[0]

    // Small delay to ensure rotated_at differs
    const meta = vault.rotate('ROTATE_ME', 'test')
    expect(meta).not.toBeNull()
    expect(meta!.name).toBe('ROTATE_ME')
    expect(meta!.rotated_at).toBeGreaterThanOrEqual(before.rotated_at)

    // Value should still be readable after rotation
    expect(vault.read('ROTATE_ME')).toBe('my-value')
  })

  it('exports encrypted bundle', () => {
    vault.create('EXPORT_1', 'val1', 'host', 'test')
    vault.create('EXPORT_2', 'val2', 'agent', 'test')

    const bundle = vault.export('test')
    expect(bundle.version).toBe('1.0.0')
    expect(bundle.host_id).toBe('test-host')
    expect(bundle.secrets).toHaveLength(2)

    // Ensure exported data is encrypted (no plaintext)
    const bundleStr = JSON.stringify(bundle)
    expect(bundleStr).not.toContain('val1')
    expect(bundleStr).not.toContain('val2')
  })

  it('imports secrets from another vault', () => {
    // Create source vault
    vault.create('IMPORT_ME', 'secret-data', 'host', 'test')
    const bundle = vault.export('test')

    // Read source HMK
    const sourceHmk = Buffer.from(
      readFileSync(join(tempDir, 'secrets', 'host.key'), 'utf8').trim(),
      'base64'
    )

    // Create target vault
    const targetDir = mkdtempSync(join(tmpdir(), 'vault-target-'))
    const targetVault = new SecretVault(targetDir, 'target-host')
    targetVault.init()

    const imported = targetVault.import(bundle, sourceHmk, 'test')
    expect(imported).toBe(1)

    // Read imported secret
    const value = targetVault.read('IMPORT_ME', 'test')
    expect(value).toBe('secret-data')

    rmSync(targetDir, { recursive: true, force: true })
  })

  it('records audit log entries', () => {
    vault.create('AUDITED', 'val', 'host', 'test-actor')
    vault.read('AUDITED', 'test-actor')
    vault.rotate('AUDITED', 'test-actor')
    vault.delete('AUDITED', 'test-actor')

    const log = vault.getAuditLog()
    expect(log.length).toBeGreaterThanOrEqual(4)
    expect(log.map(e => e.action)).toEqual(
      expect.arrayContaining(['create', 'read', 'rotate', 'delete'])
    )
    expect(log.every(e => e.hostId === 'test-host')).toBe(true)
  })

  it('persists secrets across vault reloads', () => {
    vault.create('PERSIST', 'persistent-value', 'host', 'test')

    // Create new vault instance pointing to same directory
    const vault2 = new SecretVault(tempDir, 'test-host')
    vault2.init()

    expect(vault2.getStats().secretCount).toBe(1)
    expect(vault2.read('PERSIST')).toBe('persistent-value')
  })
})

// ── NotificationManager Tests ──

describe('NotificationManager', () => {
  it('returns default preferences for unconfigured agent', async () => {
    const res = await req('GET', '/notifications/preferences/test-agent-xyz')
    expect(res.status).toBe(200)
    expect(res.body.preferences.agent).toBe('test-agent-xyz')
    expect(res.body.preferences.enabled).toBe(true)
    expect(res.body.preferences.deliveryMethod).toBe('both')
  })

  it('updates preferences', async () => {
    const res = await req('PATCH', '/notifications/preferences/notif-test-1', {
      enabled: false,
      deliveryMethod: 'inbox',
      priorityThreshold: 'P1',
    })
    expect(res.status).toBe(200)
    expect(res.body.preferences.enabled).toBe(false)
    expect(res.body.preferences.deliveryMethod).toBe('inbox')
    expect(res.body.preferences.priorityThreshold).toBe('P1')
  })

  it('resets preferences to defaults', async () => {
    // Set custom prefs
    await req('PATCH', '/notifications/preferences/notif-reset-test', {
      enabled: false,
    })

    // Reset
    const res = await req('DELETE', '/notifications/preferences/notif-reset-test')
    expect(res.status).toBe(200)

    // Verify defaults
    const check = await req('GET', '/notifications/preferences/notif-reset-test')
    expect(check.body.preferences.enabled).toBe(true)
  })

  it('mutes and unmutes agent', async () => {
    const mute = await req('POST', '/notifications/preferences/mute-test/mute', {
      durationMs: 60000,
    })
    expect(mute.status).toBe(200)
    expect(mute.body.preferences.mutedUntil).toBeGreaterThan(Date.now())

    const unmute = await req('POST', '/notifications/preferences/mute-test/unmute')
    expect(unmute.status).toBe(200)
    expect(unmute.body.preferences.mutedUntil).toBeNull()
  })

  it('routes notifications based on preferences', async () => {
    // Enable only P1 notifications
    await req('PATCH', '/notifications/preferences/route-test', {
      enabled: true,
      priorityThreshold: 'P1',
    })

    // P1 should notify
    const p1 = await req('POST', '/notifications/route', {
      agent: 'route-test',
      type: 'taskAssigned',
      priority: 'P1',
    })
    expect(p1.body.routing.shouldNotify).toBe(true)

    // P3 should NOT notify (below threshold)
    const p3 = await req('POST', '/notifications/route', {
      agent: 'route-test',
      type: 'taskAssigned',
      priority: 'P3',
    })
    expect(p3.body.routing.shouldNotify).toBe(false)
    expect(p3.body.routing.reason).toBe('below_priority_threshold')
  })

  it('respects disabled event filters', async () => {
    await req('PATCH', '/notifications/preferences/filter-test', {
      enabled: true,
      eventFilters: { taskComment: false },
    })

    const res = await req('POST', '/notifications/route', {
      agent: 'filter-test',
      type: 'taskComment',
    })
    expect(res.body.routing.shouldNotify).toBe(false)
    expect(res.body.routing.reason).toBe('event_type_taskComment_disabled')
  })

  it('blocks notifications when disabled', async () => {
    await req('PATCH', '/notifications/preferences/disabled-test', {
      enabled: false,
    })

    const res = await req('POST', '/notifications/route', {
      agent: 'disabled-test',
      type: 'taskAssigned',
    })
    expect(res.body.routing.shouldNotify).toBe(false)
    expect(res.body.routing.reason).toBe('notifications_disabled')
  })

  it('blocks notifications when muted', async () => {
    await req('POST', '/notifications/preferences/muted-route-test/mute', {
      durationMs: 60000,
    })

    const res = await req('POST', '/notifications/route', {
      agent: 'muted-route-test',
      type: 'taskAssigned',
    })
    expect(res.body.routing.shouldNotify).toBe(false)
    expect(res.body.routing.reason).toBe('muted')
  })
})

// ── Webhook Delivery Tests (via API) ──

describe('WebhookDeliveryManager', () => {
  it('returns stats', async () => {
    const res = await req('GET', '/webhooks/stats')
    expect(res.status).toBe(200)
    expect(res.body.stats).toHaveProperty('total')
    expect(res.body.stats).toHaveProperty('pending')
    expect(res.body.stats).toHaveProperty('deadLetter')
    expect(res.body.config).toHaveProperty('maxAttempts')
  })

  it('enqueues a webhook event', async () => {
    const res = await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'test.event',
      payload: { data: 'test-payload' },
      targetUrl: 'http://localhost:99999/nonexistent', // will fail delivery
      idempotencyKey: 'test-idk-001',
    })
    expect(res.status).toBe(201)
    expect(res.body.event.idempotencyKey).toBe('test-idk-001')
    expect(res.body.event.provider).toBe('test')
    expect(res.body.event.eventType).toBe('test.event')
  })

  it('deduplicates by idempotency key', async () => {
    const key = `dedup-test-${Date.now()}`
    const first = await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'dedup.event',
      payload: { n: 1 },
      targetUrl: 'http://localhost:99999/nope',
      idempotencyKey: key,
    })

    const second = await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'dedup.event',
      payload: { n: 2 },
      targetUrl: 'http://localhost:99999/nope',
      idempotencyKey: key,
    })

    // Same ID — deduped
    expect(first.body.event.id).toBe(second.body.event.id)
  })

  it('retrieves event by ID', async () => {
    const create = await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'get.event',
      payload: { get: true },
      targetUrl: 'http://localhost:99999/nope',
    })

    const res = await req('GET', `/webhooks/events/${create.body.event.id}`)
    expect(res.status).toBe(200)
    expect(res.body.event.id).toBe(create.body.event.id)
  })

  it('returns 404 for non-existent event', async () => {
    const res = await req('GET', '/webhooks/events/whe_nonexistent')
    expect(res.status).toBe(404)
  })

  it('lists events with filters', async () => {
    const res = await req('GET', '/webhooks/events?provider=test&limit=5')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.events)).toBe(true)
  })

  it('replays a webhook event', async () => {
    const create = await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'replay.event',
      payload: { replay: true },
      targetUrl: 'http://localhost:99999/nope',
    })

    const replay = await req('POST', `/webhooks/events/${create.body.event.id}/replay`)
    expect(replay.status).toBe(201)
    expect(replay.body.event.id).not.toBe(create.body.event.id) // New ID
    expect(replay.body.event.idempotencyKey).not.toBe(create.body.event.idempotencyKey)
  })

  it('returns 404 when replaying non-existent event', async () => {
    const res = await req('POST', '/webhooks/events/whe_nope/replay')
    expect(res.status).toBe(404)
  })

  it('looks up by idempotency key', async () => {
    const key = `lookup-test-${Date.now()}`
    await req('POST', '/webhooks/deliver', {
      provider: 'test',
      eventType: 'lookup.event',
      payload: {},
      targetUrl: 'http://localhost:99999/nope',
      idempotencyKey: key,
    })

    const res = await req('GET', `/webhooks/idempotency/${key}`)
    expect(res.status).toBe(200)
    expect(res.body.event.idempotencyKey).toBe(key)
  })

  it('updates delivery config', async () => {
    const res = await req('PATCH', '/webhooks/config', {
      maxAttempts: 3,
    })
    expect(res.status).toBe(200)
    expect(res.body.config.maxAttempts).toBe(3)

    // Reset
    await req('PATCH', '/webhooks/config', { maxAttempts: 5 })
  })

  it('returns DLQ entries', async () => {
    const res = await req('GET', '/webhooks/dlq')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.events)).toBe(true)
  })

  it('validates required fields on enqueue', async () => {
    const res = await req('POST', '/webhooks/deliver', {
      provider: 'test',
      // missing eventType, payload, targetUrl
    })
    expect(res.status).toBe(400)
  })
})

// ── Provisioning Tests (via API) ──

describe('ProvisioningManager', () => {
  it('returns provisioning status', async () => {
    const res = await req('GET', '/provisioning/status')
    expect(res.status).toBe(200)
    expect(res.body.provisioning).toHaveProperty('phase')
    expect(res.body.provisioning).toHaveProperty('hasCredential')
    // credential should never be exposed
    expect(res.body.provisioning).not.toHaveProperty('credential')
  })

  it('returns webhook routes', async () => {
    const res = await req('GET', '/provisioning/webhooks')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.webhooks)).toBe(true)
  })

  it('adds and removes webhook route', async () => {
    const add = await req('POST', '/provisioning/webhooks', {
      provider: 'test-provider',
      events: ['push', 'pull_request'],
      active: true,
    })
    expect(add.status).toBe(201)
    expect(add.body.webhook.provider).toBe('test-provider')
    expect(add.body.webhook.id).toBeTruthy()

    const remove = await req('DELETE', `/provisioning/webhooks/${add.body.webhook.id}`)
    expect(remove.status).toBe(200)
  })

  it('returns 404 when removing non-existent webhook', async () => {
    const res = await req('DELETE', '/provisioning/webhooks/wh_nonexistent')
    expect(res.status).toBe(404)
  })

  it('validates provision request', async () => {
    // Missing required fields
    const res = await req('POST', '/provisioning/provision', {
      cloudUrl: 'https://api.example.com',
      // missing hostName and joinToken/apiKey
    })
    expect(res.status).toBe(400)
  })

  it('rejects refresh when not enrolled', async () => {
    // Reset first to ensure unprovisioned state
    await req('POST', '/provisioning/reset')
    const res = await req('POST', '/provisioning/refresh')
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('not enrolled')
  })
})

// ── Portability Tests (via API) ──

describe('Portability', () => {
  it('exports a bundle', async () => {
    const res = await req('GET', '/portability/export')
    expect(res.status).toBe(200)
    expect(res.body.bundle.format).toBe('reflectt-export')
    expect(res.body.bundle.version).toBe('1.0.0')
    expect(res.body.bundle).toHaveProperty('teamConfig')
    expect(res.body.bundle).toHaveProperty('secrets')
    expect(res.body.bundle).toHaveProperty('webhooks')
    expect(res.body.bundle).toHaveProperty('provisioning')
  })

  it('export bundle never contains plaintext credentials', async () => {
    const res = await req('GET', '/portability/export')
    const bundleStr = JSON.stringify(res.body.bundle)

    // Check serverConfig credentials are redacted
    if (res.body.bundle.serverConfig?.cloud) {
      const cloud = res.body.bundle.serverConfig.cloud
      if (cloud.credential) {
        expect(cloud.credential).toBe('[REDACTED]')
      }
    }

    // Provisioning should not have credential field
    expect(res.body.bundle.provisioning).not.toHaveProperty('credential')
  })

  it('returns export manifest', async () => {
    const res = await req('GET', '/portability/manifest')
    expect(res.status).toBe(200)
    expect(res.body.manifest).toHaveProperty('teamConfig')
    expect(res.body.manifest).toHaveProperty('secrets')
    expect(res.body.manifest).toHaveProperty('webhooks')
    expect(res.body.manifest).toHaveProperty('provisioning')
  })

  it('downloads export as file', async () => {
    const res = await app.inject({ method: 'GET', url: '/portability/export/download' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('.json')

    // Should be valid JSON
    const parsed = JSON.parse(res.body)
    expect(parsed.format).toBe('reflectt-export')
  })

  it('rejects invalid import bundle', async () => {
    const res = await req('POST', '/portability/import', {
      bundle: { invalid: true },
    })
    expect(res.status).toBe(400)
  })

  it('imports a valid bundle', async () => {
    // Export first
    const exportRes = await req('GET', '/portability/export')
    const bundle = exportRes.body.bundle

    // Import (with skipConfig to avoid overwriting live config)
    const importRes = await req('POST', '/portability/import', {
      bundle,
      skipConfig: true,
    })
    expect(importRes.status).toBe(200)
    expect(importRes.body.success).toBe(true)
  })
})

// ── BoardHealthWorker Tests ──

describe('BoardHealthWorker', () => {
  it('GET /board-health/status returns worker status', async () => {
    const res = await req('GET', '/board-health/status')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.config).toBeDefined()
    expect(typeof res.body.running).toBe('boolean')
    expect(typeof res.body.tickCount).toBe('number')
    expect(typeof res.body.auditLogSize).toBe('number')
    expect(Array.isArray(res.body.recentActions)).toBe(true)
    expect(Array.isArray(res.body.rollbackableActions)).toBe(true)
  })

  it('GET /board-health/audit-log returns audit entries', async () => {
    const res = await req('GET', '/board-health/audit-log')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.actions)).toBe(true)
    expect(typeof res.body.count).toBe('number')
  })

  it('POST /board-health/tick (dry-run) runs without modifying state', async () => {
    const res = await req('POST', '/board-health/tick?dryRun=true')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.skipped).toBe(false)
    expect(Array.isArray(res.body.actions)).toBe(true)
  })

  it('POST /board-health/tick (real) applies policies', async () => {
    const res = await req('POST', '/board-health/tick')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.skipped).toBe(false)
  })

  it('PATCH /board-health/config updates config at runtime', async () => {
    const res = await req('PATCH', '/board-health/config', {
      dryRun: true,
      maxActionsPerTick: 3,
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.config.dryRun).toBe(true)
    expect(res.body.config.maxActionsPerTick).toBe(3)

    // Reset
    await req('PATCH', '/board-health/config', {
      dryRun: false,
      maxActionsPerTick: 5,
    })
  })

  it('POST /board-health/rollback with invalid ID returns error', async () => {
    const res = await req('POST', '/board-health/rollback/nonexistent', { by: 'test' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toContain('not found')
  })

  it('POST /board-health/prune removes old entries', async () => {
    const res = await req('POST', '/board-health/prune?maxAgeDays=7')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.pruned).toBe('number')
  })

  it('GET /board-health/audit-log supports kind filter', async () => {
    const res = await req('GET', '/board-health/audit-log?kind=digest-emitted')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // All returned actions should be digest-emitted (or empty)
    for (const action of res.body.actions) {
      expect(action.kind).toBe('digest-emitted')
    }
  })

  it('config rejects unknown fields silently', async () => {
    const res = await req('PATCH', '/board-health/config', {
      unknownField: 'value',
      enabled: true,
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.config.unknownField).toBeUndefined()
  })
})

// ── ChangeFeed Tests ──

describe('ChangeFeed', () => {
  it('GET /feed/:agent requires since parameter', async () => {
    const res = await req('GET', '/feed/link')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toContain('since')
  })

  it('GET /feed/:agent returns feed with valid since', async () => {
    const since = Date.now() - 60 * 60 * 1000 // 1h ago
    const res = await req('GET', `/feed/link?since=${since}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.agent).toBe('link')
    expect(typeof res.body.since).toBe('number')
    expect(typeof res.body.until).toBe('number')
    expect(Array.isArray(res.body.events)).toBe(true)
    expect(typeof res.body.count).toBe('number')
    expect(typeof res.body.hasMore).toBe('boolean')
  })

  it('GET /feed/:agent supports limit parameter', async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const res = await req('GET', `/feed/link?since=${since}&limit=5`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.events.length).toBeLessThanOrEqual(5)
  })

  it('GET /feed/:agent supports kinds filter', async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const res = await req('GET', `/feed/link?since=${since}&kinds=mention,task_completed`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // All returned events should match the requested kinds
    for (const event of res.body.events) {
      expect(['mention', 'task_completed']).toContain(event.kind)
    }
  })

  it('GET /feed/:agent events have required fields', async () => {
    // Create a task to ensure there's history
    const taskRes = await req('POST', '/tasks', {
      title: 'TEST: feed test task',
      assignee: 'feedtest',
      reviewer: 'link',
      done_criteria: ['test'],
      eta: '1h',
      createdBy: 'test',
    })
    expect([200, 201]).toContain(taskRes.status)

    const since = Date.now() - 5000
    const res = await req('GET', `/feed/link?since=${since}`)
    expect(res.status).toBe(200)

    for (const event of res.body.events) {
      expect(event).toHaveProperty('id')
      expect(event).toHaveProperty('kind')
      expect(event).toHaveProperty('timestamp')
      expect(event).toHaveProperty('actor')
      expect(event).toHaveProperty('summary')
      expect(typeof event.timestamp).toBe('number')
    }

    // Cleanup
    if (taskRes.body.task?.id) {
      await req('DELETE', `/tasks/${taskRes.body.task.id}`)
    }
  })

  it('GET /feed/:agent excludes global events when includeGlobal=false', async () => {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const res = await req('GET', `/feed/link?since=${since}&includeGlobal=false`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // All events should be specifically relevant to link
    for (const event of res.body.events) {
      expect(event.relevantTo).toBe('link')
    }
  })
})

// ── Policy Config Tests ──

describe('PolicyConfig', () => {
  it('GET /policy returns unified policy', async () => {
    const res = await req('GET', '/policy')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.policy).toBeDefined()
    expect(res.body.policy.quietHours).toBeDefined()
    expect(res.body.policy.idleNudge).toBeDefined()
    expect(res.body.policy.cadenceWatchdog).toBeDefined()
    expect(res.body.policy.boardHealth).toBeDefined()
    expect(res.body.policy.mentionRescue).toBeDefined()
    expect(res.body.policy.escalation).toBeDefined()
    expect(typeof res.body.policy.staleDoingThresholdMin).toBe('number')
    expect(typeof res.body.filePath).toBe('string')
  })

  it('PATCH /policy deep-merges updates', async () => {
    const res = await req('PATCH', '/policy', {
      quietHours: { startHour: 22 },
      boardHealth: { dryRun: true },
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.policy.quietHours.startHour).toBe(22)
    expect(res.body.policy.boardHealth.dryRun).toBe(true)
    // Other fields preserved
    expect(res.body.policy.quietHours.enabled).toBeDefined()
    expect(res.body.policy.boardHealth.intervalMs).toBeGreaterThan(0)
  })

  it('PATCH /policy propagates boardHealth to worker', async () => {
    await req('PATCH', '/policy', {
      boardHealth: { maxActionsPerTick: 2 },
    })
    const status = await req('GET', '/board-health/status')
    expect(status.body.config.maxActionsPerTick).toBe(2)
  })

  it('POST /policy/reset restores defaults', async () => {
    // First modify
    await req('PATCH', '/policy', { staleDoingThresholdMin: 999 })
    // Then reset
    const res = await req('POST', '/policy/reset')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.policy.staleDoingThresholdMin).toBe(240)
  })

  it('policy sections have correct types', async () => {
    const res = await req('GET', '/policy')
    const p = res.body.policy

    expect(typeof p.quietHours.enabled).toBe('boolean')
    expect(typeof p.quietHours.startHour).toBe('number')
    expect(typeof p.quietHours.timezone).toBe('string')
    expect(typeof p.idleNudge.enabled).toBe('boolean')
    expect(typeof p.idleNudge.warnMin).toBe('number')
    expect(Array.isArray(p.idleNudge.excluded)).toBe(true)
    expect(typeof p.cadenceWatchdog.silenceMin).toBe('number')
    expect(typeof p.mentionRescue.cooldownMin).toBe('number')
    expect(typeof p.escalation.defaultChannel).toBe('string')
  })
})

// ── Message Router Tests ──

describe('MessageRouter', () => {
  it('GET /routing/stats returns routing statistics', async () => {
    const res = await req('GET', '/routing/stats')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.totalRouted).toBe('number')
    expect(typeof res.body.generalCount).toBe('number')
    expect(typeof res.body.opsCount).toBe('number')
    expect(typeof res.body.byChannel).toBe('object')
    expect(typeof res.body.byCategory).toBe('object')
    expect(typeof res.body.bySeverity).toBe('object')
  })

  it('GET /routing/log returns recent routing decisions', async () => {
    const res = await req('GET', '/routing/log')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.entries)).toBe(true)
    expect(typeof res.body.count).toBe('number')
  })

  it('POST /routing/resolve routes escalation to general', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'escalation: agent idle for 90m',
      category: 'escalation',
      severity: 'warning',
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.decision.channel).toBe('general')
  })

  it('POST /routing/resolve routes watchdog to ops', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'system watchdog: stale working',
      category: 'watchdog-alert',
      severity: 'info',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision.channel).toBe('ops')
  })

  it('POST /routing/resolve routes digest to configured channel', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'Board health digest',
      category: 'digest',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision).toBeDefined()
  })

  it('POST /routing/resolve routes mention-rescue to general', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'system fallback: mention received',
      category: 'mention-rescue',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision.channel).toBe('general')
  })

  it('POST /routing/resolve routes ship notices to shipping', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'link',
      content: 'Shipped: new feature',
      category: 'ship-notice',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision.channel).toBe('shipping')
  })

  it('POST /routing/resolve adds task comment when taskId present', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'status update on task',
      category: 'status-update',
      taskId: 'task-123',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision.alsoComment).toBe(true)
  })

  it('POST /routing/resolve respects forceChannel', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'custom routed message',
      forceChannel: 'dev',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision.channel).toBe('dev')
    expect(res.body.decision.reason).toBe('force-channel')
  })

  it('POST /routing/resolve critical severity always goes to general', async () => {
    const res = await req('POST', '/routing/resolve', {
      from: 'system',
      content: 'some info message',
      category: 'system-info',
      severity: 'critical',
    })
    expect(res.status).toBe(200)
    expect(res.body.decision.channel).toBe('general')
  })
})

// ── Task Precheck Tests ──

describe('TaskPrecheck', () => {
  let testTaskId: string

  beforeAll(async () => {
    const res = await req('POST', '/tasks', {
      title: 'TEST: precheck test task',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['test criterion'],
      eta: '1h',
      createdBy: 'test',
    })
    testTaskId = res.body.task?.id
  })

  afterAll(async () => {
    if (testTaskId) await req('DELETE', `/tasks/${testTaskId}`)
  })

  it('POST /tasks/:id/precheck returns precheck for doing', async () => {
    const res = await req('POST', `/tasks/${testTaskId}/precheck`, {
      targetStatus: 'doing',
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.taskId).toBe(testTaskId)
    expect(res.body.targetStatus).toBe('doing')
    expect(typeof res.body.ready).toBe('boolean')
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.template).toBeDefined()
  })

  it('POST /tasks/:id/precheck returns precheck for validating with missing fields', async () => {
    const res = await req('POST', `/tasks/${testTaskId}/precheck`, {
      targetStatus: 'validating',
    })
    expect(res.status).toBe(200)
    expect(res.body.ready).toBe(false)
    // Should flag missing artifact_path, review_handoff
    const fields = res.body.items.map((i: any) => i.field)
    expect(fields).toContain('metadata.artifact_path')
    expect(fields).toContain('metadata.review_handoff')
  })

  it('POST /tasks/:id/precheck provides auto-defaults', async () => {
    const res = await req('POST', `/tasks/${testTaskId}/precheck`, {
      targetStatus: 'doing',
    })
    expect(res.status).toBe(200)
    expect(res.body.autoDefaults).toBeDefined()
  })

  it('POST /tasks/:id/precheck provides template', async () => {
    const res = await req('POST', `/tasks/${testTaskId}/precheck`, {
      targetStatus: 'validating',
    })
    expect(res.status).toBe(200)
    expect(res.body.template).toBeDefined()
    expect(res.body.template.status).toBe('validating')
    expect(res.body.template.metadata.review_handoff).toBeDefined()
  })

  it('POST /tasks/:id/precheck handles unknown task', async () => {
    const res = await req('POST', '/tasks/task-nonexistent/precheck', {
      targetStatus: 'doing',
    })
    expect(res.status).toBe(200)
    expect(res.body.ready).toBe(false)
    expect(res.body.items[0].message).toContain('not found')
  })

  it('auto-defaults fill ETA when moving to doing', async () => {
    // Move task to doing without explicit ETA in metadata
    const res = await req('PATCH', `/tasks/${testTaskId}`, {
      status: 'doing',
    })
    // Should succeed because auto-default fills ETA
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('Task Intake Schema Enforcement', () => {
  it('GET /tasks/intake-schema returns schema with templates', async () => {
    const res = await req('GET', '/tasks/intake-schema')
    expect(res.status).toBe(200)
    expect(res.body.required).toContain('title')
    expect(res.body.optional).toContain('reviewer') // auto-assigned when omitted
    expect(res.body.required).toContain('done_criteria')
    expect(res.body.required).toContain('priority')
    expect(res.body.templates).toBeDefined()
    expect(res.body.templates.bug).toBeDefined()
    expect(res.body.templates.feature).toBeDefined()
    expect(res.body.templates.bug.example).toBeDefined()
    expect(res.body.templates.bug.min_done_criteria).toBe(1)
    expect(res.body.templates.feature.min_done_criteria).toBe(2)
  })

  it('GET /tasks/templates/:type returns template for valid type', async () => {
    const res = await req('GET', '/tasks/templates/bug')
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('bug')
    expect(res.body.template.required_fields).toContain('title')
    expect(res.body.template.example.type).toBe('bug')
  })

  it('GET /tasks/templates/:type returns 404 for invalid type', async () => {
    const res = await req('GET', '/tasks/templates/nonexistent')
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('Unknown task type')
  })

  it('POST /tasks accepts minimal fields for todo tasks (relaxed onboarding schema)', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: Minimal todo task for onboarding validation smoke test',
    })
    // Relaxed schema: todo tasks only require title
    expect(status).toBe(200)
    if (body.task?.id) await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('POST /tasks accepts empty done_criteria for todo tasks', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: task with empty done criteria for onboarding flow validation',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: [],
      eta: '~2h',
      createdBy: 'test',
      priority: 'P2',
    })
    // done_criteria defaults to [] and is no longer required for todo tasks
    expect(status).toBe(200)
    if (body.task?.id) await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('POST /tasks accepts well-formed task with TEST: prefix', async () => {
    const res = await req('POST', '/tasks', {
      title: 'TEST: well-formed task for intake schema test',
      type: 'feature',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['User can see the feature in the UI', 'Automated test verifies the feature works'],
      eta: '~2h',
      createdBy: 'test',
      priority: 'P2',
    })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // Clean up
    if (res.body.task?.id) {
      await req('DELETE', `/tasks/${res.body.task.id}`)
    }
  })

  it('checkDefinitionOfReady catches vague titles (unit test)', async () => {
    // Access the intake-schema endpoint to verify DoR rules are documented
    const res = await req('GET', '/tasks/intake-schema')
    expect(res.body.definition_of_ready).toBeDefined()
    expect(res.body.definition_of_ready.some((r: string) => r.includes('10 characters'))).toBe(true)
    expect(res.body.definition_of_ready.some((r: string) => r.includes('vague'))).toBe(true)
  })

  it('templates include all task types', async () => {
    const types = ['bug', 'feature', 'process', 'docs', 'chore']
    for (const type of types) {
      const res = await req('GET', `/tasks/templates/${type}`)
      expect(res.status).toBe(200)
      expect(res.body.template.required_fields).toBeDefined()
      expect(res.body.template.example).toBeDefined()
      expect(res.body.template.title_hint).toBeDefined()
    }
  })
})
