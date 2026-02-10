import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { getStorage } from '@/lib/storage/storage-manager'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

const execAsync = promisify(exec)

interface SplitAudioInput {
  audio_source: string
  split_method: 'silence' | 'duration' | 'timestamps'
  silence_threshold?: number
  silence_duration?: number
  segment_duration?: number
  timestamps?: Array<{
    start: number
    end: number
    name?: string
  }>
  output_directory?: string
  output_format?: string
  preserve_quality?: boolean
}

interface SplitAudioOutput {
  segments: Array<{
    path: string
    start: number
    end: number
    duration: number
    file_size: number
  }>
  total_segments: number
  output_directory: string
  error?: string
}

/**
 * Split audio files using ffmpeg
 */
export default async function splitAudio(
  input: SplitAudioInput,
  ctx: ToolContext
): Promise<SplitAudioOutput> {
  const {
    audio_source,
    split_method,
    silence_threshold = -40,
    silence_duration = 1,
    segment_duration,
    timestamps,
    output_directory,
    output_format,
    preserve_quality = true
  } = input

  try {
    // Resolve file path
    const filePath = path.isAbsolute(audio_source)
      ? audio_source
      : ctx.resolvePath(undefined, audio_source)

    if (!await checkFileExists(filePath)) {
      return {
        segments: [],
        total_segments: 0,
        output_directory: '',
        error: `Audio file not found: ${filePath}`
      }
    }

    // Get storage instance
    const storage = getStorage()

    // Use temp directory for FFmpeg output
    const tempDir = os.tmpdir()

    // Generate unique session ID for this split operation
    const sessionId = Date.now()

    // Get file extension
    const inputExt = path.extname(filePath)
    const outputExt = output_format ? `.${output_format}` : inputExt

    // Determine codec settings
    const codecArgs = preserve_quality ? '-c copy' : '-c:a libmp3lame -q:a 2'

    const segments: Array<{
      path: string
      start: number
      end: number
      duration: number
      file_size: number
    }> = []

    if (split_method === 'timestamps' && timestamps) {
      // Split by specific timestamps
      for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i]
        const segmentName = ts.name || `segment_${i + 1}`
        const filename = `${sessionId}_${segmentName}${outputExt}`
        const tempPath = path.join(tempDir, filename)

        const duration = ts.end - ts.start
        const command = `ffmpeg -i "${filePath}" -ss ${ts.start} -t ${duration} ${codecArgs} "${tempPath}" -y`

        await execAsync(command)

        // Read the temp file and upload to storage
        const audioBuffer = await fs.readFile(tempPath)
        await storage.save(ctx.currentSpace, 'audio/segments', filename, audioBuffer)

        // Clean up temp file
        await fs.unlink(tempPath).catch(() => {})

        const storagePath = `storage/audio/segments/${filename}`
        segments.push({
          path: storagePath,
          start: ts.start,
          end: ts.end,
          duration,
          file_size: audioBuffer.length
        })
      }
    } else if (split_method === 'duration' && segment_duration) {
      // Split by duration
      // First get total duration
      const probeCommand = `ffprobe -v quiet -print_format json -show_format "${filePath}"`
      const { stdout } = await execAsync(probeCommand)
      const data = JSON.parse(stdout)
      const totalDuration = parseFloat(data.format.duration)

      let currentStart = 0
      let segmentIndex = 1

      while (currentStart < totalDuration) {
        const currentEnd = Math.min(currentStart + segment_duration, totalDuration)
        const currentDuration = currentEnd - currentStart
        const filename = `${sessionId}_segment_${segmentIndex}${outputExt}`
        const tempPath = path.join(tempDir, filename)

        const command = `ffmpeg -i "${filePath}" -ss ${currentStart} -t ${currentDuration} ${codecArgs} "${tempPath}" -y`

        await execAsync(command)

        // Read the temp file and upload to storage
        const audioBuffer = await fs.readFile(tempPath)
        await storage.save(ctx.currentSpace, 'audio/segments', filename, audioBuffer)

        // Clean up temp file
        await fs.unlink(tempPath).catch(() => {})

        const storagePath = `storage/audio/segments/${filename}`
        segments.push({
          path: storagePath,
          start: currentStart,
          end: currentEnd,
          duration: currentDuration,
          file_size: audioBuffer.length
        })

        currentStart = currentEnd
        segmentIndex++
      }
    } else if (split_method === 'silence') {
      // Split by silence detection
      // Use ffmpeg silencedetect filter to find silence
      const detectCommand = `ffmpeg -i "${filePath}" -af silencedetect=noise=${silence_threshold}dB:d=${silence_duration} -f null - 2>&1`

      const { stdout: detectOutput } = await execAsync(detectCommand)

      // Parse silence detection output
      const silenceRegex = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g
      const silences: number[] = []
      let match

      while ((match = silenceRegex.exec(detectOutput)) !== null) {
        silences.push(parseFloat(match[1]))
      }

      // Create segments between silences
      let segmentStart = 0
      let segmentIndex = 1

      for (const silenceEnd of silences) {
        if (silenceEnd - segmentStart > 1) { // Only create segment if longer than 1 second
          const filename = `${sessionId}_segment_${segmentIndex}${outputExt}`
          const tempPath = path.join(tempDir, filename)
          const duration = silenceEnd - segmentStart

          const command = `ffmpeg -i "${filePath}" -ss ${segmentStart} -t ${duration} ${codecArgs} "${tempPath}" -y`

          await execAsync(command)

          // Read the temp file and upload to storage
          const audioBuffer = await fs.readFile(tempPath)
          await storage.save(ctx.currentSpace, 'audio/segments', filename, audioBuffer)

          // Clean up temp file
          await fs.unlink(tempPath).catch(() => {})

          const storagePath = `storage/audio/segments/${filename}`
          segments.push({
            path: storagePath,
            start: segmentStart,
            end: silenceEnd,
            duration,
            file_size: audioBuffer.length
          })

          segmentIndex++
        }
        segmentStart = silenceEnd
      }

      // Add final segment if needed
      const probeCommand = `ffprobe -v quiet -print_format json -show_format "${filePath}"`
      const { stdout } = await execAsync(probeCommand)
      const data = JSON.parse(stdout)
      const totalDuration = parseFloat(data.format.duration)

      if (totalDuration - segmentStart > 1) {
        const filename = `${sessionId}_segment_${segmentIndex}${outputExt}`
        const tempPath = path.join(tempDir, filename)
        const duration = totalDuration - segmentStart

        const command = `ffmpeg -i "${filePath}" -ss ${segmentStart} -t ${duration} ${codecArgs} "${tempPath}" -y`

        await execAsync(command)

        // Read the temp file and upload to storage
        const audioBuffer = await fs.readFile(tempPath)
        await storage.save(ctx.currentSpace, 'audio/segments', filename, audioBuffer)

        // Clean up temp file
        await fs.unlink(tempPath).catch(() => {})

        const storagePath = `storage/audio/segments/${filename}`
        segments.push({
          path: storagePath,
          start: segmentStart,
          end: totalDuration,
          duration,
          file_size: audioBuffer.length
        })
      }
    }

    return {
      segments,
      total_segments: segments.length,
      output_directory: 'storage/audio/segments'
    }
  } catch (error: any) {
    if (error.message.includes('ffmpeg') && error.message.includes('not found')) {
      return {
        segments: [],
        total_segments: 0,
        output_directory: '',
        error: 'ffmpeg not found. Please install ffmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)'
      }
    }

    return {
      segments: [],
      total_segments: 0,
      output_directory: '',
      error: formatError(error)
    }
  }
}
