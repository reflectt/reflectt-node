import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { type ToolContext, formatError } from '@/lib/tools/helpers'

const execAsync = promisify(exec)

interface AnalyzeVideoInput {
  video_source: string
  video_type?: 'url' | 'file_path'
  num_frames?: number
  analysis_focus?: 'general' | 'actions' | 'objects' | 'text' | 'people' | 'scenes' | 'summary'
  include_timestamps?: boolean
  max_tokens?: number
}

interface FrameAnalysis {
  frame_number: number
  timestamp?: string
  analysis: string
}

interface AnalyzeVideoOutput {
  overall_summary: string
  frame_analyses: FrameAnalysis[]
  total_frames_analyzed: number
  video_source: string
  tokens_used?: number
  error?: string
}

/**
 * Analyze video content by extracting and analyzing representative frames
 */
export default async function analyzeVideo(
  input: AnalyzeVideoInput,
  ctx: ToolContext
): Promise<AnalyzeVideoOutput> {
  const {
    video_source,
    video_type = 'file_path',
    num_frames = 5,
    analysis_focus = 'general',
    include_timestamps = true,
    max_tokens = 2048
  } = input

  try {
    // Initialize Anthropic client
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return {
        overall_summary: '',
        frame_analyses: [],
        total_frames_analyzed: 0,
        video_source,
        error: 'ANTHROPIC_API_KEY environment variable not set'
      }
    }

    const client = new Anthropic({ apiKey })

    // Determine video path
    let videoPath: string

    if (video_type === 'url') {
      return {
        overall_summary: '',
        frame_analyses: [],
        total_frames_analyzed: 0,
        video_source,
        error: 'URL video sources not yet implemented. Please download video and use file_path.'
      }
    } else {
      videoPath = video_source.startsWith('/')
        ? video_source
        : ctx.resolvePath(undefined, video_source)

      if (!await ctx.fileExists(undefined, video_source)) {
        return {
          overall_summary: '',
          frame_analyses: [],
          total_frames_analyzed: 0,
          video_source,
          error: `Video file not found: ${videoPath}`
        }
      }
    }

    // Extract frames using ffmpeg (requires ffmpeg to be installed)
    const tempDir = ctx.resolvePath(undefined, 'temp_frames')
    await ctx.ensureDir(undefined, 'temp_frames')

    try {
      // Get video duration first
      const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
      const { stdout: durationOutput } = await execAsync(durationCmd)
      const duration = parseFloat(durationOutput.trim())

      // Calculate frame extraction intervals
      const interval = duration / (num_frames + 1)

      const frameAnalyses: FrameAnalysis[] = []
      let totalTokens = 0

      // Extract and analyze each frame
      for (let i = 1; i <= num_frames; i++) {
        const timestamp = interval * i
        const outputPath = ctx.resolvePath(undefined, 'temp_frames', `frame_${i}.jpg`)

        // Extract frame at specific timestamp
        const extractCmd = `ffmpeg -ss ${timestamp} -i "${videoPath}" -vframes 1 -y "${outputPath}"`
        await execAsync(extractCmd)

        // Read frame and convert to base64
        const frameBuffer = fs.readFileSync(outputPath)
        const base64Frame = frameBuffer.toString('base64')

        // Build analysis prompt based on focus
        let prompt = ''
        switch (analysis_focus) {
          case 'actions':
            prompt = 'Describe all actions and movements visible in this frame.'
            break
          case 'objects':
            prompt = 'List and describe all objects visible in this frame.'
            break
          case 'text':
            prompt = 'Extract and transcribe all visible text in this frame.'
            break
          case 'people':
            prompt = 'Describe all people visible in this frame, including their actions and appearance.'
            break
          case 'scenes':
            prompt = 'Describe the scene, setting, and environment in this frame.'
            break
          case 'summary':
            prompt = 'Provide a comprehensive summary of everything visible in this frame.'
            break
          default:
            prompt = 'Describe what you see in this frame.'
        }

        // Analyze frame with Claude
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: Math.floor(max_tokens / num_frames),
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: base64Frame
                  }
                },
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }
          ]
        })

        const analysis = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('\n')

        totalTokens += response.usage.input_tokens + response.usage.output_tokens

        frameAnalyses.push({
          frame_number: i,
          timestamp: include_timestamps ? `${Math.floor(timestamp / 60)}:${Math.floor(timestamp % 60).toString().padStart(2, '0')}` : undefined,
          analysis
        })

        // Clean up frame file
        fs.unlinkSync(outputPath)
      }

      // Generate overall summary
      const summaryPrompt = `Based on these ${num_frames} frame analyses from a video, provide a comprehensive overall summary:\n\n${frameAnalyses.map(fa => `Frame ${fa.frame_number} (${fa.timestamp}): ${fa.analysis}`).join('\n\n')}`

      const summaryResponse = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: summaryPrompt
          }
        ]
      })

      const overallSummary = summaryResponse.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n')

      totalTokens += summaryResponse.usage.input_tokens + summaryResponse.usage.output_tokens

      return {
        overall_summary: overallSummary,
        frame_analyses: frameAnalyses,
        total_frames_analyzed: num_frames,
        video_source,
        tokens_used: totalTokens
      }
    } catch (ffmpegError) {
      return {
        overall_summary: '',
        frame_analyses: [],
        total_frames_analyzed: 0,
        video_source,
        error: `FFmpeg error: ${formatError(ffmpegError)}. Make sure ffmpeg is installed.`
      }
    } finally {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    return {
      overall_summary: '',
      frame_analyses: [],
      total_frames_analyzed: 0,
      video_source,
      error: formatError(error)
    }
  }
}
