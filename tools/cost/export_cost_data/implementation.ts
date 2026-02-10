/**
 * Export Cost Data Tool Implementation
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import { generateCostReport } from '@/lib/cost-management/cost-reporting'

interface ExportCostDataInput {
  user_id?: string
  date_from: string
  date_to: string
  format?: 'json' | 'csv'
  group_by?: 'day' | 'week' | 'conversation'
}

export default async function export_cost_data(input: ExportCostDataInput, context: ToolContext) {
  try {
    const userId = input.user_id || 'default'
    const format = input.format || 'csv'
    const groupBy = input.group_by || 'conversation'

    // Generate detailed report
    const report = await generateCostReport(
      userId,
      input.date_from,
      input.date_to,
      groupBy === 'day' ? 'day' : groupBy === 'week' ? 'week' : undefined,
      context
    )

    // Prepare export data
    let exportData: any
    let rowCount = 0

    if (groupBy === 'conversation') {
      // Export individual conversations
      exportData = report.top_expenses // This has all conversations, not just top
      rowCount = report.top_expenses.length
    } else if (groupBy === 'day' && report.breakdown.by_day) {
      // Export daily aggregates
      exportData = Object.entries(report.breakdown.by_day).map(([date, cost]) => ({
        date,
        cost_usd: cost,
        period: 'day'
      }))
      rowCount = exportData.length
    } else if (groupBy === 'week' && report.breakdown.by_week) {
      // Export weekly aggregates
      exportData = Object.entries(report.breakdown.by_week).map(([week, cost]) => ({
        week,
        cost_usd: cost,
        period: 'week'
      }))
      rowCount = exportData.length
    }

    // Generate file content
    let fileContent: string
    if (format === 'csv') {
      fileContent = generateCSV(exportData, groupBy)
    } else {
      fileContent = JSON.stringify(exportData, null, 2)
    }

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `export_${timestamp}.${format}`

    // Use writeText for file writing
    await context.writeText('global', 'cost_management', 'exports', userId, filename, fileContent)

    const filePath = context.resolvePath('global', 'cost_management', 'exports', userId, filename)

    return {
      success: true,
      file_path: filePath,
      format,
      row_count: rowCount,
      total_cost: report.total_cost_usd,
      message: `Exported ${rowCount} rows to ${filePath}`,
      summary: formatExportSummary(filePath, format, rowCount, report.total_cost_usd)
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: 'Failed to export cost data'
    }
  }
}

function generateCSV(data: any[], groupBy: string): string {
  if (!data || data.length === 0) {
    return 'No data to export'
  }

  const lines: string[] = []

  if (groupBy === 'conversation') {
    // CSV header for conversations
    lines.push('conversation_id,agent_slug,cost_usd,tokens,date,type')

    // CSV rows
    for (const item of data) {
      lines.push(
        `"${item.conversation_id}","${item.agent_slug}",${item.cost_usd},${item.tokens},"${item.date}","${item.type}"`
      )
    }
  } else if (groupBy === 'day') {
    // CSV header for daily data
    lines.push('date,cost_usd,period')

    // CSV rows
    for (const item of data) {
      lines.push(`"${item.date}",${item.cost_usd},"${item.period}"`)
    }
  } else if (groupBy === 'week') {
    // CSV header for weekly data
    lines.push('week,cost_usd,period')

    // CSV rows
    for (const item of data) {
      lines.push(`"${item.week}",${item.cost_usd},"${item.period}"`)
    }
  }

  return lines.join('\n')
}

function formatExportSummary(
  filePath: string,
  format: string,
  rowCount: number,
  totalCost: number
): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push('COST DATA EXPORT')
  lines.push('='.repeat(60))
  lines.push('')
  lines.push(`File Path:   ${filePath}`)
  lines.push(`Format:      ${format.toUpperCase()}`)
  lines.push(`Rows:        ${rowCount}`)
  lines.push(`Total Cost:  $${totalCost.toFixed(2)}`)
  lines.push('')
  lines.push('✓ Export completed successfully')
  lines.push('')
  lines.push('You can now:')
  lines.push('  • Open in Excel or Google Sheets')
  lines.push('  • Import into BI tools')
  lines.push('  • Perform custom analysis')
  lines.push('')
  lines.push('='.repeat(60))

  return lines.join('\n')
}
