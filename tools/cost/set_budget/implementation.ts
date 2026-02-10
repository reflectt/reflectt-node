/**
 * Set Budget Tool Implementation
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { saveBudget } from '@/lib/cost-management/budget-tracking'
import { Budget } from '@/lib/cost-management/types'

interface SetBudgetInput {
  user_id?: string
  monthly_limit_usd: number
  daily_limit_usd?: number
  alert_at_percentage?: number[]
  auto_downgrade_at?: number
}

export default async function set_budget(input: SetBudgetInput, context: ToolContext) {
  try {
    // Validate inputs
    if (input.monthly_limit_usd <= 0) {
      return {
        success: false,
        error: 'Monthly limit must be greater than 0',
        message: 'Invalid budget amount'
      }
    }

    if (input.daily_limit_usd && input.daily_limit_usd <= 0) {
      return {
        success: false,
        error: 'Daily limit must be greater than 0',
        message: 'Invalid daily budget amount'
      }
    }

    const userId = input.user_id || 'default' || 'default'

    // Create alert thresholds
    const alertPercentages = input.alert_at_percentage || [75, 90]
    const alertThresholds = alertPercentages.map(percentage => ({
      percentage
    }))

    // Create auto actions if specified
    const autoActions = []
    if (input.auto_downgrade_at) {
      autoActions.push({
        at_threshold: input.auto_downgrade_at,
        action: 'downgrade_model' as const
      })
    }

    // Create budget object
    const budget: Budget = {
      user_id: userId,
      monthly_limit_usd: input.monthly_limit_usd,
      daily_limit_usd: input.daily_limit_usd,
      alert_thresholds: alertThresholds,
      auto_actions: autoActions.length > 0 ? autoActions : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Save budget
    await saveBudget(userId, budget, context)

    return {
      success: true,
      budget,
      message: `Budget set successfully: $${input.monthly_limit_usd.toFixed(2)}/month${
        input.daily_limit_usd ? ` ($${input.daily_limit_usd.toFixed(2)}/day)` : ''
      }`,
      summary: formatBudgetSummary(budget)
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to set budget'
    }
  }
}

function formatBudgetSummary(budget: Budget): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push('BUDGET CONFIGURATION')
  lines.push('='.repeat(60))
  lines.push('')
  lines.push(`Monthly Limit: $${budget.monthly_limit_usd.toFixed(2)}`)

  if (budget.daily_limit_usd) {
    lines.push(`Daily Limit:   $${budget.daily_limit_usd.toFixed(2)}`)
  }

  lines.push('')
  lines.push('Alert Thresholds:')
  for (const threshold of budget.alert_thresholds) {
    lines.push(`  - ${threshold.percentage}% ($${((threshold.percentage / 100) * budget.monthly_limit_usd).toFixed(2)})`)
  }

  if (budget.auto_actions && budget.auto_actions.length > 0) {
    lines.push('')
    lines.push('Auto Actions:')
    for (const action of budget.auto_actions) {
      lines.push(`  - At ${action.at_threshold}%: ${action.action}`)
    }
  }

  lines.push('')
  lines.push('='.repeat(60))

  return lines.join('\n')
}
