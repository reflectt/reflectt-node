/**
 * Tests for the unified install.sh script.
 * Verifies key behaviors without running actual npm installs.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'install.sh')
const script = readFileSync(SCRIPT_PATH, 'utf8')

describe('Unified install.sh', () => {
  it('starts with bash shebang', () => {
    expect(script.startsWith('#!/usr/bin/env bash')).toBe(true)
  })

  it('installs both OpenClaw and reflectt-node', () => {
    // Phase 2: OpenClaw
    expect(script).toContain('npm install -g')
    expect(script).toContain('openclaw')
    // Phase 3: reflectt-node
    expect(script).toContain('git clone')
    expect(script).toContain('npm --prefix')
    expect(script).toContain('run build')
  })

  it('preserves telemetry', () => {
    expect(script).toContain('emit_telemetry')
    expect(script).toContain('install-telemetry.jsonl')
    expect(script).toContain('"outcome"')
    expect(script).toContain('"phase"')
  })

  it('preserves error handling with exit codes', () => {
    expect(script).toContain('exit_fail')
    expect(script).toContain('missing_dependency')
    expect(script).toContain('permission_denied')
    expect(script).toContain('npm_install_failed')
    expect(script).toContain('health_check_timeout')
  })

  it('includes health check verification', () => {
    expect(script).toContain('wait_for_health')
    expect(script).toContain('verify_endpoints')
    expect(script).toContain('/health')
    expect(script).toContain('/health/agents')
    expect(script).toContain('/tasks?limit=1')
  })

  it('has 4 phases in order', () => {
    const phase1 = script.indexOf('Phase 1/4: Preflight')
    const phase2 = script.indexOf('Phase 2/4: OpenClaw')
    const phase3 = script.indexOf('Phase 3/4: reflectt-node')
    const phase4 = script.indexOf('Phase 4/4: Starting runtime')

    expect(phase1).toBeGreaterThan(0)
    expect(phase2).toBeGreaterThan(phase1)
    expect(phase3).toBeGreaterThan(phase2)
    expect(phase4).toBeGreaterThan(phase3)
  })

  it('handles partial state from interrupted runs', () => {
    expect(script).toContain('PARTIAL_MARKER_FILE')
    expect(script).toContain('.reflectt-install.partial')
    expect(script).toContain('safe-rerun checks')
  })

  it('supports test mode with mock binary', () => {
    expect(script).toContain('REFLECTT_INSTALL_TEST_MODE')
    expect(script).toContain('mock-bin')
  })

  it('chains to cloud bootstrap in success output', () => {
    expect(script).toContain('app.reflectt.ai/bootstrap')
  })

  it('checks required dependencies', () => {
    for (const dep of ['bash', 'curl', 'git', 'node', 'npm', 'tar']) {
      expect(script).toContain(dep)
    }
    // All are in the dependency check loop
    expect(script).toContain('for dep in bash curl git node npm tar')
  })
})
