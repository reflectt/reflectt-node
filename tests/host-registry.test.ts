import { describe, it, expect, beforeEach } from 'vitest'
import { getDb } from '../src/db.js'
import { upsertHostHeartbeat, getHost, listHosts, removeHost } from '../src/host-registry.js'

function clearHosts() {
  try { getDb().prepare('DELETE FROM hosts').run() } catch { /* table may not exist */ }
}

beforeEach(() => {
  clearHosts()
})

describe('host registry', () => {
  it('registers a new host via heartbeat', () => {
    const host = upsertHostHeartbeat({
      hostId: 'pi-cluster-01',
      hostname: 'raspberrypi',
      os: 'Linux',
      arch: 'arm64',
      version: '0.8.0',
      agents: ['link', 'sage'],
    })
    expect(host.id).toBe('pi-cluster-01')
    expect(host.hostname).toBe('raspberrypi')
    expect(host.os).toBe('Linux')
    expect(host.arch).toBe('arm64')
    expect(host.version).toBe('0.8.0')
    expect(host.agents).toEqual(['link', 'sage'])
    expect(host.status).toBe('online')
    expect(host.registered_at).toBeGreaterThan(0)
    expect(host.last_seen_at).toBeGreaterThan(0)
  })

  it('updates existing host on subsequent heartbeat', () => {
    upsertHostHeartbeat({ hostId: 'mac-01', hostname: 'MacBook', os: 'Darwin' })
    const updated = upsertHostHeartbeat({ hostId: 'mac-01', version: '0.9.0', agents: ['kai'] })
    expect(updated.hostname).toBe('MacBook') // preserved from first heartbeat
    expect(updated.version).toBe('0.9.0')    // updated
    expect(updated.agents).toEqual(['kai'])   // updated
    expect(updated.status).toBe('online')
  })

  it('lists all hosts', () => {
    upsertHostHeartbeat({ hostId: 'host-a', hostname: 'alpha' })
    upsertHostHeartbeat({ hostId: 'host-b', hostname: 'beta' })
    const hosts = listHosts()
    expect(hosts).toHaveLength(2)
    expect(hosts.map(h => h.id).sort()).toEqual(['host-a', 'host-b'])
  })

  it('gets a single host by ID', () => {
    upsertHostHeartbeat({ hostId: 'solo', hostname: 'solo-machine' })
    const host = getHost('solo')
    expect(host).not.toBeNull()
    expect(host!.hostname).toBe('solo-machine')
  })

  it('returns null for unknown host', () => {
    expect(getHost('nonexistent')).toBeNull()
  })

  it('removes a host', () => {
    upsertHostHeartbeat({ hostId: 'temp', hostname: 'temporary' })
    expect(removeHost('temp')).toBe(true)
    expect(getHost('temp')).toBeNull()
    expect(removeHost('temp')).toBe(false) // already gone
  })

  it('computes stale/offline status based on last_seen_at', () => {
    const db = getDb()
    const now = Date.now()

    // Insert a host that last reported 10 minutes ago (should be stale)
    db.prepare(`
      INSERT INTO hosts (id, hostname, status, last_seen_at, registered_at, agents, metadata)
      VALUES (?, ?, 'online', ?, ?, '[]', '{}')
    `).run('stale-host', 'stale-machine', now - 10 * 60 * 1000, now - 60 * 60 * 1000)

    // Insert a host that last reported 20 minutes ago (should be offline)
    db.prepare(`
      INSERT INTO hosts (id, hostname, status, last_seen_at, registered_at, agents, metadata)
      VALUES (?, ?, 'online', ?, ?, '[]', '{}')
    `).run('offline-host', 'offline-machine', now - 20 * 60 * 1000, now - 60 * 60 * 1000)

    const hosts = listHosts()
    const stale = hosts.find(h => h.id === 'stale-host')
    const offline = hosts.find(h => h.id === 'offline-host')

    expect(stale?.status).toBe('stale')
    expect(offline?.status).toBe('offline')
  })

  it('filters hosts by status', () => {
    upsertHostHeartbeat({ hostId: 'online-host', hostname: 'active' })
    const db = getDb()
    db.prepare(`
      INSERT INTO hosts (id, hostname, status, last_seen_at, registered_at, agents, metadata)
      VALUES (?, ?, 'online', ?, ?, '[]', '{}')
    `).run('old-host', 'old', Date.now() - 20 * 60 * 1000, Date.now() - 60 * 60 * 1000)

    const online = listHosts({ status: 'online' })
    expect(online).toHaveLength(1)
    expect(online[0].id).toBe('online-host')
  })
})
