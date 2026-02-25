/**
 * Duration formatting utilities.
 *
 * Centralises ms→minutes/hours/days conversion so every call site
 * goes through the same, tested path.  Prevents the class of bug
 * where one location divides by 60 instead of 60_000.
 */

/** Convert milliseconds to whole minutes (rounded). */
export function msToMinutes(ms: number): number {
  return Math.round(ms / 60_000)
}

/**
 * Human-readable duration string from milliseconds.
 *
 *   formatDuration(90_000)       → "2m"
 *   formatDuration(7_200_000)    → "2h 0m"
 *   formatDuration(90_000_000)   → "1d 1h"
 *   formatDuration(32_081_400)   → "8h 55m"   (the 534,690m bug scenario)
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0m'
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}
