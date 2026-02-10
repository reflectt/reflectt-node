# Get Current Time

## Description

Get the current date and time. Use this to know what "now" is for time-sensitive operations, scheduling, or logging.

## Purpose and Use Cases

- **Timestamping**: Add accurate timestamps to records, logs, and events
- **Scheduling**: Determine current time for scheduling tasks and workflows
- **Time-based logic**: Make decisions based on current date/time
- **Logging**: Track when operations occur
- **Time zone awareness**: Get system timezone information
- **Date calculations**: Use as reference point for date math

## Input Parameters

**No parameters required.** This tool takes an empty object as input.

## Output Format

```typescript
{
  timestamp: string    // ISO 8601 format (e.g., "2025-10-17T14:30:45.123Z")
  date: string        // Date only (e.g., "2025-10-17")
  time: string        // Time only (e.g., "14:30:45")
  timezone: string    // System timezone (e.g., "America/New_York")
  unix: number        // Unix timestamp in seconds (e.g., 1729177845)
}
```

**Example Output:**
```json
{
  "timestamp": "2025-10-17T14:30:45.123Z",
  "date": "2025-10-17",
  "time": "14:30:45",
  "timezone": "America/New_York",
  "unix": 1729177845
}
```

## Example Usage

### Example 1: Simple Timestamp

```typescript
import getCurrentTime from './implementation'

const result = await getCurrentTime({}, '/path/to/dataDir', '/path/to/globalDir')

console.log('Current time:', result.timestamp)
console.log('Date:', result.date)
console.log('Time:', result.time)
console.log('Timezone:', result.timezone)
console.log('Unix:', result.unix)

// Output:
// Current time: 2025-10-17T14:30:45.123Z
// Date: 2025-10-17
// Time: 14:30:45
// Timezone: America/New_York
// Unix: 1729177845
```

### Example 2: Timestamping Records

```typescript
import getCurrentTime from './implementation'
import upsertRecord from '../data/upsert_record/implementation'

async function createTimestampedRecord(data: any) {
  const time = await getCurrentTime({}, dataDir, globalDir)

  const record = {
    ...data,
    created_at: time.timestamp,
    created_date: time.date,
    created_unix: time.unix
  }

  return await upsertRecord(
    { table: 'records', record },
    dataDir,
    globalDir
  )
}

const result = await createTimestampedRecord({
  title: 'My Record',
  content: 'Some content here'
})
```

### Example 3: Scheduling Logic

```typescript
import getCurrentTime from './implementation'

async function isBusinessHours(): Promise<boolean> {
  const time = await getCurrentTime({}, dataDir, globalDir)

  // Parse hour from time string (HH:MM:SS)
  const hour = parseInt(time.time.split(':')[0], 10)

  // Business hours: 9 AM - 5 PM
  return hour >= 9 && hour < 17
}

if (await isBusinessHours()) {
  console.log('Currently in business hours')
} else {
  console.log('Outside business hours')
}
```

### Example 4: Date-based Filtering

```typescript
import getCurrentTime from './implementation'

async function getRecentRecords(daysBack: number) {
  const now = await getCurrentTime({}, dataDir, globalDir)
  const cutoffDate = new Date(now.timestamp)
  cutoffDate.setDate(cutoffDate.getDate() - daysBack)

  console.log(`Fetching records since ${cutoffDate.toISOString()}`)

  // Use cutoffDate to filter records...
}

await getRecentRecords(7)  // Last 7 days
```

### Example 5: Logging with Timestamps

```typescript
import getCurrentTime from './implementation'

async function log(level: string, message: string) {
  const time = await getCurrentTime({}, dataDir, globalDir)

  const logEntry = {
    timestamp: time.timestamp,
    date: time.date,
    time: time.time,
    level,
    message,
    unix: time.unix
  }

  console.log(JSON.stringify(logEntry))

  // Save to log file or database...
}

await log('INFO', 'Application started')
await log('ERROR', 'Connection failed')
```

### Example 6: Unix Timestamp for APIs

```typescript
import getCurrentTime from './implementation'

async function signApiRequest(data: any) {
  const time = await getCurrentTime({}, dataDir, globalDir)

  // Many APIs use Unix timestamps for request signing
  return {
    ...data,
    timestamp: time.unix,
    signature: generateSignature(data, time.unix)
  }
}
```

### Example 7: Time Zone Display

```typescript
import getCurrentTime from './implementation'

async function displayCurrentTime() {
  const time = await getCurrentTime({}, dataDir, globalDir)

  console.log(`Current time in ${time.timezone}:`)
  console.log(`  ISO: ${time.timestamp}`)
  console.log(`  Date: ${time.date}`)
  console.log(`  Time: ${time.time}`)
  console.log(`  Unix: ${time.unix}`)
}

await displayCurrentTime()
// Output:
// Current time in America/New_York:
//   ISO: 2025-10-17T14:30:45.123Z
//   Date: 2025-10-17
//   Time: 14:30:45
//   Unix: 1729177845
```

## Error Handling

This function does not throw errors. It always returns a valid timestamp based on the system clock.

**Note:** The function is synchronous internally but wrapped in an async interface for consistency with other tools.

## Output Format Details

### `timestamp` (ISO 8601)
- Format: `YYYY-MM-DDTHH:mm:ss.sssZ`
- Always in UTC (Z suffix)
- Includes milliseconds
- Example: `"2025-10-17T14:30:45.123Z"`
- **Use for:** Database storage, API requests, precise timing

### `date` (Date Only)
- Format: `YYYY-MM-DD`
- Extracted from timestamp
- Example: `"2025-10-17"`
- **Use for:** Date-based filtering, grouping by day, display

### `time` (Time Only)
- Format: `HH:mm:ss`
- Local time in 24-hour format
- Example: `"14:30:45"`
- **Use for:** Time-of-day logic, business hours checks, display

### `timezone`
- System timezone identifier
- IANA format (e.g., `"America/New_York"`, `"Europe/London"`)
- Example: `"America/New_York"`
- **Use for:** Timezone-aware operations, user display

### `unix`
- Unix timestamp (seconds since Jan 1, 1970 UTC)
- Integer format
- Example: `1729177845`
- **Use for:** API signatures, simple date math, caching

## Time Zone Behavior

- **ISO timestamp**: Always UTC (Universal)
- **Date/Time**: Derived from local system time
- **Timezone**: Automatically detected from system
- **Unix**: Timezone-independent (always UTC-based)

**Example across timezones:**

**New York (EST, UTC-5):**
```json
{
  "timestamp": "2025-10-17T14:30:45.123Z",
  "date": "2025-10-17",
  "time": "09:30:45",
  "timezone": "America/New_York",
  "unix": 1729177845
}
```

**London (GMT, UTC+0):**
```json
{
  "timestamp": "2025-10-17T14:30:45.123Z",
  "date": "2025-10-17",
  "time": "14:30:45",
  "timezone": "Europe/London",
  "unix": 1729177845
}
```

Note: `timestamp` and `unix` are identical across timezones, but `time` differs.

## Performance Notes

- **Execution time:** < 1ms (instant)
- **No network calls:** Pure system call
- **No side effects:** Read-only operation
- **Thread-safe:** Can be called concurrently

## Related Tools

- **upsert_record**: Save timestamped records
- **list_records**: Query records by timestamp
- **create_task**: Schedule tasks with timestamps
- **web_search**: Search for time-sensitive information
