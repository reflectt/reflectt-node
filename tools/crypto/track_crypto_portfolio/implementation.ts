import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { getCoinGeckoClient } from '@/lib/integrations/crypto/coingecko-client'

interface TrackCryptoPortfolioInput {
  portfolio_id: string
}

interface CryptoHolding {
  coinId: string
  amount: number
  costBasis: number
  currentPrice: number
  currentValue: number
  gain: number
  gainPercent: number
  allocation: number
}

interface TrackCryptoPortfolioSuccess {
  success: true
  portfolioId: string
  holdings: CryptoHolding[]
  totalValue: number
  totalCost: number
  totalGain: number
  totalGainPercent: number
  lastUpdated: string
}

interface TrackCryptoPortfolioFailure {
  success: false
  error: string
}

type TrackCryptoPortfolioOutput = TrackCryptoPortfolioSuccess | TrackCryptoPortfolioFailure

/**
 * Track cryptocurrency portfolio with current prices and performance
 *
 * @param input - Tool input with portfolio_id
 * @param context - Tool context
 * @returns Updated crypto portfolio with current values
 */
export default async function trackCryptoPortfolio(
  input: TrackCryptoPortfolioInput,
  context: ToolContext
): Promise<TrackCryptoPortfolioOutput> {
  try {
    const { portfolio_id } = input

    // Get data layer
    const dataLayer = getData(context)

    // Fetch portfolio from storage
    let portfolio: any = null
    try {
      portfolio = await dataLayer.read('portfolios', context.spaceId, portfolio_id)
    } catch {
      portfolio = null
    }

    if (!portfolio) {
      return {
        success: false,
        error: `Portfolio not found: ${portfolio_id}`
      }
    }

    // Validate portfolio structure
    if (!portfolio.holdings || !Array.isArray(portfolio.holdings)) {
      return {
        success: false,
        error: 'Invalid portfolio structure: missing or invalid holdings'
      }
    }

    // Get CoinGecko client
    const client = getCoinGeckoClient()

    let totalValue = 0
    let totalCost = 0
    const updatedHoldings: CryptoHolding[] = []

    // Update each holding with current price
    for (const holding of portfolio.holdings) {
      try {
        // Get current price in USD
        const price = await client.getPrice(holding.coinId, 'usd')

        if (!price) {
          continue
        }

        const amount = holding.amount || 1
        const costBasis = holding.costBasis || 0
        const currentPrice = price.price
        const currentValue = amount * currentPrice
        const gain = currentValue - costBasis
        const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0

        totalValue += currentValue
        totalCost += costBasis

        updatedHoldings.push({
          coinId: holding.coinId,
          amount,
          costBasis,
          currentPrice,
          currentValue,
          gain,
          gainPercent,
          allocation: 0 // Will calculate after loop
        })
      } catch (error) {
        // Continue with next holding on error
        console.error(`Error fetching price for ${holding.coinId}:`, error)
      }
    }

    // Calculate allocations
    updatedHoldings.forEach((holding) => {
      holding.allocation = totalValue > 0 ? (holding.currentValue / totalValue) * 100 : 0
    })

    // Calculate total metrics
    const totalGain = totalValue - totalCost
    const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0

    return {
      success: true,
      portfolioId: portfolio_id,
      holdings: updatedHoldings,
      totalValue,
      totalCost,
      totalGain,
      totalGainPercent,
      lastUpdated: new Date().toISOString()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
