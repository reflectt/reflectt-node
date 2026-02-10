/**
 * Recommend Chart Type Tool Handler
 *
 * Provides intelligent chart recommendations with data analysis
 */

import { getChartIntelligence, type ChartType } from '@/lib/intelligence/chart-intelligence'

export interface RecommendChartTypeInput {
  chartComponentId?: string
  data?: any[]
  columns?: string[]
  currentChartType?: ChartType
  includeEnhancements?: boolean
  includeInteractions?: boolean
  includeAnomalies?: boolean
  autoApply?: boolean
  maxRecommendations?: number
}

export interface RecommendChartTypeOutput {
  success: boolean
  recommendations: Array<{
    type: ChartType
    confidence: number
    reasoning: string[]
    dataMapping: {
      x?: string
      y?: string
      color?: string
      size?: string
      group?: string
    }
    config: any
  }>
  enhancements?: Array<{
    type: string
    reasoning: string
    priority: 'high' | 'medium' | 'low'
    config: any
  }>
  interactions?: Array<{
    type: string
    description: string
    enabled: boolean
    config: any
  }>
  anomalies?: Array<{
    index: number
    reason: string
    severity: 'low' | 'medium' | 'high'
    suggestedAction?: string
  }>
  dataCharacteristics: {
    rowCount: number
    columnCount: number
    distribution: string
    hasTimeSeries: boolean
    hasCategorical: boolean
    outlierCount: number
    correlationCount: number
  }
  autoApplied?: {
    applied: boolean
    chartType?: ChartType
    reason?: string
  }
  stats: {
    totalPreferences: number
    mostSelectedType: ChartType | null
  }
}

export async function handler(
  input: RecommendChartTypeInput
): Promise<RecommendChartTypeOutput> {
  const {
    data,
    currentChartType,
    includeEnhancements = true,
    includeInteractions = true,
    includeAnomalies = false,
    autoApply = false,
    maxRecommendations = 3
  } = input

  const chartIntelligence = getChartIntelligence()

  // If no data provided, return error
  if (!data || data.length === 0) {
    return {
      success: false,
      recommendations: [],
      dataCharacteristics: {
        rowCount: 0,
        columnCount: 0,
        distribution: 'uniform',
        hasTimeSeries: false,
        hasCategorical: false,
        outlierCount: 0,
        correlationCount: 0
      },
      stats: chartIntelligence.getStats()
    }
  }

  // Analyze data
  const characteristics = chartIntelligence.analyzeDataCharacteristics(data)

  // Get recommendations
  const recommendations = chartIntelligence.recommendChartTypes(data, characteristics)
    .slice(0, maxRecommendations)

  // Get enhancements if requested
  let enhancements: RecommendChartTypeOutput['enhancements'] = undefined
  if (includeEnhancements) {
    const chartToAnalyze = currentChartType
      ? { type: currentChartType }
      : recommendations[0]
        ? { type: recommendations[0].type }
        : { type: 'bar' as ChartType }

    enhancements = chartIntelligence.suggestChartEnhancements(chartToAnalyze, data)
  }

  // Get interactions if requested
  let interactions: RecommendChartTypeOutput['interactions'] = undefined
  if (includeInteractions) {
    const chartType = currentChartType || recommendations[0]?.type || 'bar'
    interactions = chartIntelligence.suggestInteractions(chartType, data)
  }

  // Detect anomalies if requested
  let anomalies: RecommendChartTypeOutput['anomalies'] = undefined
  if (includeAnomalies) {
    const chartType = currentChartType || recommendations[0]?.type || 'bar'
    const detectedAnomalies = chartIntelligence.detectAnomalies(data, chartType)
    anomalies = detectedAnomalies.map(a => ({
      index: a.index,
      reason: a.reason,
      severity: a.severity,
      suggestedAction: a.suggestedAction
    }))
  }

  // Auto-apply if confidence is high
  let autoApplied: RecommendChartTypeOutput['autoApplied'] = undefined
  if (autoApply && recommendations.length > 0 && recommendations[0].confidence >= 90) {
    autoApplied = {
      applied: true,
      chartType: recommendations[0].type,
      reason: `High confidence (${recommendations[0].confidence}%) - ${recommendations[0].reasoning[0]}`
    }
  } else if (autoApply) {
    autoApplied = {
      applied: false,
      reason: recommendations.length > 0
        ? `Confidence (${recommendations[0].confidence}%) below threshold (90%)`
        : 'No recommendations available'
    }
  }

  const stats = chartIntelligence.getStats()

  return {
    success: true,
    recommendations: recommendations.map(r => ({
      type: r.type,
      confidence: r.confidence,
      reasoning: r.reasoning,
      dataMapping: r.dataMapping,
      config: r.config
    })),
    enhancements,
    interactions,
    anomalies,
    dataCharacteristics: {
      rowCount: characteristics.rowCount,
      columnCount: characteristics.columnCount,
      distribution: characteristics.distribution,
      hasTimeSeries: characteristics.temporal.length > 0,
      hasCategorical: characteristics.categorical.length > 0,
      outlierCount: characteristics.outliers.length,
      correlationCount: characteristics.correlations.length
    },
    autoApplied,
    stats: {
      totalPreferences: stats.totalPreferences,
      mostSelectedType: stats.mostSelectedType
    }
  }
}
