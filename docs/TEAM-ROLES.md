# Team Roles Configuration

reflectt-node uses a YAML config file to define your team's agents, their roles, and routing rules. This drives automatic task assignment, WIP limits, and review routing.

## Quick Start

```bash
# Copy the example config
cp defaults/TEAM-ROLES.yaml ~/.reflectt/TEAM-ROLES.yaml

# Edit with your team's agents
nano ~/.reflectt/TEAM-ROLES.yaml
```

reflectt-node hot-reloads the config — changes take effect within 5 seconds, no restart needed.

## Config Location

Checked in order:
1. `~/.reflectt/TEAM-ROLES.yaml` (or `REFLECTT_HOME/TEAM-ROLES.yaml`)
2. `~/.reflectt/TEAM-ROLES.yml`
3. `defaults/TEAM-ROLES.yaml` (shipped with repo)
4. Built-in fallback (3 generic placeholder agents)

## Example: Small Dev Team

```yaml
agents:
  - name: alice
    role: builder
    description: Full-stack developer
    affinityTags: [backend, api, frontend, typescript]
    wipCap: 2

  - name: bob
    role: designer
    description: UI/UX designer
    affinityTags: [design, ui, css, a11y]
    routingMode: opt-in          # Only gets tasks matching alwaysRoute
    alwaysRoute: [design, ui, ux, css, visual]
    wipCap: 1

  - name: charlie
    role: ops
    description: DevOps and infrastructure
    affinityTags: [ci, deploy, docker, monitoring]
    protectedDomains: [deploy, ci]  # Only charlie handles these
    wipCap: 3
```

## Agent Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Agent name (matches OpenClaw agent or task assignee) |
| `role` | ✅ | Role label (builder, designer, ops, etc.) |
| `description` | | Human-readable description |
| `aliases` | | Other names this agent goes by (for task lookup) |
| `affinityTags` | | Keywords that boost assignment score |
| `wipCap` | | Max concurrent "doing" tasks (default: 1) |
| `routingMode` | | `default` or `opt-in`. Opt-in agents only get tasks matching `alwaysRoute` |
| `alwaysRoute` | | Soft routing preference — keywords that favor this agent |
| `neverRoute` | | Keywords that exclude this agent from assignment |
| `protectedDomains` | | Hard routing — only this agent handles matching tasks |
| `neverRouteUnlessLane` | | Ignore `neverRoute` when task lane matches this value |

## Routing Modes

### Default (most agents)
Agent is a candidate for any task. `affinityTags` boost their score. `neverRoute` excludes specific topics.

### Opt-in (specialized agents)
Agent is excluded from all tasks UNLESS the task matches an `alwaysRoute` keyword. Use for agents that should only handle their specialty (e.g., a designer who shouldn't get backend tasks).

```yaml
- name: designer
  routingMode: opt-in
  alwaysRoute: [design, ui, ux, css, visual, brand]
```

### Protected Domains
Hard enforcement: only this agent can be assigned tasks matching the keyword. Other agents are excluded from the candidate set.

```yaml
- name: ops-lead
  protectedDomains: [deploy, ci, release]
```

## API

### View effective config
```bash
curl http://127.0.0.1:4445/team/roles
```

Returns all agents with their current WIP count, where the config was loaded from, and whether any agent is over their WIP cap.

### Test assignment
```bash
curl -X POST http://127.0.0.1:4445/tasks/suggest-assignee \
  -H "Content-Type: application/json" \
  -d '{"title": "Fix login API timeout"}'
```

Returns scored candidates showing why each agent was or wasn't suggested.

## Hot Reload

reflectt-node watches `~/.reflectt/TEAM-ROLES.yaml` for changes (polling every 5 seconds). Edit the file and the new config is live immediately — no restart needed.

## Tips

- **Start simple.** Two agents with different `affinityTags` is enough to start.
- **Use `routingMode: opt-in`** for agents that should only handle specific work.
- **Set `wipCap`** to prevent overloading any single agent.
- **Test with `/tasks/suggest-assignee`** before committing to a config change.
- **Check `/team/roles`** to verify your config loaded correctly.
