import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getWeatherClient } from '@/lib/integrations/weather/openweathermap-client'
import type { TemperatureUnit, ForecastPeriod } from '@/lib/integrations/weather/types'

interface GetForecastInput {
  location: string
  units?: TemperatureUnit
}

interface GetForecastSuccess {
  success: true
  location: {
    name: string
    country: string
    lat: number
    lon: number
  }
  forecast: ForecastPeriod[]
  units: TemperatureUnit
  count: number
}

interface GetForecastFailure {
  success: false
  error: string
}

type GetForecastOutput = GetForecastSuccess | GetForecastFailure

/**
 * Get 5-day weather forecast for a location
 *
 * @param input - Tool input with location and units
 * @param context - Tool context
 * @returns 5-day forecast data (3-hour intervals)
 */
export default async function getForecast(
  input: GetForecastInput,
  context: ToolContext
): Promise<GetForecastOutput> {
  try {
    const { location, units = 'metric' } = input

    // Get weather client
    const client = getWeatherClient()

    // Fetch forecast
    const forecast = await client.getForecast(location, { units })

    return {
      success: true,
      location: forecast.location,
      forecast: forecast.forecast,
      units,
      count: forecast.forecast.length
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
