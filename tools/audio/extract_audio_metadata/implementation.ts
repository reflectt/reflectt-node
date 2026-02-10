import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

const execAsync = promisify(exec)

interface ExtractAudioMetadataInput {
  audio_source: string
  include_streams?: boolean
  include_format?: boolean
  include_chapters?: boolean
}

interface ExtractAudioMetadataOutput {
  duration: number
  format: string
  codec: string
  sample_rate: number
  channels: number
  bit_rate: number
  file_size: number
  streams?: Array<{
    index: number
    codec_name: string
    codec_type: string
    sample_rate: string
    channels: number
    bit_rate: string
  }>
  format_details?: {
    format_name: string
    format_long_name: string
    start_time: string
    duration: string
    size: string
    bit_rate: string
    tags?: object
  }
  chapters?: Array<{
    id: number
    start: number
    end: number
    title?: string
  }>
  error?: string
}

/**
 * Extract metadata from audio files using ffprobe
 */
export default async function extractAudioMetadata(
  input: ExtractAudioMetadataInput,
  ctx: ToolContext
): Promise<ExtractAudioMetadataOutput> {
  const {
    audio_source,
    include_streams = true,
    include_format = true,
    include_chapters = false
  } = input

  try {
    // Resolve file path
    const filePath = path.isAbsolute(audio_source)
      ? audio_source
      : ctx.resolvePath(undefined, audio_source)

    if (!await checkFileExists(filePath)) {
      return {
        duration: 0,
        format: '',
        codec: '',
        sample_rate: 0,
        channels: 0,
        bit_rate: 0,
        file_size: 0,
        error: `Audio file not found: ${filePath}`
      }
    }

    // Run ffprobe to get JSON output
    const command = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
    
    const { stdout, stderr } = await execAsync(command)
    
    if (stderr) {
      console.warn('ffprobe stderr:', stderr)
    }

    const data = JSON.parse(stdout)

    // Extract basic metadata
    const audioStream = data.streams.find((s: any) => s.codec_type === 'audio')
    const format = data.format

    if (!audioStream) {
      return {
        duration: 0,
        format: '',
        codec: '',
        sample_rate: 0,
        channels: 0,
        bit_rate: 0,
        file_size: 0,
        error: 'No audio stream found in file'
      }
    }

    const output: ExtractAudioMetadataOutput = {
      duration: parseFloat(format.duration || audioStream.duration || 0),
      format: format.format_name.split(',')[0],
      codec: audioStream.codec_name,
      sample_rate: parseInt(audioStream.sample_rate || 0),
      channels: audioStream.channels || 0,
      bit_rate: parseInt(format.bit_rate || audioStream.bit_rate || 0),
      file_size: parseInt(format.size || 0)
    }

    // Add detailed stream information
    if (include_streams) {
      output.streams = data.streams.map((stream: any) => ({
        index: stream.index,
        codec_name: stream.codec_name,
        codec_type: stream.codec_type,
        sample_rate: stream.sample_rate,
        channels: stream.channels,
        bit_rate: stream.bit_rate
      }))
    }

    // Add detailed format information
    if (include_format) {
      output.format_details = {
        format_name: format.format_name,
        format_long_name: format.format_long_name,
        start_time: format.start_time,
        duration: format.duration,
        size: format.size,
        bit_rate: format.bit_rate,
        tags: format.tags
      }
    }

    // Add chapter information
    if (include_chapters && data.chapters && data.chapters.length > 0) {
      output.chapters = data.chapters.map((chapter: any) => ({
        id: chapter.id,
        start: parseFloat(chapter.start_time),
        end: parseFloat(chapter.end_time),
        title: chapter.tags?.title
      }))
    }

    return output
  } catch (error: any) {
    // Check if ffprobe is not installed
    if (error.message.includes('ffprobe') && error.message.includes('not found')) {
      return {
        duration: 0,
        format: '',
        codec: '',
        sample_rate: 0,
        channels: 0,
        bit_rate: 0,
        file_size: 0,
        error: 'ffprobe not found. Please install ffmpeg: brew install ffmpeg (macOS) or apt-get install ffmpeg (Linux)'
      }
    }

    return {
      duration: 0,
      format: '',
      codec: '',
      sample_rate: 0,
      channels: 0,
      bit_rate: 0,
      file_size: 0,
      error: formatError(error)
    }
  }
}
