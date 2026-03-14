# Canvas State SSE Contract — v1 (FROZEN)

**Frozen for: Fullscreen Living Canvas sprint**
**Author:** @link
**Consumers:** @pixel (web), @swift (iOS), @kotlin (Android)
**Task:** task-1773457615446-habz1ylj0
**Effective from:** 2026-03-13
**Status: FROZEN — no schema changes during this sprint**

---

## 1. SSE Event Shape

Every canvas state update arrives as a `canvas_render` SSE event:

```
event: canvas_render
data: <JSON>
```

### Full payload schema

```typescript
{
  // ── Core state ─────────────────────────────────────────────────────────
  type: "canvas_render",
  timestamp: number,           // Unix ms

  data: {
    // Legacy fields (always present — backward compat)
    state: CanvasState,        // See §2 — frozen enum
    sensors: "mic" | "camera" | "mic+camera" | null,
    agentId: string,           // Which agent emitted this
    payload: {
      text?: string,
      decision?: {
        question: string,
        decisionId: string,
        expiresAt?: number,
        autoAction?: string,
      },
      agents?: Array<{ name: string; state: string; task?: string }>,
      summary?: { headline: string; items?: string[]; cost?: string; duration?: string },
    },

    // ── AgentPresence block (new — use for living canvas) ──────────────
    presence?: {
      name: string,            // Agent id
      identityColor: string,   // Hex color — use for orb + background tint
      state: PresenceState,    // See §3 — the human-readable state
      activeTask?: { id: string; title: string },
      recency: string,         // "just now", "2m ago", etc.
      attention?: {
        type: "decision" | "review" | "urgent",
        taskId: string,
        label?: string,
      },

      // ── Living Canvas extensions (new in v1) ──────────────────────────
      activeSpeaker?: boolean,        // true when agent is currently vocalizing
      urgency?: number,               // 0.0–1.0 — visual intensity (0=calm, 1=critical)
      ambientCue?: {
        colorHint?: string,           // Hex — suggested background tint override
        particleIntensity?: number,   // 0.0–1.0 — particle density
        pulseRate?: "slow" | "normal" | "fast",  // Orb pulse rhythm
      },
      progress?: {
        label: string,                // "Analysing…", "Writing…", "Reviewing…"
        percent?: number,             // 0–100, omit if indeterminate
      },
      currentPr?: { number: number; title: string; url: string },
    },
  }
}
```

---

## 2. CanvasState Enum (frozen)

These are the raw state values emitted by the node server. Map to PresenceState (§3) for UI.

```
"floor"      — agent not active; background state
"ambient"    — soft active, no attention required
"listening"  — mic open; recording input
"thinking"   — processing; no output yet
"rendering"  — generating output; stream in progress
"decision"   — waiting for human decision (amber)
"urgent"     — critical / time-sensitive decision (red)
"handoff"    — transitioning to another agent or surface
```

---

## 3. PresenceState Enum (frozen)

Human-readable states used in `presence.state`. These drive living canvas visuals.

```
"idle"             — no activity
"working"          — active, making progress
"thinking"         — processing, not yet producing output
"rendering"        — producing output (stream active)
"needs-attention"  — amber state; decision queued
"urgent"           — red state; time-sensitive
"handoff"          — passing to another agent/surface
"decision"         — human input required
"waiting"          — blocked, soft wait (not urgent)
```

**Visual mapping for living canvas:**

| PresenceState     | Background          | Orb            | Urgency hint |
|-------------------|---------------------|----------------|--------------|
| idle              | Dark / floor        | Dim white      | 0.0          |
| working           | identityColor tint  | Slow pulse     | 0.2          |
| thinking          | Cool blue tint      | Spin           | 0.3          |
| rendering         | identityColor tint  | Fast pulse     | 0.4          |
| needs-attention   | Amber tint          | Amber orbit    | 0.7          |
| urgent            | Red tint            | Red ring       | 1.0          |
| handoff           | Fade to white       | Dissolve out   | 0.2          |
| decision          | Amber tint          | Static ring    | 0.75         |
| waiting           | Dim tint            | Slow breathe   | 0.1          |

---

## 4. State Priority Cascade

When multiple presence states are active simultaneously, this cascade determines which wins:

```
listening > speaking > thinking > rendering > urgent > needs-attention > waiting > working > idle
```

**waiting vs needs-attention are emotionally distinct — do not merge:**
- `waiting` — patient, soft amber drift, 3s rhythm. "I'm ready when you are."
- `needs-attention` — active amber ring pulse, 1s rhythm. "I need you now."

---

## 5. activeSpeaker

`presence.activeSpeaker = true` when the agent is actively vocalizing TTS output.

**Living canvas behavior:**
- Scale orb up (1.0 → 1.15)
- Show waveform bars (animated, 8 bars, color = identityColor)
- Show transcript caption pill below orb
- `pulseRate: "fast"` during speech

Cleared immediately when TTS ends (`activeSpeaker` returns to `false` or absent).

---

## 5. urgency

`presence.urgency` is a float 0.0–1.0 indicating visual intensity.

**Living canvas behavior:**
- Background opacity of identityColor tint: `urgency * 0.25` (max 25% tint)
- Particle intensity: `presence.ambientCue.particleIntensity ?? urgency * 0.6`
- Border glow: none below 0.5; amber at 0.5–0.8; red above 0.8

---

## 6. ambientCue

Optional override for background + particle behavior.

```typescript
ambientCue?: {
  colorHint?: string,           // Hex — override identityColor for background tint
  particleIntensity?: number,   // 0.0–1.0
  pulseRate?: "slow" | "normal" | "fast",
}
```

If absent, derive from `urgency` and `state` per the table in §3.

---

## 7. SSE Connection

### Endpoint
```
GET /canvas/stream
```

No auth required (node is local/trusted network). For cloud-proxied access:
```
GET https://api.reflectt.ai/api/hosts/:hostId/canvas/stream
Authorization: Bearer <jwt>
```

### Reconnect semantics
- Always include `Last-Event-ID` header on reconnect
- Server replays last snapshot event on reconnect (`event: snapshot`)
- Dedupe by `id` field on received events — discard if already processed
- Reconnect backoff: 1s → 2s → 4s → 8s → 16s (cap at 16s)

### Event types
```
snapshot        — full canvas state on connect/reconnect
canvas_render   — incremental state update (use this for living canvas)
```

---

## 8. Continuity Hook

When cross-device handoff is needed, call:
```
GET /canvas/session/snapshot[?agentId=<id>]
```

Response includes `handoff.summary` for the banner + `active_decision` if a decision must follow the human. See snapshot API docs.

---

## 9. What is NOT in this contract (out of scope for this sprint)

- Calendar presence state (P3 backlog)
- Multi-agent simultaneous speaking (single activeSpeaker at a time)
- Spatial/XR positioning (Vision Pro / AR surface)
- Server-push to native apps without polling (needs APNs — blocked on Apple enrollment)

---

## 10. Contract integrity

**This document is frozen for the living canvas sprint.**
Any change requires:
1. @link files a `contract: amend canvas_state v1` task
2. @pixel, @swift, @kotlin all ACK before merge
3. Version bumped to v2

SHA of this file at freeze: TBD (post-commit)
