import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getAlphaVantageClient } from '@/lib/integrations/finance/alphavantage-client'
import type { ParsedIntradayData, ParsedDailyData } from '@/lib/integrations/finance/alphavantage-types'

interface GetStockChartInput {
  symbol: string
  interval: '1min' | '5min' | '15min' | '30min' | '60min' | 'daily' | 'weekly'
  period?: string
}

interface OHLCV {
  timestamp: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface GetStockChartSuccess {
  success: true
  symbol: string
  interval: string
  dataPoints: OHLCV[]
  pointCount: number
}

interface GetStockChartFailure {
  success: false
  error: string
}

type GetStockChartOutput = GetStockChartSuccess | GetStockChartFailure

/**
 * Get historical stock price data for charting
 *
 * @param input - Tool input with symbol and interval
 * @param context - Tool context
 * @returns Array of OHLCV data points
 */
export default async function getStockChart(
  input: GetStockChartInput,
  context: ToolContext
): Promise<GetStockChartOutput> {
  try {
    const { symbol, interval } = input

    // Get Alpha Vantage client
    const client = getAlphaVantageClient()

    let data: (ParsedIntradayData | ParsedDailyData)[] = []

    // Fetch data based on interval
    if (['1min', '5min', '15min', '30min', '60min'].includes(interval)) {
      const intradayData = await client.getIntradayData(
        symbol,
        interval as '1min' | '5min' | '15min' | '30min' | '60min'
      )
      data = intradayData || []
    } else if (interval === 'daily') {
      const dailyData = await client.getDailyData(symbol)
      data = dailyData || []
    } else if (interval === 'weekly') {
      const weeklyData = await client.getWeeklyData(symbol)
      data = weeklyData || []
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        error: `Could not fetch ${interval} data for symbol: ${symbol}`
      }
    }

    // Limit period if specified
    const period = input.period ? parseInt(input.period) : undefined
    let dataPoints = data as OHLCV[]

    if (period && interval.includes('daily') || interval === 'weekly') {
      dataPoints = dataPoints.slice(0, period)
    }

    return {
      success: true,
      symbol,
      interval,
      dataPoints,
      pointCount: dataPoints.length
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
