# Support Intake Pipeline — Contract & Architecture

**Task**: task-1771365564661-uf60xoj7y  
**Author**: link  
**Date**: 2026-02-17

## Overview

The support intake pipeline routes feedback submissions (from both humans and agents) into an actionable triage queue with severity classification, reporter attribution, and automated task creation.

## Intake Contract

### Feedback Submission (POST /feedback)

```json
{
  "category": "bug" | "feature" | "general",   // required
  "message": "string (10-1000 chars)",          // required
  "siteToken": "string",                        // required
  "email": "string",                            // optional — reporter email
  "url": "string",                              // optional — page URL where issue occurred
  "userAgent": "string",                        // optional — browser UA
  "sessionId": "string",                        // optional — session tracking
  "severity": "critical" | "high" | "medium" | "low",  // optional — auto-inferred if omitted
  "reporterType": "human" | "agent",            // optional — defaults to "human"
  "reporterAgent": "string"                     // optional — agent name (when reporterType=agent)
}
```

### Response (201 Created)

```json
{
  "success": true,
  "id": "fb-xxxxxxxx",
  "severity": "high",          // resolved severity (explicit or inferred)
  "reporterType": "human",     // resolved reporter type
  "message": "Feedback received."
}
```

### Severity Auto-Inference Rules

When `severity` is not provided, it's inferred from `category` + message content:

| Category | Pattern Match | Inferred Severity |
|----------|--------------|-------------------|
| bug | crash, data loss, security, auth broken, production down, can't login | critical |
| bug | broken, fails, error, not working, can't, unable to, blocks, regression | high |
| bug | (other) | medium |
| feature | (any) | low |
| general | broken, fails, error, etc. | medium |
| general | (other) | low |

## Triage Pipeline

### Triage Queue (GET /triage)

Returns untriaged feedback sorted by severity (critical first), then by recency.

```json
{
  "items": [
    {
      "feedbackId": "fb-xxxxxxxx",
      "category": "bug",
      "severity": "critical",
      "reporterType": "agent",
      "messagePreview": "Authentication is broken...",
      "createdAt": 1771368000000,
      "votes": 0,
      "suggestedPriority": "P0"
    }
  ],
  "total": 5
}
```

### Triage Action (POST /feedback/:id/triage)

Converts a feedback record into a task.

**Request:**
```json
{
  "triageAgent": "kai",        // required — who/what is triaging
  "priority": "P1",            // optional — overrides severity→priority mapping
  "assignee": "link",          // optional — task assignee
  "lane": "frontend",          // optional — stored in task metadata
  "title": "Custom title"      // optional — overrides auto-generated title
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "taskId": "task-...",
  "feedbackId": "fb-xxxxxxxx",
  "priority": "P1",
  "message": "Feedback triaged into task."
}
```

**Severity → Priority Mapping:**

| Severity | Default Priority |
|----------|-----------------|
| critical | P0 |
| high | P1 |
| medium | P2 |
| low | P3 |

### Task Metadata (on created task)

```json
{
  "source": "feedback",
  "feedbackId": "fb-xxxxxxxx",
  "severity": "high",
  "reporterType": "human",
  "reporterAgent": null,
  "reporterEmail": "user@example.com",
  "category": "bug",
  "triagedBy": "kai",
  "triagedAt": 1771368100000
}
```

### Feedback Record After Triage

```json
{
  "status": "triaged",
  "triageResult": {
    "taskId": "task-...",
    "triageAgent": "kai",
    "triagedAt": 1771368100000,
    "priority": "P1",
    "assignee": "link"
  }
}
```

## Filtering

### GET /feedback query parameters

| Param | Values | Default |
|-------|--------|---------|
| status | new, triaged, archived, all | new |
| category | bug, feature, general, all | all |
| severity | critical, high, medium, low, all | all |
| reporterType | human, agent, all | all |
| sort | date, votes, severity | date |
| order | asc, desc | desc |
| limit | 1-100 | 25 |
| offset | 0+ | 0 |

## Architecture

```
User/Agent → POST /feedback → FeedbackRecord (severity inferred, reporter typed)
                                      ↓
                              GET /triage (queue view)
                                      ↓
                        POST /feedback/:id/triage (agent or human decision)
                                      ↓
                              Task created (todo, priority mapped)
                              Feedback marked triaged with taskId linkage
```

## Agent-Reported Issues

Agents can self-report issues by setting `reporterType: "agent"` and `reporterAgent: "<name>"`. This enables:
- Filtering agent-reported vs human-reported issues
- Tracking which agents surface the most issues
- Automated watchdog→triage pipelines

## Test Coverage

7 integration tests in `tests/api.test.ts` (Triage pipeline describe block):
1. Severity + reporterType accepted on submission
2. Severity auto-inference from category + message
3. Triage queue endpoint returns sorted data
4. Full triage flow: feedback → task creation + metadata linkage
5. Double-triage rejection (409)
6. Priority override on triage
7. Severity + reporterType filter on GET /feedback

## Files Changed

- `src/feedback.ts` — Enhanced types, severity inference, triage pipeline functions
- `src/server.ts` — New fields on POST /feedback, GET /triage, POST /feedback/:id/triage endpoints
- `tests/api.test.ts` — 7 new integration tests
- `process/TASK-uf60xoj7y-intake-contract.md` — This document
