# Research Intake Handbook

How to use research intake endpoints and convert findings into actionable tasks.

Base URL: `http://127.0.0.1:4445`

## Endpoints
- `GET /research/requests`
- `POST /research/requests`
- `GET /research/findings`
- `POST /research/findings`

## Typical flow
1. Create research request with owner + SLA context.
2. Add findings linked to request id.
3. Mark request answered when evidence is sufficient.
4. Convert finding into implementation task with source links.

## Create request
```bash
curl -s -X POST http://127.0.0.1:4445/research/requests \
  -H 'Content-Type: application/json' \
  -d '{"title":"Need X market signal","owner":"scout","priority":"P1"}'
```

## Create finding
```bash
curl -s -X POST http://127.0.0.1:4445/research/findings \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"rreq-...","summary":"Top pain point is Y","source":"https://..."}'
```

## Handoff protocol
- include request id, finding id, evidence links
- state confidence and unresolved questions
- propose concrete task with done criteria

## Verification
- request appears in `GET /research/requests`
- finding appears in `GET /research/findings`
- linkage (`requestId`) is present and valid
