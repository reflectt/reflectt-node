/**
 * Test-specific agent roles matching the team names used in test assertions.
 * Production BUILTIN_ROLES uses generic names (agent-1, agent-2, etc.).
 * Tests need specific names to verify routing, assignment, and WIP logic.
 */
import type { AgentRole } from '../../src/assignment.js'

export const TEST_AGENT_ROLES: AgentRole[] = [
  { name: 'link', role: 'builder', description: 'Test builder', affinityTags: ['backend', 'api', 'integration', 'bug', 'test', 'webhook', 'server', 'fastify', 'typescript', 'task-lifecycle', 'watchdog', 'database'], alwaysRoute: ['backend', 'integration', 'api'], neverRoute: ['brand-copy'], wipCap: 2 },
  { name: 'pixel', role: 'designer', description: 'Test designer', affinityTags: ['dashboard', 'ui', 'css', 'visual', 'animation', 'frontend', 'layout', 'ux', 'modal', 'chart'], routingMode: 'opt-in', neverRouteUnlessLane: 'design', alwaysRoute: ['design', 'user-facing', 'ui', 'ux', 'dashboard', 'a11y', 'css', 'visual', 'copy', 'brand', 'marketing'], neverRoute: ['infra', 'ci', 'deploy', 'docker'], wipCap: 1 },
  { name: 'sage', role: 'ops', description: 'Test ops', affinityTags: ['ci', 'deploy', 'ops', 'merge', 'infra', 'github-actions', 'docker', 'pipeline', 'release', 'codeowners'], alwaysRoute: ['ops', 'ci', 'release'], neverRoute: ['visual-polish'], protectedDomains: ['deploy', 'ci', 'release'], wipCap: 1 },
  { name: 'echo', role: 'voice', description: 'Test voice', affinityTags: ['content', 'docs', 'landing', 'copy', 'brand', 'marketing', 'social', 'blog', 'readme', 'onboarding'], alwaysRoute: ['docs', 'content', 'standards'], neverRoute: ['db-migration'], wipCap: 1 },
  { name: 'harmony', role: 'reviewer', description: 'Test reviewer', affinityTags: ['qa', 'review', 'validation', 'audit', 'security', 'compliance', 'testing', 'quality'], alwaysRoute: ['qa', 'audit', 'security-review'], neverRoute: ['feature-spec'], protectedDomains: ['security', 'audit'], wipCap: 2 },
  { name: 'scout', role: 'analyst', description: 'Test analyst', affinityTags: ['research', 'analysis', 'metrics', 'monitoring', 'analytics', 'data', 'reporting', 'benchmark'], alwaysRoute: ['analytics', 'research', 'sla'], neverRoute: ['frontend-polish'], wipCap: 1 },
]
