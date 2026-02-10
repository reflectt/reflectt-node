import { ElevenLabsClient } from 'elevenlabs'
import * as path from 'path'
import {
  type ToolContext,
  formatError,
} from '@/lib/tools/helpers'
import { TextToSpeechConvertRequestOutputFormat } from 'elevenlabs/api/resources/textToSpeech/types/TextToSpeechConvertRequestOutputFormat'
import { getStorage } from '@/lib/storage/storage-manager'

interface TextToSpeechInput {
  text: string
  voice_preset?: 'default' | 'singing' | 'narrative' | 'conversational' | 'dramatic' | 'calm' | 'energetic'
  voice_id?: string
  voice_settings?: {
    stability?: number
    similarity_boost?: number
    style?: number
    use_speaker_boost?: boolean
  }
  model_id?: string
  output_format?: string
  output_path?: string
}

interface TextToSpeechOutput {
  audio_path: string
  audio_url?: string
  duration?: number
  character_count: number
  cost?: number
  voice_id: string
  error?: string
}

/**
 * Voice presets with optimized settings and voice IDs
 */
const VOICE_PRESETS = {
  default: {
    voice_id: '21m00Tcm4TlvDq8ikWAM', // Rachel - clear, neutral
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true
  },
  singing: {
    // Use env var for custom singing voice, or use "The Soulful Songstress" by default
    // This is an actual singing voice from ElevenLabs Voice Library
    voice_id: process.env.ELEVENLABS_SINGING_VOICE_ID || 'ThT5KcBeYPX3keUQqHPh',
    stability: 0.3, // Lower for more expressiveness in singing
    similarity_boost: 0.8,
    style: 0.8, // High style for musical performance
    use_speaker_boost: false // Don't boost for singing
  },
  narrative: {
    voice_id: 'N2lVS1w4EtoT3dr4eOWO', // Callum - great for narration
    stability: 0.7, // Higher for consistency in long narration
    similarity_boost: 0.75,
    style: 0.2,
    use_speaker_boost: true
  },
  conversational: {
    voice_id: '21m00Tcm4TlvDq8ikWAM', // Rachel - natural conversation
    stability: 0.4,
    similarity_boost: 0.7,
    style: 0.1,
    use_speaker_boost: true
  },
  dramatic: {
    voice_id: 'onwK4e9ZLuTAKqWW03F9', // Daniel - dramatic voice
    stability: 0.4,
    similarity_boost: 0.8,
    style: 0.7, // High style for dramatic effect
    use_speaker_boost: true
  },
  calm: {
    voice_id: 'EXAVITQu4vr4xnSDxMaL', // Bella - soft, calm voice
    stability: 0.8, // Very stable for calming effect
    similarity_boost: 0.6,
    style: 0,
    use_speaker_boost: false
  },
  energetic: {
    voice_id: 'pNInz6obpgDQGcFmaJgB', // Adam - energetic
    stability: 0.3,
    similarity_boost: 0.85,
    style: 0.5,
    use_speaker_boost: true
  }
};

/**
 * Generate speech from text using ElevenLabs API
 */
export default async function textToSpeech(
  input: TextToSpeechInput,
  ctx: ToolContext
): Promise<TextToSpeechOutput> {
  const {
    text,
    voice_preset = 'default',
    voice_id: customVoiceId,
    voice_settings: customSettings = {},
    model_id: customModelId,
    output_format = 'mp3_44100_128',
    output_path
  } = input

  // Get preset settings early so voice_id is in scope for error handling
  const preset = VOICE_PRESETS[voice_preset];
  const voice_id = customVoiceId || preset.voice_id;
  
  // Use eleven_multilingual_v1 for singing (required by singing voices), v2 for others
  const model_id = customModelId || (voice_preset === 'singing' ? 'eleven_multilingual_v1' : 'eleven_multilingual_v2');

  try {
    // Validate text length
    if (text.length > 5000) {
      return {
        audio_path: '',
        character_count: text.length,
        voice_id,
        error: `Text too long: ${text.length} characters. Maximum is 5000 characters per request.`
      }
    }

    // Initialize ElevenLabs client
    const apiKey = process.env.ELEVENLABS_API_KEY
    console.log('[text_to_speech] API key check:', apiKey ? `${apiKey.slice(0, 15)}... (${apiKey.length} chars)` : 'NOT SET')
    if (!apiKey) {
      return {
        audio_path: '',
        character_count: text.length,
        voice_id,
        error: 'ELEVENLABS_API_KEY environment variable not set'
      }
    }

    const client = new ElevenLabsClient({ apiKey })
    
    // Merge preset settings with custom settings (custom settings take priority)
    const settings = {
      stability: customSettings.stability ?? preset.stability,
      similarity_boost: customSettings.similarity_boost ?? preset.similarity_boost,
      style: customSettings.style ?? preset.style,
      use_speaker_boost: customSettings.use_speaker_boost ?? preset.use_speaker_boost
    }

    console.log(`[text_to_speech] Using voice preset: ${voice_preset}, voice_id: ${voice_id}, model: ${model_id}`);

    // Generate audio using direct fetch (SDK has issues with 403)
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: settings,
        output_format: output_format
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const audioBuffer = await response.arrayBuffer()
    const audio = Buffer.from(audioBuffer)

    // Determine filename
    let filename: string
    if (output_path) {
      // Extract filename from output_path
      filename = path.basename(output_path)
    } else {
      // Generate filename with timestamp
      const timestamp = Date.now()
      filename = `tts_${timestamp}.mp3`
    }

    // Get storage manager and save to Supabase storage or filesystem
    const storage = getStorage()
    const storagePath = await storage.save(
      ctx.currentSpace,
      'audio/generated',
      filename,
      audio
    )

    // Build final path for backwards compatibility
    const finalPath = ctx.resolvePath(undefined, storagePath)

    // Calculate cost (ElevenLabs is ~$0.30 per 1000 characters)
    const cost = (text.length / 1000) * 0.30

    // Estimate duration (average speaking rate is ~150 words per minute)
    const wordCount = text.split(/\s+/).length
    const estimatedDuration = (wordCount / 150) * 60 // in seconds

    return {
      audio_path: finalPath,
      character_count: text.length,
      cost: parseFloat(cost.toFixed(4)),
      voice_id,
      duration: parseFloat(estimatedDuration.toFixed(2))
    }
  } catch (error: any) {
    // Try to read the error body if it's a stream
    let errorBody = error.body
    if (error.body && typeof error.body.getReader === 'function') {
      try {
        const reader = error.body.getReader()
        const decoder = new TextDecoder()
        let bodyText = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bodyText += decoder.decode(value, { stream: true })
        }
        errorBody = bodyText ? JSON.parse(bodyText) : {}
      } catch (e) {
        errorBody = 'Failed to read error body'
      }
    }

    console.error('[text_to_speech] Error details:', {
      message: error.message,
      statusCode: error.statusCode,
      body: errorBody,
      stack: error.stack?.split('\n')[0]
    })
    return {
      audio_path: '',
      character_count: text.length,
      voice_id,
      error: formatError(error)
    }
  }
}
