import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getWeatherClient } from '@/lib/integrations/weather/openweathermap-client'
import type { WeatherMapLayer } from '@/lib/integrations/weather/types'

interface GetWeatherMapInput {
  layer: WeatherMapLayer
  zoom: number
  x: number
  y: number
}

interface GetWeatherMapSuccess {
  success: true
  layer: WeatherMapLayer
  zoom: number
  x: number
  y: number
  tileUrl: string
  description: string
}

interface GetWeatherMapFailure {
  success: false
  error: string
}

type GetWeatherMapOutput = GetWeatherMapSuccess | GetWeatherMapFailure

/**
 * Get weather map tile URL
 *
 * @param input - Tool input with layer and tile coordinates
 * @param context - Tool context
 * @returns Weather map tile data
 */
export default async function getWeatherMap(
  input: GetWeatherMapInput,
  context: ToolContext
): Promise<GetWeatherMapOutput> {
  try {
    const { layer, zoom, x, y } = input

    // Get weather client
    const client = getWeatherClient()

    // Get map tile URL
    const mapData = await client.getWeatherMap(layer, zoom, x, y)

    return {
      success: true,
      layer: mapData.layer,
      zoom: mapData.zoom,
      x: mapData.x,
      y: mapData.y,
      tileUrl: mapData.tileUrl,
      description: mapData.description
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
