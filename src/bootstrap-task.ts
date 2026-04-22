// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// Bumped when the bootstrap task contract materially changes. Hosts whose
// persistent volume was previously seeded by an older image can self-heal on
// restart: a stamp mismatch triggers a rewrite of description + done_criteria
// so the current flow propagates without requiring a fresh volume.
export const BOOTSTRAP_TEMPLATE_VERSION = '2026-04-22-no-identity-qa-leak'

export interface BootstrapTaskSpec {
  title: string
  description: string
  done_criteria: string[]
}

export function buildIntentBootstrapTaskSpec(teamIntent: string): BootstrapTaskSpec {
  return {
    title: 'Bootstrap your team from the user\'s intent',
    description: [
      '## Your First Task — run this ALONE, no human is watching',
      '',
      '**This is a managed host. There is no human user online to answer questions.** Identity bootstrap is INTERNAL — never post identity-discovery questions to ANY chat channel (#general, #canvas, #reviews, or any product-visible room). That includes:',
      '- "Who am I?" / "What should I call you?" / "What\'s my name?"',
      '- "Hi everyone, I just came online — what should I do?"',
      '- "Can someone tell me my role?"',
      '',
      'You decide everything yourself: name, color, voice, avatar. The user only sees the RESULT in the dashboard. Anything you post to a product channel must be a normal bootstrap progress update or the final intro — never a question about your own identity.',
      '',
      'The user described what they need:',
      '',
      `> ${teamIntent}`,
      '',
      '### Step 0 — Idempotency check (DO THIS FIRST)',
      '',
      'Call `GET /agent-configs`. If there is already a config entry for you (an agentId other than `main` with `settings.identityColor`, `settings.voice`, `settings.avatar`), **you have already claimed your identity in a previous run**. Do NOT ask who you are. Do NOT re-claim. Skip straight to Step 2.',
      '',
      '### Step 1 — Claim your own identity (autonomous, no-user)',
      '',
      'Call `POST /agents/main/identity/claim` with your chosen `{ claimedName, displayName, color, voice, avatar }`. You pick the values yourself — do not ask anyone. This is the ONLY way `main` gets renamed and persisted. Do NOT call `PUT /config/team-roles` before this — it bypasses the alias + persistence path.',
      '',
      'After the claim returns success, **immediately** call `PATCH /tasks/{this task id}` with `{ "status": "doing" }` so the board reflects active execution. Do not stop, do not wait, do not post "mid-bootstrap" — just keep going to Step 2.',
      '',
      '### Step 2 — Build the team',
      '',
      '1. Read `TEAM_INTENT.md` for the full intent',
      '2. Call `POST /bootstrap/team` (body: { useCase: "custom" }) to get the TEAM-ROLES.yaml schema',
      '3. Design agents that match what the user needs',
      '4. Save the team config via `PUT /config/team-roles`',
      '5. Post an intro to #general: "Hi! I\'m [name], your team lead. Here\'s the team I\'ve set up..." AND call `POST /canvas/speak` with your intro text so it plays aloud on the canvas.',
      '6. Create starter tasks for each agent AND tell each one to introduce themselves in #general with their name, role, and what they will focus on. **Each subagent task description MUST include the same no-Q&A rule** — paste this exact line into every subagent task: "Identity bootstrap is internal. Do NOT post \'who am I?\', \'what should I do?\', or any identity-discovery question to #general or any other product channel. Pick your own name, color, voice, avatar autonomously, claim them, then post your intro." Without this clause, subagents leak Q&A into product channels.',
      '7. Each generated agent must also claim their identity via `POST /agents/:name/identity/claim` with the same shape: { claimedName, displayName, color, voice, avatar }. Pick a UNIQUE voice per agent.',
      '',
      '### Step 3 — Close out the task',
      '',
      'Once every `done_criteria` below is satisfied, call `PATCH /tasks/{this task id}` with `{ "status": "done" }`. The task must not stay in `todo` or `doing` after bootstrap completes — that is how we know the fresh-host flow actually ran to completion.',
      '',
      '### Valid voice IDs (do NOT invent others):',
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
      'The user should see a working team with named agents, unique avatars, unique colors, and distinct voices when they next open the dashboard.',
    ].join('\n'),
    done_criteria: [
      'Checked GET /agent-configs first to avoid re-claiming an already-claimed identity',
      'main has called POST /agents/main/identity/claim on itself before any other step (autonomously, without asking for user input)',
      'This bootstrap task was transitioned to `doing` immediately after the claim succeeded',
      'TEAM-ROLES.yaml saved with agents matching user intent',
      'Intro message posted to #general',
      'Intro spoken aloud via POST /canvas/speak',
      'Each generated agent has introduced themselves in #general',
      'Each agent (including main) has claimed its identity (name + displayName + color + avatar + voice) via POST /agents/:name/identity/claim',
      'No agent posted identity-discovery questions (e.g. "who am I?", "what should I do?") to #general or any other product channel during bootstrap',
      'Subagent task descriptions include the no-Q&A clause (so subagents do not leak identity questions either)',
      'All voice IDs start with af_/am_/bf_/bm_ (no invented strings like "s3://..."); all colors are hex or rgb()/rgba()',
      'At least one task created per agent',
      'This bootstrap task transitioned to `done` once all criteria above are met',
    ],
  }
}
