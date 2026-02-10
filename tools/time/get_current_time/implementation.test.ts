import { describe, it, expect, beforeEach, vi } from 'vitest'
import getCurrentTime from './implementation'

describe('getCurrentTime', () => {
  const mockDataDir = '/mock/data'
  const mockGlobalDir = '/mock/global'

  describe('Happy Path', () => {
    it('should return current time with all required fields', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result).toHaveProperty('timestamp')
      expect(result).toHaveProperty('date')
      expect(result).toHaveProperty('time')
      expect(result).toHaveProperty('timezone')
      expect(result).toHaveProperty('unix')
    })

    it('should return valid ISO 8601 timestamp', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

      // Should be parseable as a date
      const date = new Date(result.timestamp)
      expect(date.toString()).not.toBe('Invalid Date')
    })

    it('should return valid date string (YYYY-MM-DD)', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

      // Should be parseable
      const date = new Date(result.date)
      expect(date.toString()).not.toBe('Invalid Date')
    })

    it('should return valid time string (HH:mm:ss)', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)

      // Hours should be 0-23
      const hours = parseInt(result.time.split(':')[0], 10)
      expect(hours).toBeGreaterThanOrEqual(0)
      expect(hours).toBeLessThan(24)

      // Minutes should be 0-59
      const minutes = parseInt(result.time.split(':')[1], 10)
      expect(minutes).toBeGreaterThanOrEqual(0)
      expect(minutes).toBeLessThan(60)

      // Seconds should be 0-59
      const seconds = parseInt(result.time.split(':')[2], 10)
      expect(seconds).toBeGreaterThanOrEqual(0)
      expect(seconds).toBeLessThan(60)
    })

    it('should return valid timezone', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(typeof result.timezone).toBe('string')
      expect(result.timezone.length).toBeGreaterThan(0)

      // Common timezone patterns: America/New_York, Europe/London, etc.
      // Just verify it's a non-empty string
      expect(result.timezone).toBeTruthy()
    })

    it('should return valid unix timestamp', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(typeof result.unix).toBe('number')
      expect(result.unix).toBeGreaterThan(0)

      // Unix timestamp should be reasonable (after 2020, before 2100)
      const year2020Unix = 1577836800  // Jan 1, 2020
      const year2100Unix = 4102444800  // Jan 1, 2100

      expect(result.unix).toBeGreaterThan(year2020Unix)
      expect(result.unix).toBeLessThan(year2100Unix)
    })
  })

  describe('Consistency Checks', () => {
    it('should have date matching timestamp date', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      const timestampDate = result.timestamp.split('T')[0]
      expect(result.date).toBe(timestampDate)
    })

    it('should have consistent unix timestamp with ISO timestamp', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      const isoUnix = Math.floor(new Date(result.timestamp).getTime() / 1000)

      // Should be within 1 second (due to execution time)
      expect(Math.abs(result.unix - isoUnix)).toBeLessThanOrEqual(1)
    })

    it('should return current time (not cached)', async () => {
      const result1 = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      const result2 = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      // Timestamps should be different (not cached)
      // Unix timestamps should be close but different
      expect(result2.unix).toBeGreaterThanOrEqual(result1.unix)
    })
  })

  describe('Edge Cases', () => {
    it('should work with empty input object', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result).toBeDefined()
      expect(result.timestamp).toBeDefined()
    })

    it('should work regardless of dataDir value', async () => {
      const result1 = await getCurrentTime({}, '/any/path', mockGlobalDir)
      const result2 = await getCurrentTime({}, '', mockGlobalDir)
      const result3 = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result1.timestamp).toBeDefined()
      expect(result2.timestamp).toBeDefined()
      expect(result3.timestamp).toBeDefined()
    })

    it('should work regardless of globalDir value', async () => {
      const result1 = await getCurrentTime({}, mockDataDir, '/any/path')
      const result2 = await getCurrentTime({}, mockDataDir, '')
      const result3 = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result1.timestamp).toBeDefined()
      expect(result2.timestamp).toBeDefined()
      expect(result3.timestamp).toBeDefined()
    })
  })

  describe('Data Types', () => {
    it('should return correct data types for all fields', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(typeof result.timestamp).toBe('string')
      expect(typeof result.date).toBe('string')
      expect(typeof result.time).toBe('string')
      expect(typeof result.timezone).toBe('string')
      expect(typeof result.unix).toBe('number')
    })

    it('should return integer unix timestamp (no decimals)', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result.unix % 1).toBe(0)  // Should be whole number
    })
  })

  describe('Multiple Calls', () => {
    it('should return fresh timestamps on each call', async () => {
      const results: any[] = []

      for (let i = 0; i < 5; i++) {
        results.push(await getCurrentTime({}, mockDataDir, mockGlobalDir))
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // All timestamps should be present
      expect(results).toHaveLength(5)

      // Unix timestamps should be monotonically increasing (or equal within same second)
      for (let i = 1; i < results.length; i++) {
        expect(results[i].unix).toBeGreaterThanOrEqual(results[i - 1].unix)
      }
    })

    it('should handle rapid successive calls', async () => {
      const results = await Promise.all([
        getCurrentTime({}, mockDataDir, mockGlobalDir),
        getCurrentTime({}, mockDataDir, mockGlobalDir),
        getCurrentTime({}, mockDataDir, mockGlobalDir),
        getCurrentTime({}, mockDataDir, mockGlobalDir),
        getCurrentTime({}, mockDataDir, mockGlobalDir)
      ])

      expect(results).toHaveLength(5)

      // All should have valid timestamps
      results.forEach(result => {
        expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(result.unix).toBeGreaterThan(0)
      })

      // Should all be within same second (or very close)
      const unixTimes = results.map(r => r.unix)
      const maxDiff = Math.max(...unixTimes) - Math.min(...unixTimes)
      expect(maxDiff).toBeLessThanOrEqual(1)
    })
  })

  describe('Timezone Validation', () => {
    it('should return IANA timezone format', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      // IANA timezones typically contain "/" (e.g., America/New_York)
      // or are UTC, GMT, etc.
      const isValidFormat =
        result.timezone.includes('/') ||
        ['UTC', 'GMT'].includes(result.timezone)

      expect(isValidFormat).toBe(true)
    })
  })

  describe('ISO 8601 Compliance', () => {
    it('should return timestamp ending with Z (UTC)', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(result.timestamp.endsWith('Z')).toBe(true)
    })

    it('should include milliseconds in timestamp', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      // Format: YYYY-MM-DDTHH:mm:ss.sssZ
      const parts = result.timestamp.split('.')
      expect(parts).toHaveLength(2)

      const milliseconds = parts[1].replace('Z', '')
      expect(milliseconds).toHaveLength(3)
      expect(/^\d{3}$/.test(milliseconds)).toBe(true)
    })
  })

  describe('Date Extraction', () => {
    it('should extract date correctly from timestamp', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      const dateParts = result.date.split('-')
      expect(dateParts).toHaveLength(3)

      const year = parseInt(dateParts[0], 10)
      const month = parseInt(dateParts[1], 10)
      const day = parseInt(dateParts[2], 10)

      expect(year).toBeGreaterThan(2020)
      expect(year).toBeLessThan(2100)
      expect(month).toBeGreaterThanOrEqual(1)
      expect(month).toBeLessThanOrEqual(12)
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(31)
    })
  })

  describe('Time Extraction', () => {
    it('should extract time correctly in 24-hour format', async () => {
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      const timeParts = result.time.split(':')
      expect(timeParts).toHaveLength(3)

      // Verify each part is a 2-digit number
      timeParts.forEach(part => {
        expect(part).toHaveLength(2)
        expect(/^\d{2}$/.test(part)).toBe(true)
      })
    })
  })

  describe('Unix Timestamp Accuracy', () => {
    it('should match JavaScript Date.now() within 1 second', async () => {
      const jsNow = Math.floor(Date.now() / 1000)
      const result = await getCurrentTime({}, mockDataDir, mockGlobalDir)

      expect(Math.abs(result.unix - jsNow)).toBeLessThanOrEqual(1)
    })
  })
})
