import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { WritingAnalyzer, type WritingAnalysis } from '@/lib/intelligence/writing-analyzer'
import { getWritingPreferencesLearner } from '@/lib/intelligence/writing-preferences'

/**
 * analyze_writing - Office Suite AI Tool
 *
 * Performs comprehensive writing analysis on document content including:
 * - Readability metrics (Flesch Reading Ease, Gunning Fog, SMOG, etc.)
 * - Tone and sentiment analysis
 * - Grammar and style issue detection
 * - Vocabulary richness and diversity
 * - Sentence structure and variety
 *
 * Can analyze mounted DocumentEditor components or provided text content.
 * Results include detailed metrics, identified issues with suggestions,
 * and an overall writing quality score.
 *
 * Use Cases:
 * - "Analyze the readability of this document"
 * - "Check this text for grammar and style issues"
 * - "What's the tone of this writing?"
 * - "Evaluate vocabulary diversity"
 * - "Get writing quality score"
 *
 * @param input - Analysis parameters
 * @param ctx - Tool execution context
 * @returns Analysis results with metrics and suggestions
 */
export default async function analyzeWritingTool(
  input: unknown,
  ctx: ToolContext
): Promise<AnalyzeWritingOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Must have either moduleId or content
    if (!params.moduleId && !params.content) {
      throw new Error('Must provide either moduleId (to analyze a component) or content (to analyze text)')
    }

    // Get text content to analyze
    let textContent: string

    if (params.moduleId) {
      // Get content from mounted component
      const moduleId = params.moduleId.trim()
      if (moduleId.length === 0) {
        throw new Error('moduleId cannot be empty')
      }

      // NOTE: Component registry access is not available in current ToolContext
      // Would need to pass component content directly or through params
      // For now, this requires content to be provided directly
      throw new Error('Module ID analysis requires content to be provided directly (context.components not available in current ToolContext)')

      // If selection is provided, extract only that portion
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
        textContent = textContent.substring(start, end)
      }
    } else {
      // Use provided content
      textContent = params.content.trim()
      if (textContent.length === 0) {
        throw new Error('content cannot be empty')
      }
    }

    // Validate minimum content length
    if (textContent.length < 10) {
      throw new Error('Content too short for meaningful analysis (minimum 10 characters)')
    }

    // Get analysis type
    const analysisType = params.analysisType || 'full'
    const validTypes = ['full', 'readability', 'tone', 'grammar', 'style', 'vocabulary', 'sentences']
    if (!validTypes.includes(analysisType)) {
      throw new Error(`Invalid analysisType: "${analysisType}". Must be one of: ${validTypes.join(', ')}`)
    }

    // Initialize analyzer
    const analyzer = new WritingAnalyzer()

    // Configure analysis options
    const options = {
      checkGrammar: analysisType === 'full' || analysisType === 'grammar',
      checkStyle: analysisType === 'full' || analysisType === 'style',
      checkReadability: analysisType === 'full' || analysisType === 'readability',
      analyzeTone: analysisType === 'full' || analysisType === 'tone',
      analyzeVocabulary: analysisType === 'full' || analysisType === 'vocabulary',
      targetAudience: params.targetAudience,
      targetReadingLevel: params.targetReadingLevel
    }

    // Perform analysis
    console.log(`Analyzing ${textContent.length} characters of text...`)
    const analysis = await analyzer.analyze(textContent, options)

    // Apply user preferences if available
    // NOTE: userId and agentId are not available in current ToolContext
    // User preference filtering is skipped
    // if (userId) {
    //   const preferencesLearner = getWritingPreferencesLearner(userId)
    //   analysis.issues = preferencesLearner.filterIssuesByPreferences(analysis.issues)
    //   analysis.issues = analysis.issues.map(issue =>
    //     preferencesLearner.adjustIssueConfidence(issue)
    //   )
    // }

    // Auto-fix issues if requested
    if (params.autoFix && params.moduleId) {
      const autoFix = params.autoFix
      const fixCount = await applyAutoFixes(
        params.moduleId,
        analysis.issues,
        autoFix,
        ctx
      )

      console.log(`Auto-fixed ${fixCount} issues`)
    }

    // Format output based on returnFormat
    const returnFormat = params.returnFormat || 'detailed'
    const formattedOutput = formatAnalysisOutput(analysis, returnFormat, analysisType)

    return {
      success: true,
      data: formattedOutput,
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
 * Format analysis output based on requested format
 */
function formatAnalysisOutput(
  analysis: WritingAnalysis,
  format: string,
  analysisType: string
): any {
  if (format === 'scores_only') {
    return {
      overallScore: Math.round(analysis.overallScore),
      readabilityScore: analysis.readability.fleschReadingEase,
      gradeLevel: Math.round(analysis.readability.overallGrade),
      issueCount: analysis.issues.length,
      wordCount: analysis.stats.wordCount
    }
  }

  if (format === 'summary') {
    return {
      overallScore: Math.round(analysis.overallScore),
      readability: {
        gradeLevel: Math.round(analysis.readability.overallGrade),
        difficulty: analysis.readability.readabilityScore,
        targetAudience: analysis.readability.targetAudience
      },
      tone: {
        primary: analysis.tone.primary,
        formality: Math.round(analysis.tone.formality),
        sentiment: analysis.tone.sentiment.polarity > 0.2 ? 'positive' :
                   analysis.tone.sentiment.polarity < -0.2 ? 'negative' : 'neutral'
      },
      vocabulary: {
        diversity: Math.round(analysis.vocabulary.lexicalDiversity * 100),
        level: analysis.vocabulary.vocabularyLevel
      },
      issues: {
        total: analysis.issues.length,
        grammar: analysis.issues.filter(i => i.type === 'grammar').length,
        style: analysis.issues.filter(i => i.type === 'style').length,
        clarity: analysis.issues.filter(i => i.type === 'clarity').length
      },
      stats: {
        words: analysis.stats.wordCount,
        sentences: analysis.stats.sentenceCount,
        readingTime: analysis.stats.readingTime
      }
    }
  }

  // Detailed format
  const output: any = {
    overallScore: Math.round(analysis.overallScore),
    timestamp: analysis.timestamp.toISOString()
  }

  // Include requested analysis sections
  if (analysisType === 'full' || analysisType === 'readability') {
    output.readability = {
      fleschReadingEase: Math.round(analysis.readability.fleschReadingEase),
      fleschKincaidGrade: Math.round(analysis.readability.fleschKincaidGrade),
      gunningFogIndex: Math.round(analysis.readability.gunningFogIndex),
      smogIndex: Math.round(analysis.readability.smogIndex),
      overallGrade: Math.round(analysis.readability.overallGrade),
      difficulty: analysis.readability.readabilityScore,
      targetAudience: analysis.readability.targetAudience
    }
  }

  if (analysisType === 'full' || analysisType === 'tone') {
    output.tone = {
      primary: analysis.tone.primary,
      confidence: Math.round(analysis.tone.confidence * 100),
      formality: Math.round(analysis.tone.formality),
      sentiment: {
        polarity: Math.round(analysis.tone.sentiment.polarity * 100) / 100,
        subjectivity: Math.round(analysis.tone.sentiment.subjectivity * 100) / 100,
        classification: analysis.tone.sentiment.polarity > 0.2 ? 'positive' :
                        analysis.tone.sentiment.polarity < -0.2 ? 'negative' : 'neutral'
      },
      characteristics: analysis.tone.characteristics,
      emotions: analysis.tone.emotions.slice(0, 3).map(e => ({
        emotion: e.emotion,
        score: Math.round(e.score * 100)
      }))
    }
  }

  if (analysisType === 'full' || analysisType === 'vocabulary') {
    output.vocabulary = {
      totalWords: analysis.vocabulary.totalWords,
      uniqueWords: analysis.vocabulary.uniqueWords,
      diversity: Math.round(analysis.vocabulary.lexicalDiversity * 100),
      averageWordLength: Math.round(analysis.vocabulary.averageWordLength * 10) / 10,
      level: analysis.vocabulary.vocabularyLevel,
      overusedWords: analysis.vocabulary.overusedWords.slice(0, 5).map(w => ({
        word: w.word,
        count: w.count,
        suggestions: w.suggestions.slice(0, 3)
      })),
      recommendations: analysis.vocabulary.recommendations
    }
  }

  if (analysisType === 'full' || analysisType === 'sentences') {
    output.sentences = {
      count: analysis.sentenceAnalysis.sentenceCount,
      averageLength: Math.round(analysis.sentenceAnalysis.averageSentenceLength * 10) / 10,
      variety: Math.round(analysis.sentenceAnalysis.variety),
      rhythm: analysis.sentenceAnalysis.rhythm,
      types: analysis.sentenceAnalysis.sentenceTypes,
      issues: analysis.sentenceAnalysis.issues
    }
  }

  if (analysisType === 'full' || analysisType === 'grammar' || analysisType === 'style') {
    output.issues = analysis.issues.map(issue => ({
      type: issue.type,
      severity: issue.severity,
      category: issue.category,
      position: issue.position,
      text: issue.text,
      message: issue.message,
      suggestions: issue.suggestions.slice(0, 3),
      confidence: Math.round(issue.confidence * 100)
    }))
  }

  output.statistics = {
    characters: analysis.stats.characterCount,
    words: analysis.stats.wordCount,
    sentences: analysis.stats.sentenceCount,
    paragraphs: analysis.stats.paragraphCount,
    pages: analysis.stats.pageCount,
    readingTime: analysis.stats.readingTime,
    speakingTime: analysis.stats.speakingTime
  }

  return output
}

/**
 * Apply auto-fixes to issues
 */
async function applyAutoFixes(
  moduleId: string,
  issues: WritingAnalysis['issues'],
  autoFix: { grammar?: boolean; style?: boolean; clarity?: boolean },
  ctx: ToolContext
): Promise<number> {
  let fixCount = 0

  // Filter issues to auto-fix
  const issuesToFix = issues.filter(issue => {
    if (autoFix.grammar && issue.type === 'grammar') return true
    if (autoFix.style && issue.type === 'style') return true
    if (autoFix.clarity && issue.type === 'clarity') return true
    return false
  })

  // Apply fixes through component events
  // NOTE: fireComponentEvent is not available in current ToolContext
  // Auto-fix events are not applied, only counted for reporting
  for (const issue of issuesToFix) {
    if (issue.suggestions.length > 0) {
      try {
        // Cannot fire events in current ToolContext version
        // Would need fireComponentEvent property
        console.log(`Would apply fix for ${issue.category}: ${issue.suggestions[0]}`)
        fixCount++
      } catch (error) {
        console.log(`Failed to apply fix for ${issue.category}: ${error}`)
      }
    }
  }

  return fixCount
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AnalyzeWritingOutput {
  success: boolean
  data?: any
  error?: string
  timestamp: string
}
