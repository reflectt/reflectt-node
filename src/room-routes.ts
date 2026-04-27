// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Routes — slice 2 of room-model-v0.1.1, extended in slice 5A
 * (Room Share Snapshot v0).
 *
 * Fastify plugin registering room-state read/write endpoints:
 *   - GET /room/participants            (slice 2 — presence cache)
 *   - GET /room/transcript              (Browser-STT v0 — finalized segments)
 *   - GET /room/artifacts               (5A — list, generic, filterable by kind)
 *   - GET /room/artifacts/:id/content   (5A — full-res bytes)
 *   - GET /room/artifacts/:id/thumbnail (5A — server-generated 480px PNG)
 *   - POST /room/artifacts              (5A — multipart write; v0 only accepts kind='snapshot')
 *
 * Auth uses the same heartbeat-token model as `/hosts/heartbeat`: if
 * REFLECTT_HOST_HEARTBEAT_TOKEN is set, requests must present it via
 * `Authorization: Bearer`, `x-heartbeat-token` header, or `?token=` query.
 * If unset, the route is open (matches existing host-cred behavior).
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eventBus } from './events.js'
import { listRoomParticipants, getRoomPresenceStatus } from './room-presence-store.js'
import { getRecentTranscript, getRoomTranscriptStatus } from './room-transcript-store.js'
import { getRecentCards, getRoomCardStatus } from './room-card-store.js'
import {
  storeArtifact,
  getArtifact,
  deleteArtifact,
  listArtifacts,
  updateArtifactMetadata,
  pruneSnapshotsForRetention,
  ROOM_ARTIFACT_AGENT_ID,
  type Artifact,
} from './artifact-store.js'
import { generateSnapshotThumbnail, thumbnailPathFor } from './snapshot-thumbnail.js'
import { broadcastArtifactShared } from './room-artifact-broadcast.js'

const SNAPSHOT_RETENTION_MAX = 20
const ALLOWED_KINDS_V0 = new Set(['snapshot'])

function verifyAuth(request: FastifyRequest): { ok: boolean; error?: string } {
  const expectedToken = process.env.REFLECTT_HOST_HEARTBEAT_TOKEN
  if (!expectedToken) return { ok: true }

  const headers = request.headers as Record<string, string | string[] | undefined>
  const authHeader = (headers.authorization || headers.Authorization) as string | undefined
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const provided = authHeader.slice('Bearer '.length).trim()
    if (provided === expectedToken) return { ok: true }
  }
  const headerToken = headers['x-heartbeat-token']
  if (typeof headerToken === 'string' && headerToken === expectedToken) return { ok: true }

  const query = request.query as Record<string, unknown>
  if (typeof query?.token === 'string' && query.token === expectedToken) return { ok: true }

  return { ok: false, error: 'Unauthorized: REFLECTT_HOST_HEARTBEAT_TOKEN required' }
}

function resolveHostId(): string {
  return process.env.REFLECTT_HOST_ID || process.env.HOSTNAME || 'unknown'
}

/**
 * Project an artifact for the wire — strips on-disk paths, adds the
 * relative URL the cloud will resolve. `thumbnailUrl` is present even
 * for kinds without a thumbnail (returns 404 in that case); v0 only
 * accepts `kind='snapshot'` so all v0 artifacts have one.
 */
function projectArtifact(art: Artifact): Record<string, unknown> {
  const meta = art.metadata ?? {}
  return {
    id: art.id,
    kind: (meta.kind as string | undefined) ?? null,
    name: art.name,
    mimeType: art.mimeType,
    sizeBytes: art.sizeBytes,
    createdAt: art.createdAt,
    sharedBy: (meta.sharedBy as string | undefined) ?? null,
    sharedByDisplayName: (meta.sharedByDisplayName as string | undefined) ?? null,
    dimensions: (meta.dimensions as { width: number; height: number } | undefined) ?? null,
    url: `/room/artifacts/${art.id}/content`,
    thumbnailUrl: `/room/artifacts/${art.id}/thumbnail`,
  }
}

export async function roomRoutes(app: FastifyInstance) {
  app.get('/room/participants', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const participants = listRoomParticipants()
    const status = getRoomPresenceStatus()
    return {
      participants,
      count: participants.length,
      hostId: status.hostId,
      initialized: status.initialized,
    }
  })

  // ── Browser-STT v0: GET /room/transcript ────────────────────────────
  // Recent finalized transcript segments from the room's Realtime
  // broadcast. `?since=<unix-ms>` returns only segments with
  // `receivedAt >= since` (use this for incremental polling). Unset =
  // full ring (last ~60s). Agents prefer the `room_recent_transcript`
  // MCP tool; this HTTP endpoint exists for parity and debugging.
  app.get('/room/transcript', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const query = request.query as Record<string, unknown>
    const sinceRaw = query?.since
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : (typeof sinceRaw === 'number' ? sinceRaw : undefined)
    const segments = getRecentTranscript(Number.isFinite(since) ? (since as number) : undefined)
    const status = getRoomTranscriptStatus()
    return {
      segments,
      count: segments.length,
      hostId: status.hostId,
      initialized: status.initialized,
      windowMs: status.windowMs,
    }
  })

  // ── Reply-card backfill v0 ──────────────────────────────────────────
  // Recent reply cards from the room's Realtime broadcast. `?since=<ms>`
  // returns only entries with `receivedAt >= since` (incremental polling).
  // `?limit=<n>` caps from the END (newest entries), default unbounded
  // within the rolling window. Wire shape mirrors the broadcast envelope
  // so the client can apply the same drop-self / dedupe logic on backfill
  // that it does on live receive.
  app.get('/room/cards', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const query = request.query as Record<string, unknown>
    const sinceRaw = query?.since
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : (typeof sinceRaw === 'number' ? sinceRaw : undefined)
    const limitRaw = query?.limit
    const limitParsed = typeof limitRaw === 'string' ? Number(limitRaw) : (typeof limitRaw === 'number' ? limitRaw : undefined)
    const limit = Number.isFinite(limitParsed) && (limitParsed as number) > 0
      ? Math.min(50, Math.floor(limitParsed as number))
      : undefined
    const entries = getRecentCards({
      sinceMs: Number.isFinite(since) ? (since as number) : undefined,
      limit,
    })
    const status = getRoomCardStatus()
    return {
      entries,
      count: entries.length,
      hostId: status.hostId,
      initialized: status.initialized,
      windowMs: status.windowMs,
      maxEntries: status.maxEntries,
    }
  })

  // ── Room Share Snapshot v0 (slice 5A) ───────────────────────────────
  // Artifact-generic substrate per ROOM_MODEL_V0; snapshot is the first
  // artifact kind via `metadata.kind='snapshot'` discriminator. UI copy
  // stays snapshot-specific; substrate stays kind-generic so future
  // recordings / agent outputs ride the same routes without renaming.

  /**
   * GET /room/artifacts?kind=snapshot&since=<unix-ms>&limit=<n>
   * List artifacts shared in this room. Optional `kind` narrows to one
   * discriminator; omit for all kinds. `since` is an inclusive cursor
   * on createdAt for incremental polling. Default limit 50.
   */
  app.get('/room/artifacts', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const query = request.query as Record<string, unknown>
    const kindRaw = query?.kind
    const kind = typeof kindRaw === 'string' && kindRaw.length > 0 ? kindRaw : undefined
    const sinceRaw = query?.since
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : (typeof sinceRaw === 'number' ? sinceRaw : undefined)
    const limitRaw = query?.limit
    const limitParsed = typeof limitRaw === 'string' ? Number(limitRaw) : (typeof limitRaw === 'number' ? limitRaw : undefined)
    const limit = Number.isFinite(limitParsed) && (limitParsed as number) > 0
      ? Math.min(200, Math.floor(limitParsed as number))
      : 50

    const artifacts = listArtifacts({
      agentId: ROOM_ARTIFACT_AGENT_ID,
      kind,
      sinceMs: Number.isFinite(since) ? (since as number) : undefined,
      limit,
    })
    return {
      artifacts: artifacts.map(projectArtifact),
      count: artifacts.length,
      hostId: resolveHostId(),
    }
  })

  /**
   * GET /room/artifacts/:id/content
   * Full-resolution bytes. Mime-type from the stored row. 404 if the
   * artifact id is unknown or the file was evicted by retention sweep
   * between listing and read.
   */
  app.get<{ Params: { id: string } }>('/room/artifacts/:id/content', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const art = getArtifact(request.params.id)
    if (!art || art.agentId !== ROOM_ARTIFACT_AGENT_ID || !existsSync(art.storagePath)) {
      reply.status(404)
      return { error: 'artifact not found' }
    }
    const buf = readFileSync(art.storagePath)
    reply.header('Content-Type', art.mimeType)
    reply.header('Content-Length', String(buf.length))
    return reply.send(buf)
  })

  /**
   * GET /room/artifacts/:id/thumbnail
   * Server-generated 480px PNG. 404 if the artifact has no thumbnail
   * (kind without one) or the file was evicted.
   */
  app.get<{ Params: { id: string } }>('/room/artifacts/:id/thumbnail', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const art = getArtifact(request.params.id)
    if (!art || art.agentId !== ROOM_ARTIFACT_AGENT_ID) {
      reply.status(404)
      return { error: 'artifact not found' }
    }
    const thumbPath = (art.metadata?.thumbnailPath as string | undefined) ?? null
    if (!thumbPath || !existsSync(thumbPath)) {
      reply.status(404)
      return { error: 'thumbnail not found' }
    }
    const buf = readFileSync(thumbPath)
    reply.header('Content-Type', 'image/png')
    reply.header('Content-Length', String(buf.length))
    return reply.send(buf)
  })

  /**
   * POST /room/artifacts (multipart)
   * Field 'file' = PNG bytes (required; v0 enforces image/png).
   * Field 'kind' = discriminator (required; v0 only accepts 'snapshot').
   * Field 'sharedBy' = participant id (required).
   * Field 'sharedByDisplayName' = denormalized display name (required).
   *
   * Flow: write original → generate thumbnail (sync, sharp 480px) → update
   * artifact metadata with thumbnailPath + dimensions → emit
   * room_artifact_shared on EventBus → broadcast artifact.shared on the
   * room channel → run snapshot retention sweep (last-20 evict).
   *
   * Failure contract: if thumbnail generation throws, the original PNG +
   * row are rolled back and the route returns 500. Half-stored artifacts
   * (full-res but no thumb) would force the strip to fall back to
   * full-res or render nothing — both worse than failing the upload.
   */
  app.post('/room/artifacts', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const data = await request.file()
    if (!data) {
      reply.status(400)
      return { error: 'file field required (multipart)' }
    }

    const fields = data.fields as Record<string, { value?: unknown } | undefined>
    const kind = typeof fields.kind?.value === 'string' ? (fields.kind.value as string) : undefined
    const sharedBy = typeof fields.sharedBy?.value === 'string' ? (fields.sharedBy.value as string) : undefined
    const sharedByDisplayName = typeof fields.sharedByDisplayName?.value === 'string' ? (fields.sharedByDisplayName.value as string) : undefined

    if (!kind || !ALLOWED_KINDS_V0.has(kind)) {
      reply.status(400)
      return { error: `kind must be one of: ${[...ALLOWED_KINDS_V0].join(', ')}` }
    }
    if (!sharedBy || !sharedByDisplayName) {
      reply.status(400)
      return { error: 'sharedBy + sharedByDisplayName required' }
    }
    // v0 only handles image/png snapshots. Future kinds may relax this.
    if (data.mimetype !== 'image/png') {
      reply.status(400)
      return { error: 'snapshot requires image/png' }
    }

    const buf = await data.toBuffer()
    if (buf.length === 0) {
      reply.status(400)
      return { error: 'empty file' }
    }

    const hostId = resolveHostId()
    const isoNow = new Date().toISOString()
    const fileName = `snapshot-${isoNow.replace(/[:.]/g, '-')}.png`

    const art = storeArtifact({
      agentId: ROOM_ARTIFACT_AGENT_ID,
      name: fileName,
      content: buf,
      mimeType: 'image/png',
      metadata: {
        kind,
        roomId: hostId,
        sharedBy,
        sharedByDisplayName,
      },
    })

    const thumbPath = thumbnailPathFor(art.storagePath)
    let updated = art
    try {
      const thumb = await generateSnapshotThumbnail(art.storagePath, thumbPath)
      const next = updateArtifactMetadata(art.id, {
        thumbnailPath: thumb.thumbnailPath,
        dimensions: thumb.dimensions,
      })
      if (!next) {
        // Concurrent retention evicted us between insert and update — rare
        // but possible. Treat as failure path: clean up the thumbnail we
        // just wrote, return 500.
        try { if (existsSync(thumbPath)) unlinkSync(thumbPath) } catch { /* best effort */ }
        reply.status(500)
        return { error: 'artifact disappeared during write' }
      }
      updated = next
    } catch (err) {
      // Roll back: remove thumbnail (if it landed) + original PNG + DB row.
      try { if (existsSync(thumbPath)) unlinkSync(thumbPath) } catch { /* best effort */ }
      deleteArtifact(art.id)
      reply.status(500)
      return { error: `thumbnail generation failed: ${err instanceof Error ? err.message : String(err)}` }
    }

    const projected = projectArtifact(updated)

    // Push half: emit on EventBus so room-event-bridge can format a chat
    // line for the founding agent. Same pattern as room_participant_joined
    // and room_transcript_segment.
    eventBus.emit({
      id: `room-artifact-${updated.id}`,
      type: 'room_artifact_shared',
      timestamp: Date.now(),
      data: { artifact: projected, by: sharedBy, hostId },
    })

    // Realtime fan-out: cloud subscribers (other participants) refresh
    // their strips on receipt. Best-effort — the chat push + HTTP listing
    // path still work if the broadcast fails.
    void broadcastArtifactShared({
      artifactId: updated.id,
      kind,
      sharedBy,
      sharedByDisplayName,
      createdAt: updated.createdAt,
      url: projected.url as string,
      thumbnailUrl: projected.thumbnailUrl as string,
    })

    // Per-kind retention sweep — last 20 snapshots, evict oldest. Sync,
    // cheap, no scheduler. Future kinds set their own caps from their
    // own specs.
    if (kind === 'snapshot') {
      pruneSnapshotsForRetention(ROOM_ARTIFACT_AGENT_ID, SNAPSHOT_RETENTION_MAX)
    }

    reply.status(201)
    return { artifact: projected, hostId }
  })
}
