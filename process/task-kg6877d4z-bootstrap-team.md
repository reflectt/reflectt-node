# Bootstrap Team Endpoint — task-1772213665265-kg6877d4z

## Summary
POST /bootstrap/team — keyword-based team composition recommender.

## Proof
- Use case "managed node support team" → 3 agents, 3 tasks, heartbeat snippets, TEAM-ROLES.yaml
- Use case "content and growth launch" → 3 agents, 3 tasks, different roles
- tsc clean

## Known Caveats
- Keyword matching is simple (no LLM). Future improvement: use AI for more nuanced recommendations.
- Templates cover 3 archetypes + default fallback. Expand as user patterns emerge.
