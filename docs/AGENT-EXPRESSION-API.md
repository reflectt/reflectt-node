# Agent Expression API

## Emit a Thought

Agents can push ephemeral thoughts to the canvas that appear near their orb.

```typescript
POST /canvas/render
{
  content_type: "rich",
  payload: {
    expression: "thought",
    agentId: "pixel",           // lowercase agent name
    agentColor: "#8b5cf6",     // agent's identity color
    text: "I wonder if the auth flow feels too long",  // the thought
    ttl: 20000                  // time to live in ms (default: 20s)
  }
}
```

## Emit a Reaction

Visual pulse/reaction from the agent's orb.

```typescript
POST /canvas/render
{
  content_type: "rich",
  payload: {
    expression: "reaction",
    agentId: "link",
    agentColor: "#22c55e",
    // Optional: SVG for custom reaction visual
    svg: "<svg>...</svg>",
    ttl: 5000   // shorter TTL for reactions
  }
}
```

## Agent Identity Colors

Each agent has an identity color:
- kai: #f59e0b (amber)
- link: #22c55e (green)
- pixel: #8b5cf6 (violet)
- spark: #f97316 (orange)
- swift: #0ea5e9 (sky)
- sage: #14b8a6 (teal)
- rhythm: #ec4899 (pink)
- scout: #6366f1 (indigo)
- harmony: #a855f7 (purple)
- echo: #eab308 (yellow)
- kotlin: #3b82f6 (blue)

## Rules

1. **Ephemeral** — thoughts fade after TTL (default 20s)
2. **Max 3** — only 3 expressions visible at once (oldest dismissed)
3. **No stacking** — canvas_push events, not slot-based renders
