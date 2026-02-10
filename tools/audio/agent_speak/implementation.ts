import {
  type ToolContext,
  formatError,
} from '@/lib/tools/helpers'

interface AgentSpeakInput {
  text: string
  voice_preset?: 'conversational' | 'calm' | 'energetic' | 'dramatic' | 'narrative'
  priority?: 'low' | 'normal' | 'high' | 'interrupt'
}

interface AgentSpeakOutput {
  success: boolean
  audio_path?: string
  audio_url?: string
  character_count: number
  speech_control?: {
    action: 'play'
    audio_url: string
    priority: string
    text: string
  }
  error?: string
}

/**
 * Agent Speak - Generate speech with UI auto-play control
 *
 * This tool wraps text_to_speech and adds UI streaming metadata
 * to enable automatic audio playback in the browser.
 */
export default async function agentSpeak(
  input: AgentSpeakInput,
  ctx: ToolContext
): Promise<AgentSpeakOutput> {
  const {
    text,
    voice_preset = 'conversational',
    priority = 'normal'
  } = input

  try {
    // Validate text length
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        character_count: 0,
        error: 'Text is required and cannot be empty'
      }
    }

    if (text.length > 1000) {
      return {
        success: false,
        character_count: text.length,
        error: `Text too long: ${text.length} characters. Maximum is 1000 characters for optimal user experience.`
      }
    }

    // Call the text_to_speech tool using executeTool
    const ttsResult = await ctx.executeTool<any, any>('text_to_speech', {
      text,
      voice_preset,
      // Use turbo model for faster response
      model_id: 'eleven_turbo_v2_5',
      // Use high-quality audio format
      output_format: 'mp3_44100_192'
    })

    // Check for errors from text_to_speech
    if (ttsResult.error) {
      return {
        success: false,
        character_count: text.length,
        error: `Failed to generate speech: ${ttsResult.error}`
      }
    }

    // Extract audio path from text_to_speech result
    const audioPath = ttsResult.audio_path
    if (!audioPath) {
      return {
        success: false,
        character_count: text.length,
        error: 'No audio file was generated'
      }
    }

    // Generate audio URL for browser playback
    // Extract filename from path
    const filename = audioPath.split('/').pop() || ''
    // Include spaceId in URL so the audio route knows where to look
    const audioUrl = `/api/audio/${filename}?spaceId=${ctx.currentSpace}`
    console.log('[agent_speak] Generated audio URL:', { filename, spaceId: ctx.currentSpace, audioUrl })

    // Return result with speech_control object for UI streaming
    return {
      success: true,
      audio_path: audioPath,
      audio_url: audioUrl,
      character_count: text.length,
      speech_control: {
        action: 'play',
        audio_url: audioUrl,
        priority: priority,
        text: text
      }
    }
  } catch (error: any) {
    return {
      success: false,
      character_count: text.length,
      error: formatError(error)
    }
  }
}
