# Proof Artifact Spec v0

**Status:** Draft for @coo review  
**Author:** @kai  
**Reviewer:** @coo

---

## What Is a Proof Artifact?

A proof artifact is a machine-created, human-checkable record that a specific action happened. It is attached to a run, task, or handoff and must be verifiable without trust.

---

## What Counts as a Receipt

| Receipt Type | Contents | Example |
|---|---|---|
| **Screenshot** | Timestamped image of browser/screen state | `screenshots/run-abc123-step-2.png` |
| **Run ID** | Stable identifier for the run that produced the action | `run-1773283000000-xyz` |
| **Approval event** | Record of who approved, when, what was approved | `{ reviewer: "kai", taskId: "task-...", decision: "approve", ts: 1773283... }` |
| **Message/send receipt** | Message ID returned by the channel | `msg-1773283000000-abc` |
| **Artifact hash** | SHA256 of the artifact file at time of creation | `sha256:a3f2...` |
| **Link to changed object** | URL or path to the changed resource | `https://github.com/reflectt/reflectt-node/pull/900` |
| **API response snapshot** | Status + body of the confirming API response | `{ status: 200, id: "task-...", updatedAt: 1773... }` |

---

## How Receipts Attach

### To a Run
```json
{
  "runId": "run-1773283000000-xyz",
  "receipts": [
    { "type": "api_response", "status": 200, "ref": "POST /tasks/task-123/review" },
    { "type": "message_id", "value": "msg-1773283000000-abc", "channel": "general" }
  ]
}
```

### To a Task
Task `metadata.proofLinks` field holds all receipt references:
```json
{
  "proofLinks": [
    "https://github.com/reflectt/reflectt-node/pull/900",
    "msg-1773283000000-abc"
  ]
}
```

### To a Handoff
Handoff message includes a `proof` block:
```json
{
  "from": "kai",
  "to": "link",
  "task": "task-123",
  "proof": {
    "prLink": "https://github.com/reflectt/reflectt-node/pull/900",
    "ciStatus": "green",
    "mergedAt": "2026-03-11T22:00:00Z"
  }
}
```

### To a Completion Claim
No agent may post "done" without a proof block in the same message:
```
Done. PR #900: https://github.com/reflectt/reflectt-node/pull/900 — merged, CI green.
```
Prose + link = valid completion. "Done" alone = invalid, reviewer must reject.

---

## What Makes a Proof Artifact Human-Checkable

1. **Navigable** — the human can open it in a browser or read it without tooling
2. **Timestamped** — creation time is part of the artifact or its metadata
3. **Specific** — it points to exactly one action, not a batch
4. **Stable** — the link/path does not rotate or expire within 30 days
5. **Attributable** — the agent that created it is identified

---

## Minimum Proof Set by Action Type

### Browser Action
- Screenshot of final state (before + after if mutation)
- URL of the page at completion
- Timestamp

### Approval
- Task ID + decision + reviewer + timestamp (from `/tasks/:id/review` response)
- Message ID of the notification sent

### Message Send
- Message ID returned by the channel API
- Channel + timestamp

### Deploy / Code Change
- PR URL + merge commit SHA
- CI run status (green/red) + run URL
- Deployed URL if applicable

### Data Mutation (task update, config change, etc.)
- API response with `{ id, updatedAt }` or equivalent
- Before/after snapshot if the change is reversible and high-stakes

---

## How to Avoid Noisy Evidence Spam

**Rules:**
1. One receipt per action — do not post every intermediate step
2. Receipts attach to artifacts silently — only surface in the completion message
3. Completion message format: `[What was done]. [Proof link or ID].` — one line
4. Screenshots only for browser actions — not for API calls
5. Batch receipts for batch actions: `3 tasks updated → task IDs: [list]`

**Anti-patterns:**
- Posting a receipt after every tool call in a run
- Screenshotting API responses that already have a message ID
- Pasting raw JSON as proof when a URL exists
- Calling "done" and then posting proof in a follow-up message

---

## Integration Points

| System | Where proof attaches |
|---|---|
| Task board | `metadata.proofLinks[]` on task |
| Runs | `receipts[]` array on run object |
| Chat | Inline in completion message (one line) |
| Approvals | `decision.proof` field on review record |
| Handoffs | `proof` block in handoff message |

---

## Version

v0 — sufficient for tonight's loop proof. Expand to cover stream artifacts + async proof collection in v1.
