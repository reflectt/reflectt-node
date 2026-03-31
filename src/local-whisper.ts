/**
 * local-whisper.ts — Local STT via the system-installed openai-whisper Python CLI
 *
 * Eliminates OpenAI API key dependency for STT. Falls back gracefully if not installed.
 * Uses the `tiny` model for ~1.8s latency on Apple Silicon CPU.
 *
 * Model priority: tiny (fast) → base (if tiny missing)
 * Binary resolution order:
 *   1. LOCAL_WHISPER_BIN env var (explicit override)
 *   2. `which whisper` — picks up brew-installed binary via PATH
 *   3. `brew --prefix openai-whisper` — resolves keg path even when PATH is restricted
 */

import { execFile } from 'node:child_process'
import { writeFile, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Resolved binary path — populated on first successful detection. */
let _whisperBin: string | null = null

/**
 * Detect the whisper binary path at startup.
 *
 * Resolution order:
 *   1. `LOCAL_WHISPER_BIN` env var (explicit operator override)
 *   2. `which whisper` (PATH lookup — works after normal brew install)
 *   3. `brew --prefix openai-whisper` + `/bin/whisper` (survives PATH restrictions
 *      and version-directory churn — the prefix symlink always points to the current keg)
 *
 * Returns null if whisper cannot be located.
 */
async function detectWhisperBin(): Promise<string | null> {
  // 1. Explicit env var override — highest priority
  if (process.env.LOCAL_WHISPER_BIN) return process.env.LOCAL_WHISPER_BIN

  // 2. PATH lookup
  try {
    const { stdout } = await execFileAsync('which', ['whisper'], { timeout: 3000 })
    const p = stdout.trim()
    if (p) return p
  } catch { /* not on PATH */ }

  // 3. brew prefix — stable across keg upgrades (resolves to /opt/homebrew/opt/openai-whisper/…)
  try {
    const { stdout } = await execFileAsync('brew', ['--prefix', 'openai-whisper'], { timeout: 5000 })
    const prefix = stdout.trim()
    if (prefix) return join(prefix, 'bin', 'whisper')
  } catch { /* brew not available or formula not installed */ }

  return null
}

/** Return the resolved whisper binary path (must call after isLocalWhisperAvailable). */
function getWhisperBin(): string {
  // _whisperBin is populated by isLocalWhisperAvailable(); should always be set here.
  if (_whisperBin) return _whisperBin
  // Fallback: respect env var even if availability check was skipped
  return process.env.LOCAL_WHISPER_BIN ?? 'whisper'
}

/** Model to use. Override with LOCAL_WHISPER_MODEL (tiny|base|small). Default: tiny. */
function getWhisperModel(): string {
  return process.env.LOCAL_WHISPER_MODEL ?? 'tiny'
}

/** Check if local whisper is available (cached — checked once at startup). */
let _available: boolean | null = null

export async function isLocalWhisperAvailable(): Promise<boolean> {
  if (_available !== null) return _available
  try {
    const bin = await detectWhisperBin()
    if (!bin) {
      _available = false
      return false
    }
    await execFileAsync(bin, ['--help'], { timeout: 5000 })
    _whisperBin = bin
    _available = true
  } catch {
    _available = false
  }
  return _available
}

/**
 * Transcribe audio buffer using local whisper CLI.
 * @param audioBuffer Raw audio bytes
 * @param mimeType MIME type (used to pick extension)
 * @returns Transcript string, or null if transcription failed
 */
export async function transcribeLocally(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const bin = getWhisperBin()
  const model = getWhisperModel()

  // Derive extension from mime type (whisper CLI needs it to detect format)
  const ext =
    mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
    : mimeType.includes('mp3') ? 'mp3'
    : mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('wav') ? 'wav'
    : 'webm'

  const id = randomUUID().replace(/-/g, '').slice(0, 12)
  const inputPath = join(tmpdir(), `whisper-in-${id}.${ext}`)
  const outputDir = join(tmpdir(), `whisper-out-${id}`)
  const outputTxt = join(outputDir, `whisper-in-${id}.txt`)

  try {
    // Write audio to temp file
    await writeFile(inputPath, audioBuffer)

    // Run whisper CLI
    // --no_speech_threshold 0.3 avoids spurious transcriptions on silence
    await execFileAsync(
      bin,
      [
        inputPath,
        '--model', model,
        '--language', 'en',
        '--output_format', 'txt',
        '--output_dir', outputDir,
        '--no_speech_threshold', '0.3',
      ],
      {
        timeout: 30_000,
        // Suppress Python warnings
        env: { ...process.env, PYTHONWARNINGS: 'ignore' },
      },
    )

    // Read transcript
    const text = await readFile(outputTxt, 'utf8')
    return text.trim() || null
  } catch (err) {
    console.error('[local-whisper] transcription error:', err instanceof Error ? err.message : err)
    return null
  } finally {
    // Clean up temp files (best-effort)
    unlink(inputPath).catch(() => {})
    unlink(outputTxt).catch(() => {})
  }
}
