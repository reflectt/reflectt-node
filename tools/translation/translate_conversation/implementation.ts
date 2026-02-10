/**
 * Translate Conversation Tool
 *
 * Translates entire conversation threads with message-level caching.
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { createTranslationClient } from '@/lib/integrations/translation'
import { logger } from '@/lib/observability/logger'

interface ConversationMessage {
  id: string
  text: string
  source_lang?: string
}

interface TranslateConversationInput {
  conversation_id: string
  messages: ConversationMessage[]
  target_lang: string
  preserve_history?: boolean
}

interface TranslatedMessage {
  message_id: string
  original_text: string
  translated_text: string
  source_lang: string
  target_lang: string
}

interface TranslateConversationOutput {
  success: boolean
  conversation_id?: string
  translations?: TranslatedMessage[]
  total_messages?: number
  cached_count?: number
  translated_count?: number
  failed_count?: number
  provider?: string
  error?: string
}

export default async function translateConversation(
  input: TranslateConversationInput,
  context: ToolContext
): Promise<TranslateConversationOutput> {
  const startTime = Date.now()

  try {
    logger.info('Translating conversation', {
      conversationId: input.conversation_id,
      messageCount: input.messages.length,
      targetLang: input.target_lang,
    })

    // Validate input
    if (!input.conversation_id || input.conversation_id.trim().length === 0) {
      return {
        success: false,
        error: 'Conversation ID is required',
      }
    }

    if (!input.messages || input.messages.length === 0) {
      return {
        success: false,
        error: 'Messages array is required and cannot be empty',
      }
    }

    if (!input.target_lang || input.target_lang.trim().length === 0) {
      return {
        success: false,
        error: 'Target language is required',
      }
    }

    // Validate language code
    const langCodeRegex = /^[a-z]{2}(-[A-Z]{2})?$/i
    if (!langCodeRegex.test(input.target_lang)) {
      return {
        success: false,
        error: `Invalid target language code: ${input.target_lang}. Use ISO 639-1 codes like 'en', 'es', 'fr', etc.`,
      }
    }

    // Validate message structure
    for (const msg of input.messages) {
      if (!msg.id || !msg.text) {
        return {
          success: false,
          error: 'Each message must have an id and text property',
        }
      }
    }

    // Create translation client
    const client = createTranslationClient({
      provider: 'google', // Use Google Translate by default
      cacheEnabled: true,
      cacheTTL: 60 * 60 * 24 * 7, // 7 days
    })

    // Translate conversation
    const result = await client.translateConversation({
      conversationId: input.conversation_id,
      messages: input.messages.map((msg) => ({
        id: msg.id,
        text: msg.text,
        sourceLang: msg.source_lang,
      })),
      targetLang: input.target_lang,
      preserveHistory: input.preserve_history ?? true,
    })

    const duration = Date.now() - startTime
    const failedCount = input.messages.length - result.translations.length

    logger.info('Conversation translated successfully', {
      conversationId: input.conversation_id,
      totalMessages: input.messages.length,
      cachedCount: result.cached,
      translatedCount: result.translated,
      failedCount,
      duration,
    })

    return {
      success: true,
      conversation_id: result.conversationId,
      translations: result.translations.map((t) => ({
        message_id: t.messageId,
        original_text: t.originalText,
        translated_text: t.translatedText,
        source_lang: t.sourceLang,
        target_lang: t.targetLang,
      })),
      total_messages: input.messages.length,
      cached_count: result.cached,
      translated_count: result.translated,
      failed_count: failedCount,
      provider: 'google',
    }
  } catch (error) {
    const duration = Date.now() - startTime
    logger.error('Conversation translation failed', {
      conversationId: input.conversation_id,
      error: error instanceof Error ? error.message : String(error),
      duration,
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Conversation translation failed',
    }
  }
}
