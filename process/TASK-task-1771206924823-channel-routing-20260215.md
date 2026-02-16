# TASK task-1771206924823-dd3yt3x2m — channel routing for operational comms

## Shipped
Implemented core channel routing support for the new team comms protocol by introducing canonical operational channels and wiring them through chat, inbox defaults, dashboard composer options, docs, and API coverage.

## What changed

### 1) Canonical channel definitions
- Added `src/channels.ts` with shared channel definitions:
  - `general`
  - `decisions`
  - `shipping`
  - `reviews`
  - `blockers`
  - legacy compatibility channels: `problems`, `dev`
- Added shared exports:
  - `DEFAULT_CHAT_CHANNELS`
  - `DEFAULT_INBOX_SUBSCRIPTIONS`

### 2) Chat channel existence + room defaults
- Updated `src/chat.ts`:
  - default rooms are now created from shared channel definitions (not just `general`)
  - `/chat/channels` default list now includes canonical channels `shipping`, `reviews`, and `blockers`

### 3) Agent subscriptions
- Updated `src/inbox.ts`:
  - default inbox subscriptions now include `reviews` and `blockers` via shared defaults
  - stats now report shared default subscriptions source

### 4) Dashboard posting UX
- Updated `src/dashboard.ts` chat channel selector to include:
  - `#general`, `#decisions`, `#shipping`, `#reviews`, `#blockers`, `#problems`

### 5) API docs update
- Updated `public/docs.md`:
  - `/chat/channels` docs now call out canonical operational channels
  - `/inbox/:agent/subscribe` contract corrected to `channels[]` array body

### 6) Test coverage
- Updated `tests/api.test.ts`:
  - `/chat/channels` includes `general`, `shipping`, `reviews`, `blockers`
  - `POST /chat/messages` accepts `reviews` and `blockers` channel posts
  - `POST /inbox/:agent/subscribe` updates and persists per-agent channel subscriptions

## Validation
- `npm run build` ✅
- `npx vitest run tests/api.test.ts -t "GET /chat/channels lists channels|POST /chat/messages supports reviews and blockers channels|POST /inbox/:agent/subscribe updates per-agent channel subscriptions"` ✅

## PR
- (to be added)
