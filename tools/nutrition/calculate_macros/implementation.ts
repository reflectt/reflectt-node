import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'

interface MacroTargets {
  protein_percent: number
  carbs_percent: number
  fat_percent: number
}

interface CalculateMacrosInput {
  start_date?: string
  end_date?: string
  target_calories?: number
  macro_targets?: MacroTargets
}

interface MacroBreakdown {
  protein_g: number
  protein_calories: number
  protein_percent: number
  carbs_g: number
  carbs_calories: number
  carbs_percent: number
  fat_g: number
  fat_calories: number
  fat_percent: number
  total_calories: number
}

interface CalculateMacrosOutput {
  success: boolean
  result?: {
    period: { start_date: string; end_date: string; days: number }
    actual: MacroBreakdown
    targets?: {
      calories?: number
      macros?: MacroTargets
      comparison: {
        protein_diff_g?: number
        carbs_diff_g?: number
        fat_diff_g?: number
        calories_diff?: number
      }
    }
  }
  error?: string
}

/**
 * Calculate macro nutrient breakdown from food logs
 *
 * @param totals - Total grams of protein, carbs, fat
 * @returns Macro breakdown with calories and percentages
 */
function getMacroBreakdown(totals: { protein_g: number; carbs_g: number; fat_g: number }): MacroBreakdown {
  // Calories per gram: protein = 4, carbs = 4, fat = 9
  const proteinCal = totals.protein_g * 4
  const carbsCal = totals.carbs_g * 4
  const fatCal = totals.fat_g * 9
  const totalCal = proteinCal + carbsCal + fatCal

  return {
    protein_g: Math.round(totals.protein_g * 10) / 10,
    protein_calories: Math.round(proteinCal),
    protein_percent: totalCal > 0 ? Math.round((proteinCal / totalCal) * 100) : 0,
    carbs_g: Math.round(totals.carbs_g * 10) / 10,
    carbs_calories: Math.round(carbsCal),
    carbs_percent: totalCal > 0 ? Math.round((carbsCal / totalCal) * 100) : 0,
    fat_g: Math.round(totals.fat_g * 10) / 10,
    fat_calories: Math.round(fatCal),
    fat_percent: totalCal > 0 ? Math.round((fatCal / totalCal) * 100) : 0,
    total_calories: Math.round(totalCal)
  }
}

/**
 * Calculate macro nutrient breakdown for a date range with targets comparison
 *
 * @param input - Date range and target parameters
 * @param context - Tool execution context
 * @returns Macro breakdown with comparison to targets
 */
export default async function calculateMacros(
  input: CalculateMacrosInput,
  context: ToolContext
): Promise<CalculateMacrosOutput> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const startDate = input.start_date || today
    const endDate = input.end_date || today

    logger.info('Calculating macros', { start_date: startDate, end_date: endDate })

    const dataLayer = getData(context)

    // Query nutrition logs for date range
    const allLogs = await dataLayer.list('nutrition_logs', context.spaceId)

    const logsInRange = allLogs.filter((log: any) => {
      const logDate = log.logged_at?.split('T')[0] || log.created_at?.split('T')[0]
      return logDate >= startDate && logDate <= endDate
    })

    logger.debug('Found nutrition logs in range', { count: logsInRange.length })

    // Calculate totals
    const totals = logsInRange.reduce(
      (acc: any, log: any) => {
        const nutrition = log.nutrition || {}
        return {
          protein_g: acc.protein_g + (nutrition.protein_g || 0),
          carbs_g: acc.carbs_g + (nutrition.carbs_g || 0),
          fat_g: acc.fat_g + (nutrition.fat_g || 0)
        }
      },
      { protein_g: 0, carbs_g: 0, fat_g: 0 }
    )

    const breakdown = getMacroBreakdown(totals)

    // Calculate days in period
    const start = new Date(startDate)
    const end = new Date(endDate)
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

    // Prepare result
    const result: any = {
      period: {
        start_date: startDate,
        end_date: endDate,
        days
      },
      actual: breakdown
    }

    // Compare to targets if provided
    if (input.target_calories || input.macro_targets) {
      const targets: any = {
        comparison: {}
      }

      if (input.target_calories) {
        targets.calories = input.target_calories
        targets.comparison.calories_diff = breakdown.total_calories - input.target_calories
      }

      if (input.macro_targets) {
        targets.macros = input.macro_targets

        // Calculate target grams from percentages
        const targetCalories = input.target_calories || breakdown.total_calories
        const targetProteinG = (targetCalories * (input.macro_targets.protein_percent / 100)) / 4
        const targetCarbsG = (targetCalories * (input.macro_targets.carbs_percent / 100)) / 4
        const targetFatG = (targetCalories * (input.macro_targets.fat_percent / 100)) / 9

        targets.comparison.protein_diff_g = Math.round((breakdown.protein_g - targetProteinG) * 10) / 10
        targets.comparison.carbs_diff_g = Math.round((breakdown.carbs_g - targetCarbsG) * 10) / 10
        targets.comparison.fat_diff_g = Math.round((breakdown.fat_g - targetFatG) * 10) / 10
      }

      result.targets = targets
    }

    logger.info('Macros calculated successfully', {
      total_calories: breakdown.total_calories,
      days
    })

    return {
      success: true,
      result
    }

  } catch (error) {
    logger.error('Failed to calculate macros', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to calculate macro breakdown'
    }
  }
}
