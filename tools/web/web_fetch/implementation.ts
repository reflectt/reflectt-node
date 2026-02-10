import {
  validateRequired,
  quickValidate,
  formatError,
} from '@/lib/tools/helpers'

interface WebFetchInput {
  url: string
}

interface WebFetchOutput {
  url: string
  content?: string
  length?: number
  error?: string
}

/**
 * Fetch the content of a web page
 */
export default async function webFetch(input: WebFetchInput): Promise<WebFetchOutput> {
  const { url } = input

  try {
    // Validation
    const error = quickValidate([
      () => validateRequired(url, 'url')
    ])
    if (error) throw new Error(error)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()

    // Simple text extraction - remove HTML tags
    const text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 10000) // Limit to 10k chars

    return {
      url,
      content: text,
      length: text.length
    }
  } catch (error) {
    return {
      url,
      error: formatError(error)
    }
  }
}
