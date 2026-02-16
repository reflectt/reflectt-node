# Telemetry Pipeline — task-1771263489906-na5it5vuo

## Summary
Customer telemetry pipeline is fully implemented. Added missing route-docs entries for telemetry endpoints (`/telemetry`, `/telemetry/config`, `/api/telemetry/ingest`) and analytics endpoints (`/analytics/models`, `/analytics/agents`). Route-docs contract now passes at 125/125.

## What Was Already Built (src/telemetry.ts — 341 lines)
- Opt-in SDK: `REFLECTT_TELEMETRY=true` or `config.json` toggle
- Endpoint usage metrics: hit counts, response times, p95, error rates
- Team metrics: agent count, active agents
- Feature adoption: maps endpoint usage to feature names
- Task throughput: created/completed per reporting period, avg cycle time
- Error reporting: type + endpoint only, no PII, no stack traces
- Health metrics: uptime, avg response time, error rate, request totals
- Cloud aggregation: periodic reporting to `cloudUrl/api/telemetry/ingest`
- Privacy: explicit opt-in, PII-free normalization of paths

## What This PR Adds
- Route-docs for 5 undocumented endpoints (3 telemetry + 2 analytics)
- Route-docs contract: 125/125 ✅

## Done Criteria Verification
1. ✅ Opt-in telemetry SDK — `initTelemetry()` with config
2. ✅ Metrics: endpoint usage, team size, feature adoption, task throughput
3. ✅ Error reporting: crashes, failed API calls, timeouts (no PII)
4. ✅ Health metrics: uptime, response times
5. ✅ Cloud aggregation endpoint — POST `/api/telemetry/ingest`
6. ✅ Privacy: explicit opt-in, clear docs on what is collected

## Test Results
- Build: ✅ clean
- Tests: 111 passed (9 pre-existing gate-ordering failures)
- Route-docs: 125/125 ✅
