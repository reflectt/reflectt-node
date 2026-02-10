import * as fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { type ToolContext, formatError } from '@/lib/tools/helpers'

const execAsync = promisify(exec)

interface ExtractFramesFromVideoInput {
  video_source: string
  extraction_method?: 'interval' | 'count' | 'timestamps'
  interval_seconds?: number
  frame_count?: number
  timestamps?: number[]
  output_directory?: string
  output_format?: 'jpg' | 'png'
  quality?: number
  include_base64?: boolean
}

interface ExtractedFrame {
  frame_number: number
  timestamp: number
  file_path: string
  file_name: string
  base64_data?: string
}

interface ExtractFramesFromVideoOutput {
  frames: ExtractedFrame[]
  total_frames: number
  video_source: string
  output_directory: string
  video_duration?: number
  error?: string
}

/**
 * Extract individual frames from a video file
 */
export default async function extractFramesFromVideo(
  input: ExtractFramesFromVideoInput,
  ctx: ToolContext
): Promise<ExtractFramesFromVideoOutput> {
  const {
    video_source,
    extraction_method = 'count',
    interval_seconds,
    frame_count = 5,
    timestamps,
    output_directory,
    output_format = 'jpg',
    quality = 90,
    include_base64 = false
  } = input

  try {
    // Determine video path
    const videoPath = video_source.startsWith('/')
      ? video_source
      : ctx.resolvePath(undefined, video_source)

    if (!await ctx.fileExists(undefined, video_source)) {
      return {
        frames: [],
        total_frames: 0,
        video_source,
        output_directory: '',
        error: `Video file not found: ${videoPath}`
      }
    }

    // Create output directory
    const outputDir = output_directory
      ? (output_directory.startsWith('/') ? output_directory : ctx.resolvePath(undefined, output_directory))
      : ctx.resolvePath(undefined, 'extracted_frames')

    await ctx.ensureDir(undefined, output_directory || 'extracted_frames')

    // Get video duration
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    const { stdout: durationOutput } = await execAsync(durationCmd)
    const duration = parseFloat(durationOutput.trim())

    // Determine extraction timestamps based on method
    let extractionTimestamps: number[] = []

    switch (extraction_method) {
      case 'interval':
        if (!interval_seconds || interval_seconds <= 0) {
          return {
            frames: [],
            total_frames: 0,
            video_source,
            output_directory: outputDir,
            error: 'interval_seconds must be provided and greater than 0 for interval extraction method'
          }
        }
        for (let t = 0; t < duration; t += interval_seconds) {
          extractionTimestamps.push(t)
        }
        break

      case 'count':
        if (!frame_count || frame_count <= 0) {
          return {
            frames: [],
            total_frames: 0,
            video_source,
            output_directory: outputDir,
            error: 'frame_count must be provided and greater than 0 for count extraction method'
          }
        }
        const interval = duration / (frame_count + 1)
        for (let i = 1; i <= frame_count; i++) {
          extractionTimestamps.push(interval * i)
        }
        break

      case 'timestamps':
        if (!timestamps || timestamps.length === 0) {
          return {
            frames: [],
            total_frames: 0,
            video_source,
            output_directory: outputDir,
            error: 'timestamps array must be provided and non-empty for timestamps extraction method'
          }
        }
        extractionTimestamps = timestamps.filter(t => t >= 0 && t <= duration)
        break
    }

    // Extract frames
    const frames: ExtractedFrame[] = []

    for (let i = 0; i < extractionTimestamps.length; i++) {
      const timestamp = extractionTimestamps[i]
      const fileName = `frame_${i + 1}_${Math.floor(timestamp)}s.${output_format}`
      const outputPath = `${outputDir}/${fileName}`

      // Build ffmpeg command with quality settings
      let ffmpegCmd = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1`

      if (output_format === 'jpg') {
        ffmpegCmd += ` -q:v ${Math.floor((100 - quality) / 3.125)}`
      } else if (output_format === 'png') {
        ffmpegCmd += ` -compression_level ${Math.floor((100 - quality) / 10)}`
      }

      ffmpegCmd += ` -y "${outputPath}"`

      // Execute extraction
      await execAsync(ffmpegCmd)

      // Read base64 data if requested
      let base64Data: string | undefined

      if (include_base64) {
        const frameBuffer = fs.readFileSync(outputPath)
        base64Data = frameBuffer.toString('base64')
      }

      frames.push({
        frame_number: i + 1,
        timestamp,
        file_path: outputPath,
        file_name: fileName,
        base64_data: base64Data
      })
    }

    return {
      frames,
      total_frames: frames.length,
      video_source,
      output_directory: outputDir,
      video_duration: duration
    }
  } catch (error) {
    return {
      frames: [],
      total_frames: 0,
      video_source,
      output_directory: output_directory || '',
      error: formatError(error)
    }
  }
}
