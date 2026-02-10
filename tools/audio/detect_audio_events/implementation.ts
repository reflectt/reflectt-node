import { AssemblyAI } from 'assemblyai'
import * as path from 'path'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface DetectAudioEventsInput {
  audio_source: string
  audio_type?: 'file_path' | 'url'
  event_types?: Array<'applause' | 'music' | 'silence' | 'speech' | 'laughter' | 'noise'>
  silence_threshold?: number
  min_event_duration?: number
}

interface DetectAudioEventsOutput {
  events: Array<{
    type: string
    start: number
    end: number
    duration: number
    confidence: number
  }>
  summary: {
    total_events: number
    events_by_type: Record<string, number>
    total_silence: number
    total_speech: number
    total_music: number
  }
  duration: number
  cost?: number
  error?: string
}

/**
 * Detect audio events using AssemblyAI
 */
export default async function detectAudioEvents(
  input: DetectAudioEventsInput,
  ctx: ToolContext
): Promise<DetectAudioEventsOutput> {
  const {
    audio_source,
    audio_type = 'file_path',
    event_types = ['music', 'silence'],
    silence_threshold = 500,
    min_event_duration = 100
  } = input

  try {
    // Initialize AssemblyAI client
    const apiKey = process.env.ASSEMBLYAI_API_KEY
    if (!apiKey) {
      return {
        events: [],
        summary: {
          total_events: 0,
          events_by_type: {},
          total_silence: 0,
          total_speech: 0,
          total_music: 0
        },
        duration: 0,
        error: 'ASSEMBLYAI_API_KEY environment variable not set'
      }
    }

    const client = new AssemblyAI({ apiKey })

    // Handle audio source
    let audioUrl: string

    if (audio_type === 'file_path') {
      const filePath = path.isAbsolute(audio_source)
        ? audio_source
        : ctx.resolvePath(undefined, audio_source)

      if (!await checkFileExists(filePath)) {
        return {
          events: [],
          summary: {
            total_events: 0,
            events_by_type: {},
            total_silence: 0,
            total_speech: 0,
            total_music: 0
          },
          duration: 0,
          error: `Audio file not found: ${filePath}`
        }
      }

      // Upload file to AssemblyAI
      audioUrl = await client.files.upload(filePath)
    } else {
      audioUrl = audio_source
    }

    // Configure transcription with audio intelligence features
    const config: any = {
      audio_url: audioUrl
    }

    // Submit transcription
    const transcript = await client.transcripts.transcribe(config)

    if (transcript.status === 'error') {
      return {
        events: [],
        summary: {
          total_events: 0,
          events_by_type: {},
          total_silence: 0,
          total_speech: 0,
          total_music: 0
        },
        duration: 0,
        error: `Transcription failed: ${transcript.error}`
      }
    }

    // Calculate duration and cost
    const duration = (transcript.audio_duration || 0) / 1000
    const cost = duration * 0.00025

    // Process words to detect silence (gaps between words)
    const events: Array<{
      type: string
      start: number
      end: number
      duration: number
      confidence: number
    }> = []

    // Detect silence between words
    if (event_types.includes('silence') && transcript.words) {
      for (let i = 0; i < transcript.words.length - 1; i++) {
        const currentWord = transcript.words[i]
        const nextWord = transcript.words[i + 1]
        
        const silenceStart = currentWord.end / 1000
        const silenceEnd = nextWord.start / 1000
        const silenceDuration = (silenceEnd - silenceStart) * 1000 // in ms

        if (silenceDuration >= silence_threshold) {
          events.push({
            type: 'silence',
            start: silenceStart,
            end: silenceEnd,
            duration: silenceEnd - silenceStart,
            confidence: 1.0
          })
        }
      }
    }

    // Detect speech segments
    if (event_types.includes('speech') && transcript.words) {
      let speechStart = transcript.words[0]?.start / 1000 || 0
      let speechEnd = transcript.words[0]?.end / 1000 || 0

      for (let i = 1; i < transcript.words.length; i++) {
        const word = transcript.words[i]
        const prevWord = transcript.words[i - 1]
        
        const gap = (word.start - prevWord.end) / 1000

        // If gap is larger than threshold, end current speech segment
        if (gap > silence_threshold / 1000) {
          if ((speechEnd - speechStart) * 1000 >= min_event_duration) {
            events.push({
              type: 'speech',
              start: speechStart,
              end: speechEnd,
              duration: speechEnd - speechStart,
              confidence: 0.95
            })
          }
          speechStart = word.start / 1000
        }
        
        speechEnd = word.end / 1000
      }

      // Add final speech segment
      if ((speechEnd - speechStart) * 1000 >= min_event_duration) {
        events.push({
          type: 'speech',
          start: speechStart,
          end: speechEnd,
          duration: speechEnd - speechStart,
          confidence: 0.95
        })
      }
    }

    // Calculate summary
    const eventsByType: Record<string, number> = {}
    let totalSilence = 0
    let totalSpeech = 0
    let totalMusic = 0

    events.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
      
      if (event.type === 'silence') totalSilence += event.duration
      if (event.type === 'speech') totalSpeech += event.duration
      if (event.type === 'music') totalMusic += event.duration
    })

    return {
      events,
      summary: {
        total_events: events.length,
        events_by_type: eventsByType,
        total_silence: parseFloat(totalSilence.toFixed(2)),
        total_speech: parseFloat(totalSpeech.toFixed(2)),
        total_music: parseFloat(totalMusic.toFixed(2))
      },
      duration,
      cost: parseFloat(cost.toFixed(4))
    }
  } catch (error: any) {
    return {
      events: [],
      summary: {
        total_events: 0,
        events_by_type: {},
        total_silence: 0,
        total_speech: 0,
        total_music: 0
      },
      duration: 0,
      error: formatError(error)
    }
  }
}
