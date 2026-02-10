import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getCoinGeckoClient } from '@/lib/integrations/crypto/coingecko-client'

interface GetCryptoPriceInput {
  coin_ids: string[]
  currencies?: string[]
}

interface CryptoPrice {
  coinId: string
  currency: string
  price: number
  marketCap: number | null
  volume24h: number | null
  change24h: number | null
  marketCapRank: number | null
}

interface GetCryptoPriceSuccess {
  success: true
  prices: CryptoPrice[]
  priceCount: number
  timestamp: string
}

interface GetCryptoPriceFailure {
  success: false
  error: string
}

type GetCryptoPriceOutput = GetCryptoPriceSuccess | GetCryptoPriceFailure

/**
 * Get current cryptocurrency prices
 *
 * @param input - Tool input with coin IDs and currencies
 * @param context - Tool context
 * @returns Array of cryptocurrency prices
 */
export default async function getCryptoPrice(
  input: GetCryptoPriceInput,
  context: ToolContext
): Promise<GetCryptoPriceOutput> {
  try {
    const { coin_ids, currencies = ['usd'] } = input

    if (!coin_ids || coin_ids.length === 0) {
      return {
        success: false,
        error: 'At least one coin ID is required'
      }
    }

    // Get CoinGecko client
    const client = getCoinGeckoClient()

    const prices: CryptoPrice[] = []

    // Fetch prices for each coin and currency combination
    for (const coinId of coin_ids) {
      for (const currency of currencies) {
        try {
          const price = await client.getPrice(coinId, currency)

          if (price) {
            prices.push({
              coinId,
              currency,
              price: price.price,
              marketCap: price.marketCap || null,
              volume24h: price.volume24h || null,
              change24h: price.change24h || null,
              marketCapRank: price.marketCapRank || null
            })
          }
        } catch (error) {
          // Continue with next currency on error
          console.error(`Error fetching price for ${coinId} in ${currency}:`, error)
        }
      }
    }

    if (prices.length === 0) {
      return {
        success: false,
        error: 'Could not fetch prices for any of the requested coins'
      }
    }

    return {
      success: true,
      prices,
      priceCount: prices.length,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
