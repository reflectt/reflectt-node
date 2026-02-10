import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getAlphaVantageClient } from '@/lib/integrations/finance/alphavantage-client'

interface GetStockQuoteInput {
  symbol: string
}

interface GetStockQuoteSuccess {
  success: true
  symbol: string
  price: number
  change: number
  changePercent: number
  volume: number
  previousClose: number
  open: number
  high: number
  low: number
  timestamp: string
}

interface GetStockQuoteFailure {
  success: false
  error: string
}

type GetStockQuoteOutput = GetStockQuoteSuccess | GetStockQuoteFailure

/**
 * Get current stock quote with price and market data
 *
 * @param input - Tool input with stock symbol
 * @param context - Tool context
 * @returns Current stock quote data
 */
export default async function getStockQuote(
  input: GetStockQuoteInput,
  context: ToolContext
): Promise<GetStockQuoteOutput> {
  try {
    const { symbol } = input

    // Get Alpha Vantage client
    const client = getAlphaVantageClient()

    // Fetch stock quote
    const quote = await client.getQuote(symbol)

    if (!quote) {
      return {
        success: false,
        error: `Could not fetch quote for symbol: ${symbol}`
      }
    }

    return {
      success: true,
      symbol: quote.symbol,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      previousClose: quote.previousClose,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      timestamp: quote.timestamp
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
