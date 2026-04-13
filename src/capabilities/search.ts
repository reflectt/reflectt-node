/**
 * Search capability — web search via Serper, Brave, or Tavily.
 *
 * The node calls the search provider directly using an API key from the
 * local environment. Provider priority: Serper → Brave → Tavily.
 *
 * @module capabilities/search
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** ISO date string when available */
  date?: string
}

export interface SearchResponse {
  results: SearchResult[]
  /** Which provider was used */
  provider: 'serper' | 'brave' | 'tavily'
  query: string
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

export type SearchProvider = 'serper' | 'brave' | 'tavily' | null

/** Return the first configured search provider, or null if none available. */
export function getSearchProvider(): SearchProvider {
  if (process.env.SERPER_API_KEY) return 'serper'
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave'
  if (process.env.TAVILY_API_KEY) return 'tavily'
  return null
}

// ---------------------------------------------------------------------------
// Search implementation
// ---------------------------------------------------------------------------

async function searchSerper(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: limit }),
  })
  if (!res.ok) throw new Error(`Serper error ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    organic?: Array<{ title: string; link: string; snippet: string; date?: string }>
  }
  return (data.organic ?? []).slice(0, limit).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    date: r.date,
  }))
}

async function searchBrave(query: string, limit: number): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(limit, 20)))
  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY!,
    },
  })
  if (!res.ok) throw new Error(`Brave error ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    web?: { results?: Array<{ title: string; url: string; description: string; page_age?: string }> }
  }
  return (data.web?.results ?? []).slice(0, limit).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    date: r.page_age,
  }))
}

async function searchTavily(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: limit,
      search_depth: 'basic',
    }),
  })
  if (!res.ok) throw new Error(`Tavily error ${res.status}: ${await res.text()}`)
  const data = await res.json() as {
    results?: Array<{ title: string; url: string; content: string; published_date?: string }>
  }
  return (data.results ?? []).slice(0, limit).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    date: r.published_date,
  }))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a web search using the first available configured provider.
 * Throws if no provider is configured.
 */
export async function search(query: string, limit = 10): Promise<SearchResponse> {
  const provider = getSearchProvider()
  if (!provider) {
    throw new Error(
      'No search API key configured. Set SERPER_API_KEY, BRAVE_SEARCH_API_KEY, or TAVILY_API_KEY.',
    )
  }

  const clampedLimit = Math.min(Math.max(1, limit), 20)

  let results: SearchResult[]
  if (provider === 'serper') {
    results = await searchSerper(query, clampedLimit)
  } else if (provider === 'brave') {
    results = await searchBrave(query, clampedLimit)
  } else {
    results = await searchTavily(query, clampedLimit)
  }

  return { results, provider, query }
}
