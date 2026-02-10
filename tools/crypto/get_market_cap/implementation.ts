import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getCoinGeckoClient } from '@/lib/integrations/crypto/coingecko-client'

interface GetMarketCapInput {
  limit?: string
  currency?: string
}

interface TopCoin {
  rank: number
  id: string
  name: string
  symbol: string
  price: number
  marketCap: number | null
  volume24h: number | null
  change24h: number | null
  circulatingSupply: number | null
}

interface GetMarketCapSuccess {
  success: true
  topCoins: TopCoin[]
  coinCount: number
  currency: string
  timestamp: string
}

interface GetMarketCapFailure {
  success: false
  error: string
}

type GetMarketCapOutput = GetMarketCapSuccess | GetMarketCapFailure

/**
 * Get top cryptocurrencies by market cap
 *
 * @param input - Tool input with limit and currency
 * @param context - Tool context
 * @returns Array of top coins by market cap
 */
export default async function getMarketCap(
  input: GetMarketCapInput,
  context: ToolContext
): Promise<GetMarketCapOutput> {
  try {
    const limit = Math.min(parseInt(input.limit || '10'), 250)
    const currency = input.currency || 'usd'

    // Get CoinGecko client
    const client = getCoinGeckoClient()

    // Fetch top coins by market cap
    const topCoins = await client.getTopCoins(limit, currency)

    if (!topCoins || topCoins.length === 0) {
      return {
        success: false,
        error: 'Could not fetch market cap data'
      }
    }

    // Map to output format with rank
    const coins: TopCoin[] = topCoins.map((coin: any, index: number) => ({
      rank: index + 1,
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      price: coin.price,
      marketCap: coin.marketCap || null,
      volume24h: coin.volume24h || null,
      change24h: coin.change24h || null,
      circulatingSupply: coin.circulatingSupply || null
    }))

    return {
      success: true,
      topCoins: coins,
      coinCount: coins.length,
      currency,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
