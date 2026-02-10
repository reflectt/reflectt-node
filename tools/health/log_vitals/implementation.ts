/**
 * Log Vitals Tool
 *
 * Logs vital signs like heart rate, blood pressure, body temperature, and oxygen
 * saturation for health monitoring.
 *
 * @module tools/health/log_vitals
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { logger } from '@/lib/observability/logger'
import { getData } from '@/lib/data-layer'

interface LogVitalsInput {
  heart_rate?: number
  blood_pressure?: {
    systolic: number
    diastolic: number
  }
  weight_kg?: number
  body_fat_percent?: number
  temperature_c?: number
  oxygen_saturation?: number
  notes?: string
  measured_at?: string
}

interface VitalMetric {
  type: string
  value: number
  unit: string
  metadata?: Record<string, any>
}

interface LogVitalsOutput {
  success: boolean
  result?: {
    vitals_logged: VitalMetric[]
    measured_at: string
    date: string
    warnings?: string[]
  }
  error?: string
}

/**
 * Validate vital sign ranges
 */
function validateVitals(input: LogVitalsInput): string[] {
  const warnings: string[] = []

  // Heart rate validation (normal range: 60-100 bpm)
  if (input.heart_rate !== undefined) {
    if (input.heart_rate < 40) {
      warnings.push('Heart rate is very low (bradycardia). Consult a doctor.')
    } else if (input.heart_rate > 120) {
      warnings.push('Heart rate is very high (tachycardia). Consult a doctor.')
    }
  }

  // Blood pressure validation
  if (input.blood_pressure) {
    const { systolic, diastolic } = input.blood_pressure
    if (systolic >= 180 || diastolic >= 120) {
      warnings.push('Blood pressure is critically high (hypertensive crisis). Seek immediate medical attention.')
    } else if (systolic >= 140 || diastolic >= 90) {
      warnings.push('Blood pressure is high (hypertension). Consult a doctor.')
    } else if (systolic < 90 || diastolic < 60) {
      warnings.push('Blood pressure is low (hypotension). Monitor closely.')
    }
  }

  // Temperature validation (normal: 36.5-37.5°C)
  if (input.temperature_c !== undefined) {
    if (input.temperature_c >= 38) {
      warnings.push('Fever detected. Monitor temperature and consult a doctor if persistent.')
    } else if (input.temperature_c < 35) {
      warnings.push('Body temperature is low (hypothermia). Seek medical attention.')
    }
  }

  // Oxygen saturation validation (normal: 95-100%)
  if (input.oxygen_saturation !== undefined) {
    if (input.oxygen_saturation < 90) {
      warnings.push('Oxygen saturation is critically low. Seek immediate medical attention.')
    } else if (input.oxygen_saturation < 95) {
      warnings.push('Oxygen saturation is below normal. Monitor closely.')
    }
  }

  // Body fat percentage validation (varies by age/gender, general ranges)
  if (input.body_fat_percent !== undefined) {
    if (input.body_fat_percent < 5) {
      warnings.push('Body fat percentage is very low. May be unhealthy.')
    } else if (input.body_fat_percent > 35) {
      warnings.push('Body fat percentage is high. Consider consulting a health professional.')
    }
  }

  return warnings
}

/**
 * Calculate BMI if weight and height are available
 */
function calculateBMI(weight_kg: number, height_m?: number): number | undefined {
  if (!height_m || height_m <= 0) return undefined
  return weight_kg / (height_m * height_m)
}

/**
 * Log vital signs
 */
export default async function log_vitals(
  input: LogVitalsInput,
  context: ToolContext
): Promise<LogVitalsOutput> {
  try {
    const {
      heart_rate,
      blood_pressure,
      weight_kg,
      body_fat_percent,
      temperature_c,
      oxygen_saturation,
      notes,
      measured_at,
    } = input

    const timestamp = measured_at || new Date().toISOString()
    const date = timestamp.split('T')[0]

    // Validate vitals and get warnings
    const warnings = validateVitals(input)

    logger.info('[log_vitals] Logging vital signs', {
      date,
      has_heart_rate: heart_rate !== undefined,
      has_blood_pressure: blood_pressure !== undefined,
      has_weight: weight_kg !== undefined,
      warnings_count: warnings.length,
    })

    const dataLayer = getData(context)
    const vitalsLogged: VitalMetric[] = []

    // Heart rate
    if (heart_rate !== undefined) {
      vitalsLogged.push({
        type: 'heart_rate',
        value: heart_rate,
        unit: 'bpm',
      })
    }

    // Blood pressure
    if (blood_pressure) {
      vitalsLogged.push({
        type: 'blood_pressure',
        value: blood_pressure.systolic,
        unit: 'mmHg',
        metadata: {
          systolic: blood_pressure.systolic,
          diastolic: blood_pressure.diastolic,
          reading: `${blood_pressure.systolic}/${blood_pressure.diastolic}`,
        },
      })
    }

    // Weight
    if (weight_kg !== undefined) {
      vitalsLogged.push({
        type: 'weight',
        value: weight_kg,
        unit: 'kg',
      })

      // Calculate BMI if possible (would need height from user profile)
      // For now, we'll skip BMI calculation
    }

    // Body fat percentage
    if (body_fat_percent !== undefined) {
      vitalsLogged.push({
        type: 'body_fat',
        value: body_fat_percent,
        unit: '%',
      })
    }

    // Temperature
    if (temperature_c !== undefined) {
      vitalsLogged.push({
        type: 'temperature',
        value: temperature_c,
        unit: '°C',
        metadata: {
          fahrenheit: (temperature_c * 9) / 5 + 32,
        },
      })
    }

    // Oxygen saturation
    if (oxygen_saturation !== undefined) {
      vitalsLogged.push({
        type: 'oxygen_saturation',
        value: oxygen_saturation,
        unit: '%',
      })
    }

    // Store vitals in data layer
    const vitalId = `vitals_${date}_${Date.now()}`
    await dataLayer.create('health_metrics', context.spaceId || 'global', vitalId, {
      date,
      timestamp,
      source: 'manual',
      metrics: vitalsLogged,
      notes,
      warnings,
      created_at: new Date().toISOString(),
      user_id: context.userId,
      tenant_id: context.tenantId,
    })

    logger.info('[log_vitals] Vitals logged successfully', {
      vitals_count: vitalsLogged.length,
      warnings_count: warnings.length,
    })

    return {
      success: true,
      result: {
        vitals_logged: vitalsLogged,
        measured_at: timestamp,
        date,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    }
  } catch (error) {
    logger.error('[log_vitals] Error logging vitals', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
