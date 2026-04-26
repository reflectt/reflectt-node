// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Snapshot Thumbnail — Room Share Snapshot v0 slice 5A
 *
 * Sharp-based 480px-longest-edge PNG thumbnail generator. Called
 * synchronously from `POST /room/artifacts` after the original PNG is
 * stored, before the artifact_shared event is emitted.
 *
 * Why server-side: kai's lock (msg-1777191987071, agreeing with link's
 * later firmer call). Pulling full-res 4K PNGs into the strip on every
 * page load is unbounded bandwidth; one 480px PNG per snapshot is bounded
 * (~50KB on disk). Strip uses thumbnailUrl, click-to-expand uses url.
 *
 * Why sync: the user just pressed "Share to room" and expects the strip
 * tile to appear immediately. A background job would either delay the
 * tile (bad perception loop) or render full-res then swap (visual jank).
 * Sharp on a 4K PNG → 480px = ~50ms; cost is bounded.
 *
 * Why PNG output (not JPEG): snapshots are screen captures with text
 * legibility constraints. JPEG artifacts on small text are unacceptable
 * for a screen-share use case.
 *
 * Failure contract: if generation throws, the caller (POST /room/artifacts)
 * rolls back the original artifact insert. Half-stored state (full-res
 * but no thumb) would force the strip to either show nothing or fall
 * back to full-res — both worse than failing the upload cleanly.
 */

import sharp from 'sharp'

const TARGET_LONGEST_EDGE_PX = 480

export interface ThumbnailResult {
  thumbnailPath: string
  /** Original capture dimensions; useful for client-side aspect-ratio calc without fetching bytes. */
  dimensions: { width: number; height: number }
}

/**
 * Derive the thumbnail path that pairs with an original artifact storage
 * path. Same directory, `-thumb.png` suffix on the basename. Exposed so
 * retention / read paths can locate thumbnails without re-deriving the
 * convention in three places.
 */
export function thumbnailPathFor(originalStoragePath: string): string {
  return originalStoragePath.replace(/\.png$/i, '') + '-thumb.png'
}

/**
 * Generate a 480px-longest-edge PNG thumbnail at `thumbnailPath`. Reads
 * the original from disk; returns the path written + the original's
 * pixel dimensions.
 *
 * Throws on any sharp failure (invalid PNG, no metadata, write error).
 * The caller is responsible for rolling back the corresponding artifact
 * row + original file — see POST /room/artifacts in room-routes.ts.
 */
export async function generateSnapshotThumbnail(
  originalPath: string,
  thumbnailPath: string,
): Promise<ThumbnailResult> {
  const meta = await sharp(originalPath).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!w || !h) throw new Error('snapshot has no dimensions (corrupt or zero-size PNG)')

  const longest = Math.max(w, h)
  const scale = longest > TARGET_LONGEST_EDGE_PX ? TARGET_LONGEST_EDGE_PX / longest : 1
  const targetW = Math.max(1, Math.round(w * scale))
  const targetH = Math.max(1, Math.round(h * scale))

  await sharp(originalPath)
    .resize({ width: targetW, height: targetH, fit: 'inside' })
    .png()
    .toFile(thumbnailPath)

  return { thumbnailPath, dimensions: { width: w, height: h } }
}
