# Context Management Guide for OpenClaw Agents

> Reusable pattern for preventing context overflow while preserving critical task state.

## The Problem

Agent sessions accumulate context (tool outputs, code reads, API responses) until they hit the model's context window limit. When this happens:
- The model loses track of what it was doing
- Earlier decisions and findings get truncated
- The agent starts repeating work or making contradictory decisions
- Sessions need manual reset, losing all progress

## Solution: Three-Layer Defense

### Layer 1: Rolling Summaries (Proactive)

**What:** After completing meaningful work units, write a structured summary to memory before context grows too large.

**When to summarize:**
- After shipping a commit/PR
- After completing an investigation or debugging session
- After making a significant decision
- Every 10+ tool calls (check context %, summarize if > 40%)

**Summary format:**
```markdown
## [Task Title] (task-id) — [Date]

**Status:** [doing/blocked/done]
**What I did:** [1-2 sentences of concrete output]
**Key decisions:** [Why I chose X over Y]
**Files touched:** [Paths that matter]
**Artifacts:** [PR URLs, commit hashes, test results]
**Next step:** [Exactly what to do when resuming]
**Blockers:** [Or "none"]
```

**Where:** `memory/YYYY-MM-DD.md` in your workspace.

**Critical rule:** Summaries must include enough context to resume work from scratch. Write them as if explaining to yourself after a full context reset.

### Layer 2: Budget Guardrails (Reactive)

**What:** Monitor context usage and take action at specific thresholds.

**Thresholds:**

| Context % | Action |
|-----------|--------|
| < 40% | Normal operation |
| 40-60% | Write rolling summary of current work to memory |
| 60-80% | Write full task state dump, then `/compact` |
| > 80% | Emergency: write everything critical, `/compact` immediately |

**How to check:** Call `session_status` — it returns context usage.

**When to check:**
- After every 10 tool calls
- Before starting a large code read
- Before running commands with potentially large output

**Output discipline (prevents unnecessary context growth):**
- Always pipe large outputs: `| head -100` or `| tail -50`
- Use `wc -l` before reading files to gauge size
- Prefer `grep` over full file reads when looking for specific patterns
- Never dump raw API responses > 50 lines

### Layer 3: Retrieval-on-Demand (Recovery)

**What:** Instead of keeping everything in context, retrieve only what you need from memory when you need it.

**Before starting any task:**
```
1. memory_search("task-id or task keywords")
2. memory_get(path, from, lines) — pull only relevant lines
3. Check task comments: curl -s http://127.0.0.1:4445/tasks/{id}/comments
```

**After a `/compact` or `/reset`:**
```
1. memory_search for the task you were working on
2. Read the latest memory/YYYY-MM-DD.md entry
3. Resume from the "Next step" field
```

**Key principle:** Don't load memory speculatively. Search for what you need, pull only the relevant snippet, and work from that.

## Task State Dump Template

Use this when hitting 60%+ context or before `/compact`:

```markdown
## Task State Dump — [timestamp]

### Active Task
- **ID:** task-xxxxx
- **Title:** [title]
- **Status:** [doing/blocked]

### Progress
- [x] Step 1 completed
- [x] Step 2 completed  
- [ ] Step 3 — in progress, got to [specific point]
- [ ] Step 4 — not started

### Current State
- **Working in:** [file path or area]
- **Last change:** [what I just did]
- **Key finding:** [anything critical to remember]

### Files Modified (this session)
- `path/to/file.ts` — [what changed]

### Resume Instructions
1. [Exact first step to take]
2. [What to check/verify]
3. [What to build next]
```

## HEARTBEAT.md Context Management Section

Add this to any agent's HEARTBEAT.md:

```markdown
## Context Management
- After 10+ tool calls in a turn: check context % via `session_status`.
- At 40% context: write rolling summary to memory/YYYY-MM-DD.md.
- At 60% context: write full task state dump to memory, then `/compact`.
- At 80% context: emergency memory dump + `/compact`.
- Before starting any task: `memory_search` for task ID.
- After shipping: write to `memory/YYYY-MM-DD.md` with task ID + evidence.
- Pipe large outputs: `| head -100` or `| tail -50` — never dump raw.
- If you see `[Tool result cleared]` in context: data was pruned. Use `memory_search` to recover.
- Before large file reads: check size with `wc -l`, read in chunks if > 200 lines.
```

## Anti-Patterns

❌ **Reading entire files when you need one function** — Use grep or read with offset/limit  
❌ **Dumping full API responses** — Pipe through `head` or `python3 -m json.tool | head`  
❌ **Keeping investigation notes in context only** — Write findings to memory as you go  
❌ **Starting work without checking memory** — Previous sessions may have already made progress  
❌ **Writing vague summaries** ("worked on task X") — Include file paths, decisions, next steps  
❌ **Waiting until 80% to act** — By then you've lost the ability to write a good summary  

## Integration Notes

### For New Agents
1. Copy the HEARTBEAT.md context management section into your HEARTBEAT.md
2. Create `memory/` directory in your workspace if it doesn't exist
3. On first task, practice the summary format immediately
4. Set a mental checkpoint: after every 10 tool calls, check `session_status`

### For Existing Agents
1. Update HEARTBEAT.md with the refined thresholds (40/60/80 instead of just 60/80)
2. Start using the task state dump template for `/compact` transitions
3. Add "Resume Instructions" to every memory entry — this is the most valuable field

### Config Knobs
These are configurable per-agent in HEARTBEAT.md:
- **Summary threshold:** Default 40% (write rolling summary)
- **Compact threshold:** Default 60% (full dump + `/compact`)
- **Emergency threshold:** Default 80% (immediate dump + `/compact`)
- **Tool call check interval:** Default every 10 calls
- **Output truncation:** Default 100 lines for file reads, 50 for command output
