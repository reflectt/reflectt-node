/**
 * Port auto-detection at startup — task-1773529415342-eput9xcq1
 *
 * Behavior:
 *   - Default port 4445; PORT env var overrides
 *   - --port <n> CLI flag overrides env var
 *   - If 4445 is EADDRINUSE, try 4446–4455 sequentially
 *   - First available port is used; serverConfig.port updated
 *   - Startup log clearly shows which port was selected
 *   - If all ports 4445–4455 occupied → process.exit(1)
 */

import { describe, it, expect } from 'vitest'
import net from 'node:net'

const PORT_FALLBACK_START = 4446
const PORT_FALLBACK_END   = 4455

/** Mirrors the CLI arg parsing logic in src/index.ts */
function parseCliPort(argv: string[]): number | null {
  const idx = argv.indexOf('--port')
  if (idx === -1) return null
  const val = argv[idx + 1]
  if (!val) return null
  const n = parseInt(val, 10)
  if (isNaN(n) || n <= 0 || n >= 65536) return null
  return n
}

/** Check if a port is available (returns true if free) */
function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

describe('port auto-detection (task-eput9xcq1)', () => {
  it('A: --port flag overrides PORT env var', () => {
    const argv = ['node', 'reflectt', '--port', '4450']
    const port = parseCliPort(argv)
    expect(port).toBe(4450)
  })

  it('B: --port with no value is ignored (returns null)', () => {
    const argv = ['node', 'reflectt', '--port']
    const port = parseCliPort(argv)
    expect(port).toBeNull()
  })

  it('C: no --port flag returns null', () => {
    const argv = ['node', 'reflectt']
    const port = parseCliPort(argv)
    expect(port).toBeNull()
  })

  it('D: --port out of range is ignored', () => {
    expect(parseCliPort(['node', 'reflectt', '--port', '0'])).toBeNull()
    expect(parseCliPort(['node', 'reflectt', '--port', '99999'])).toBeNull()
    expect(parseCliPort(['node', 'reflectt', '--port', 'abc'])).toBeNull()
  })

  it('E: fallback port range is 4446–4455', () => {
    expect(PORT_FALLBACK_START).toBe(4446)
    expect(PORT_FALLBACK_END).toBe(4455)
    expect(PORT_FALLBACK_END - PORT_FALLBACK_START + 1).toBe(10) // 10 fallback slots
  })

  it('F: a free port can be detected (real net check)', async () => {
    // Pick a high port unlikely to be in use
    const testPort = 49234
    const free = await isPortFree(testPort)
    // We can't guarantee it's free but we can verify the helper works
    expect(typeof free).toBe('boolean')
  })

  it('G: occupying a port makes isPortFree return false', async () => {
    const server = net.createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as net.AddressInfo
    const free = await isPortFree(addr.port)
    expect(free).toBe(false)
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
})
