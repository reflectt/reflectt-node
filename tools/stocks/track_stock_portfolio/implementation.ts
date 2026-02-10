import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { getAlphaVantageClient } from '@/lib/integrations/finance/alphavantage-client'

interface TrackStockPortfolioInput {
  portfolio_id: string
}

interface Holding {
  symbol: string
  shares: number
  costBasis: number
  currentPrice: number
  currentValue: number
  gain: number
  gainPercent: number
  allocation: number
}

interface TrackStockPortfolioSuccess {
  success: true
  portfolioId: string
  holdings: Holding[]
  totalValue: number
  totalCost: number
  totalGain: number
  totalGainPercent: number
  lastUpdated: string
}

interface TrackStockPortfolioFailure {
  success: false
  error: string
}

type TrackStockPortfolioOutput = TrackStockPortfolioSuccess | TrackStockPortfolioFailure

/**
 * Track stock portfolio with current prices and performance
 *
 * @param input - Tool input with portfolio_id
 * @param context - Tool context
 * @returns Updated portfolio with current values
 */
export default async function trackStockPortfolio(
  input: TrackStockPortfolioInput,
  context: ToolContext
): Promise<TrackStockPortfolioOutput> {
  try {
    const { portfolio_id } = input

    // Get data layer
    const dataLayer = getData(context)

    // Fetch portfolio from storage (using context's current space)
    let portfolio: any = null
    try {
      portfolio = await dataLayer.read('portfolios', context.spaceId, portfolio_id)
    } catch {
      // Try to read from parent context if available
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

    // Get Alpha Vantage client
    const client = getAlphaVantageClient()

    let totalValue = 0
    let totalCost = 0
    const updatedHoldings: Holding[] = []

    // Update each holding with current price
    for (const holding of portfolio.holdings) {
      try {
        // Get current price
        const quote = await client.getQuote(holding.symbol)

        if (!quote) {
          continue
        }

        const shares = holding.shares || 1
        const costBasis = holding.costBasis || 0
        const currentPrice = quote.price
        const currentValue = shares * currentPrice
        const gain = currentValue - costBasis
        const gainPercent = costBasis > 0 ? (gain / costBasis) * 100 : 0

        totalValue += currentValue
        totalCost += costBasis

        updatedHoldings.push({
          symbol: holding.symbol,
          shares,
          costBasis,
          currentPrice,
          currentValue,
          gain,
          gainPercent,
          allocation: 0 // Will calculate after loop
        })
      } catch (error) {
        // Continue with next holding on error
        console.error(`Error fetching quote for ${holding.symbol}:`, error)
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
