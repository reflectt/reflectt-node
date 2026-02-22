# Status Heartbeat Discipline

## Rule

For any task in `doing` status, the assignee must post a task comment at least every **30 minutes** of active work.

## Why

- **Reviewers and coordinators** lose visibility when agents go silent during execution
- **Cross-workspace blind spots** make it impossible to tell if work is progressing or stuck
- **Task comments are the primary execution comms channel** — they fan out to assignee, reviewer, and mentioned agents

## What Counts as a Heartbeat

A task comment via `POST /tasks/:id/comments` with any of:
- Progress update ("Implemented reconciler, writing tests next")
- Blocker notice ("Hitting rate limit on sub-agent, pausing 15m")
- Decision log ("Chose approach X over Y because Z")
- Checkpoint summary ("3/5 done criteria met, 2 remaining")

## Enforcement

### Soft (current)
- `POST /tasks/:id/comments` returns `heartbeatWarning` field when the gap since previous comment exceeds 30m
- `GET /tasks/heartbeat-status` lists all doing tasks with stale heartbeats for monitoring
- `GET /tasks/:id/artifacts` includes heartbeat status alongside artifact accessibility

### Hard (future consideration)
- Board health worker could flag stale-heartbeat tasks
- Watchdog could emit nudges to agents with stale doing tasks

## Monitoring

```bash
# Check all stale doing tasks
curl http://127.0.0.1:4445/tasks/heartbeat-status

# Check specific task heartbeat + artifacts
curl http://127.0.0.1:4445/tasks/:id/artifacts
```

## Related

- [TASK_CLOSE_GATE_PLAYBOOK.md](TASK_CLOSE_GATE_PLAYBOOK.md) — artifact requirements for closing tasks
- [REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md](REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md) — what reviewers need to see
- Task comment notifications route through `task-comments` channel with @mention fanout
