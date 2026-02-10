import { logger } from '@/lib/observability/logger'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

/**
 * Supported visual effects
 */
export type VisualEffect =
  | 'confetti'
  | 'balloons'
  | 'fireworks'
  | 'sparkles'
  | 'red-alert'
  | 'rainbow'
  | 'snow'
  | 'stars'
  | 'hearts'
  | '2030'

/**
 * Intensity level for effects
 */
export type EffectIntensity = 'low' | 'medium' | 'high'

/**
 * Position where effect should appear
 */
export type EffectPosition = 'full-screen' | 'top' | 'center' | 'bottom'

/**
 * Input parameters for trigger_visual_effect tool
 */
interface TriggerVisualEffectInput {
  effect: VisualEffect
  duration?: number
  intensity?: EffectIntensity
  message?: string
  position?: EffectPosition
}

/**
 * Output for trigger_visual_effect tool
 */
interface TriggerVisualEffectOutput {
  success: boolean
  effect_triggered?: VisualEffect
  duration?: number
  intensity?: EffectIntensity
  message?: string
  position?: EffectPosition
  effect_id?: string
  timestamp?: string
  error?: string
}

/**
 * Validate effect intensity
 */
function validateIntensity(intensity?: string): EffectIntensity {
  const validIntensities: EffectIntensity[] = ['low', 'medium', 'high']
  if (!intensity || !validIntensities.includes(intensity as EffectIntensity)) {
    return 'medium'
  }
  return intensity as EffectIntensity
}

/**
 * Validate effect position
 */
function validatePosition(position?: string): EffectPosition {
  const validPositions: EffectPosition[] = ['full-screen', 'top', 'center', 'bottom']
  if (!position || !validPositions.includes(position as EffectPosition)) {
    return 'full-screen'
  }
  return position as EffectPosition
}

/**
 * Validate visual effect
 */
function validateEffect(effect: string): boolean {
  const validEffects: VisualEffect[] = [
    'confetti',
    'balloons',
    'fireworks',
    'sparkles',
    'red-alert',
    'rainbow',
    'snow',
    'stars',
    'hearts',
    '2030'
  ]
  return validEffects.includes(effect as VisualEffect)
}

/**
 * Get effect metadata for UI rendering
 */
function getEffectMetadata(effect: VisualEffect, intensity: EffectIntensity) {
  const metadata: Record<VisualEffect, Record<string, any>> = {
    confetti: {
      particleCount: intensity === 'low' ? 30 : intensity === 'medium' ? 60 : 150,
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#ffd93d', '#f38181'],
      physics: {
        gravity: 0.3,
        friction: 0.95
      }
    },
    balloons: {
      count: intensity === 'low' ? 8 : intensity === 'medium' ? 15 : 25,
      colors: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#ffd93d', '#95e1d3'],
      floatSpeed: intensity === 'low' ? 2 : intensity === 'medium' ? 3 : 4
    },
    fireworks: {
      bursts: intensity === 'low' ? 3 : intensity === 'medium' ? 5 : 8,
      particlesPerBurst: intensity === 'low' ? 30 : intensity === 'medium' ? 60 : 100,
      colors: ['#ff006e', '#ffbe0b', '#8338ec', '#3a86ff', '#fb5607']
    },
    sparkles: {
      particleCount: intensity === 'low' ? 20 : intensity === 'medium' ? 40 : 80,
      colors: ['#ffd700', '#ffffff', '#87ceeb'],
      decay: 0.9
    },
    'red-alert': {
      pulseCount: intensity === 'low' ? 3 : intensity === 'medium' ? 5 : 10,
      color: '#ff0000',
      opacity: intensity === 'low' ? 0.3 : intensity === 'medium' ? 0.5 : 0.8,
      soundEnabled: intensity !== 'low'
    },
    rainbow: {
      colors: ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#9400d3'],
      speed: intensity === 'low' ? 1 : intensity === 'medium' ? 2 : 3
    },
    snow: {
      particleCount: intensity === 'low' ? 30 : intensity === 'medium' ? 80 : 150,
      fallSpeed: intensity === 'low' ? 1 : intensity === 'medium' ? 2 : 3,
      particleSize: intensity === 'low' ? 4 : intensity === 'medium' ? 6 : 10
    },
    stars: {
      count: intensity === 'low' ? 30 : intensity === 'medium' ? 60 : 100,
      colors: ['#ffd700', '#ffffff', '#ffff99'],
      twinkleSpeed: intensity === 'low' ? 1 : intensity === 'medium' ? 2 : 3
    },
    hearts: {
      count: intensity === 'low' ? 15 : intensity === 'medium' ? 30 : 50,
      colors: ['#ff0000', '#ff69b4', '#ff1493'],
      floatSpeed: intensity === 'low' ? 1 : intensity === 'medium' ? 2 : 3
    },
    '2030': {
      particleCount: intensity === 'low' ? 50 : intensity === 'medium' ? 100 : 200,
      colors: ['#00d9ff', '#0099ff', '#9d00ff', '#ff00ff', '#00ff99'],
      style: 'cyberpunk'
    }
  }

  return metadata[effect] || {}
}

/**
 * Generate a unique effect ID
 */
function generateEffectId(): string {
  return `effect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Trigger a visual effect in the UI
 *
 * This tool creates a visual effect event that will be sent to the frontend
 * via Server-Sent Events (SSE). The frontend receives the event and renders
 * the appropriate animation.
 *
 * @param input - Visual effect parameters
 * @param _context - Tool context (not used for this tool)
 * @returns Result object with effect details
 */
export default async function triggerVisualEffect(
  input: TriggerVisualEffectInput,
  _context: ToolContext
): Promise<TriggerVisualEffectOutput> {
  try {
    const { effect, duration = 3000, intensity = 'medium', message, position = 'full-screen' } = input

    // Validate effect type
    if (!effect || !validateEffect(effect)) {
      return {
        success: false,
        error: `Invalid effect: "${effect}". Valid effects are: confetti, balloons, fireworks, sparkles, red-alert, rainbow, snow, stars, hearts, 2030`
      }
    }

    // Validate and normalize parameters
    const validatedIntensity = validateIntensity(intensity)
    const validatedPosition = validatePosition(position)
    const validatedDuration = Math.max(500, Math.min(duration, 30000)) // Clamp between 500ms and 30s

    // Generate effect ID and timestamp
    const effectId = generateEffectId()
    const timestamp = new Date().toISOString()

    // Get effect-specific metadata
    const effectMetadata = getEffectMetadata(effect as VisualEffect, validatedIntensity)

    // Log the effect trigger
    logger.info('visual_effect_triggered', {
      effect,
      intensity: validatedIntensity,
      position: validatedPosition,
      duration: validatedDuration,
      message: message || 'none',
      effectId
    })

    // Return effect trigger data
    // This response includes metadata that can be used for:
    // 1. SSE event streaming to frontend
    // 2. Analytics tracking
    // 3. Effect synchronization across sessions
    return {
      success: true,
      effect_triggered: effect as VisualEffect,
      duration: validatedDuration,
      intensity: validatedIntensity,
      message: message || undefined,
      position: validatedPosition,
      effect_id: effectId,
      timestamp,
      // Additional metadata for frontend rendering (embedded in SSE event)
      // This gets included in the tool response and can be extracted by handlers
    }
  } catch (error) {
    logger.error('visual_effect_trigger_failed', error as Error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to trigger visual effect'
    }
  }
}

/**
 * Export metadata for SSE event builder
 * This is used by stream handlers to construct the SSE event payload
 */
export function getVisualEffectEventPayload(
  input: TriggerVisualEffectInput,
  result: TriggerVisualEffectOutput
) {
  if (!result.success) {
    return null
  }

  return {
    type: 'visual_effect',
    effect: result.effect_triggered,
    duration: result.duration,
    intensity: result.intensity,
    message: result.message,
    position: result.position,
    effect_id: result.effect_id,
    timestamp: result.timestamp,
    metadata: getEffectMetadata(
      result.effect_triggered as VisualEffect,
      result.intensity as EffectIntensity
    )
  }
}
