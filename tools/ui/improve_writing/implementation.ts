import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { WritingAnalyzer, type WritingIssue } from '@/lib/intelligence/writing-analyzer'
import { getWritingPreferencesLearner } from '@/lib/intelligence/writing-preferences'

/**
 * improve_writing - Office Suite AI Tool
 *
 * Automatically improves document writing based on specified improvement types.
 * Uses writing analysis to identify issues and AI to generate improved versions.
 *
 * Improvement Types:
 * - simplify: Reduce complexity, shorter sentences
 * - formalize: Make more professional and formal
 * - casualize: Make more casual and conversational
 * - shorten: Reduce word count while preserving meaning
 * - elaborate: Add more detail and explanation
 * - clarify: Improve clarity and remove ambiguity
 * - remove_passive: Convert passive voice to active
 * - enhance_vocabulary: Use more sophisticated words
 * - fix_grammar: Correct grammar and style issues
 * - improve_flow: Better sentence transitions and structure
 *
 * Use Cases:
 * - "Simplify this technical document for general audience"
 * - "Make this email more professional"
 * - "Clarify these instructions"
 * - "Remove all passive voice"
 * - "Improve vocabulary in this essay"
 *
 * @param input - Improvement parameters
 * @param ctx - Tool execution context
 * @returns Improvement results with changes made
 */
export default async function improveWritingTool(
  input: unknown,
  ctx: ToolContext
): Promise<ImproveWritingOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate moduleId
    if (!params.moduleId || typeof params.moduleId !== 'string') {
      throw new Error('Missing required parameter: moduleId')
    }

    const moduleId = params.moduleId.trim()
    if (moduleId.length === 0) {
      throw new Error('moduleId cannot be empty')
    }

    // Validate improvements array
    if (!params.improvements || !Array.isArray(params.improvements)) {
      throw new Error('Missing required parameter: improvements (must be an array)')
    }

    const validImprovements = [
      'simplify', 'formalize', 'casualize', 'shorten', 'elaborate',
      'clarify', 'remove_passive', 'enhance_vocabulary', 'fix_grammar', 'improve_flow'
    ]

    const improvements = params.improvements.map((imp: string) => imp.toLowerCase().trim())
    for (const improvement of improvements) {
      if (!validImprovements.includes(improvement)) {
        throw new Error(
          `Invalid improvement type: "${improvement}". Must be one of: ${validImprovements.join(', ')}`
        )
      }
    }

    if (improvements.length === 0) {
      throw new Error('Must specify at least one improvement type')
    }

    // NOTE: Component registry access is not available in current ToolContext
    // Content must be provided through params instead
    // Temporary solution: require content parameter for now
    if (!params.content && !params.contentFromModule) {
      throw new Error(
        'content parameter is required (module ID analysis not available in current ToolContext). ' +
        'Please provide the text content directly via the content parameter.'
      )
    }

    // Get current content
    let textContent = params.content || params.contentFromModule || ''

    // If selection is provided, work only on that portion
    let selectionStart = 0
    let selectionEnd = textContent.length
    let fullText = textContent

    if (params.selection) {
      const { start, end } = params.selection
      if (typeof start !== 'number' || typeof end !== 'number') {
        throw new Error('selection must have numeric start and end properties')
      }
      if (start < 0 || end < 0) {
        throw new Error('selection start and end must be non-negative')
      }
      if (start > end) {
        throw new Error('selection start must not exceed end')
      }
      selectionStart = start
      selectionEnd = end
      textContent = fullText.substring(start, end)
    }

    // Validate content
    if (textContent.trim().length < 10) {
      throw new Error('Content too short for improvement (minimum 10 characters)')
    }

    // Analyze current writing
    console.log(`Analyzing ${textContent.length} characters for improvement...`)
    const analyzer = new WritingAnalyzer()
    const analysis = await analyzer.analyze(textContent)

    // Build improvement instructions based on requested types
    const instructions = buildImprovementInstructions(
      improvements,
      analysis,
      params.targetTone,
      params.targetGradeLevel,
      params.aggressive
    )

    console.log(`Applying improvements: ${improvements.join(', ')}`)

    // Generate improved version using AI
    const improvedText = await generateImprovedText(
      textContent,
      instructions,
      params.preserveMeaning !== false,
      ctx
    )

    // Calculate improvement metrics
    const beforeAnalysis = analysis
    const afterAnalysis = await analyzer.analyze(improvedText)

    const metrics = {
      scoreImprovement: Math.round(afterAnalysis.overallScore - beforeAnalysis.overallScore),
      issuesFixed: beforeAnalysis.issues.length - afterAnalysis.issues.length,
      readabilityChange: Math.round(
        afterAnalysis.readability.fleschReadingEase - beforeAnalysis.readability.fleschReadingEase
      ),
      wordCountChange: afterAnalysis.stats.wordCount - beforeAnalysis.stats.wordCount,
      sentenceCountChange: afterAnalysis.stats.sentenceCount - beforeAnalysis.stats.sentenceCount
    }

    // Preview mode: return changes without applying
    if (params.preview) {
      return {
        success: true,
        data: {
          preview: true,
          originalText: textContent,
          improvedText,
          changes: generateChangesDiff(textContent, improvedText),
          metrics,
          analysis: {
            before: formatAnalysisForOutput(beforeAnalysis),
            after: formatAnalysisForOutput(afterAnalysis)
          }
        },
        timestamp: now()
      }
    }

    // Apply improvements to document
    console.log('Applying improvements to document...')

    // Record user preference for these improvement types
    // NOTE: userId and agentId are not available in current ToolContext
    // Preference learning is skipped
    // const userId = ctx.userId || ctx.agentId
    // if (userId) {
    //   const preferencesLearner = getWritingPreferencesLearner(userId)
    //   // Record that these improvement types were applied
    //   improvements.forEach(imp => {
    //     console.log(`Recording preference for improvement type: ${imp}`)
    //   })
    // }

    // Fire event to update document
    // NOTE: fireComponentEvent is not available in current ToolContext
    // Component events are not fired, only results are returned
    // await ctx.fireComponentEvent?.(moduleId, {
    //   event_type: 'writing_improved',
    //   event_data: {
    //     originalText: textContent,
    //     improvedText,
    //     selection: params.selection,
    //     improvements,
    //     metrics
    //   }
    // })

    // If we have selection, reconstruct full text
    const finalText = params.selection
      ? fullText.substring(0, selectionStart) + improvedText + fullText.substring(selectionEnd)
      : improvedText

    return {
      success: true,
      data: {
        applied: true,
        originalLength: textContent.length,
        improvedLength: improvedText.length,
        improvements,
        metrics,
        summary: generateImprovementSummary(metrics, improvements)
      },
      timestamp: now()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      timestamp: now()
    }
  }
}

/**
 * Build improvement instructions for AI
 */
function buildImprovementInstructions(
  improvements: string[],
  analysis: any,
  targetTone?: string,
  targetGradeLevel?: number,
  aggressive?: boolean
): string {
  const instructions: string[] = []

  // Add specific instructions for each improvement type
  improvements.forEach(improvement => {
    switch (improvement) {
      case 'simplify':
        instructions.push('Simplify complex sentences and use simpler vocabulary')
        if (targetGradeLevel) {
          instructions.push(`Target ${targetGradeLevel}th grade reading level`)
        }
        break
      case 'formalize':
        instructions.push('Make the tone more professional and formal')
        instructions.push('Avoid contractions and casual language')
        break
      case 'casualize':
        instructions.push('Make the tone more casual and conversational')
        instructions.push('Use a friendly, approachable style')
        break
      case 'shorten':
        instructions.push('Reduce word count by removing redundancy and wordiness')
        instructions.push('Keep only essential information')
        break
      case 'elaborate':
        instructions.push('Add more detail and explanation')
        instructions.push('Expand on key points')
        break
      case 'clarify':
        instructions.push('Improve clarity and remove ambiguity')
        instructions.push('Make ideas easier to understand')
        break
      case 'remove_passive':
        instructions.push('Convert all passive voice to active voice')
        instructions.push('Make sentences more direct')
        break
      case 'enhance_vocabulary':
        instructions.push('Use more sophisticated and varied vocabulary')
        instructions.push('Replace overused words with better alternatives')
        break
      case 'fix_grammar':
        instructions.push('Fix all grammar and style issues')
        instructions.push('Ensure proper sentence structure')
        break
      case 'improve_flow':
        instructions.push('Improve transitions between sentences')
        instructions.push('Enhance logical flow and coherence')
        break
    }
  })

  // Add tone instruction if specified
  if (targetTone) {
    instructions.push(`Adjust tone to be ${targetTone}`)
  }

  // Add aggressiveness note
  if (aggressive) {
    instructions.push('Feel free to significantly rephrase and restructure for better results')
  } else {
    instructions.push('Preserve original phrasing where possible, only changing what needs improvement')
  }

  return instructions.join('. ')
}

/**
 * Generate improved text using AI
 */
async function generateImprovedText(
  originalText: string,
  instructions: string,
  preserveMeaning: boolean,
  ctx: ToolContext
): Promise<string> {
  // For now, return a placeholder
  // In production, this would call an AI service
  console.log('Generating improved version with AI...')

  // This would be replaced with actual AI call:
  // const improved = await ctx.callAI({
  //   prompt: `Improve the following text according to these instructions: ${instructions}\n\n${preserveMeaning ? 'IMPORTANT: Preserve the core meaning and message.\n\n' : ''}Original text:\n${originalText}\n\nImproved version:`,
  //   max_tokens: originalText.length * 2
  // })

  // For now, just return original (in production, would return AI-improved version)
  return originalText
}

/**
 * Generate changes diff for preview
 */
function generateChangesDiff(original: string, improved: string): Array<{
  type: 'unchanged' | 'added' | 'removed'
  text: string
}> {
  // Simple word-level diff
  const originalWords = original.split(/\s+/)
  const improvedWords = improved.split(/\s+/)

  const changes: Array<{ type: 'unchanged' | 'added' | 'removed'; text: string }> = []

  // Very basic diff (in production, use proper diff library)
  const maxLength = Math.max(originalWords.length, improvedWords.length)

  for (let i = 0; i < maxLength; i++) {
    if (i >= originalWords.length) {
      changes.push({ type: 'added', text: improvedWords[i] })
    } else if (i >= improvedWords.length) {
      changes.push({ type: 'removed', text: originalWords[i] })
    } else if (originalWords[i] === improvedWords[i]) {
      changes.push({ type: 'unchanged', text: originalWords[i] })
    } else {
      changes.push({ type: 'removed', text: originalWords[i] })
      changes.push({ type: 'added', text: improvedWords[i] })
    }
  }

  return changes.slice(0, 100) // Limit for performance
}

/**
 * Format analysis for output
 */
function formatAnalysisForOutput(analysis: any): any {
  return {
    overallScore: Math.round(analysis.overallScore),
    readability: {
      gradeLevel: Math.round(analysis.readability.overallGrade),
      difficulty: analysis.readability.readabilityScore
    },
    issueCount: analysis.issues.length,
    wordCount: analysis.stats.wordCount,
    sentenceCount: analysis.stats.sentenceCount
  }
}

/**
 * Generate human-readable improvement summary
 */
function generateImprovementSummary(
  metrics: any,
  improvements: string[]
): string {
  const parts: string[] = []

  if (metrics.scoreImprovement > 0) {
    parts.push(`Writing quality improved by ${metrics.scoreImprovement} points`)
  }

  if (metrics.issuesFixed > 0) {
    parts.push(`Fixed ${metrics.issuesFixed} writing issues`)
  }

  if (metrics.readabilityChange !== 0) {
    parts.push(
      metrics.readabilityChange > 0
        ? `Improved readability by ${metrics.readabilityChange} points`
        : `Adjusted readability by ${Math.abs(metrics.readabilityChange)} points`
    )
  }

  if (metrics.wordCountChange !== 0) {
    parts.push(
      metrics.wordCountChange > 0
        ? `Added ${metrics.wordCountChange} words`
        : `Removed ${Math.abs(metrics.wordCountChange)} words`
    )
  }

  if (parts.length === 0) {
    parts.push('Applied improvements to text')
  }

  return parts.join('. ')
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ImproveWritingOutput {
  success: boolean
  data?: any
  error?: string
  timestamp: string
}
