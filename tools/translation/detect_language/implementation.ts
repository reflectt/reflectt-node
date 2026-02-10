/**
 * Detect Language Tool
 *
 * Detects the language of a given text with confidence scoring.
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createTranslationClient } from '@/lib/integrations/translation'
import { ALL_LANGUAGES } from '@/lib/integrations/translation'
import { logger } from '@/lib/observability/logger'

interface DetectLanguageInput {
  text: string
}

interface DetectLanguageOutput {
  success: boolean
  language?: string
  language_name?: string
  language_native_name?: string
  confidence?: number
  alternative_languages?: Array<{
    language: string
    language_name?: string
    confidence: number
  }>
  error?: string
}

export default async function detectLanguage(
  input: DetectLanguageInput,
  context: ToolContext
): Promise<DetectLanguageOutput> {
  const startTime = Date.now()

  try {
    logger.info('Detecting language', {
      textLength: input.text.length,
    })

    // Validate input
    if (!input.text || input.text.trim().length === 0) {
      return {
        success: false,
        error: 'Text is required and cannot be empty',
      }
    }

    // Create translation client
    const client = createTranslationClient({
      provider: 'google', // Use Google Translate by default
    })

    // Detect language
    const result = await client.detectLanguage({
      text: input.text,
    })

    // Get language name from our language list
    const languageInfo = ALL_LANGUAGES.find((lang) => lang.code === result.language)

    // Get alternative language names
    const alternativeLanguages = result.alternativeLanguages?.map((alt) => {
      const altLangInfo = ALL_LANGUAGES.find((lang) => lang.code === alt.language)
      return {
        language: alt.language,
        language_name: altLangInfo?.name,
        confidence: alt.confidence,
      }
    })

    const duration = Date.now() - startTime

    logger.info('Language detected successfully', {
      language: result.language,
      languageName: languageInfo?.name,
      confidence: result.confidence,
      duration,
    })

    return {
      success: true,
      language: result.language,
      language_name: languageInfo?.name,
      language_native_name: languageInfo?.nativeName,
      confidence: result.confidence,
      alternative_languages: alternativeLanguages,
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error('Language detection failed', {
      error: error instanceof Error ? error.message : String(error),
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Language detection failed',
    }
  }
}
