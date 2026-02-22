// SPDX-License-Identifier: Apache-2.0
// Domain-specific tag presets for reflection/insight taxonomy
// These provide suggested tags per vertical — not enforced, just guidance.

import type { Domain } from './reflections.js'

export interface DomainPreset {
  domain: Domain
  label: string
  description: string
  stages: string[]
  families: string[]
  units: string[]
  exampleReflection: {
    pain: string
    impact: string
    went_well: string
    suspected_why: string
    proposed_fix: string
    tags: string[]
  }
}

export const DOMAIN_PRESETS: Record<string, DomainPreset> = {
  engineering: {
    domain: 'engineering',
    label: 'Engineering / Software',
    description: 'Software development, DevOps, and technical teams',
    stages: ['triage', 'design', 'implementation', 'review', 'testing', 'deploy', 'monitoring'],
    families: ['runtime-error', 'data-loss', 'performance', 'access', 'ui', 'config', 'deployment', 'testing'],
    units: ['api', 'frontend', 'backend', 'infra', 'mobile', 'database'],
    exampleReflection: {
      pain: 'Deploy failed silently — no error in CI, but production 500s spiked',
      impact: '20min downtime, 3 customer tickets',
      went_well: 'Rollback was fast thanks to blue-green setup',
      suspected_why: 'Health check endpoint didn\'t cover the new dependency',
      proposed_fix: 'Add deep health checks that verify all downstream services',
      tags: ['stage:deploy', 'family:deployment', 'unit:infra'],
    },
  },

  retail: {
    domain: 'retail',
    label: 'Retail / Operations',
    description: 'Retail stores, inventory, supply chain, and operations teams',
    stages: ['procurement', 'receiving', 'inventory', 'merchandising', 'fulfillment', 'returns', 'customer-service'],
    families: ['stockout', 'overstock', 'supplier-delay', 'quality-defect', 'shrinkage', 'pricing-error', 'delivery-miss'],
    units: ['store', 'warehouse', 'online', 'distribution', 'headquarters'],
    exampleReflection: {
      pain: 'Store #12 ran out of winter jackets 3 weeks before season end',
      impact: 'Estimated $15k lost revenue, customer complaints',
      went_well: 'Store #8 had surplus and could transfer partial stock',
      suspected_why: 'Demand forecast underweighted social media trend signals',
      proposed_fix: 'Add social trend input to demand forecasting pipeline',
      tags: ['stage:procurement', 'family:stockout', 'unit:store'],
    },
  },

  agency: {
    domain: 'agency',
    label: 'Agency / Client Services',
    description: 'Creative agencies, consulting firms, and client-facing teams',
    stages: ['brief', 'strategy', 'creative', 'production', 'review', 'delivery', 'retro'],
    families: ['scope-creep', 'revision-loop', 'deadline-miss', 'budget-overrun', 'brief-ambiguity', 'resource-gap'],
    units: ['client', 'internal', 'creative', 'strategy', 'production'],
    exampleReflection: {
      pain: 'Acme Corp creative went through 7 revision rounds before approval',
      impact: '3 weeks over deadline, $8k budget overrun',
      went_well: 'Client ultimately happy with final output',
      suspected_why: 'Brief was too vague — interpretation drift from round 1',
      proposed_fix: 'Require structured brief template with visual references',
      tags: ['stage:creative', 'family:revision-loop', 'unit:client'],
    },
  },

  support: {
    domain: 'support',
    label: 'Support / Customer Success',
    description: 'Customer support, success, and service teams',
    stages: ['triage', 'investigation', 'resolution', 'followup', 'escalation', 'onboarding'],
    families: ['recurring-issue', 'escalation', 'churn-signal', 'onboarding-friction', 'knowledge-gap', 'sla-breach'],
    units: ['tier-1', 'tier-2', 'enterprise', 'self-serve', 'vip'],
    exampleReflection: {
      pain: 'AI agent resolved ticket incorrectly — told customer feature exists when deprecated',
      impact: 'Customer escalated, trust in AI support reduced',
      went_well: 'Human agent caught the error within 10 minutes',
      suspected_why: 'Agent knowledge base out of date after last release',
      proposed_fix: 'Auto-sync agent knowledge base on each product release',
      tags: ['stage:resolution', 'family:knowledge-gap', 'unit:tier-1'],
    },
  },

  ops: {
    domain: 'ops',
    label: 'Operations / General',
    description: 'General business operations, HR, finance, and cross-functional teams',
    stages: ['planning', 'execution', 'review', 'reporting', 'compliance', 'hiring'],
    families: ['process-gap', 'communication-miss', 'handoff-failure', 'tool-friction', 'policy-violation', 'bottleneck'],
    units: ['team', 'department', 'cross-functional', 'leadership', 'vendor'],
    exampleReflection: {
      pain: 'New hire onboarding took 3 weeks instead of planned 1 week',
      impact: 'Delayed project start, mentor time consumed',
      went_well: 'New hire flagged pain points early — gave us data',
      suspected_why: 'Onboarding checklist was outdated, 4 tools changed since last update',
      proposed_fix: 'Monthly automated check that onboarding doc links resolve',
      tags: ['stage:hiring', 'family:process-gap', 'unit:team'],
    },
  },

  general: {
    domain: 'general',
    label: 'General / Unspecified',
    description: 'Default domain for teams that don\'t fit a specific vertical',
    stages: ['planning', 'execution', 'review', 'improvement'],
    families: ['process', 'communication', 'quality', 'efficiency', 'risk'],
    units: ['team', 'project', 'org'],
    exampleReflection: {
      pain: 'Weekly meeting ran 45 minutes over, lost productive afternoon',
      impact: 'Team morale dipped, two deadlines pushed',
      went_well: 'Good discussion surfaced a hidden blocker',
      suspected_why: 'No agenda or timebox — meeting expanded to fill available time',
      proposed_fix: 'Mandatory agenda + 5min timebox per topic + parking lot doc',
      tags: ['stage:review', 'family:process', 'unit:team'],
    },
  },
}

/**
 * Get tag suggestions for a domain. Returns stage:, family:, and unit: prefixed tags.
 */
export function getDomainTags(domain: string): string[] {
  const preset = DOMAIN_PRESETS[domain]
  if (!preset) return []
  return [
    ...preset.stages.map(s => `stage:${s}`),
    ...preset.families.map(f => `family:${f}`),
    ...preset.units.map(u => `unit:${u}`),
  ]
}

/**
 * Get all available domains with their labels.
 */
export function listDomains(): Array<{ domain: string; label: string; description: string }> {
  return Object.values(DOMAIN_PRESETS).map(p => ({
    domain: p.domain,
    label: p.label,
    description: p.description,
  }))
}
