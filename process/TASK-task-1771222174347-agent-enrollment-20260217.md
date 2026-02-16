# Task: Agent-friendly host enrollment
## ID: task-1771222174347-w245kxqq3
## Status: validating
## Artifacts
- Cloud PR #46: API key auth for register-token endpoint (merged)
- Node PR #101: CLI agent enrollment integration (CI pending)
## Summary
Extended `/api/hosts/register-token` to accept API key auth alongside JWT, enabling agents to generate join tokens via CLI/API without browser dashboard.
## Done Criteria Check
- [x] Agents can generate join tokens via CLI or API key without browser auth
- [x] No human dashboard click required for host enrollment  
- [ ] E2E flow verified (pending PR #101 merge + deploy)
