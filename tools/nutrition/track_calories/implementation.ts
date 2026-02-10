import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getData } from '@/lib/data-layer'
import { logger } from '@/lib/observability/logger'

interface TrackCaloriesInput {
  date?: string
  calorie_goal?: number
  goal_type?: 'weight_loss' | 'maintenance' | 'muscle_gain'
}

interface MealBreakdown {
  breakfast: number
  lunch: number
  dinner: number
  snack: number
}

interface TrackCaloriesOutput {
  success: boolean
  result?: {
    date: string
    calories_consumed: number
    calorie_goal: number
    remaining_calories: number
    progress_percent: number
    meal_breakdown: MealBreakdown
    goal_type?: string
  }
  error?: string
}

/**
 * Calculate daily calorie goal based on goal type
 * Uses standard TDEE adjustments for different goals
 *
 * @param goalType - Type of fitness goal
 * @returns Estimated daily calorie goal
 */
function calculateCalorieGoal(goalType: string): number {
  // These are example values - in production you'd calculate based on user's
  // weight, height, age, activity level, etc.
  const baseTDEE = 2000 // Total Daily Energy Expenditure

  switch (goalType) {
    case 'weight_loss':
      return Math.round(baseTDEE * 0.8) // 20% deficit
    case 'muscle_gain':
      return Math.round(baseTDEE * 1.1) // 10% surplus
    case 'maintenance':
    default:
      return baseTDEE
  }
}

/**
 * Get daily nutrition totals from food logs
 *
 * @param logs - Array of food log entries
 * @returns Total calories and meal breakdown
 */
function getDailyNutrition(logs: any[]): { total_calories: number; meal_breakdown: MealBreakdown } {
  const breakdown: MealBreakdown = {
    breakfast: 0,
    lunch: 0,
    dinner: 0,
    snack: 0
  }

  const totalCalories = logs.reduce((total: number, log: any) => {
    const calories = log.nutrition?.calories || 0
    const mealType = log.meal_type as keyof MealBreakdown

    if (mealType in breakdown) {
      breakdown[mealType] += calories
    }

    return total + calories
  }, 0)

  return {
    total_calories: Math.round(totalCalories),
    meal_breakdown: {
      breakfast: Math.round(breakdown.breakfast),
      lunch: Math.round(breakdown.lunch),
      dinner: Math.round(breakdown.dinner),
      snack: Math.round(breakdown.snack)
    }
  }
}

/**
 * Track daily calorie intake and compare to goals
 *
 * @param input - Tracking parameters
 * @param context - Tool execution context
 * @returns Calorie tracking summary with meal breakdown
 */
export default async function trackCalories(
  input: TrackCaloriesInput,
  context: ToolContext
): Promise<TrackCaloriesOutput> {
  try {
    const date = input.date || new Date().toISOString().split('T')[0]

    logger.info('Tracking calories', { date, goal_type: input.goal_type })

    const dataLayer = getData(context)

    // Query nutrition logs for the specified date
    const allLogs = await dataLayer.list('nutrition_logs', context.spaceId)

    const logsForDate = allLogs.filter((log: any) => {
      const logDate = log.logged_at?.split('T')[0] || log.created_at?.split('T')[0]
      return logDate === date
    })

    logger.debug('Found food logs for date', { count: logsForDate.length })

    // Calculate daily nutrition
    const { total_calories, meal_breakdown } = getDailyNutrition(logsForDate)

    // Determine calorie goal
    let calorieGoal = input.calorie_goal

    if (!calorieGoal && input.goal_type) {
      calorieGoal = calculateCalorieGoal(input.goal_type)
      logger.debug('Calculated calorie goal', { goal_type: input.goal_type, goal: calorieGoal })
    } else if (!calorieGoal) {
      calorieGoal = 2000 // Default goal
    }

    // Calculate progress
    const remainingCalories = calorieGoal - total_calories
    const progressPercent = Math.min(Math.round((total_calories / calorieGoal) * 100), 100)

    logger.info('Calorie tracking complete', {
      consumed: total_calories,
      goal: calorieGoal,
      remaining: remainingCalories
    })

    return {
      success: true,
      result: {
        date,
        calories_consumed: total_calories,
        calorie_goal: calorieGoal,
        remaining_calories: remainingCalories,
        progress_percent: progressPercent,
        meal_breakdown,
        goal_type: input.goal_type
      }
    }

  } catch (error) {
    logger.error('Failed to track calories', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to track calorie intake'
    }
  }
}
