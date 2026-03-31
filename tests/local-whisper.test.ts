/**
 * tests/local-whisper.test.ts
 * Unit + integration tests for local-whisper STT helper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Unit tests (mocked child_process) ────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('Hello from local whisper.'),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import * as childProcess from 'node:child_process'
import * as fsPromises from 'node:fs/promises'

// Reset module cache between tests so _available is re-evaluated
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('local-whisper availability check', () => {
  it('returns true when whisper CLI exits successfully', async () => {
    // Pin LOCAL_WHISPER_BIN so detectWhisperBin() skips `which`/`brew` lookups
    // (those return empty stdout from the mock, causing null detection).
    process.env.LOCAL_WHISPER_BIN = '/mock/whisper'
    const { execFile } = await import('node:child_process')
    // Mock execFile to call callback with no error
    vi.mocked(execFile).mockImplementation((_bin: any, _args: any, _opts: any, cb: any) => {
      if (typeof cb === 'function') cb(null, '', '')
      return {} as any
    })

    const { isLocalWhisperAvailable } = await import('../src/local-whisper.js')
    const result = await isLocalWhisperAvailable()
    expect(result).toBe(true)
  })

  it('returns false when whisper CLI is not found', async () => {
    process.env.LOCAL_WHISPER_BIN = '/mock/whisper'
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_bin: any, _args: any, _opts: any, cb: any) => {
      if (typeof cb === 'function') cb(new Error('ENOENT'), '', '')
      return {} as any
    })

    const { isLocalWhisperAvailable } = await import('../src/local-whisper.js')
    const result = await isLocalWhisperAvailable()
    expect(result).toBe(false)
  })
})

describe('transcribeLocally', () => {
  it('writes audio to temp file and returns transcript text', async () => {
    const { execFile } = await import('node:child_process')
    // execFile: first call = --help (availability), second = actual transcription
    let callCount = 0
    vi.mocked(execFile).mockImplementation((_bin: any, _args: any, _opts: any, cb: any) => {
      callCount++
      if (typeof cb === 'function') cb(null, '', '')
      return {} as any
    })

    const { transcribeLocally } = await import('../src/local-whisper.js')
    const result = await transcribeLocally(Buffer.from('fake-audio'), 'audio/wav')

    expect(result).toBe('Hello from local whisper.')
    const { writeFile } = await import('node:fs/promises')
    expect(vi.mocked(writeFile)).toHaveBeenCalledOnce()
  })

  it('returns null when execFile throws (binary crash)', async () => {
    const { execFile } = await import('node:child_process')
    vi.mocked(execFile).mockImplementation((_bin: any, _args: any, _opts: any, cb: any) => {
      if (typeof cb === 'function') cb(new Error('process exited with code 1'), '', '')
      return {} as any
    })

    const { transcribeLocally } = await import('../src/local-whisper.js')
    const result = await transcribeLocally(Buffer.from('bad-audio'), 'audio/webm')
    expect(result).toBeNull()
  })

  it('maps mime types to correct file extensions', async () => {
    const { execFile } = await import('node:child_process')
    const capturedArgs: string[][] = []
    vi.mocked(execFile).mockImplementation((_bin: any, args: any, _opts: any, cb: any) => {
      capturedArgs.push(args as string[])
      if (typeof cb === 'function') cb(null, '', '')
      return {} as any
    })

    const { transcribeLocally } = await import('../src/local-whisper.js')

    for (const [mime, expectedExt] of [
      ['audio/webm', '.webm'],
      ['audio/wav', '.wav'],
      ['audio/mp3', '.mp3'],
      ['audio/ogg', '.ogg'],
      ['audio/mp4', '.m4a'],
    ]) {
      capturedArgs.length = 0
      await transcribeLocally(Buffer.from('x'), mime)
      const inputPath = capturedArgs[0]?.[0] ?? ''
      expect(inputPath.endsWith(expectedExt), `${mime} → ${expectedExt}`).toBe(true)
    }
  })

  it('respects LOCAL_WHISPER_MODEL env override', async () => {
    process.env.LOCAL_WHISPER_MODEL = 'base'
    const { execFile } = await import('node:child_process')
    const capturedArgs: string[][] = []
    vi.mocked(execFile).mockImplementation((_bin: any, args: any, _opts: any, cb: any) => {
      capturedArgs.push(args as string[])
      if (typeof cb === 'function') cb(null, '', '')
      return {} as any
    })

    const { transcribeLocally } = await import('../src/local-whisper.js')
    await transcribeLocally(Buffer.from('x'), 'audio/wav')
    const args = capturedArgs[0] ?? []
    expect(args).toContain('base')
    delete process.env.LOCAL_WHISPER_MODEL
  })
})
