import OpenAI from 'openai'
import * as fs from 'fs'
import * as path from 'path'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface TranscribeAudioInput {
  audio_source: string
  audio_type?: 'file_path' | 'url'
  language?: string
  prompt?: string
  response_format?: 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json'
  temperature?: number
  timestamp_granularities?: ('word' | 'segment')[]
}

interface TranscribeAudioOutput {
  text: string
  language?: string
  duration?: number
  segments?: Array<{
    id: number
    start: number
    end: number
    text: string
  }>
  words?: Array<{
    word: string
    start: number
    end: number
  }>
  tokens_used?: number
  cost?: number
  error?: string
}

/**
 * Transcribe audio to text using OpenAI Whisper API
 */
export default async function transcribeAudio(
  input: TranscribeAudioInput,
  ctx: ToolContext
): Promise<TranscribeAudioOutput> {
  const {
    audio_source,
    audio_type = 'file_path',
    language,
    prompt,
    response_format = 'verbose_json',
    temperature = 0,
    timestamp_granularities
  } = input

  try {
    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return {
        text: '',
        error: 'OPENAI_API_KEY environment variable not set'
      }
    }

    const client = new OpenAI({ apiKey })

    // Handle file path
    let audioFile: File | fs.ReadStream
    let filePath: string

    if (audio_type === 'file_path') {
      filePath = path.isAbsolute(audio_source)
        ? audio_source
        : ctx.resolvePath(undefined, audio_source)

      if (!await checkFileExists(filePath)) {
        return {
          text: '',
          error: `Audio file not found: ${filePath}`
        }
      }

      // Check file size (max 25MB for Whisper)
      const stats = fs.statSync(filePath)
      if (stats.size > 25 * 1024 * 1024) {
        return {
          text: '',
          error: `File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Maximum is 25MB.`
        }
      }

      audioFile = fs.createReadStream(filePath) as any
    } else {
      return {
        text: '',
        error: 'URL audio sources not yet supported. Please provide a file path.'
      }
    }

    // Prepare request parameters
    const params: any = {
      file: audioFile,
      model: 'whisper-1',
      response_format,
      temperature
    }

    if (language) params.language = language
    if (prompt) params.prompt = prompt
    if (timestamp_granularities) params.timestamp_granularities = timestamp_granularities

    // Call Whisper API
    const response = await client.audio.transcriptions.create(params)

    // Parse response based on format
    if (response_format === 'verbose_json') {
      const verboseResponse = response as any
      
      // Calculate cost (Whisper is $0.006 per minute)
      const duration = verboseResponse.duration || 0
      const cost = (duration / 60) * 0.006

      return {
        text: verboseResponse.text,
        language: verboseResponse.language,
        duration: verboseResponse.duration,
        segments: verboseResponse.segments,
        words: verboseResponse.words,
        cost: parseFloat(cost.toFixed(4))
      }
    } else if (response_format === 'json') {
      const jsonResponse = response as any
      return {
        text: jsonResponse.text
      }
    } else {
      // text, srt, vtt formats return plain string
      return {
        text: response as any as string
      }
    }
  } catch (error: any) {
    return {
      text: '',
      error: formatError(error)
    }
  }
}
