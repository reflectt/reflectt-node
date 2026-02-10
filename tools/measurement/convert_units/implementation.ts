import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  convert,
  convertToMultiple,
  bakingConversions,
  distanceConversions,
  weightConversions,
  getUnitCategory,
} from '@/lib/integrations/measurement/converter'
import type { Unit, ConversionResult, LengthUnit, WeightUnit, VolumeUnit } from '@/lib/integrations/measurement/types'

interface ConvertUnitsInput {
  value: number
  from: Unit
  to?: Unit
  toUnits?: Unit[]
  precision?: number
  preset?: 'baking' | 'distance' | 'weight'
}

interface ConvertUnitsSuccess {
  success: true
  input: {
    value: number
    from: Unit
    category: string
  }
  results: ConversionResult[]
  count: number
}

interface ConvertUnitsFailure {
  success: false
  error: string
}

type ConvertUnitsOutput = ConvertUnitsSuccess | ConvertUnitsFailure

export default async function convertUnits(
  input: ConvertUnitsInput,
  ctx: ToolContext
): Promise<ConvertUnitsOutput> {
  try {
    const { value, from, to, toUnits, precision = 2, preset } = input

    // Validate input
    if (typeof value !== 'number' || !isFinite(value)) {
      return {
        success: false,
        error: 'Invalid value: must be a finite number'
      }
    }

    if (!from) {
      return {
        success: false,
        error: 'Missing required parameter: from'
      }
    }

    // Get category for validation
    let category: string
    try {
      category = getUnitCategory(from)
    } catch (error) {
      return {
        success: false,
        error: `Unknown unit: ${from}`
      }
    }

    let results: ConversionResult[]

    // Handle preset conversions
    if (preset) {
      if (preset === 'baking') {
        if (category !== 'volume') {
          return {
            success: false,
            error: 'Baking preset requires volume units (e.g., cup, mL, tbsp)'
          }
        }
        results = bakingConversions(value, from as VolumeUnit)
      } else if (preset === 'distance') {
        if (category !== 'length') {
          return {
            success: false,
            error: 'Distance preset requires length units (e.g., m, ft, mi)'
          }
        }
        results = distanceConversions(value, from as LengthUnit)
      } else if (preset === 'weight') {
        if (category !== 'weight') {
          return {
            success: false,
            error: 'Weight preset requires weight units (e.g., kg, lb, oz)'
          }
        }
        results = weightConversions(value, from as WeightUnit)
      } else {
        return {
          success: false,
          error: `Unknown preset: ${preset}`
        }
      }
    }
    // Handle batch conversion
    else if (toUnits && toUnits.length > 0) {
      try {
        results = convertToMultiple(value, from, toUnits, precision)
      } catch (error) {
        return {
          success: false,
          error: formatError(error)
        }
      }
    }
    // Handle single conversion
    else if (to) {
      try {
        results = [convert(value, from, to, precision)]
      } catch (error) {
        return {
          success: false,
          error: formatError(error)
        }
      }
    }
    // No target specified
    else {
      return {
        success: false,
        error: 'Must specify either "to", "toUnits", or "preset"'
      }
    }

    return {
      success: true,
      input: {
        value,
        from,
        category
      },
      results,
      count: results.length
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
