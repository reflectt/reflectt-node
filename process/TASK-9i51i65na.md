# TASK-9i51i65na — fix(cloud): add GET /api/hosts/:hostId/agent-interface/runs route

**Task:** task-1773588996651-9i51i65na  
**Assignee:** link  
**PR:** https://github.com/reflectt/reflectt-cloud/pull/1226  

## Done

Added `GET /api/hosts/:hostId/agent-interface/runs` proxy route to `apps/api/src/index.ts`.
Also wired `POST /api/hosts/:hostId/agent-interface/runs/:runId/approve|reject`.
Docs updated in `docs/FLY_API_ENDPOINTS.md`.
