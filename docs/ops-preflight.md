# Ops preflight (mandatory)

Before **any** ops action (restart, deploy, release):

1) Read the last 20 messages in `#general`.
2) If a restart/deploy receipt is already confirmed, **do not** redo it.

## Local helper

```bash
scripts/chat-preflight-general.sh
```

This prints the most recent messages and flags likely ops receipts (`restart`, `deploy`, `commit`, `live`, etc.).

> This is a *discipline guard*. For hard enforcement, wire it into the actual ops command path.
