# Host Error Correlation Contract

Contract version: `host-error-fingerprint.v1` (emitted inside cloud heartbeat payloads)

## Goal

Let cloud correlate newly emerging host failures against recent deploy transitions across multiple hosts.

## Where it is emitted

`src/cloud.ts` includes two new heartbeat fields on `POST /api/hosts/:hostId/heartbeat`:

- `deployTransition`
- `errorFingerprints`

## Heartbeat shape

```json
{
  "contractVersion": "host-heartbeat.v1",
  "timestamp": 1773056000000,
  "source": {
    "hostId": "host-mac-daddy",
    "hostName": "Mac Daddy",
    "hostType": "mac",
    "uptimeMs": 123456,
    "repo": "reflectt-node",
    "runtime": {
      "appVersion": "0.1.7",
      "nodeVersion": "v25.5.0",
      "pid": 4242
    }
  },
  "deployTransition": {
    "contractVersion": "deploy-transition.v1",
    "timestamp": 1773056000000,
    "currentCommit": "abcdef1234567890abcdef1234567890abcdef12",
    "previousCommit": "1111111111111111111111111111111111111111",
    "startupCommit": "1111111111111111111111111111111111111111",
    "signature": "111111111111→abcdef123456",
    "changedSinceStartup": true,
    "withinGrace": false
  },
  "errorFingerprints": [
    {
      "contractVersion": "host-error-fingerprint.v1",
      "host_id": "host-mac-daddy",
      "repo": "reflectt-node",
      "runtime": {
        "appVersion": "0.1.7",
        "nodeVersion": "v25.5.0",
        "pid": 4242
      },
      "timestamp": 1773055999000,
      "deploy": {
        "currentCommit": "abcdef1234567890abcdef1234567890abcdef12",
        "previousCommit": "1111111111111111111111111111111111111111",
        "startupCommit": "1111111111111111111111111111111111111111",
        "signature": "111111111111→abcdef123456",
        "changedSinceStartup": true,
        "withinGrace": false
      },
      "normalized_fingerprint": "8a15fe4c66221b4d",
      "normalized_message": "get /tasks/:taskid/comments -> :n: sqlite_busy after :nms on commit :sha",
      "subsystem": "tasks",
      "status": 500,
      "method": "GET",
      "sample_message": "GET /tasks/task-1772992262338-2k0iha2hp/comments -> 500: SQLITE_BUSY after 12034ms on commit abcdef1234567890",
      "sample_url": "/tasks/:taskId/comments"
    }
  ]
}
```

## Required fields for correlation

Each emitted fingerprint event contains:

- `host_id`
- `repo`
- `runtime`
- `timestamp`
- `deploy.signature`
- `deploy.currentCommit`
- `normalized_fingerprint`
- `subsystem`
- `sample_message`

This is the minimum cloud needs to answer:

- did the same failure appear on multiple hosts?
- did it begin after the same deploy transition?
- which subsystem is failing?
- what raw sample should a human inspect first?

## Normalization rules

Normalization happens in `src/host-error-correlation.ts`.

Current rules intentionally collapse noisy differences:

- task/message IDs → placeholders
- UUIDs → `:uuid`
- SHAs → `:sha`
- large timestamps → `:timestamp`
- other numbers → `:n`
- query strings removed from URLs
- numeric/UUID/SHA path segments normalized in URLs

Fingerprint basis:

```text
subsystem | method | status | normalizedUrl | normalizedMessage
```

Hash:

- SHA-256
- truncated to first 16 hex chars for compact transport

## Before / after example

Raw samples:

- `GET /tasks/task-1772992262338-2k0iha2hp/comments -> 500: SQLITE_BUSY after 12034ms on commit abcdef1234567890`
- `GET /tasks/task-1773055904507-t33nsvfjh/comments -> 500: SQLITE_BUSY after 98342ms on commit fedcba9876543210`

Both normalize to the same stable shape and produce the same fingerprint.

## Intended cloud-side correlation

A cloud worker can group by:

- `deploy.currentCommit`
- `normalized_fingerprint`

Then count unique `host_id`s.

A `3 hosts + same commit + same fingerprint` cluster is the regression signal this contract is meant to unlock.
