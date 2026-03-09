// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import {
  buildDeployTransition,
  buildHostErrorFingerprintBatch,
  buildHostErrorFingerprintEvent,
  computeNormalizedFingerprint,
} from '../src/host-error-correlation.js'
import type { BuildInfo } from '../src/buildInfo.js'

const buildInfo: BuildInfo = {
  appVersion: '0.1.7',
  gitSha: 'abcdef1234567890abcdef1234567890abcdef12',
  gitShortSha: 'abcdef123456',
  gitBranch: 'main',
  gitMessage: 'test commit',
  gitAuthor: 'rhythm',
  gitTimestamp: '2026-03-09T00:00:00Z',
  buildTimestamp: '2026-03-09T00:00:00Z',
  pid: 4242,
  nodeVersion: 'v25.5.0',
  startedAt: '2026-03-09T00:00:00Z',
  startedAtMs: 1773000000000,
  uptime: 60,
}

describe('host error correlation contract', () => {
  it('collapses equivalent task API errors to one deterministic fingerprint', () => {
    const first = computeNormalizedFingerprint({
      timestamp: 1773000001000,
      method: 'GET',
      url: '/tasks/task-1772992262338-2k0iha2hp/comments?limit=50',
      status: 500,
      message: 'GET /tasks/task-1772992262338-2k0iha2hp/comments -> 500: SQLITE_BUSY after 12034ms on commit abcdef1234567890',
    })

    const second = computeNormalizedFingerprint({
      timestamp: 1773000002000,
      method: 'GET',
      url: '/tasks/task-1773055904507-t33nsvfjh/comments?limit=10',
      status: 500,
      message: 'GET /tasks/task-1773055904507-t33nsvfjh/comments -> 500: SQLITE_BUSY after 98342ms on commit fedcba9876543210',
    })

    expect(first.normalizedMessage).toContain('sqlite_busy after :nms on commit :sha')
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.subsystem).toBe('tasks')
  })

  it('includes deploy transition metadata in emitted contract events', () => {
    const deploy = buildDeployTransition({
      currentCommit: 'abcdef1234567890abcdef1234567890abcdef12',
      previousCommit: '1111111111111111111111111111111111111111',
      startupCommit: '1111111111111111111111111111111111111111',
      withinGrace: false,
    })

    const event = buildHostErrorFingerprintEvent({
      hostId: 'host-mac-daddy',
      buildInfo,
      deploy,
      sample: {
        timestamp: 1773000003000,
        method: 'POST',
        url: '/api/hosts/heartbeat',
        status: 502,
        message: 'POST /api/hosts/host-mac-daddy/heartbeat -> 502 upstream timeout after 10342ms',
      },
    })

    expect(event.host_id).toBe('host-mac-daddy')
    expect(event.repo).toBe('reflectt-node')
    expect(event.deploy.signature).toBe('111111111111→abcdef123456')
    expect(event.deploy.changedSinceStartup).toBe(true)
    expect(event.normalized_fingerprint).toMatch(/^[a-f0-9]{16}$/)
    expect(event.subsystem).toBe('cloud')
    expect(event.sample_message).toContain('heartbeat')
  })

  it('builds a three-host same-fingerprint same-commit fixture for cloud correlation', () => {
    const deploy = buildDeployTransition({
      currentCommit: 'abcdef1234567890abcdef1234567890abcdef12',
      previousCommit: '9999999999999999999999999999999999999999',
      startupCommit: '9999999999999999999999999999999999999999',
    })

    const hosts = ['host-a', 'host-b', 'host-c']
    const fixture = hosts.flatMap((hostId, index) => buildHostErrorFingerprintBatch({
      hostId,
      buildInfo,
      deploy,
      samples: [{
        timestamp: 1773000010000 + index,
        method: 'GET',
        url: `/health/deploy/${100 + index}`,
        status: 500,
        message: `GET /health/deploy/${100 + index} -> 500 runtime error: startup commit abcdef1234567890 mismatched deployment ${200 + index}`,
      }],
    }))

    expect(fixture).toHaveLength(3)
    expect(new Set(fixture.map(item => item.host_id)).size).toBe(3)
    expect(new Set(fixture.map(item => item.normalized_fingerprint)).size).toBe(1)
    expect(new Set(fixture.map(item => item.deploy.currentCommit)).size).toBe(1)
    expect(fixture.every(item => item.deploy.signature === '999999999999→abcdef123456')).toBe(true)
  })
})
