import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getAlphaVantageClient } from '@/lib/integrations/finance/alphavantage-client'

interface GetStockFundamentalsInput {
  symbol: string
}

interface GetStockFundamentalsSuccess {
  success: true
  symbol: string
  name: string
  sector: string
  industry: string
  marketCap: number | null
  peRatio: number | null
  eps: number | null
  dividendYield: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  description: string
  currency: string
}

interface GetStockFundamentalsFailure {
  success: false
  error: string
}

type GetStockFundamentalsOutput = GetStockFundamentalsSuccess | GetStockFundamentalsFailure

/**
 * Get company fundamentals and financial metrics
 *
 * @param input - Tool input with stock symbol
 * @param context - Tool context
 * @returns Company fundamentals and financial metrics
 */
export default async function getStockFundamentals(
  input: GetStockFundamentalsInput,
  context: ToolContext
): Promise<GetStockFundamentalsOutput> {
  try {
    const { symbol } = input

    // Get Alpha Vantage client
    const client = getAlphaVantageClient()

    // Fetch company overview/fundamentals
    const fundamentals = await client.getFundamentals(symbol)

    if (!fundamentals) {
      return {
        success: false,
        error: `Could not fetch fundamentals for symbol: ${symbol}`
      }
    }

    return {
      success: true,
      symbol: fundamentals.symbol,
      name: fundamentals.name,
      sector: fundamentals.sector,
      industry: fundamentals.industry,
      marketCap: fundamentals.marketCap,
      peRatio: fundamentals.peRatio,
      eps: fundamentals.eps,
      dividendYield: fundamentals.dividendYield,
      fiftyTwoWeekHigh: fundamentals.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: fundamentals.fiftyTwoWeekLow,
      description: fundamentals.description,
      currency: fundamentals.currency
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
