import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('failed to bind test server')
  return address.port
}

describe('reflectt dogfood smoke CLI', () => {
  const servers: Array<ReturnType<typeof createServer>> = []

  afterEach(async () => {
    await Promise.all(
      servers.map(async (server) => {
        if (server.listening) {
          server.close()
          await once(server, 'close')
        }
      }),
    )
    servers.length = 0
  })

  it('runs enroll -> heartbeat -> sync -> dashboard verify as a single command', async () => {
    const state = {
      registerCalled: false,
      claimCalled: false,
      heartbeatCalled: false,
      syncCalled: false,
      syncedTaskId: '',
      hostId: 'host-dogfood-1',
      joinToken: 'join-dogfood-1',
    }

    const cloudServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const auth = req.headers.authorization || ''
      if (auth !== 'Bearer test-token') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }

      if (req.method === 'POST' && req.url === '/api/hosts/register-token') {
        const body = await readJson(req)
        if (body.teamId !== 'team-123') {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'teamId mismatch' }))
          return
        }
        state.registerCalled = true
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ registerToken: { joinToken: state.joinToken } }))
        return
      }

      if (req.method === 'POST' && req.url === '/api/hosts/claim') {
        const body = await readJson(req)
        if (body.joinToken !== state.joinToken) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'join token mismatch' }))
          return
        }
        state.claimCalled = true
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ host: { id: state.hostId }, credential: { token: 'cred-once' } }))
        return
      }

      if (req.method === 'POST' && req.url === `/api/hosts/${state.hostId}/heartbeat`) {
        state.heartbeatCalled = true
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ host: { id: state.hostId, status: 'online' } }))
        return
      }

      if (req.method === 'POST' && req.url === `/api/hosts/${state.hostId}/tasks/sync`) {
        const body = await readJson(req)
        const task = Array.isArray(body.tasks) ? body.tasks[0] : null
        state.syncCalled = Boolean(task?.taskId)
        state.syncedTaskId = String(task?.taskId || '')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          hostId: state.hostId,
          syncedAt: new Date().toISOString(),
          syncedCount: 1,
          conflicts: [],
          tasks: [{ taskId: state.syncedTaskId }],
        }))
        return
      }

      if (req.method === 'GET' && req.url === '/api/hosts?teamId=team-123') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            hosts: [
              {
                id: state.hostId,
                syncedTasks: state.syncedTaskId ? [{ taskId: state.syncedTaskId }] : [],
              },
            ],
          }),
        )
        return
      }

      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found', method: req.method, url: req.url }))
    })
    servers.push(cloudServer)

    const dashboardServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && req.url === '/dashboard/hosts') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>ok</body></html>')
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    })
    servers.push(dashboardServer)

    const cloudPort = await listen(cloudServer)
    const dashboardPort = await listen(dashboardServer)

    const cliPath = join(process.cwd(), 'src', 'cli.ts')
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        cliPath,
        'dogfood',
        'smoke',
        '--team-id',
        'team-123',
        '--token',
        'test-token',
        '--cloud-url',
        `http://127.0.0.1:${cloudPort}`,
        '--dashboard-url',
        `http://127.0.0.1:${dashboardPort}`,
        '--host-name',
        'ci-dogfood-smoke',
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    const [code, signal] = await once(child, 'exit')

    expect(signal).toBeNull()
    expect(code).toBe(0)
    expect(stdout).toContain('✅ Dogfood smoke PASSED')
    expect(stderr).toBe('')

    expect(state.registerCalled).toBe(true)
    expect(state.claimCalled).toBe(true)
    expect(state.heartbeatCalled).toBe(true)
    expect(state.syncCalled).toBe(true)
    expect(state.syncedTaskId).not.toBe('')
  })
})
