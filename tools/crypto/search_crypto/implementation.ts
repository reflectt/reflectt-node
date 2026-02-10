import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getCoinGeckoClient } from '@/lib/integrations/crypto/coingecko-client'

interface SearchCryptoInput {
  query: string
}

interface CryptoMatch {
  id: string
  name: string
  symbol: string
  marketCapRank: number | null
  thumb: string
}

interface SearchCryptoSuccess {
  success: true
  query: string
  matches: CryptoMatch[]
  matchCount: number
}

interface SearchCryptoFailure {
  success: false
  error: string
}

type SearchCryptoOutput = SearchCryptoSuccess | SearchCryptoFailure

/**
 * Search for cryptocurrencies
 *
 * @param input - Tool input with search query
 * @param context - Tool context
 * @returns List of matching cryptocurrencies
 */
export default async function searchCrypto(
  input: SearchCryptoInput,
  context: ToolContext
): Promise<SearchCryptoOutput> {
  try {
    const { query } = input

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Search query cannot be empty'
      }
    }

    // Get CoinGecko client
    const client = getCoinGeckoClient()

    // Search for cryptocurrencies
    const results = await client.searchCoins(query)

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
      id: result.id,
      name: result.name,
      symbol: result.symbol,
      marketCapRank: result.marketCapRank || null,
      thumb: result.thumb || ''
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
