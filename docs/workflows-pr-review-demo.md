# Canonical PR Review Workflow Regression Path

Task: `task-1773265241575-8268bhayd`

## Added endpoint

- **POST** `/workflows/pr-review-demo`
- Executes canonical template `pr-review`
- Implemented in `src/server.ts`

## Behavior

1. Auto-creates a synthetic task when `taskId` is not supplied
2. Runs canonical steps: create run → start work → request review → approve → handoff → complete
3. Returns run snapshot + event list so regression checks can validate completion

## Request body (all optional)

```json
{
  "agentId": "link",
  "reviewer": "kai",
  "teamId": "default",
  "taskId": "task-optional",
  "prUrl": "https://github.com/reflectt/reflectt-node/pull/123",
  "objective": "Canonical PR review workflow regression run",
  "title": "PR review demo run",
  "urgency": "normal",
  "nextOwner": "kai",
  "summary": "Regression demo completed via /workflows/pr-review-demo"
}
```

## Validation calls

```bash
curl -sS -X POST http://127.0.0.1:4445/workflows/pr-review-demo \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"link","reviewer":"kai","teamId":"default"}' | jq .

curl -sS http://127.0.0.1:4445/workflows | jq .
```

## Build proof

- `npm run build` (tsc) passes after changes.
