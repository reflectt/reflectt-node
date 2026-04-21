// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// Bumped when the bootstrap task contract materially changes. Hosts whose
// persistent volume was previously seeded by an older image can self-heal on
// restart: a stamp mismatch triggers a rewrite of description + done_criteria
// so the current flow (claim-first, color required, enumerated Kokoro voices)
// propagates without requiring a fresh volume.
export const BOOTSTRAP_TEMPLATE_VERSION = '2026-04-21-claim-first-color-required-kokoro-voices'

export interface BootstrapTaskSpec {
  title: string
  description: string
  done_criteria: string[]
}

export function buildIntentBootstrapTaskSpec(teamIntent: string): BootstrapTaskSpec {
  return {
    title: 'Bootstrap your team from the user\'s intent',
    description: [
      '## Your First Task',
      '',
      'The user described what they need:',
      '',
      `> ${teamIntent}`,
      '',
      '### Steps:',
      '1. **Claim your own identity FIRST** via `POST /agents/main/identity/claim` with `{ claimedName, displayName, color, voice, avatar }`. This is the ONLY way `main` gets renamed and persisted. Do NOT call `PUT /config/team-roles` before this — it bypasses the alias + persistence path.',
      '2. Read `TEAM_INTENT.md` for the full intent',
      '3. Call `POST /bootstrap/team` (body: { useCase: "custom" }) to get the TEAM-ROLES.yaml schema',
      '4. Design agents that match what the user needs',
      '5. Save the team config via `PUT /config/team-roles`',
      '6. Post an intro to #general: "Hi! I\'m [name], your team lead. Here\'s the team I\'ve set up..." AND call `POST /canvas/speak` with your intro text so it plays aloud on the canvas with Kokoro TTS.',
      '7. Create starter tasks for each agent AND tell each one to introduce themselves in #general with their name, role, and what they will focus on.',
      '8. Each generated agent must also claim their identity via `POST /agents/:name/identity/claim` with the same shape: { claimedName, displayName, color, voice, avatar }. Pick a UNIQUE Kokoro voice per agent.',
      '',
      '### Valid Kokoro voice IDs (do NOT invent others):',
      '- Female American: `af_sarah`, `af_nicole`, `af_bella`',
      '- Male American:   `am_adam`, `am_michael`',
      '- Female British:  `bf_emma`, `bf_isabella`',
      '- Male British:    `bm_george`, `bm_lewis`',
      '',
      'Voice IDs must start with `af_`, `am_`, `bf_`, or `bm_`. The API rejects anything else.',
      '',
      '### Identity claim body shape:',
      '```json',
      '{',
      '  "claimedName": "nova",',
      '  "displayName": "Nova",',
      '  "color": "#fb923c",',
      '  "voice": "am_adam",',
      '  "avatar": { "type": "svg", "content": "<svg viewBox=\\"0 0 100 100\\">…</svg>" }',
      '}',
      '```',
      '',
      '`color` is a hex (`#rrggbb`) or `rgb()`/`rgba()` value. The API persists it as `settings.identityColor` — that is the single source of truth for each agent\'s canvas color.',
      '',
      'The user should see a working team with named agents, unique avatars, unique colors, and distinct Kokoro voices when they check the dashboard.',
    ].join('\n'),
    done_criteria: [
      'main has called POST /agents/main/identity/claim on itself before any other step',
      'TEAM-ROLES.yaml saved with agents matching user intent',
      'Intro message posted to #general',
      'Intro spoken aloud via POST /canvas/speak',
      'Each generated agent has introduced themselves in #general',
      'Each agent (including main) has claimed its identity (name + displayName + color + avatar + Kokoro voice) via POST /agents/:name/identity/claim',
      'All voice IDs start with af_/am_/bf_/bm_ (no invented strings like "s3://..."); all colors are hex or rgb()/rgba()',
      'At least one task created per agent',
    ],
  }
}
