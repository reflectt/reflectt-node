# `update_theme`

**Category:** `ui` (Streaming UI Control)

Dynamically change the application mood/theme in real-time to match conversation context. This is a **streaming UI tool** - it passes through the server and is handled client-side as tool calls stream in.

## When to use

- **Match user mood/energy:** User mentions feeling "stressed" → switch to `oceanic` (calming)
- **Match time of day:** Late night conversation (10pm+) → switch to `dark` + `night`
- **Match work type:**
  - Creative brainstorming → `aurora` (energetic)
  - Analytical deep-dive → `oceanic` (focused calm)
  - Warm collaboration → `solstice` (cozy)
  - Standard work → `light` (professional)
- **Express empathy:** Theme changes show you understand user's state

## Available Moods

### 🌞 `light` - Daylight
Bright, crisp mission control. Professional, energetic, optimistic.
- **Use for:** Standard work, morning sessions, clarity-focused tasks
- **Gradients:** Fresh dawn → balanced day → warm evening → subtle night

### 🌙 `dark` - Night Ops
Low-light focus with neon accents. Focused, immersive, calm intensity.
- **Use for:** Late night work, focused coding, reduced eye strain
- **Gradients:** Pre-dawn cool → subtle day → dusk transition → deep night

### ✨ `aurora` - Aurora Run
Vivid teal & magenta energy. Energetic, dynamic, inspiring.
- **Use for:** Creative brainstorming, high-energy sessions, innovation
- **Gradients:** Teal dawn → vivid afternoon → magenta evening → electric night

### 🌊 `oceanic` - Oceanic Drift
Calm blues with glacial greens. Calm, balanced, contemplative.
- **Use for:** Analytical work, review sessions, calm problem-solving
- **Gradients:** Light aqua morning → mid-day ocean → deep blue evening → glacial night

### 🌅 `solstice` - Solstice Glow
Warm amber command deck. Warm, inviting, comfortable.
- **Use for:** Cozy sessions, evening work, warm collaboration
- **Gradients:** Golden morning → warm afternoon → amber evening → ember night

## Time-of-Day Variants

Each mood has 4 time-of-day gradients with unique color palettes:
- `morning` - Dawn colors, fresh start vibes
- `afternoon` - Mid-day balanced lighting
- `evening` - Dusk transitions, winding down
- `night` - Dark mode variations, late work

## Input Shape

```jsonc
{
  "mood": "aurora",              // Required: light|dark|aurora|oceanic|solstice
  "timeOfDay": "morning",        // Optional: morning|afternoon|evening|night
  "animate": true,               // Optional: smooth transition (default: true)
  "reason": "User expressed high creative energy"  // Optional: context for logging
}
```

## Examples

### Match User Mood
```json
// User: "Let's brainstorm some crazy ideas!"
{
  "mood": "aurora",
  "timeOfDay": "morning",
  "reason": "User expressed high creative energy, energizing workspace"
}
```

### Late Night Work Session
```json
// System detects: 11:30pm timestamp
{
  "mood": "dark",
  "timeOfDay": "night",
  "animate": true,
  "reason": "Late night work session, reducing eye strain"
}
```

### Calm Analysis
```json
// User: "I need to carefully review this data"
{
  "mood": "oceanic",
  "timeOfDay": "afternoon",
  "reason": "User needs focused analytical mindset, calming UI"
}
```

### Warm Collaboration
```json
// User: "Let's work together on this"
{
  "mood": "solstice",
  "timeOfDay": "evening",
  "reason": "Collaborative session, creating warm inviting atmosphere"
}
```

## Behavior

1. **Server-side:** Validates mood and timeOfDay parameters
2. **Response:** Returns `theme_update` object in tool call response
3. **Client-side:** Chat UI detects `theme_update` in tool call stream
4. **Application:** 
   - Calls `setTheme(mood)` from next-themes hook
   - Applies timeOfDay-specific gradient if provided
   - Animates transition if `animate: true`
5. **Persistence:** Theme persists in localStorage (next-themes behavior)

## Integration Notes

- **Next-themes:** Integrates with existing next-themes provider
- **Gradients:** Time-of-day gradients defined in `lib/theme/moods.ts`
- **Animation:** CSS transitions in theme system handle smooth changes
- **No Layout Shift:** Theme change is pure CSS, no re-render needed

## Best Practices

1. **Always provide reason:** Helps with debugging and shows intent
2. **Match time-of-day to clock:** Use actual time for timeOfDay if known
3. **Narrate the change:** Tell user why you're changing theme
   - "I've energized the workspace to match your creative flow..."
   - "Switching to night mode for your late session..."
4. **Don't overuse:** Only change when meaningful context shift occurs
5. **Combine with layout:** Theme + layout changes create immersive experiences

## Error Handling

- Invalid mood → Returns error with valid options
- Invalid timeOfDay → Returns error with valid options
- Missing mood → Returns error
- Other errors → Returns formatted error message
