import { AssemblyAI } from 'assemblyai'
import * as fs from 'fs'
import * as path from 'path'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface AnalyzeAudioInput {
  audio_source: string
  audio_type?: 'file_path' | 'url'
  features?: {
    speaker_labels?: boolean
    sentiment_analysis?: boolean
    auto_chapters?: boolean
    entity_detection?: boolean
    content_safety?: boolean
    iab_categories?: boolean
  }
  speaker_count?: number
  language_code?: string
}

interface AnalyzeAudioOutput {
  transcript: string
  speakers?: Array<{
    speaker: string
    text: string
    start: number
    end: number
    confidence: number
  }>
  sentiment?: Array<{
    text: string
    sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'
    confidence: number
    start: number
    end: number
  }>
  chapters?: Array<{
    summary: string
    headline: string
    start: number
    end: number
  }>
  entities?: Array<{
    entity_type: string
    text: string
    start: number
    end: number
  }>
  content_safety?: {
    labels: Array<{
      label: string
      confidence: number
      severity: number
    }>
    summary: object
  }
  topics?: Array<{
    text: string
    labels: Array<{
      relevance: number
      label: string
    }>
  }>
  duration: number
  cost?: number
  error?: string
}

/**
 * Analyze audio with advanced features using AssemblyAI
 */
export default async function analyzeAudio(
  input: AnalyzeAudioInput,
  ctx: ToolContext
): Promise<AnalyzeAudioOutput> {
  const {
    audio_source,
    audio_type = 'file_path',
    features = {},
    speaker_count,
    language_code = 'en'
  } = input

  try {
    // Initialize AssemblyAI client
    const apiKey = process.env.ASSEMBLYAI_API_KEY
    if (!apiKey) {
      return {
        transcript: '',
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
          transcript: '',
          duration: 0,
          error: `Audio file not found: ${filePath}`
        }
      }

      // Upload file to AssemblyAI
      audioUrl = await client.files.upload(filePath)
    } else {
      audioUrl = audio_source
    }

    // Prepare transcription config
    const config: any = {
      audio_url: audioUrl,
      language_code,
      speaker_labels: features.speaker_labels || false,
      sentiment_analysis: features.sentiment_analysis || false,
      auto_chapters: features.auto_chapters || false,
      entity_detection: features.entity_detection || false,
      content_safety: features.content_safety || false,
      iab_categories: features.iab_categories || false
    }

    if (speaker_count) {
      config.speakers_expected = speaker_count
    }

    // Submit transcription
    const transcript = await client.transcripts.transcribe(config)

    if (transcript.status === 'error') {
      return {
        transcript: '',
        duration: 0,
        error: `Transcription failed: ${transcript.error}`
      }
    }

    // Calculate cost (AssemblyAI is ~$0.00025 per second)
    const duration = (transcript.audio_duration || 0) / 1000 // Convert ms to seconds
    const cost = duration * 0.00025

    // Build output
    const output: AnalyzeAudioOutput = {
      transcript: transcript.text || '',
      duration,
      cost: parseFloat(cost.toFixed(4))
    }

    // Add speaker information
    if (features.speaker_labels && transcript.utterances) {
      output.speakers = transcript.utterances.map((utt: any) => ({
        speaker: utt.speaker,
        text: utt.text,
        start: utt.start / 1000,
        end: utt.end / 1000,
        confidence: utt.confidence
      }))
    }

    // Add sentiment analysis
    if (features.sentiment_analysis && transcript.sentiment_analysis_results) {
      output.sentiment = transcript.sentiment_analysis_results.map((sent: any) => ({
        text: sent.text,
        sentiment: sent.sentiment,
        confidence: sent.confidence,
        start: sent.start / 1000,
        end: sent.end / 1000
      }))
    }

    // Add chapters
    if (features.auto_chapters && transcript.chapters) {
      output.chapters = transcript.chapters.map((ch: any) => ({
        summary: ch.summary,
        headline: ch.headline,
        start: ch.start / 1000,
        end: ch.end / 1000
      }))
    }

    // Add entities
    if (features.entity_detection && transcript.entities) {
      output.entities = transcript.entities.map((ent: any) => ({
        entity_type: ent.entity_type,
        text: ent.text,
        start: ent.start / 1000,
        end: ent.end / 1000
      }))
    }

    // Add content safety
    if (features.content_safety && transcript.content_safety_labels) {
      output.content_safety = {
        labels: transcript.content_safety_labels.results.map((label: any) => ({
          label: label.label,
          confidence: label.confidence,
          severity: label.severity
        })),
        summary: transcript.content_safety_labels.summary
      }
    }
    
    // Add topics
    if (features.iab_categories && transcript.iab_categories_result) {
      output.topics = transcript.iab_categories_result.results.map((topic: any) => ({
        text: topic.text,
        labels: topic.labels.map((label: any) => ({
          relevance: label.relevance,
          label: label.label
        }))
      }))
    }

    return output
  } catch (error: any) {
    return {
      transcript: '',
      duration: 0,
      error: formatError(error)
    }
  }
}
