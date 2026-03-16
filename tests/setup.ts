/**
 * Test setup: isolate tests from production data
 *
 * Sets REFLECTT_HOME to a temporary directory so tests never touch
 * the production SQLite database or data files.
 */
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

// Create isolated temp directory BEFORE any module imports config
const testHome = mkdtempSync(join(tmpdir(), 'reflectt-test-'))
process.env.REFLECTT_HOME = testHome

// Set NODE_ENV=test so DoR gate, noise budget, and other production guards
// are bypassed in test mode (matches the skipDoR check in POST /tasks).
process.env.NODE_ENV = 'test'

// Ensure cleanup after all tests
process.on('exit', () => {
  try {
    rmSync(testHome, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup
  }
})

console.log(`[Test Setup] REFLECTT_HOME=${testHome}`)
