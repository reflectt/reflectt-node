import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getCoinGeckoClient } from '@/lib/integrations/crypto/coingecko-client'

interface GetCryptoChartInput {
  coin_id: string
  days: '1' | '7' | '30' | '90' | '365'
  currency?: string
}

interface PricePoint {
  timestamp: number
  price: number
}

interface GetCryptoChartSuccess {
  success: true
  coinId: string
  days: string
  currency: string
  priceHistory: PricePoint[]
  pointCount: number
  minPrice: number
  maxPrice: number
  avgPrice: number
}

interface GetCryptoChartFailure {
  success: false
  error: string
}

type GetCryptoChartOutput = GetCryptoChartSuccess | GetCryptoChartFailure

/**
 * Get cryptocurrency price history for charting
 *
 * @param input - Tool input with coin ID and days
 * @param context - Tool context
 * @returns Array of price points with timestamps
 */
export default async function getCryptoChart(
  input: GetCryptoChartInput,
  context: ToolContext
): Promise<GetCryptoChartOutput> {
  try {
    const { coin_id, days, currency = 'usd' } = input

    // Get CoinGecko client
    const client = getCoinGeckoClient()

    // Fetch market chart data
    const chart = await client.getMarketChart(coin_id, currency, parseInt(days))

    if (!chart || !chart.prices || chart.prices.length === 0) {
      return {
        success: false,
        error: `Could not fetch price history for coin: ${coin_id}`
      }
    }

    // Convert to price points
    const priceHistory: PricePoint[] = chart.prices.map((point: [number, number]) => ({
      timestamp: point[0],
      price: point[1]
    }))

    // Calculate statistics
    const prices = priceHistory.map((p) => p.price)
    const minPrice = Math.min(...prices)
    const maxPrice = Math.max(...prices)
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length

    return {
      success: true,
      coinId: coin_id,
      days,
      currency,
      priceHistory,
      pointCount: priceHistory.length,
      minPrice,
      maxPrice,
      avgPrice
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
