import {
  validateRequired,
  quickValidate,
  formatError,
} from '@/lib/tools/helpers'

interface WebSearchInput {
  query: string
  num_results?: number
}

interface WebSearchOutput {
  query: string
  num_results: number
  results: Array<{
    title: string
    url: string
    snippet: string
  }>
  source: string
  error?: string
}

/**
 * Search the web for information using DuckDuckGo
 */
export default async function webSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const { query, num_results = 5 } = input

  try {
    // Validation
    const error = quickValidate([
      () => validateRequired(query, 'query')
    ])
    if (error) throw new Error(error)

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`)
    }

    const html = await response.text()

    // Parse DuckDuckGo results
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]+)</g

    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < num_results) {
      results.push({
        title: match[2].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"'),
        url: match[1].replace(/&amp;/g, '&'),
        snippet: match[3].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim()
      })
    }

    return {
      query,
      num_results: results.length,
      results,
      source: 'DuckDuckGo'
    }
  } catch (error) {
    return {
      query,
      num_results: 0,
      results: [],
      source: 'DuckDuckGo',
      error: formatError(error)
    }
  }
}
