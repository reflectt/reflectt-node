/**
 * PID Lockfile Manager
 * 
 * Ensures only one instance of reflectt-node runs at a time.
 * On startup: reads lockfile, kills stale process, writes new PID.
 * On shutdown: cleans up lockfile.
 * 
 * Also detects port conflicts from processes NOT managed by our lockfile.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const DEFAULT_PID_PATH = '/tmp/reflectt-node.pid'

export interface PidLockResult {
  previousPid: number | null
  killedPrevious: boolean
  portConflictPids: number[]
  killedPortConflicts: boolean
}

/**
 * Check if a process is alive
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 = just check existence
    return true
  } catch {
    return false
  }
}

/**
 * Kill a process with escalation: SIGTERM → wait → SIGKILL
 */
function killProcess(pid: number, label: string): boolean {
  if (!isProcessAlive(pid)) return false

  console.log(`  ⚠ Killing ${label} (pid ${pid})...`)
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }

  // Wait up to 3 seconds for graceful shutdown
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && isProcessAlive(pid)) {
    // busy-wait in 100ms increments (startup only, acceptable)
    const waitUntil = Date.now() + 100
    while (Date.now() < waitUntil) { /* spin */ }
  }

  // Force kill if still alive
  if (isProcessAlive(pid)) {
    console.log(`  ⚠ Force-killing ${label} (pid ${pid})...`)
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      return false
    }
    // Brief wait for SIGKILL to take effect
    const killDeadline = Date.now() + 1000
    while (Date.now() < killDeadline && isProcessAlive(pid)) {
      const waitUntil = Date.now() + 50
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }

  return !isProcessAlive(pid)
}

/**
 * Find PIDs listening on a given port (via lsof)
 */
function findPortPids(port: number): number[] {
  try {
    const output = execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: 'utf8', timeout: 5000 })
    return output
      .trim()
      .split('\n')
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n) && n > 0 && n !== process.pid)
  } catch {
    return []
  }
}

/**
 * Acquire the PID lock. Call this before starting the server.
 * 
 * 1. Reads existing lockfile and kills that process if alive
 * 2. Checks for port conflicts from unmanaged processes
 * 3. Writes current PID to lockfile
 */
export function acquirePidLock(port: number, pidPath: string = DEFAULT_PID_PATH): PidLockResult {
  const result: PidLockResult = {
    previousPid: null,
    killedPrevious: false,
    portConflictPids: [],
    killedPortConflicts: false,
  }

  console.log('🔒 Acquiring PID lock...')

  // Step 1: Check existing lockfile
  if (existsSync(pidPath)) {
    try {
      const content = readFileSync(pidPath, 'utf8').trim()
      const previousPid = parseInt(content, 10)
      if (!isNaN(previousPid) && previousPid > 0) {
        result.previousPid = previousPid
        if (isProcessAlive(previousPid)) {
          console.log(`  Found previous instance (pid ${previousPid}) from lockfile`)
          result.killedPrevious = killProcess(previousPid, 'previous instance')
          if (result.killedPrevious) {
            console.log(`  ✅ Previous instance killed`)
          } else {
            console.warn(`  ⚠ Could not kill previous instance (pid ${previousPid})`)
          }
        } else {
          console.log(`  Stale lockfile found (pid ${previousPid} not running), cleaning up`)
        }
      }
    } catch (err) {
      console.warn(`  ⚠ Could not read lockfile: ${err}`)
    }
  }

  // Step 2: Check for port conflicts (processes not in our lockfile)
  const portPids = findPortPids(port)
  if (portPids.length > 0) {
    result.portConflictPids = portPids
    console.log(`  Found ${portPids.length} process(es) on port ${port}: ${portPids.join(', ')}`)
    let allKilled = true
    for (const pid of portPids) {
      if (!killProcess(pid, `port conflict`)) {
        allKilled = false
        console.warn(`  ⚠ Could not kill port conflict (pid ${pid})`)
      }
    }
    result.killedPortConflicts = allKilled
    if (allKilled && portPids.length > 0) {
      console.log(`  ✅ All port conflicts resolved`)
      // Brief pause to let ports release
      const waitUntil = Date.now() + 1000
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }

  // Step 3: Write current PID
  try {
    writeFileSync(pidPath, String(process.pid), 'utf8')
    console.log(`  ✅ PID lock acquired (pid ${process.pid}, lockfile ${pidPath})`)
  } catch (err) {
    console.warn(`  ⚠ Could not write lockfile: ${err}`)
  }

  return result
}

/**
 * Release the PID lock. Call this on shutdown.
 * Only removes the lockfile if it still contains our PID (avoid race).
 */
export function releasePidLock(pidPath: string = DEFAULT_PID_PATH): void {
  try {
    if (existsSync(pidPath)) {
      const content = readFileSync(pidPath, 'utf8').trim()
      const lockPid = parseInt(content, 10)
      if (lockPid === process.pid) {
        unlinkSync(pidPath)
        console.log(`🔓 PID lock released (pid ${process.pid})`)
      }
      // If PID doesn't match, a newer instance has taken over — don't delete
    }
  } catch {
    // Best effort cleanup
  }
}
