import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getStorage } from '@/lib/storage/storage-manager'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

const execAsync = promisify(exec)

interface ConvertAudioFormatInput {
  audio_source: string
  output_format: string
  output_path?: string
  bit_rate?: string
  sample_rate?: number
  channels?: number
  codec?: string
  normalize_audio?: boolean
  remove_silence?: boolean
}

interface ConvertAudioFormatOutput {
  output_path: string
  input_format: string
  output_format: string
  input_size: number
  output_size: number
  compression_ratio: number
  duration: number
  error?: string
}

/**
 * Convert audio between formats using ffmpeg
 */
export default async function convertAudioFormat(
  input: ConvertAudioFormatInput,
  ctx: ToolContext
): Promise<ConvertAudioFormatOutput> {
  const {
    audio_source,
    output_format,
    output_path,
    bit_rate,
    sample_rate,
    channels,
    codec,
    normalize_audio = false,
    remove_silence = false
  } = input

  try {
    // Resolve file path
    const filePath = path.isAbsolute(audio_source)
      ? audio_source
      : ctx.resolvePath(undefined, audio_source)

    if (!await checkFileExists(filePath)) {
      return {
        output_path: '',
        input_format: '',
        output_format: '',
        input_size: 0,
        output_size: 0,
        compression_ratio: 0,
        duration: 0,
        error: `Audio file not found: ${filePath}`
      }
    }

    // Get input file info
    const inputStats = fs.statSync(filePath)
    const inputExt = path.extname(filePath).substring(1)

    // Determine output filename and path
    let filename: string
    let useStorage = true
    let finalOutputPath: string

    if (output_path) {
      // User specified output path - use it directly (legacy behavior)
      finalOutputPath = path.isAbsolute(output_path)
        ? output_path
        : ctx.resolvePath(undefined, output_path)
      useStorage = false

      // Ensure output directory exists for legacy path
      const outputDir = path.dirname(finalOutputPath)
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }
    } else {
      // No output path specified - use storage
      const baseName = path.basename(filePath, path.extname(filePath))
      const timestamp = Date.now()
      filename = `${baseName}_${timestamp}.${output_format}`

      // Use temp directory for FFmpeg output
      const tempDir = os.tmpdir()
      finalOutputPath = path.join(tempDir, filename)
    }

    // Build ffmpeg command
    let command = `ffmpeg -i "${filePath}"`

    // Add codec
    if (codec) {
      command += ` -c:a ${codec}`
    } else {
      // Default codecs for common formats
      const codecMap: Record<string, string> = {
        mp3: 'libmp3lame',
        ogg: 'libvorbis',
        opus: 'libopus',
        aac: 'aac',
        m4a: 'aac',
        flac: 'flac',
        wav: 'pcm_s16le'
      }
      if (codecMap[output_format]) {
        command += ` -c:a ${codecMap[output_format]}`
      }
    }

    // Add bit rate
    if (bit_rate) {
      command += ` -b:a ${bit_rate}`
    }

    // Add sample rate
    if (sample_rate) {
      command += ` -ar ${sample_rate}`
    }

    // Add channels
    if (channels) {
      command += ` -ac ${channels}`
    }

    // Add audio filters
    const filters: string[] = []

    if (normalize_audio) {
      filters.push('loudnorm')
    }

    if (remove_silence) {
      filters.push('silenceremove=start_periods=1:start_duration=1:start_threshold=-60dB:detection=peak,aformat=dblp,areverse,silenceremove=start_periods=1:start_duration=1:start_threshold=-60dB:detection=peak,aformat=dblp,areverse')
    }

    if (filters.length > 0) {
      command += ` -af "${filters.join(',')}"`
    }

    command += ` "${finalOutputPath}" -y`

    // Execute conversion
    await execAsync(command)

    // Get output file info
    const outputStats = fs.statSync(finalOutputPath)

    // Get duration
    const probeCommand = `ffprobe -v quiet -print_format json -show_format "${finalOutputPath}"`
    const { stdout } = await execAsync(probeCommand)
    const data = JSON.parse(stdout)
    const duration = parseFloat(data.format.duration || 0)

    // Calculate compression ratio
    const compressionRatio = ((inputStats.size - outputStats.size) / inputStats.size) * 100

    let storagePath: string

    if (useStorage) {
      // Upload to storage
      const audioBuffer = fs.readFileSync(finalOutputPath)
      const storage = getStorage()
      await storage.save(ctx.currentSpace, 'audio/converted', filename!, audioBuffer)

      // Clean up temp file
      fs.unlinkSync(finalOutputPath)

      // Return storage path
      storagePath = `storage/audio/converted/${filename}`
    } else {
      // Return legacy path
      storagePath = finalOutputPath
    }

    return {
      output_path: storagePath,
      input_format: inputExt,
      output_format,
      input_size: inputStats.size,
      output_size: outputStats.size,
      compression_ratio: parseFloat(compressionRatio.toFixed(2)),
      duration
    }
  } catch (error: any) {
    if (error.message.includes('ffmpeg') && error.message.includes('not found')) {
      return {
        output_path: '',
        input_format: '',
        output_format: '',
        input_size: 0,
        output_size: 0,
        compression_ratio: 0,
        duration: 0,
        error: 'ffmpeg not found. Please install ffmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)'
      }
    }

    return {
      output_path: '',
      input_format: '',
      output_format: '',
      input_size: 0,
      output_size: 0,
      compression_ratio: 0,
      duration: 0,
      error: formatError(error)
    }
  }
}
