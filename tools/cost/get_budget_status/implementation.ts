/**
 * Get Budget Status Tool Implementation
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { checkBudgetStatus, loadBudget } from '@/lib/cost-management/budget-tracking'

interface GetBudgetStatusInput {
  user_id?: string
  period?: string
}

export default async function get_budget_status(input: GetBudgetStatusInput, context: ToolContext) {
  try {
    const userId = input.user_id || 'default' || 'default'
    const period = input.period || 'current'

    // Check if budget exists
    const budget = await loadBudget(userId, context)
    if (!budget) {
      return {
        success: false,
        error: 'No budget configured',
        message: 'Please set a budget first using set_budget tool',
        has_budget: false
      }
    }

    // Get budget status
    const status = await checkBudgetStatus(userId, period, context)

    if (!status) {
      return {
        success: false,
        error: 'Failed to check budget status',
        message: 'Could not retrieve budget information'
      }
    }

    return {
      success: true,
      status,
      summary: formatBudgetStatus(status),
      message: `Budget status for ${status.period}: ${status.on_track ? 'On track' : 'Over budget'}`
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to get budget status'
    }
  }
}

function formatBudgetStatus(status: any): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push(`BUDGET STATUS: ${status.period}`)
  lines.push('='.repeat(60))
  lines.push('')

  // Progress bar
  const barLength = 40
  const filled = Math.min(Math.round((status.percentage_used / 100) * barLength), barLength)
  const empty = barLength - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)

  lines.push('SPENDING')
  lines.push('-'.repeat(60))
  lines.push(`Budget:     $${status.budget_limit.toFixed(2)}`)
  lines.push(`Spent:      $${status.spent_to_date.toFixed(2)}`)
  lines.push(`Remaining:  $${status.remaining.toFixed(2)}`)
  lines.push('')
  lines.push(`[${bar}] ${status.percentage_used.toFixed(1)}%`)
  lines.push('')

  // Projection
  lines.push('PROJECTION')
  lines.push('-'.repeat(60))
  lines.push(`Days Remaining: ${status.days_remaining}`)
  lines.push(`Projected Total: $${status.projected_total.toFixed(2)}`)

  if (status.on_track) {
    const savings = status.budget_limit - status.projected_total
    lines.push(`Status: ✓ ON TRACK (Projected savings: $${savings.toFixed(2)})`)
  } else {
    const overage = status.projected_total - status.budget_limit
    const overagePercent = ((overage / status.budget_limit) * 100).toFixed(1)
    lines.push(`Status: ⚠ OVER BUDGET (Projected overage: $${overage.toFixed(2)} / ${overagePercent}%)`)
  }
  lines.push('')

  // Alerts
  if (status.alerts && status.alerts.length > 0) {
    lines.push('ALERTS')
    lines.push('-'.repeat(60))
    for (const alert of status.alerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'
      lines.push(`${icon} ${alert.message}`)
    }
    lines.push('')
  }

  lines.push('='.repeat(60))

  return lines.join('\n')
}
