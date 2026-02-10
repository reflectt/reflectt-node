/**
 * Translate Text Tool
 *
 * Translates text from one language to another with caching and format preservation.
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createTranslationClient } from '@/lib/integrations/translation'
import { logger } from '@/lib/observability/logger'

interface TranslateTextInput {
  text: string
  target_lang: string
  source_lang?: string
  format?: 'text' | 'html' | 'markdown'
  preserve_formatting?: boolean
}

interface TranslateTextOutput {
  success: boolean
  translated_text?: string
  detected_source_lang?: string
  source_lang?: string
  target_lang?: string
  cached?: boolean
  provider?: string
  error?: string
}

export default async function translateText(
  input: TranslateTextInput,
  context: ToolContext
): Promise<TranslateTextOutput> {
  const startTime = Date.now()

  try {
    logger.info('Translating text', {
      textLength: input.text.length,
      targetLang: input.target_lang,
      sourceLang: input.source_lang || 'auto',
      format: input.format || 'text',
    })

    // Validate input
    if (!input.text || input.text.trim().length === 0) {
      return {
        success: false,
        error: 'Text is required and cannot be empty',
      }
    }

    if (!input.target_lang || input.target_lang.trim().length === 0) {
      return {
        success: false,
        error: 'Target language is required',
      }
    }

    // Validate language codes (basic check - 2-5 chars, alphanumeric + dash)
    const langCodeRegex = /^[a-z]{2}(-[A-Z]{2})?$/i
    if (!langCodeRegex.test(input.target_lang)) {
      return {
        success: false,
        error: `Invalid target language code: ${input.target_lang}. Use ISO 639-1 codes like 'en', 'es', 'fr', etc.`,
      }
    }

    if (input.source_lang && input.source_lang !== 'auto' && !langCodeRegex.test(input.source_lang)) {
      return {
        success: false,
        error: `Invalid source language code: ${input.source_lang}. Use ISO 639-1 codes like 'en', 'es', 'fr', etc., or 'auto' for detection.`,
      }
    }

    // Create translation client
    const client = createTranslationClient({
      provider: 'google', // Use Google Translate by default
      cacheEnabled: true,
      cacheTTL: 60 * 60 * 24 * 7, // 7 days
    })

    // Translate text
    const result = await client.translate({
      text: input.text,
      sourceLang: input.source_lang === 'auto' ? undefined : input.source_lang,
      targetLang: input.target_lang,
      format: input.format || 'text',
      preserveFormatting: input.preserve_formatting ?? true,
    })

    const duration = Date.now() - startTime

    logger.info('Text translated successfully', {
      targetLang: input.target_lang,
      detectedSourceLang: result.detectedSourceLang,
      cached: result.cached,
      provider: result.provider,
      duration,
    })

    return {
      success: true,
      translated_text: result.translatedText as string,
      detected_source_lang: result.detectedSourceLang,
      source_lang: input.source_lang,
      target_lang: input.target_lang,
      cached: result.cached,
      provider: result.provider,
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error('Translation failed', {
      error: error instanceof Error ? error.message : String(error),
      targetLang: input.target_lang,
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Translation failed',
    }
  }
}
