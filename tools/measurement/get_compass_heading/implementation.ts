import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getCompassHeading } from '@/lib/integrations/measurement/converter'
import type { CompassHeading } from '@/lib/integrations/measurement/types'

interface GetCompassHeadingInput {
  timeout?: number
}

interface GetCompassHeadingSuccess {
  success: true
  heading: CompassHeading
  supported: true
}

interface GetCompassHeadingNotSupported {
  success: true
  supported: false
  reason: string
}

interface GetCompassHeadingFailure {
  success: false
  error: string
}

type GetCompassHeadingOutput =
  | GetCompassHeadingSuccess
  | GetCompassHeadingNotSupported
  | GetCompassHeadingFailure

export default async function getCompassHeadingTool(
  input: GetCompassHeadingInput,
  ctx: ToolContext
): Promise<GetCompassHeadingOutput> {
  try {
    const { timeout = 5000 } = input

    // Check if we're in browser environment
    if (typeof window === 'undefined') {
      return {
        success: true,
        supported: false,
        reason: 'Not in browser environment (server-side execution)'
      }
    }

    // Check if DeviceOrientation API is supported
    if (!window.DeviceOrientationEvent) {
      return {
        success: true,
        supported: false,
        reason: 'DeviceOrientation API not supported by browser'
      }
    }

    // Check for HTTPS (required for sensor access)
    if (typeof window.location !== 'undefined' &&
        window.location.protocol !== 'https:' &&
        window.location.hostname !== 'localhost') {
      return {
        success: true,
        supported: false,
        reason: 'HTTPS required for device sensor access'
      }
    }

    // Get compass heading
    const heading = await Promise.race([
      getCompassHeading(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))
    ])

    if (!heading) {
      return {
        success: true,
        supported: false,
        reason: 'Compass heading not available (device may not have magnetometer or permission denied)'
      }
    }

    return {
      success: true,
      heading,
      supported: true
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
