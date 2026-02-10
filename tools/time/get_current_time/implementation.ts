import { now } from '@/lib/tools/helpers'

interface GetCurrentTimeOutput {
  timestamp: string
  date: string
  time: string
  timezone: string
  unix: number
}

/**
 * Get the current date and time
 */
export default async function getCurrentTime(
  input: Record<string, never>
): Promise<GetCurrentTimeOutput> {
  const timestamp = now()
  const currentDate = new Date(timestamp)

  return {
    timestamp,
    date: timestamp.split('T')[0],
    time: currentDate.toTimeString().split(' ')[0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    unix: Math.floor(currentDate.getTime() / 1000)
  }
}
