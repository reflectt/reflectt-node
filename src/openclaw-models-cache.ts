/**
 * openclaw-models-cache.ts
 *
 * Single-tenant cache for the OpenClaw models capability envelope, populated
 * by the reflectt-channel-openclaw plugin via POST /openclaw/models/publish
 * and read by GET /openclaw/models (cloud-facing).
 *
 * The plugin runs in-process with the OpenClaw gateway on the same managed
 * host as this node, so this is a 1:1 cache — one node holds one host's
 * latest envelope. No keying by hostId.
 *
 * Rules locked in #general at msg-1777007976663:
 *  - last-write-wins, no TTL eviction
 *  - never silent-evict to empty (preserves last-known truth across plugin
 *    restarts so the panel doesn't flap to "capability disappeared")
 *  - bounded envelope only — plugin normalizes raw CLI blobs before POST
 */
import type { ModelsEnvelope, CachedEnvelope } from './openclaw-models-types.js'

let cached: CachedEnvelope | null = null

export function putEnvelope(envelope: ModelsEnvelope): CachedEnvelope {
  const next: CachedEnvelope = {
    envelope,
    receivedAt: Date.now(),
  }
  cached = next
  return next
}

export function getCachedEnvelope(): CachedEnvelope | null {
  return cached
}

export function clearEnvelope(): void {
  cached = null
}

export function isStale(record: CachedEnvelope, now: number = Date.now()): boolean {
  const max = record.envelope.maxAgeMs
  if (typeof max !== 'number' || max <= 0) return false
  return now - record.envelope.publishedAt > max
}
