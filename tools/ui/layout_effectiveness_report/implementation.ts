import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { layoutMetrics } from '@/lib/ui-control/layout-metrics'

type LayoutMode =
  | 'standard'
  | 'split'
  | 'sidebar-focus'
  | 'fullscreen'
  | 'dashboard'
  | 'master-detail'
  | 'app-shell'
  | 'three-column'
  | 'board'
  | 'feed'
  | 'tabs'
  | 'accordion'

/**
 * Layout Effectiveness Report Input
 */
interface LayoutEffectivenessReportInput {
  timeframe?: {
    start?: string // ISO date
    end?: string // ISO date
    period?: 'day' | 'week' | 'month' | 'all'
  }
  includeCharts?: boolean // Default: true
  compareLayouts?: LayoutMode[] // Specific layouts to compare
  format?: 'detailed' | 'summary' | 'json' // Default: 'detailed'
}

/**
 * Layout Effectiveness Report Tool
 *
 * Generates comprehensive reports on layout effectiveness with metrics,
 * insights, recommendations, and visual charts.
 */
export async function layout_effectiveness_report(
  input: LayoutEffectivenessReportInput,
  context: ToolContext
): Promise<any> {
  try {
    const spaceId = context.currentSpace

    // Parse timeframe
    const timeframe = input.timeframe ? {
      start: input.timeframe.start ? new Date(input.timeframe.start) : undefined,
      end: input.timeframe.end ? new Date(input.timeframe.end) : undefined,
      period: input.timeframe.period
    } : { period: 'all' as const }

    // Generate report
    const report = layoutMetrics.generateReport({
      timeframe,
      includeCharts: input.includeCharts ?? true,
      compareLayouts: input.compareLayouts
    })

    // Format based on requested format
    const format = input.format || 'detailed'

    if (format === 'summary') {
      return {
        success: true,
        report: {
          summary: report.summary,
          topInsights: report.insights.slice(0, 3),
          topRecommendations: report.recommendations.slice(0, 3),
          generatedAt: report.generatedAt,
          timeframe: report.timeframe
        },
        space_id: spaceId,
        timestamp: now()
      }
    }

    if (format === 'json') {
      return {
        success: true,
        report,
        space_id: spaceId,
        timestamp: now()
      }
    }

    // Detailed format (default)
    return {
      success: true,
      report: {
        summary: report.summary,
        insights: report.insights,
        recommendations: report.recommendations,
        topLayouts: Object.entries(report.layoutBreakdown)
          .sort(([, a], [, b]) => b.efficiencyScore - a.efficiencyScore)
          .slice(0, 5)
          .map(([layout, metrics]) => ({
            layout,
            efficiencyScore: metrics.efficiencyScore,
            totalSessions: metrics.totalSessions,
            avgSatisfaction: metrics.avgSatisfaction,
            taskCompletionRate: metrics.taskCompletionRate
          })),
        charts: input.includeCharts !== false ? report.charts : undefined,
        generatedAt: report.generatedAt,
        timeframe: report.timeframe
      },
      space_id: spaceId,
      timestamp: now()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: context.currentSpace,
      timestamp: now()
    }
  }
}
