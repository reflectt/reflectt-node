/**
 * WebSocket Heartbeat Manager
 * 
 * Handles ping/pong heartbeat, stale connection cleanup,
 * and accurate subscriber count tracking.
 * 
 * - Sends ping every 30s to each connected WebSocket
 * - Closes connections that miss 2 consecutive pongs
 * - Tracks subscriber count accurately via connect/disconnect lifecycle
 * - Logs all cleanup actions for observability
 */

import type { WebSocket } from 'ws'

interface TrackedConnection {
  id: string
  socket: WebSocket
  connectedAt: number
  lastPongAt: number
  missedPongs: number
  alive: boolean
  cleanup: () => void  // Called to unsubscribe from chat, etc.
}

export interface WsHeartbeatConfig {
  /** Ping interval in ms (default: 30000) */
  pingIntervalMs: number
  /** Max missed pongs before closing (default: 2) */
  maxMissedPongs: number
}

const DEFAULT_CONFIG: WsHeartbeatConfig = {
  pingIntervalMs: 30_000,
  maxMissedPongs: 2,
}

class WsHeartbeatManager {
  private connections = new Map<string, TrackedConnection>()
  private pingTimer: NodeJS.Timeout | null = null
  private config: WsHeartbeatConfig
  private idCounter = 0

  constructor(config?: Partial<WsHeartbeatConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Start the heartbeat interval
   */
  start(): void {
    if (this.pingTimer) return

    this.pingTimer = setInterval(() => {
      this.heartbeatTick()
    }, this.config.pingIntervalMs)
    this.pingTimer.unref()

    console.log(`[WS-Heartbeat] Started (ping every ${this.config.pingIntervalMs}ms, max missed: ${this.config.maxMissedPongs})`)
  }

  /**
   * Stop the heartbeat interval
   */
  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    console.log('[WS-Heartbeat] Stopped')
  }

  /**
   * Register a new WebSocket connection for heartbeat tracking
   */
  track(socket: WebSocket, cleanup: () => void): string {
    const id = `ws-${Date.now()}-${++this.idCounter}`
    const now = Date.now()

    const conn: TrackedConnection = {
      id,
      socket,
      connectedAt: now,
      lastPongAt: now,
      missedPongs: 0,
      alive: true,
      cleanup,
    }

    this.connections.set(id, conn)

    // Listen for pong responses
    socket.on('pong', () => {
      const tracked = this.connections.get(id)
      if (tracked) {
        tracked.lastPongAt = Date.now()
        tracked.missedPongs = 0
        tracked.alive = true
      }
    })

    // Clean up on normal close
    socket.on('close', () => {
      this.removeConnection(id, 'client-close')
    })

    // Clean up on error
    socket.on('error', (err) => {
      console.error(`[WS-Heartbeat] Connection ${id} error:`, err.message)
      this.removeConnection(id, 'error')
    })

    console.log(`[WS-Heartbeat] Tracking ${id} (${this.connections.size} total)`)

    // Auto-start heartbeat when first connection arrives
    if (!this.pingTimer) {
      this.start()
    }

    return id
  }

  /**
   * Run one heartbeat tick: ping all connections, close stale ones
   */
  private heartbeatTick(): void {
    if (this.connections.size === 0) return

    const staleIds: string[] = []

    for (const [id, conn] of this.connections) {
      if (!conn.alive) {
        // Was marked not-alive on previous tick and still no pong
        conn.missedPongs++

        if (conn.missedPongs >= this.config.maxMissedPongs) {
          staleIds.push(id)
          continue
        }
      }

      // Mark as not-alive; pong handler will set it back to true
      conn.alive = false

      // Send ping
      try {
        if (conn.socket.readyState === conn.socket.OPEN) {
          conn.socket.ping()
        } else {
          staleIds.push(id)
        }
      } catch (err) {
        console.error(`[WS-Heartbeat] Ping failed for ${id}:`, err)
        staleIds.push(id)
      }
    }

    // Close stale connections
    for (const id of staleIds) {
      this.removeConnection(id, 'stale')
    }

    if (staleIds.length > 0) {
      console.log(`[WS-Heartbeat] Cleaned up ${staleIds.length} stale connection(s) (${this.connections.size} remaining)`)
    }

    // Auto-stop when no connections left
    if (this.connections.size === 0 && this.pingTimer) {
      this.stop()
    }
  }

  /**
   * Remove a connection and run its cleanup
   */
  private removeConnection(id: string, reason: string): void {
    const conn = this.connections.get(id)
    if (!conn) return

    this.connections.delete(id)

    // Run cleanup (e.g., unsubscribe from chat)
    try {
      conn.cleanup()
    } catch (err) {
      console.error(`[WS-Heartbeat] Cleanup error for ${id}:`, err)
    }

    // Force-close the socket if still open
    try {
      if (conn.socket.readyState === conn.socket.OPEN || conn.socket.readyState === conn.socket.CONNECTING) {
        conn.socket.close(1000, `Connection closed: ${reason}`)
      }
    } catch {
      // Socket already closed
    }

    const durationMs = Date.now() - conn.connectedAt
    console.log(`[WS-Heartbeat] Removed ${id} (reason: ${reason}, lived: ${Math.round(durationMs / 1000)}s, ${this.connections.size} remaining)`)
  }

  /**
   * Get current connection stats
   */
  getStats(): {
    connected: number
    connections: Array<{
      id: string
      connectedAt: number
      lastPongAt: number
      missedPongs: number
      alive: boolean
      durationMs: number
    }>
  } {
    const now = Date.now()
    return {
      connected: this.connections.size,
      connections: Array.from(this.connections.values()).map(conn => ({
        id: conn.id,
        connectedAt: conn.connectedAt,
        lastPongAt: conn.lastPongAt,
        missedPongs: conn.missedPongs,
        alive: conn.alive,
        durationMs: now - conn.connectedAt,
      })),
    }
  }

  /**
   * Get just the count (for subscriber count accuracy)
   */
  getConnectionCount(): number {
    return this.connections.size
  }
}

export const wsHeartbeat = new WsHeartbeatManager()
