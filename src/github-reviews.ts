// SPDX-License-Identifier: Apache-2.0
// GitHub PR review operations (approve) using explicit tokens.

export interface GitHubUser {
  login: string
  id: number
}

export function parsePrUrl(prUrl: string): { owner: string; repo: string; pullNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  const pullNumber = parseInt(match[3], 10)
  if (!Number.isFinite(pullNumber) || pullNumber <= 0) return null
  return { owner: match[1], repo: match[2], pullNumber }
}

export async function githubWhoami(opts: { token: string; fetchImpl?: typeof fetch }): Promise<GitHubUser | null> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const res = await fetchImpl('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${opts.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) return null
  const json = (await res.json()) as any
  if (!json?.login) return null
  return { login: String(json.login), id: Number(json.id) }
}

export async function approvePullRequest(opts: {
  token: string
  prUrl: string
  body?: string
  fetchImpl?: typeof fetch
}): Promise<{ ok: boolean; status: number; message?: string }>{
  const parsed = parsePrUrl(opts.prUrl)
  if (!parsed) return { ok: false, status: 400, message: 'Invalid PR URL' }

  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.pullNumber}/reviews`

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${opts.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event: 'APPROVE', body: opts.body || '' }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      detail = await res.text().catch(() => '')
    }
    return { ok: false, status: res.status, message: detail || res.statusText }
  }

  return { ok: true, status: res.status }
}
