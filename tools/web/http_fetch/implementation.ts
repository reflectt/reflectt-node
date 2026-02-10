import {
  validateRequired,
  quickValidate,
  formatError,
} from '@/lib/tools/helpers'

interface HttpFetchInput {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

interface HttpFetchOutput {
  url: string
  headers?: Record<string, string>
  content?: string
  length?: number
  error?: string
}

/**
 * Fetch the content of a web page
 */
export default async function httpFetch(input: HttpFetchInput): Promise<HttpFetchOutput> {
  const { url, method = 'GET', headers, body } = input

  try {
    // Validation
    const error = quickValidate([
      () => validateRequired(url, 'url')
    ])
    if (error) throw new Error(error)

    const response = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)',
        ...headers
      },
      body: method === 'POST' ? body : undefined
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const content = await response.text()

    return {
      url,
      content,
      length: content.length,
      headers: Object.fromEntries(response.headers.entries()),
    }
  } catch (error) {
    return {
      url,
      error: formatError(error)
    }
  }
}
