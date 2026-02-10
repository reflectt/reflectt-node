/**
 * Layout Optimization Tool
 *
 * Analyzes the current UI layout state and provides actionable recommendations
 * for improving UX, performance, mobile compatibility, and accessibility.
 */

import { useLayoutStore, LayoutMode } from '@/lib/ui-control/layout-store'
import { layoutAnalyzer } from '@/lib/ui-control/layout-analyzer'

interface OptimizationInput {
  focus?: 'mobile' | 'desktop' | 'performance' | 'accessibility' | 'general'
  applyRecommendations?: boolean
}

interface LayoutIssue {
  severity: 'error' | 'warning' | 'suggestion' | 'info'
  issue: string
  recommendation: string
  impact?: string
}

interface Optimization {
  type: string
  action: string
  rationale: string
  safeToApply: boolean
}

interface OptimizationResult {
  success: boolean
  analysis: {
    issues: LayoutIssue[]
    optimizations: Optimization[]
  }
  applied?: string[]
  recommendations?: Optimization[]
}

/**
 * Get all component types from slot configuration
 */
function getAllComponentTypes(slots: any): string[] {
  const types: string[] = []

  Object.values(slots).forEach((slot: any) => {
    if (slot.modules && Array.isArray(slot.modules)) {
      slot.modules.forEach((module: any) => {
        if (module.componentId) {
          types.push(module.componentId)
        }
      })
    }
  })

  return types
}

/**
 * Find which slot a module is in
 */
function findSlotForModule(moduleId: string, slots: any): string | null {
  for (const [slotName, slotConfig] of Object.entries(slots)) {
    const slot = slotConfig as any
    if (slot.modules && Array.isArray(slot.modules)) {
      if (slot.modules.some((m: any) => m.id === moduleId)) {
        return slotName
      }
    }
  }
  return null
}

/**
 * Optimize layout based on current state and focus area
 */
export async function optimizeLayout(input: OptimizationInput): Promise<OptimizationResult> {
  const layoutState = useLayoutStore.getState()
  const { mode, slots } = layoutState

  const issues: LayoutIssue[] = []
  const optimizations: Optimization[] = []

  console.log('[Optimize Layout] Analyzing layout:', { mode, focus: input.focus })

  // Count components in each slot
  const componentCount = Object.values(slots).reduce((sum, slot: any) =>
    sum + (slot.modules?.length || 0), 0
  )

  const slotCounts: Record<string, number> = {}
  Object.entries(slots).forEach(([slotName, slotConfig]: [string, any]) => {
    slotCounts[slotName] = slotConfig.modules?.length || 0
  })

  console.log('[Optimize Layout] Component distribution:', slotCounts, 'total:', componentCount)

  // ============================================
  // Issue 1: Too many components in one slot
  // ============================================
  Object.entries(slots).forEach(([slotName, slotConfig]: [string, any]) => {
    if (slotConfig.modules && slotConfig.modules.length > 3) {
      issues.push({
        severity: 'warning',
        issue: `${slotName} slot has ${slotConfig.modules.length} components`,
        recommendation: mode !== 'dashboard'
          ? 'Consider switching to dashboard mode for better organization'
          : 'Consider using tabs or accordion to group related components',
        impact: 'Cluttered UI, harder to focus on specific content'
      })

      if (mode !== 'dashboard' && mode !== 'tabs') {
        optimizations.push({
          type: 'change_layout',
          action: 'Switch to dashboard or tabs layout',
          rationale: 'Multiple components benefit from grid or tab organization',
          safeToApply: false // Requires user confirmation
        })
      }
    }
  })

  // ============================================
  // Issue 2: Empty slots consuming space
  // ============================================
  const emptySlots = Object.entries(slots).filter(([_, slot]: [string, any]) =>
    slot.visible && (!slot.modules || slot.modules.length === 0)
  )

  if (emptySlots.length > 0) {
    issues.push({
      severity: 'info',
      issue: `${emptySlots.length} empty slot${emptySlots.length > 1 ? 's are' : ' is'} visible`,
      recommendation: 'Hide empty slots to reduce clutter',
      impact: 'Wasted screen space, visual gaps'
    })

    optimizations.push({
      type: 'hide_empty_slots',
      action: `Hide ${emptySlots.length} empty slot${emptySlots.length > 1 ? 's' : ''} automatically`,
      rationale: 'Reduces visual clutter and maximizes usable space',
      safeToApply: true
    })
  }

  // ============================================
  // Issue 3: Layout mode mismatch
  // ============================================
  const componentTypes = getAllComponentTypes(slots)
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1440
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900

  const recommendations = layoutAnalyzer.recommendLayout({
    componentTypes,
    componentCount,
    viewportWidth,
    viewportHeight
  })

  const topRecommendation = recommendations[0]

  if (topRecommendation && topRecommendation.mode !== mode && topRecommendation.score > 80) {
    issues.push({
      severity: 'suggestion',
      issue: `Current layout (${mode}) may not be optimal`,
      recommendation: `Consider ${topRecommendation.mode} layout (confidence: ${Math.round(topRecommendation.confidence * 100)}%)`,
      impact: topRecommendation.reasons.join(', ')
    })

    optimizations.push({
      type: 'change_layout',
      action: `Switch to ${topRecommendation.mode} layout`,
      rationale: topRecommendation.reasons.join('. '),
      safeToApply: false // Layout changes should be explicit
    })
  }

  // ============================================
  // Issue 4: Mobile compatibility (if focus is mobile or general)
  // ============================================
  if (input.focus === 'mobile' || input.focus === 'general') {
    if (viewportWidth < 768) {
      if (mode === 'three-column') {
        issues.push({
          severity: 'error',
          issue: 'Three-column layout is not suitable for mobile',
          recommendation: 'Switch to standard, feed, or sidebar-focus layout for mobile',
          impact: 'Horizontal scrolling, cramped columns, poor UX'
        })

        optimizations.push({
          type: 'change_layout',
          action: 'Switch to mobile-friendly layout (standard or feed)',
          rationale: 'Three-column layouts require too much horizontal space on mobile',
          safeToApply: false
        })
      }

      if (mode === 'split' && componentCount > 2) {
        issues.push({
          severity: 'warning',
          issue: 'Split layout with multiple components on mobile',
          recommendation: 'Use tabs or standard layout instead',
          impact: 'Content is too small to read comfortably'
        })
      }

      if (mode === 'board') {
        issues.push({
          severity: 'warning',
          issue: 'Board layout on mobile requires horizontal scrolling',
          recommendation: 'Consider feed or standard layout for mobile',
          impact: 'Difficult to view all columns at once'
        })
      }
    }
  }

  // ============================================
  // Issue 5: Performance issues
  // ============================================
  if (input.focus === 'performance' || input.focus === 'general') {
    if (componentCount > 8) {
      issues.push({
        severity: 'warning',
        issue: `${componentCount} components rendered simultaneously`,
        recommendation: 'Consider using tabs or lazy loading to improve performance',
        impact: 'Slower initial render, higher memory usage'
      })

      if (mode !== 'tabs') {
        optimizations.push({
          type: 'change_layout',
          action: 'Switch to tabs layout to virtualize components',
          rationale: 'Only active tab content is rendered, improving performance',
          safeToApply: false
        })
      }
    }

    // Check for heavy components
    const heavyComponents = componentTypes.filter(id =>
      id.includes('3d') || id.includes('video') || id.includes('game')
    )

    if (heavyComponents.length > 1) {
      issues.push({
        severity: 'warning',
        issue: `${heavyComponents.length} resource-intensive components active`,
        recommendation: 'Use tabs or split views to load heavy components on-demand',
        impact: 'High memory and CPU usage'
      })
    }
  }

  // ============================================
  // Issue 6: Desktop optimization
  // ============================================
  if (input.focus === 'desktop' || input.focus === 'general') {
    if (viewportWidth >= 1440 && componentCount >= 3) {
      if (mode === 'standard' || mode === 'feed') {
        issues.push({
          severity: 'suggestion',
          issue: 'Large screen with multiple components using simple layout',
          recommendation: 'Consider dashboard, three-column, or board layout',
          impact: 'Not utilizing available screen space efficiently'
        })

        optimizations.push({
          type: 'change_layout',
          action: 'Switch to dashboard or three-column for better space utilization',
          rationale: 'Wide screens benefit from multi-column layouts',
          safeToApply: false
        })
      }
    }
  }

  // ============================================
  // Issue 7: Accessibility concerns
  // ============================================
  if (input.focus === 'accessibility' || input.focus === 'general') {
    // Check for too many nested components
    const maxDepth = Math.max(...Object.values(slotCounts))
    if (maxDepth > 5) {
      issues.push({
        severity: 'warning',
        issue: 'Deep component nesting detected',
        recommendation: 'Simplify layout hierarchy for better screen reader navigation',
        impact: 'Difficult for assistive technology users to navigate'
      })
    }

    // Check if focus mode would help
    if (componentCount > 4 && mode !== 'sidebar-focus' && mode !== 'fullscreen') {
      issues.push({
        severity: 'info',
        issue: 'Multiple components competing for attention',
        recommendation: 'Consider sidebar-focus or fullscreen mode for concentrated tasks',
        impact: 'Reduced focus, harder to accomplish single tasks'
      })
    }
  }

  // ============================================
  // Apply safe optimizations if requested
  // ============================================
  if (input.applyRecommendations) {
    const applied: string[] = []

    // Only apply safe optimizations (safeToApply: true)
    const safeOptimizations = optimizations.filter(opt => opt.safeToApply)

    for (const opt of safeOptimizations) {
      if (opt.type === 'hide_empty_slots') {
        emptySlots.forEach(([slotName, _]) => {
          useLayoutStore.getState().actions.setSlots({
            [slotName]: { visible: false }
          })
          applied.push(`Hidden empty ${slotName} slot`)
        })
      }
    }

    console.log('[Optimize Layout] Applied optimizations:', applied)

    return {
      success: true,
      analysis: { issues, optimizations },
      applied
    }
  }

  // Return analysis without applying changes
  return {
    success: true,
    analysis: {
      issues: issues.sort((a, b) => {
        const severityOrder = { error: 0, warning: 1, suggestion: 2, info: 3 }
        return severityOrder[a.severity] - severityOrder[b.severity]
      }),
      optimizations
    },
    recommendations: optimizations.slice(0, 5)
  }
}
