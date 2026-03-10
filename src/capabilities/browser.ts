/**
 * Browser capability — local Stagehand integration.
 *
 * Provides isolated browser sessions that agents can create and control
 * via HTTP. Sessions auto-close after a configurable idle timeout.
 *
 * @module capabilities/browser
 */

import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserConfig {
  /** Maximum concurrent sessions (default: 3) */
  maxConcurrentSessions: number
  /** Maximum sessions per hour per agent (default: 10) */
  maxSessionsPerHour: number
  /** Session idle timeout in ms before auto-close (default: 5 min) */
  idleTimeoutMs: number
  /** Run headless (default: true) */
  headless: boolean
  /** Viewport dimensions */
  viewport: { width: number; height: number }
}

export interface BrowserSession {
  id: string
  agent: string
  createdAt: number
  lastActivityAt: number
  status: 'active' | 'closing' | 'closed'
  /** Stagehand instance (opaque, held internally) */
  _stagehand?: unknown
  _page?: unknown
  _idleTimer?: ReturnType<typeof setTimeout>
}

export interface CreateSessionOpts {
  agent: string
  url?: string
  headless?: boolean
  viewport?: { width: number; height: number }
}

export interface ActResult {
  success: boolean
  message?: string
  url?: string
}

export interface ExtractResult {
  data: unknown
}

export interface ObserveResult {
  actions: Array<{ description: string; selector?: string }>
}

// ---------------------------------------------------------------------------
// Rate limiter (per-agent, rolling 1h window)
// ---------------------------------------------------------------------------

const agentSessionCounts = new Map<string, number[]>()

function checkRateLimit(agent: string, max: number): boolean {
  const now = Date.now()
  const hourAgo = now - 3_600_000
  const timestamps = (agentSessionCounts.get(agent) ?? []).filter((t) => t > hourAgo)
  agentSessionCounts.set(agent, timestamps)
  return timestamps.length < max
}

function recordSession(agent: string): void {
  const timestamps = agentSessionCounts.get(agent) ?? []
  timestamps.push(Date.now())
  agentSessionCounts.set(agent, timestamps)
}

// ---------------------------------------------------------------------------
// Session manager
// ---------------------------------------------------------------------------

const sessions = new Map<string, BrowserSession>()

const DEFAULT_CONFIG: BrowserConfig = {
  maxConcurrentSessions: 3,
  maxSessionsPerHour: 10,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  headless: true,
  viewport: { width: 1280, height: 720 },
}

let config: BrowserConfig = { ...DEFAULT_CONFIG }

export function configureBrowser(overrides: Partial<BrowserConfig>): void {
  config = { ...config, ...overrides }
}

export function getBrowserConfig(): BrowserConfig {
  return { ...config }
}

function touchSession(session: BrowserSession): void {
  session.lastActivityAt = Date.now()
  if (session._idleTimer) clearTimeout(session._idleTimer)
  session._idleTimer = setTimeout(() => {
    closeSession(session.id).catch((err) =>
      console.warn(`⚠️  Browser session ${session.id} idle-close failed:`, err),
    )
  }, config.idleTimeoutMs)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createSession(opts: CreateSessionOpts): Promise<BrowserSession> {
  // Validate limits
  const activeSessions = [...sessions.values()].filter((s) => s.status === 'active')
  if (activeSessions.length >= config.maxConcurrentSessions) {
    throw new Error(
      `Max concurrent browser sessions reached (${config.maxConcurrentSessions}). Close an existing session first.`,
    )
  }
  if (!checkRateLimit(opts.agent, config.maxSessionsPerHour)) {
    throw new Error(
      `Agent "${opts.agent}" exceeded max sessions per hour (${config.maxSessionsPerHour}).`,
    )
  }

  // Lazy-import Stagehand (heavy dependency)
  const { Stagehand } = await import('@browserbasehq/stagehand')

  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 0,
    disablePino: true,
    disableAPI: true,
    localBrowserLaunchOptions: {
      headless: opts.headless ?? config.headless,
      viewport: opts.viewport ?? config.viewport,
    },
  })

  await stagehand.init()
  recordSession(opts.agent)

  const page = stagehand.context.pages()[0]
  if (opts.url && page) {
    await page.goto(opts.url, { waitUntil: 'domcontentloaded' })
  }

  const session: BrowserSession = {
    id: randomUUID(),
    agent: opts.agent,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    status: 'active',
    _stagehand: stagehand,
    _page: page,
  }

  sessions.set(session.id, session)
  touchSession(session)

  return session
}

export function getSession(sessionId: string): BrowserSession | undefined {
  return sessions.get(sessionId)
}

export function listSessions(): Array<Omit<BrowserSession, '_stagehand' | '_page' | '_idleTimer'>> {
  return [...sessions.values()].map(({ _stagehand, _page, _idleTimer, ...rest }) => rest)
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return
  if (session.status === 'closed' || session.status === 'closing') return

  session.status = 'closing'
  if (session._idleTimer) clearTimeout(session._idleTimer)

  try {
    const stagehand = session._stagehand as { close: () => Promise<void> } | undefined
    if (stagehand) {
      await stagehand.close()
    }
  } catch (err) {
    console.warn(`⚠️  Browser session ${sessionId} close error:`, err)
  }

  session.status = 'closed'
  session._stagehand = undefined
  session._page = undefined
  sessions.delete(sessionId)
}

export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.keys()]
  await Promise.allSettled(ids.map((id) => closeSession(id)))
}

// ---------------------------------------------------------------------------
// Session actions (act / extract / observe / navigate / screenshot)
// ---------------------------------------------------------------------------

function getActiveStagehand(sessionId: string): {
  stagehand: any
  page: any
  session: BrowserSession
} {
  const session = sessions.get(sessionId)
  if (!session || session.status !== 'active') {
    throw new Error(`No active browser session: ${sessionId}`)
  }
  touchSession(session)
  return {
    stagehand: session._stagehand,
    page: session._page,
    session,
  }
}

export async function act(sessionId: string, instruction: string): Promise<ActResult> {
  const { stagehand, page } = getActiveStagehand(sessionId)
  await stagehand.act(instruction)
  const url = page?.url?.() ?? undefined
  return { success: true, message: `Executed: ${instruction}`, url }
}

export async function extract(
  sessionId: string,
  instruction: string,
  schema?: unknown,
): Promise<ExtractResult> {
  const { stagehand } = getActiveStagehand(sessionId)
  const data = await stagehand.extract(instruction, schema)
  return { data }
}

export async function observe(sessionId: string, instruction: string): Promise<ObserveResult> {
  const { stagehand } = getActiveStagehand(sessionId)
  const actions = await stagehand.observe(instruction)
  return { actions }
}

export async function navigate(sessionId: string, url: string): Promise<{ url: string }> {
  const { page } = getActiveStagehand(sessionId)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return { url: page.url() }
}

export async function screenshot(
  sessionId: string,
): Promise<{ base64: string; mimeType: string }> {
  const { page } = getActiveStagehand(sessionId)
  const buffer = await page.screenshot({ type: 'png' })
  return {
    base64: buffer.toString('base64'),
    mimeType: 'image/png',
  }
}
