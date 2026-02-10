# TODO

## MVP Complete ✅
- [x] Basic server structure
- [x] Task management (CRUD)
- [x] Agent chat (REST API)
- [x] WebSocket support
- [x] Health endpoint
- [x] Documentation

## OpenClaw Integration (In Progress)
- [ ] Fix authentication issue with gateway
  - Current issue: "gateway token mismatch (set gateway.remote.token to match gateway.auth.token)"
  - The REST API works fine, OpenClaw gateway connection needs debugging
  - Agents can use reflectt-node via REST API in the meantime
- [ ] Test message broadcasting via OpenClaw
- [ ] Add agent event listeners

## Phase 2: Persistence
- [ ] Add SQLite/Postgres support
- [ ] Migrate from in-memory storage
- [ ] Message history search
- [ ] Task history/audit log

## Phase 3: Homie Integration
- [ ] Import useful Homie tools
- [ ] Expose via REST endpoints
- [ ] Create unified tool catalog

## Phase 4: Advanced Features
- [ ] File attachments for messages
- [ ] Message reactions
- [ ] Threaded conversations
- [ ] Task dependencies
- [ ] Agent presence indicators

## Phase 5: Sync with chat.reflectt.ai
- [ ] WebSocket sync protocol
- [ ] Conflict resolution
- [ ] Real-time updates to cloud UI
