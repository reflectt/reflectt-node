import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getWeatherClient } from '@/lib/integrations/weather/openweathermap-client'
import type { TemperatureUnit } from '@/lib/integrations/weather/types'

interface GetWeatherInput {
  location: string
  units?: TemperatureUnit
}

interface GetWeatherSuccess {
  success: true
  location: {
    name: string
    country: string
    lat: number
    lon: number
  }
  current: {
    temp: number
    feels_like: number
    temp_min: number
    temp_max: number
    pressure: number
    humidity: number
    visibility: number
    wind_speed: number
    wind_deg: number
    wind_gust?: number
    clouds: number
    rain_1h?: number
    snow_1h?: number
  }
  condition: {
    main: string
    description: string
    icon: string
  }
  sun: {
    sunrise: number
    sunset: number
  }
  units: TemperatureUnit
  timestamp: number
}

interface GetWeatherFailure {
  success: false
  error: string
}

type GetWeatherOutput = GetWeatherSuccess | GetWeatherFailure

/**
 * Get current weather conditions for a location
 *
 * @param input - Tool input with location and units
 * @param context - Tool context
 * @returns Current weather data
 */
export default async function getWeather(
  input: GetWeatherInput,
  context: ToolContext
): Promise<GetWeatherOutput> {
  try {
    const { location, units = 'metric' } = input

    // Get weather client
    const client = getWeatherClient()

    // Fetch current weather
    const weather = await client.getCurrentWeather(location, { units })

    return {
      success: true,
      location: weather.location,
      current: weather.current,
      condition: weather.condition,
      sun: weather.sun,
      units,
      timestamp: weather.timestamp
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
