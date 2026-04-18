// SPDX-License-Identifier: Apache-2.0
// Fetches a GitHub installation access token from the cloud API and keeps it fresh.
// The token is set as GITHUB_TOKEN / GH_TOKEN so `gh` CLI and existing
// resolveGitHubTokenForActor() pick it up automatically.

let refreshTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Fetch a GitHub installation token from the cloud API and set it in process.env.
 * Returns true if a token was obtained, false if GitHub isn't connected.
 */
async function fetchAndSet(): Promise<boolean> {
  const cloudUrl = (process.env.REFLECTT_CLOUD_URL || '').replace(/\/+$/, '')
  const hostId = process.env.REFLECTT_HOST_ID
  const credential = process.env.REFLECTT_HOST_CREDENTIAL
  if (!cloudUrl || !hostId || !credential) return false

  try {
    const res = await fetch(`${cloudUrl}/api/hosts/${hostId}/github/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential}`,
        'Content-Type': 'application/json',
      },
    })
    if (res.status === 404) return false // GitHub not connected on this team
    if (!res.ok) {
      console.warn(`[github-cloud-token] Failed to fetch token: ${res.status} ${await res.text().catch(() => '')}`)
      return false
    }
    const { token, expires_at } = await res.json() as { token: string; expires_at: string }
    process.env.GITHUB_TOKEN = token
    process.env.GH_TOKEN = token
    console.log(`[github-cloud-token] Token set, expires ${expires_at}`)
    return true
  } catch (err) {
    console.warn('[github-cloud-token] Error fetching token:', err)
    return false
  }
}

/**
 * Start the GitHub token refresh loop.
 * Fetches immediately, then refreshes every 50 minutes (tokens expire after 1 hour).
 */
export async function startGitHubTokenRefresh(): Promise<void> {
  // Don't override an explicitly provided token
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    console.log('[github-cloud-token] GITHUB_TOKEN already set, skipping cloud token refresh')
    return
  }

  const ok = await fetchAndSet()
  if (!ok) {
    console.log('[github-cloud-token] GitHub not connected or cloud not available — agents will work without GitHub access')
    return
  }

  // Refresh every 50 minutes
  refreshTimer = setInterval(() => {
    fetchAndSet().catch(() => {})
  }, 50 * 60 * 1000)
  // Don't keep the process alive just for this timer
  if (refreshTimer.unref) refreshTimer.unref()
}

export function stopGitHubTokenRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}
