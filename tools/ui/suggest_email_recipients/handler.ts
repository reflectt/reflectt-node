/**
 * Suggest Email Recipients Tool Handler
 *
 * Provides intelligent recipient suggestions with context awareness
 */

import { getContactStorageService } from '@/lib/email/contact-storage'
import { getRecipientIntelligence, type RecipientContext } from '@/lib/email/recipient-intelligence'
import { fuzzySearch } from '@/lib/utils/fuzzy-search'

export interface SuggestEmailRecipientsInput {
  emailComponentId?: string
  query?: string
  context?: RecipientContext
  maxSuggestions?: number
  includeGroups?: boolean
  suggestCC?: boolean
}

export interface SuggestEmailRecipientsOutput {
  success: boolean
  suggestions: Array<{
    email: string
    name?: string
    score: number
    reasoning: string[]
    type: 'contact' | 'group' | 'cc_suggestion'
    group?: {
      id: string
      name: string
      members: string[]
    }
  }>
  groups?: Array<{
    id: string
    name: string
    members: string[]
    frequency: number
  }>
  stats: {
    totalContacts: number
    totalGroups: number
    hasConsent: boolean
  }
}

export async function handler(
  input: SuggestEmailRecipientsInput
): Promise<SuggestEmailRecipientsOutput> {
  const {
    query = '',
    context = {},
    maxSuggestions = 5,
    includeGroups = true,
    suggestCC = false
  } = input

  const contactStorage = getContactStorageService()
  const intelligence = getRecipientIntelligence()

  // Check consent
  const stats = contactStorage.getStats()
  if (!stats.hasConsent) {
    return {
      success: false,
      suggestions: [],
      stats: {
        totalContacts: 0,
        totalGroups: 0,
        hasConsent: false
      }
    }
  }

  const suggestions: SuggestEmailRecipientsOutput['suggestions'] = []

  // If suggesting CC recipients
  if (suggestCC && context.primaryRecipient) {
    const ccSuggestions = intelligence.suggestCCRecipients([context.primaryRecipient])

    for (const ccSug of ccSuggestions.slice(0, maxSuggestions)) {
      suggestions.push({
        email: ccSug.email,
        score: ccSug.confidence,
        reasoning: [ccSug.reasoning],
        type: 'cc_suggestion'
      })
    }
  }

  // Regular recipient suggestions
  if (!suggestCC) {
    const allContacts = contactStorage.getAllContacts()

    // Filter by query if provided
    let filteredContacts = allContacts
    if (query && query.length >= 2) {
      const matches = fuzzySearch(
        query,
        allContacts,
        (contact) => [contact.email, contact.name || '']
      )
      filteredContacts = matches.map(m => m.item)
    }

    // Get intelligent suggestions with context
    const intelligentSuggestions = intelligence.suggestFromContext(
      query,
      filteredContacts,
      context
    )

    // Add to results
    for (const sug of intelligentSuggestions.slice(0, maxSuggestions)) {
      suggestions.push({
        email: sug.email,
        name: sug.name,
        score: sug.score,
        reasoning: sug.reasoning || [],
        type: 'contact'
      })
    }
  }

  // Get groups if requested
  let groups: SuggestEmailRecipientsOutput['groups'] = undefined
  if (includeGroups && !suggestCC) {
    const allGroups = intelligence.getGroups()

    if (query) {
      const matchedGroups = intelligence.searchGroups(query)
      groups = matchedGroups.slice(0, 3).map(g => ({
        id: g.id,
        name: g.name,
        members: g.members,
        frequency: g.frequency
      }))
    } else {
      groups = allGroups.slice(0, 5).map(g => ({
        id: g.id,
        name: g.name,
        members: g.members,
        frequency: g.frequency
      }))
    }

    // Add group suggestions
    if (groups) {
      for (const group of groups) {
        if (suggestions.length < maxSuggestions) {
          suggestions.push({
            email: `@${group.name}`,
            score: group.frequency * 10,
            reasoning: [`Group with ${group.members.length} members`, `Used ${group.frequency} times`],
            type: 'group',
            group: {
              id: group.id,
              name: group.name,
              members: group.members
            }
          })
        }
      }
    }
  }

  const intelligenceStats = intelligence.getStats()

  return {
    success: true,
    suggestions: suggestions.slice(0, maxSuggestions),
    groups,
    stats: {
      totalContacts: stats.totalContacts,
      totalGroups: intelligenceStats.totalGroups,
      hasConsent: stats.hasConsent
    }
  }
}
