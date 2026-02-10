/**
 * Get Cost Insights Tool Implementation
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { CostInsight } from '@/lib/cost-management/types'
import { generateCostReport, getTopExpenses } from '@/lib/cost-management/cost-reporting'

interface GetCostInsightsInput {
  user_id?: string
  look_back_days?: number
  min_savings_usd?: number
}

export default async function get_cost_insights(input: GetCostInsightsInput, context: ToolContext) {
  try {
    const userId = input.user_id || 'default' || 'default'
    const lookBackDays = input.look_back_days || 30
    const minSavings = input.min_savings_usd || 1.0

    // Get cost data for analysis
    const dateTo = new Date().toISOString().split('T')[0]
    const dateFrom = new Date()
    dateFrom.setDate(dateFrom.getDate() - lookBackDays)
    const dateFromStr = dateFrom.toISOString().split('T')[0]

    const report = await generateCostReport(userId, dateFromStr, dateTo, 'day', context)

    // Analyze and generate insights
    const insights = await analyzeForInsights(report, minSavings, context)

    const totalSavings = insights.reduce((sum, insight) => sum + insight.potential_savings_usd, 0)

    return {
      success: true,
      insights,
      total_potential_savings: totalSavings,
      summary: formatInsights(insights, totalSavings),
      message: `Found ${insights.length} optimization opportunities with potential savings of $${totalSavings.toFixed(2)}`
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to generate cost insights'
    }
  }
}

async function analyzeForInsights(
  report: any,
  minSavings: number,
  context: ToolContext
): Promise<CostInsight[]> {
  const insights: CostInsight[] = []

  // 1. Check for expensive agents that could use cheaper models
  const avgCost = report.total_cost_usd / Math.max(report.total_conversations, 1)
  for (const [agent, breakdown] of Object.entries(report.breakdown.by_agent)) {
    const b = breakdown as any
    if (b.avg_cost_per_conversation > avgCost * 1.5 && b.conversation_count > 5) {
      const potentialSavings = b.total_cost_usd * 0.4 // Assume 40% savings with Haiku
      if (potentialSavings >= minSavings) {
        insights.push({
          type: 'optimization',
          title: `High-cost agent: ${agent}`,
          description: `Agent ${agent} has above-average costs ($${b.avg_cost_per_conversation.toFixed(2)} vs $${avgCost.toFixed(2)} avg). Consider using Haiku model for simpler queries.`,
          potential_savings_usd: potentialSavings,
          actionable: true,
          suggested_action: `Review ${agent} conversations and switch to claude-3-haiku for routine tasks`,
          confidence: 0.75
        })
      }
    }
  }

  // 2. Check for cost spikes (anomalies)
  if (report.breakdown.by_day) {
    const dailyCosts = Object.values(report.breakdown.by_day) as number[]
    const avgDaily = dailyCosts.reduce((sum, cost) => sum + cost, 0) / dailyCosts.length
    const maxDaily = Math.max(...dailyCosts)

    if (maxDaily > avgDaily * 2.5) {
      insights.push({
        type: 'anomaly',
        title: 'Unusual spending spike detected',
        description: `Peak daily spending of $${maxDaily.toFixed(2)} is ${((maxDaily / avgDaily - 1) * 100).toFixed(0)}% above average. Investigate what caused the spike.`,
        potential_savings_usd: maxDaily - avgDaily,
        actionable: true,
        suggested_action: 'Review high-cost conversations from peak days to identify patterns',
        confidence: 0.85
      })
    }
  }

  // 3. Check for repetitive expensive patterns
  const conversationTypes = report.breakdown.by_conversation_type
  for (const [type, breakdown] of Object.entries(conversationTypes)) {
    const b = breakdown as any
    if (type === 'agent_to_agent' && b.conversation_count > 10) {
      // Agent-to-agent calls can be optimized with better routing
      const potentialSavings = b.total_cost_usd * 0.2 // Assume 20% savings with optimization
      if (potentialSavings >= minSavings) {
        insights.push({
          type: 'pattern',
          title: 'High agent-to-agent delegation costs',
          description: `${b.conversation_count} agent-to-agent calls cost $${b.total_cost_usd.toFixed(2)}. Consider direct agent access or caching common queries.`,
          potential_savings_usd: potentialSavings,
          actionable: true,
          suggested_action: 'Reduce delegation depth by routing directly to specialized agents',
          confidence: 0.65
        })
      }
    }
  }

  // 4. High token usage
  const tokensPerConv = report.total_tokens / Math.max(report.total_conversations, 1)
  if (tokensPerConv > 50000) {
    // Very high token usage - likely large contexts
    const potentialSavings = report.total_cost_usd * 0.25 // Assume 25% savings with prompt optimization
    if (potentialSavings >= minSavings) {
      insights.push({
        type: 'optimization',
        title: 'High token usage per conversation',
        description: `Average ${tokensPerConv.toLocaleString()} tokens per conversation. Consider prompt caching or reducing context size.`,
        potential_savings_usd: potentialSavings,
        actionable: true,
        suggested_action: 'Enable prompt caching and optimize system prompts to reduce token usage',
        confidence: 0.8
      })
    }
  }

  // 5. Budget efficiency recommendation
  if (report.trends.trend_direction === 'up' && report.trends.vs_previous_period > 20) {
    insights.push({
      type: 'pattern',
      title: 'Rapid cost growth detected',
      description: `Costs increased ${report.trends.vs_previous_period.toFixed(1)}% from previous period. Set budget limits to control spending.`,
      potential_savings_usd: 0,
      actionable: true,
      suggested_action: 'Set a monthly budget with alerts at 75% and 90% thresholds',
      confidence: 0.9
    })
  }

  return insights
}

function formatInsights(insights: CostInsight[], totalSavings: number): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push('COST OPTIMIZATION INSIGHTS')
  lines.push('='.repeat(60))
  lines.push('')

  if (insights.length === 0) {
    lines.push('✓ No significant optimization opportunities found.')
    lines.push('Your spending patterns look efficient!')
  } else {
    lines.push(`Found ${insights.length} opportunities`)
    lines.push(`Total Potential Savings: $${totalSavings.toFixed(2)}/month`)
    lines.push('')

    for (let i = 0; i < insights.length; i++) {
      const insight = insights[i]
      const icon = insight.type === 'optimization' ? '💡' : insight.type === 'anomaly' ? '⚠️' : '📊'

      lines.push(`${i + 1}. ${icon} ${insight.title}`)
      lines.push(`   ${insight.description}`)

      if (insight.potential_savings_usd > 0) {
        lines.push(`   Potential Savings: $${insight.potential_savings_usd.toFixed(2)}/month`)
      }

      if (insight.suggested_action) {
        lines.push(`   → ${insight.suggested_action}`)
      }

      lines.push(`   Confidence: ${(insight.confidence * 100).toFixed(0)}%`)
      lines.push('')
    }
  }

  lines.push('='.repeat(60))

  return lines.join('\n')
}
