import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getWeatherClient } from '@/lib/integrations/weather/openweathermap-client'
import type { WeatherAlert } from '@/lib/integrations/weather/types'

interface GetWeatherAlertsInput {
  lat: number
  lon: number
}

interface GetWeatherAlertsSuccess {
  success: true
  location: {
    name: string
    country: string
    lat: number
    lon: number
  }
  alerts: WeatherAlert[]
  count: number
  hasAlerts: boolean
}

interface GetWeatherAlertsFailure {
  success: false
  error: string
}

type GetWeatherAlertsOutput = GetWeatherAlertsSuccess | GetWeatherAlertsFailure

/**
 * Get weather alerts for a location
 *
 * @param input - Tool input with coordinates
 * @param context - Tool context
 * @returns Weather alerts data
 */
export default async function getWeatherAlerts(
  input: GetWeatherAlertsInput,
  context: ToolContext
): Promise<GetWeatherAlertsOutput> {
  try {
    const { lat, lon } = input

    // Get weather client
    const client = getWeatherClient()

    // Fetch alerts
    const alertsData = await client.getAlerts(lat, lon)

    return {
      success: true,
      location: alertsData.location,
      alerts: alertsData.alerts,
      count: alertsData.alerts.length,
      hasAlerts: alertsData.alerts.length > 0
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
