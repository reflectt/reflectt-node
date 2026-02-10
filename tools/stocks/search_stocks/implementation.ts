import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getAlphaVantageClient } from '@/lib/integrations/finance/alphavantage-client'

interface SearchStocksInput {
  query: string
}

interface StockMatch {
  symbol: string
  name: string
  type: string
  region: string
  marketOpen: string
  marketClose: string
  timezone: string
  currency: string
  matchScore: number
}

interface SearchStocksSuccess {
  success: true
  query: string
  matches: StockMatch[]
  matchCount: number
}

interface SearchStocksFailure {
  success: false
  error: string
}

type SearchStocksOutput = SearchStocksSuccess | SearchStocksFailure

/**
 * Search for stock symbols
 *
 * @param input - Tool input with search query
 * @param context - Tool context
 * @returns List of matching stock symbols
 */
export default async function searchStocks(
  input: SearchStocksInput,
  context: ToolContext
): Promise<SearchStocksOutput> {
  try {
    const { query } = input

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Search query cannot be empty'
      }
    }

    // Get Alpha Vantage client
    const client = getAlphaVantageClient()

    // Search for symbols
    const results = await client.searchSymbols(query)

    if (!results || results.length === 0) {
      return {
        success: true,
        query,
        matches: [],
        matchCount: 0
      }
    }

    // Limit to top 10 results
    const topMatches = results.slice(0, 10).map((result: any) => ({
      symbol: result.symbol,
      name: result.name,
      type: result.type,
      region: result.region,
      marketOpen: result.marketOpen,
      marketClose: result.marketClose,
      timezone: result.timezone,
      currency: result.currency,
      matchScore: result.matchScore
    }))

    return {
      success: true,
      query,
      matches: topMatches,
      matchCount: topMatches.length
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
