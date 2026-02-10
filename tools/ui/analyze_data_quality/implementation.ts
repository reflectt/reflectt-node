import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'
import { useLayoutStore } from '@/lib/ui-control/layout-store'
import { dataQualityAnalyzer, type DataQualityAnalysis, type QualityIssue } from '@/lib/intelligence/data-quality'

interface AnalyzeDataQualityInput {
  componentId?: string
  analysisType?: 'full' | 'quick' | 'column' | 'sample'
  columns?: string[]
  sampleSize?: number
  detectionLevel?: 'strict' | 'normal' | 'lenient'
  autoFix?: boolean
  enableOutlierDetection?: boolean
  enableDuplicateDetection?: boolean
}

interface ComponentAnalysis {
  componentId: string
  componentType: string
  analysis: DataQualityAnalysis
  autoFixResults?: {
    fixedCount: number
    unfixedCount: number
    fixedIssues: QualityIssue[]
  }
}

interface AnalyzeDataQualitySuccess {
  success: true
  analyses: ComponentAnalysis[]
  summary: {
    totalComponents: number
    averageQualityScore: number
    totalIssues: number
    criticalIssues: number
    autoFixedIssues: number
  }
  recommendations: string[]
}

interface AnalyzeDataQualityFailure {
  success: false
  error: string
}

type AnalyzeDataQualityOutput = AnalyzeDataQualitySuccess | AnalyzeDataQualityFailure

export default async function analyzeDataQuality(
  input: AnalyzeDataQualityInput,
  ctx: ToolContext
): Promise<AnalyzeDataQualityOutput> {
  try {
    const {
      componentId,
      analysisType = 'full',
      columns: specificColumns,
      sampleSize,
      detectionLevel = 'normal',
      autoFix = false,
      enableOutlierDetection = true,
      enableDuplicateDetection = true,
    } = input

    // Get target components from context bus
    let targetContexts = contextBus.query(() => true)

    // Filter by component ID if specified
    if (componentId) {
      targetContexts = targetContexts.filter((c) => c.id === componentId)
      if (targetContexts.length === 0) {
        return {
          success: false,
          error: `Component with ID "${componentId}" not found`,
        }
      }
    } else {
      // Filter to only table/grid components
      targetContexts = targetContexts.filter(
        (c) =>
          c.type === 'query_results_table' ||
          c.type === 'data_grid' ||
          c.type === 'data_table'
      )
    }

    if (targetContexts.length === 0) {
      return {
        success: false,
        error: 'No data table components found',
      }
    }

    // Get layout store to access component props
    const layoutState = useLayoutStore.getState()

    // Analyze each component
    const analyses: ComponentAnalysis[] = []

    for (const context of targetContexts) {
      // Get component data
      const data = context.data || []
      if (!Array.isArray(data) || data.length === 0) {
        continue // Skip components without data
      }

      // Get columns from component props or data
      let columns: Array<{ key: string; label?: string; type?: string }> = []

      // Try to get columns from layout store
      for (const [slotName, slotConfig] of Object.entries(layoutState.slots)) {
        const modules = slotConfig.modules || []
        const module = modules.find((m: any) => m.id === context.id)

        if (module && module.props && module.props.columns) {
          columns = module.props.columns
          break
        }
      }

      // Fallback: infer columns from data
      if (columns.length === 0 && data.length > 0) {
        const firstRow = data[0]
        columns = Object.keys(firstRow).map((key) => ({
          key,
          label: key,
        }))
      }

      if (columns.length === 0) {
        continue // Skip if we can't determine columns
      }

      // Determine analysis options based on analysis type
      const analysisOptions: any = {
        detectionLevel,
        enableAnomalyDetection: analysisType !== 'quick',
        enableFormatDetection: analysisType !== 'quick',
        enableOutlierDetection: analysisType !== 'quick' && enableOutlierDetection,
        enableDuplicateDetection: analysisType !== 'quick' && enableDuplicateDetection,
      }

      // Handle specific columns
      if (analysisType === 'column' && specificColumns) {
        analysisOptions.columns = specificColumns
      }

      // Handle sampling
      if (analysisType === 'sample' || (sampleSize && data.length > sampleSize)) {
        analysisOptions.sampleSize = sampleSize || Math.min(1000, Math.floor(data.length / 2))
      } else if (data.length > 5000) {
        // Auto-sample for very large datasets
        analysisOptions.sampleSize = 1000
      }

      // Perform analysis
      const analysis = dataQualityAnalyzer.analyze(data, columns, analysisOptions)

      const componentAnalysis: ComponentAnalysis = {
        componentId: context.id,
        componentType: context.type,
        analysis,
      }

      // Auto-fix if requested
      if (autoFix && analysis.issues.some((i) => i.autoFixable)) {
        const autoFixableIssues = analysis.issues.filter((i) => i.autoFixable)
        const { fixedData, fixedIssues, unfixedIssues } = dataQualityAnalyzer.autoFix(
          data,
          autoFixableIssues
        )

        componentAnalysis.autoFixResults = {
          fixedCount: fixedIssues.length,
          unfixedCount: unfixedIssues.length,
          fixedIssues,
        }

        // Update component data if fixes were applied
        if (fixedIssues.length > 0) {
          // Note: Actual data update would happen via patch_component_state
          // This is just recording what was fixed
          console.log(
            `[analyze_data_quality] Auto-fixed ${fixedIssues.length} issues in ${context.id}`
          )
        }
      }

      analyses.push(componentAnalysis)
    }

    if (analyses.length === 0) {
      return {
        success: false,
        error: 'No components with data found to analyze',
      }
    }

    // Calculate summary statistics
    const totalIssues = analyses.reduce((sum, a) => sum + a.analysis.issues.length, 0)
    const criticalIssues = analyses.reduce(
      (sum, a) => sum + a.analysis.summary.criticalIssues,
      0
    )
    const autoFixedIssues = analyses.reduce(
      (sum, a) => sum + (a.autoFixResults?.fixedCount || 0),
      0
    )
    const avgScore =
      analyses.reduce((sum, a) => sum + a.analysis.score.overall, 0) / analyses.length

    // Aggregate recommendations
    const allRecommendations = new Set<string>()
    analyses.forEach((a) => {
      a.analysis.recommendations.forEach((rec) => allRecommendations.add(rec))
    })

    // Add cross-component recommendations
    if (analyses.length > 1) {
      const scores = analyses.map((a) => a.analysis.score.overall)
      const minScore = Math.min(...scores)
      const maxScore = Math.max(...scores)

      if (maxScore - minScore > 30) {
        allRecommendations.add(
          `Inconsistent quality across components (range: ${minScore.toFixed(1)}-${maxScore.toFixed(1)}%). Standardize data quality processes.`
        )
      }
    }

    return {
      success: true,
      analyses,
      summary: {
        totalComponents: analyses.length,
        averageQualityScore: Math.round(avgScore * 10) / 10,
        totalIssues,
        criticalIssues,
        autoFixedIssues,
      },
      recommendations: Array.from(allRecommendations),
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
    }
  }
}
