// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

export const CHANNEL_DEFINITIONS = [
  { id: 'general', name: 'General' },
  { id: 'decisions', name: 'Decisions' },
  { id: 'shipping', name: 'Shipping' },
  { id: 'reviews', name: 'Reviews' },
  { id: 'blockers', name: 'Blockers' },
  { id: 'ops', name: 'Ops' },
  // Legacy channels retained for compatibility with historical workflows.
  { id: 'problems', name: 'Problems & Ideas' },
  { id: 'dev', name: 'Development' },
] as const

export const DEFAULT_CHAT_CHANNELS = CHANNEL_DEFINITIONS.map(channel => channel.id)

export const DEFAULT_INBOX_SUBSCRIPTIONS = [
  'general',
  'decisions',
  'shipping',
  'reviews',
  'blockers',
  'problems',
]
