// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { getTeamHealthScope } from '../src/health.js'

const OLD_ENV = {
  REFLECTT_HOST_NAME: process.env.REFLECTT_HOST_NAME,
  REFLECTT_CLOUD_URL: process.env.REFLECTT_CLOUD_URL,
  REFLECTT_HOST_TOKEN: process.env.REFLECTT_HOST_TOKEN,
  REFLECTT_HOST_ID: process.env.REFLECTT_HOST_ID,
  REFLECTT_HOST_CREDENTIAL: process.env.REFLECTT_HOST_CREDENTIAL,
}

afterEach(() => {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})

describe('getTeamHealthScope', () => {
  it('labels /health/team as host-local and includes host name', () => {
    process.env.REFLECTT_HOST_NAME = 'Mac Daddy'
    delete process.env.REFLECTT_HOST_TOKEN
    delete process.env.REFLECTT_HOST_ID
    delete process.env.REFLECTT_HOST_CREDENTIAL

    const scope = getTeamHealthScope()
    expect(scope.kind).toBe('host-local')
    expect(scope.hostName).toBe('Mac Daddy')
    expect(scope.label).toContain('Mac Daddy')
    expect(scope.message).toContain('host-local')
    expect(scope.orgHealthUrl).toBeNull()
  })

  it('includes org-health pointer when cloud is configured', () => {
    process.env.REFLECTT_HOST_NAME = 'Mac Daddy'
    process.env.REFLECTT_HOST_TOKEN = 'test-token'
    process.env.REFLECTT_CLOUD_URL = 'https://app.reflectt.ai/'

    const scope = getTeamHealthScope()
    expect(scope.orgHealthUrl).toBe('https://app.reflectt.ai/org-health')
    expect(scope.message).toContain('org-health')
  })
})
