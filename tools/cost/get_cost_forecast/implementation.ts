/**
 * Get Cost Forecast Tool Implementation
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { forecastCosts } from '@/lib/cost-management/forecasting'

interface GetCostForecastInput {
  user_id?: string
  forecast_days?: number
  include_recommendations?: boolean
}

export default async function get_cost_forecast(input: GetCostForecastInput, context: ToolContext) {
  try {
    const userId = input.user_id || 'default' || 'default'
    const forecastDays = input.forecast_days || 30

    // Generate forecast
    const forecast = await forecastCosts(userId, forecastDays, context)

    return {
      success: true,
      forecast,
      summary: formatForecast(forecast),
      message: `Cost forecast generated with ${(forecast.confidence_level * 100).toFixed(0)}% confidence`
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to generate cost forecast'
    }
  }
}

function formatForecast(forecast: any): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push('COST FORECAST')
  lines.push('='.repeat(60))
  lines.push('')

  // Current status
  lines.push('CURRENT STATUS')
  lines.push('-'.repeat(60))
  lines.push(`Current Month Spend: $${forecast.current_monthly_spend.toFixed(2)}`)
  lines.push(`Daily Burn Rate:     $${forecast.daily_burn_rate.toFixed(2)}/day`)
  lines.push(`Forecast Confidence: ${(forecast.confidence_level * 100).toFixed(0)}%`)
  lines.push('')

  // Projections
  lines.push('MONTH-END PROJECTIONS')
  lines.push('-'.repeat(60))
  lines.push(`Conservative (Best): $${forecast.scenarios.conservative.toFixed(2)}`)
  lines.push(`Likely (Expected):   $${forecast.scenarios.likely.toFixed(2)}`)
  lines.push(`Pessimistic (Worst): $${forecast.scenarios.pessimistic.toFixed(2)}`)
  lines.push('')

  // Main projection
  lines.push(`📊 Most Likely Total: $${forecast.projected_month_end.toFixed(2)}`)
  lines.push('')

  // Recommendations
  if (forecast.recommendations && forecast.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS')
    lines.push('-'.repeat(60))
    for (const rec of forecast.recommendations) {
      lines.push(`• ${rec}`)
    }
    lines.push('')
  }

  lines.push('='.repeat(60))
  lines.push(`Generated: ${new Date(forecast.generated_at).toLocaleString()}`)

  return lines.join('\n')
}
