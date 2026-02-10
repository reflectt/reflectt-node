import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import type { MoodKey, TimeOfDay } from '@/lib/theme/moods'

interface UpdateThemeInput {
  mood: MoodKey
  timeOfDay?: TimeOfDay
  animate?: boolean
  reason?: string
}

interface UpdateThemeSuccess {
  success: true
  theme_update: {
    mood: MoodKey
    timeOfDay?: TimeOfDay
    animate: boolean
    reason?: string
    timestamp: string
  }
  space_id: string
}

interface UpdateThemeFailure {
  success: false
  error: string
  space_id: string
}

type UpdateThemeOutput = UpdateThemeSuccess | UpdateThemeFailure

/**
 * update_theme - Streaming UI Tool
 * 
 * Dynamically changes the application mood/theme. This is a streaming UI control
 * tool - the payload passes through the server and is handled client-side by
 * the chat UI as the tool call streams in.
 * 
 * The theme change is processed by:
 * 1. Server validates the mood/timeOfDay values
 * 2. Returns success payload with theme_update object
 * 3. Client-side chat UI listens for tool calls with theme_update
 * 4. Calls setTheme(mood) from next-themes hook
 * 5. Optionally applies timeOfDay-specific gradients
 * 6. Animates transition if animate=true
 * 
 * Moods:
 * - light: Bright, crisp mission control
 * - dark: Low-light focus with neon accents
 * - aurora: Vivid teal & magenta energy
 * - oceanic: Calm blues with glacial greens
 * - solstice: Warm amber command deck
 * 
 * Time-of-Day Gradients (per mood):
 * - morning: Dawn colors, fresh start
 * - afternoon: Mid-day balanced lighting
 * - evening: Dusk transitions
 * - night: Dark mode variations
 */
export default async function updateThemeTool(
  input: unknown,
  ctx: ToolContext
): Promise<UpdateThemeOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    if (!params.mood || typeof params.mood !== 'string') {
      throw new Error('Missing required parameter: mood')
    }

    const validMoods: MoodKey[] = ['light', 'dark', 'aurora', 'oceanic', 'solstice']
    const mood = params.mood as MoodKey

    if (!validMoods.includes(mood)) {
      throw new Error(`Invalid mood: "${params.mood}". Must be one of: ${validMoods.join(', ')}`)
    }

    let timeOfDay: TimeOfDay | undefined = undefined
    if (params.timeOfDay) {
      const validTimes: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night']
      if (!validTimes.includes(params.timeOfDay)) {
        throw new Error(`Invalid timeOfDay: "${params.timeOfDay}". Must be one of: ${validTimes.join(', ')}`)
      }
      timeOfDay = params.timeOfDay as TimeOfDay
    }

    const animate = params.animate !== false // Default to true
    const reason = params.reason && typeof params.reason === 'string' ? params.reason.trim() : undefined

    // Log theme change for debugging
    console.log('[update_theme]', {
      mood,
      timeOfDay,
      animate,
      reason,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      theme_update: {
        mood,
        timeOfDay,
        animate,
        reason,
        timestamp: now()
      },
      space_id: ctx.currentSpace
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: ctx.currentSpace
    }
  }
}
