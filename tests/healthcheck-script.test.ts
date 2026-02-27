import { describe, it, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

describe('scripts/healthcheck.sh', () => {
  it('is executable', async () => {
    const scriptPath = join(process.cwd(), 'scripts', 'healthcheck.sh')
    const st = await fs.stat(scriptPath)
    // any execute bit set
    expect((st.mode & 0o111) !== 0).toBe(true)
  })

  it('runs and prints usage with --help', async () => {
    const scriptPath = join(process.cwd(), 'scripts', 'healthcheck.sh')
    const { stdout } = await execFileAsync('bash', [scriptPath, '--help'], {
      cwd: process.cwd(),
      env: process.env,
    })

    expect(stdout).toContain('Usage: ./scripts/healthcheck.sh')
    expect(stdout).toContain('--deep')
    expect(stdout).toContain('REFLECTT_NODE_URL')
  })
})
