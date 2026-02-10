/**
 * Suggest Form Values Tool Handler
 *
 * Provides intelligent form auto-fill suggestions with learning
 */

import { getFormIntelligence, type FormContext } from '@/lib/forms/form-intelligence'
import { detectFieldType } from '@/lib/forms/field-detection'
import { getFormDataStorageService } from '@/lib/forms/form-data-storage'

export interface SuggestFormValuesInput {
  formComponentId?: string
  fieldId?: string
  formContext?: FormContext
  includeReasoning?: boolean
  includeAlternatives?: boolean
}

export interface SuggestFormValuesOutput {
  success: boolean
  suggestions: Array<{
    fieldId: string
    fieldType: string
    value: any
    confidence: number
    reasoning: string
    source: string
    alternatives?: Array<{
      value: any
      confidence: number
      reasoning: string
    }>
  }>
  formIntent: 'personal' | 'business' | 'shipping' | 'billing' | 'unknown'
  stats: {
    totalSubmissions: number
    totalPatterns: number
    hasConsent: boolean
  }
}

export async function handler(
  input: SuggestFormValuesInput
): Promise<SuggestFormValuesOutput> {
  const {
    fieldId,
    formContext = {},
    includeReasoning = true,
    includeAlternatives = false
  } = input

  const formIntelligence = getFormIntelligence()
  const formStorage = getFormDataStorageService()

  // Check consent
  const stats = formStorage.getStats()
  if (!stats.hasConsent) {
    return {
      success: false,
      suggestions: [],
      formIntent: 'unknown',
      stats: {
        totalSubmissions: 0,
        totalPatterns: 0,
        hasConsent: false
      }
    }
  }

  const suggestions: SuggestFormValuesOutput['suggestions'] = []

  // Predict form intent if not provided
  const formIntent = formContext.formType || 'unknown'

  // If specific field requested
  if (fieldId) {
    const detected = detectFieldType(fieldId, fieldId)

    if (detected.confidence >= 0.5) {
      const intelligentSuggestions = formIntelligence.suggestValue(
        detected.fieldType,
        formContext
      )

      if (intelligentSuggestions.length > 0) {
        const primary = intelligentSuggestions[0]

        suggestions.push({
          fieldId,
          fieldType: detected.fieldType,
          value: primary.value,
          confidence: primary.confidence,
          reasoning: includeReasoning ? primary.reasoning : '',
          source: primary.source,
          alternatives: includeAlternatives
            ? intelligentSuggestions.slice(1).map(s => ({
                value: s.value,
                confidence: s.confidence,
                reasoning: s.reasoning
              }))
            : undefined
        })
      }
    }
  } else {
    // Suggest for all common field types
    const commonFieldTypes = [
      'name', 'firstName', 'lastName', 'email', 'phone',
      'address', 'city', 'state', 'zip', 'country'
    ]

    for (const fieldType of commonFieldTypes) {
      const intelligentSuggestions = formIntelligence.suggestValue(
        fieldType as any,
        formContext
      )

      if (intelligentSuggestions.length > 0) {
        const primary = intelligentSuggestions[0]

        suggestions.push({
          fieldId: fieldType,
          fieldType,
          value: primary.value,
          confidence: primary.confidence,
          reasoning: includeReasoning ? primary.reasoning : '',
          source: primary.source,
          alternatives: includeAlternatives
            ? intelligentSuggestions.slice(1).map(s => ({
                value: s.value,
                confidence: s.confidence,
                reasoning: s.reasoning
              }))
            : undefined
        })
      }
    }
  }

  const intelligenceStats = formIntelligence.getStats()

  return {
    success: true,
    suggestions,
    formIntent,
    stats: {
      totalSubmissions: intelligenceStats.totalSubmissions,
      totalPatterns: intelligenceStats.totalPatterns,
      hasConsent: stats.hasConsent
    }
  }
}
