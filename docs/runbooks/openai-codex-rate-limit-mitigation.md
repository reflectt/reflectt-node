# Ops mitigation: openai-codex rate-limit cascade (task-1772069605109-ahbwhs9si)

## Problem
Multiple agents were pinned to **openai-codex/gpt-5.2** (alias `gpt`) with no fallbacks, producing a herd effect and triggering repeated provider cooldown + rate-limit failures.

## What changed (config)
Edited: `~/.openclaw/openclaw.json`

1) **Most agents moved off codex primary**
- Agents affected: `main`, `harmony`, `scout`, `sage`, `pixel`, `echo`, `spark`, `rhythm`
- Before: `model.primary = "gpt"` (openai-codex/gpt-5.2) and `fallbacks = []`
- After: `model.primary = "sonnet"` and `fallbacks = ["opus", "gpt", "gpt-codex"]`

2) **Subagents moved off codex primary**
- `agents.defaults.subagents.model.primary = "sonnet"`
- `agents.defaults.subagents.model.fallbacks = ["opus", "gpt", "gpt-codex"]`

3) **Codex auth profile order** (restart-required)
- Set `auth.order.openai-codex = ["openai-codex:ryan", "openai-codex:kai"]`
- Note: gateway flagged this key as restart-required (safe to defer since codex is now fallback).

## Evidence
- Historical: gateway log contained many occurrences of:
  - `Provider openai-codex is in cooldown (all profiles unavailable) (rate_limit)`
  - `⚠️ API rate limit reached. Please try again later.`

- Post-mitigation check:
  - Starting from gateway log line **107167** (immediately after the `auth.order.openai-codex` change warning), occurrences of `API rate limit reached|rate_limit` in the remainder of the log: **1**.

Commands used:
- `tail -n +107167 /tmp/openclaw/openclaw-2026-02-25.log | grep -Ei "API rate limit reached|rate_limit" | wc -l`

## Caveats / follow-ups
- Some already-open sessions may still be pinned to codex until reset; new sessions should follow the updated config.
- Consider adding a **shared per-provider limiter** (token bucket/QPS) + jittered backoff + visible requeue/ETA UX for rate-limit conditions.
