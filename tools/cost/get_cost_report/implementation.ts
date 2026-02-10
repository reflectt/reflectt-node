/**
 * Get Cost Report Tool Implementation
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { generateCostReport } from '@/lib/cost-management/cost-reporting'

interface GetCostReportInput {
  user_id?: string
  date_from?: string
  date_to?: string
  group_by?: 'day' | 'week' | 'agent' | 'type'
  include_breakdown?: boolean
  include_trends?: boolean
}

export default async function get_cost_report(input: GetCostReportInput, context: ToolContext) {
  try {
    // Default to current user if not specified
    const userId = input.user_id || 'default' || 'default'

    // Default date range: last 30 days
    const dateTo = input.date_to || new Date().toISOString().split('T')[0]
    const dateFrom = input.date_from || (() => {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      return d.toISOString().split('T')[0]
    })()

    // Generate the cost report
    const report = await generateCostReport(
      userId,
      dateFrom,
      dateTo,
      input.group_by,
      context
    )

    // Format for human-readable output
    const summary = formatReportSummary(report)

    return {
      success: true,
      report,
      summary,
      message: `Cost report generated for ${dateFrom} to ${dateTo}`
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to generate cost report'
    }
  }
}

function formatReportSummary(report: any): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push(`COST REPORT: ${report.period_start} to ${report.period_end}`)
  lines.push('='.repeat(60))
  lines.push('')

  // Overall summary
  lines.push('SUMMARY')
  lines.push('-'.repeat(60))
  lines.push(`Total Cost:         $${report.total_cost_usd.toFixed(2)}`)
  lines.push(`Total Conversations: ${report.total_conversations}`)
  lines.push(`Total Tokens:        ${report.total_tokens.toLocaleString()}`)
  lines.push(`Daily Average:       $${report.trends.daily_average.toFixed(2)}`)
  lines.push(`Trend:               ${report.trends.trend_direction.toUpperCase()} (${report.trends.vs_previous_period > 0 ? '+' : ''}${report.trends.vs_previous_period.toFixed(1)}%)`)
  lines.push('')

  // Top agents
  const topAgents = Object.entries(report.breakdown.by_agent)
    .sort((a: any, b: any) => b[1].total_cost_usd - a[1].total_cost_usd)
    .slice(0, 5)

  if (topAgents.length > 0) {
    lines.push('TOP AGENTS BY COST')
    lines.push('-'.repeat(60))
    for (const [agent, data] of topAgents) {
      const d = data as any
      lines.push(`${agent.padEnd(30)} $${d.total_cost_usd.toFixed(2).padStart(8)} (${d.conversation_count} convs)`)
    }
    lines.push('')
  }

  // Top expenses
  if (report.top_expenses.length > 0) {
    lines.push('TOP EXPENSIVE CONVERSATIONS')
    lines.push('-'.repeat(60))
    for (let i = 0; i < Math.min(5, report.top_expenses.length); i++) {
      const exp = report.top_expenses[i]
      lines.push(`${(i + 1)}. ${exp.conversation_id.substring(0, 12)}... | ${exp.agent_slug.padEnd(20)} | $${exp.cost_usd.toFixed(2)}`)
    }
    lines.push('')
  }

  lines.push('='.repeat(60))

  return lines.join('\n')
}
