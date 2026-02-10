# Web Search

## Description

Search the web for information on a topic. Returns search results with titles, URLs, and snippets. Use this to find current information or research topics.

## Purpose and Use Cases

- **Research topics**: Find current information and best practices
- **Fact checking**: Verify information against web sources
- **Content discovery**: Find relevant articles, tutorials, and documentation
- **Market research**: Gather competitive intelligence and trends
- **Knowledge gathering**: Collect information for decision-making

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | The search query |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `num_results` | number | `5` | Number of results to return (1-10) |

## Output Format

```typescript
{
  query: string
  num_results: number
  results: Array<{
    title: string
    url: string
    snippet: string
  }>
  source: string
  error?: string
}
```

**Success Example:**
```json
{
  "query": "personal budget tracking best practices",
  "num_results": 3,
  "results": [
    {
      "title": "Budget Tracking: Best Practices for 2025",
      "url": "https://example.com/budget-tracking-guide",
      "snippet": "Learn the top 10 best practices for tracking your personal budget effectively..."
    },
    {
      "title": "How to Track Your Budget - Expert Tips",
      "url": "https://example.com/expert-budget-tips",
      "snippet": "Financial experts share their proven methods for budget tracking and expense management..."
    },
    {
      "title": "Budget Apps vs Manual Tracking: A Comparison",
      "url": "https://example.com/budget-methods-comparison",
      "snippet": "Discover whether digital apps or manual tracking is better for your budget needs..."
    }
  ],
  "source": "DuckDuckGo"
}
```

**Error Example:**
```json
{
  "query": "search query",
  "num_results": 0,
  "results": [],
  "source": "DuckDuckGo",
  "error": "Search failed: 500"
}
```

## Example Usage

### Example 1: Basic Web Search

```typescript
import webSearch from './implementation'

const result = await webSearch(
  {
    query: 'best practices for React hooks'
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(`Found ${result.num_results} results:`)
result.results.forEach((item, index) => {
  console.log(`${index + 1}. ${item.title}`)
  console.log(`   ${item.url}`)
  console.log(`   ${item.snippet}`)
})
```

### Example 2: Search with Custom Result Count

```typescript
const result = await webSearch(
  {
    query: 'TypeScript generics tutorial',
    num_results: 10  // Get maximum results
  },
  '/path/to/dataDir',
  '/path/to/globalDir'
)

console.log(`Retrieved ${result.results.length} results`)
```

### Example 3: Research and Extract Information

```typescript
async function researchTopic(topic: string) {
  const result = await webSearch(
    { query: topic, num_results: 5 },
    dataDir,
    globalDir
  )

  if (result.error) {
    console.error('Search failed:', result.error)
    return null
  }

  // Extract URLs for further processing
  const urls = result.results.map(r => r.url)

  // Create summary
  const summary = {
    topic,
    sources: result.num_results,
    topResult: result.results[0],
    allUrls: urls
  }

  return summary
}

const research = await researchTopic('machine learning algorithms')
console.log(research)
```

### Example 4: Search with Error Handling

```typescript
async function safeWebSearch(query: string) {
  try {
    const result = await webSearch(
      { query, num_results: 5 },
      dataDir,
      globalDir
    )

    if (result.error) {
      console.warn('Search completed with error:', result.error)
      return []
    }

    return result.results
  } catch (error) {
    console.error('Search failed completely:', error)
    return []
  }
}

const results = await safeWebSearch('cloud computing trends')
```

### Example 5: Competitive Analysis

```typescript
async function competitorResearch(competitors: string[]) {
  const results = []

  for (const competitor of competitors) {
    const searchResult = await webSearch(
      { query: `${competitor} product features reviews`, num_results: 3 },
      dataDir,
      globalDir
    )

    results.push({
      competitor,
      findings: searchResult.results
    })
  }

  return results
}

const analysis = await competitorResearch(['Competitor A', 'Competitor B'])
```

## Error Handling

The function handles errors gracefully and returns them in the output:

```typescript
// Network error
{
  query: "search query",
  num_results: 0,
  results: [],
  source: "DuckDuckGo",
  error: "fetch failed"
}

// HTTP error
{
  query: "search query",
  num_results: 0,
  results: [],
  source: "DuckDuckGo",
  error: "Search failed: 503"
}

// No results found
{
  query: "very obscure query xyz123abc",
  num_results: 0,
  results: [],
  source: "DuckDuckGo"
  // No error, just empty results
}
```

**Error Handling Pattern:**

```typescript
const result = await webSearch({ query: 'test' }, dataDir, globalDir)

if (result.error) {
  // Handle error case
  console.error('Search error:', result.error)
  // Still have partial data available
  console.log('Query was:', result.query)
} else if (result.num_results === 0) {
  // No results found
  console.log('No results for query:', result.query)
} else {
  // Success
  console.log(`Found ${result.num_results} results`)
}
```

## Search Engine Details

**Provider:** DuckDuckGo (privacy-focused search)

**Why DuckDuckGo?**
- No tracking or personalization
- Consistent, unbiased results
- No API key required
- No rate limits for reasonable use
- Privacy-preserving

**How it works:**
1. Sends query to DuckDuckGo HTML search endpoint
2. Parses HTML response to extract results
3. Returns structured data with titles, URLs, and snippets

**Limitations:**
- Maximum 10 results per query
- Results depend on DuckDuckGo's index
- HTML parsing may break if DuckDuckGo changes their format
- No advanced search operators support

## Performance Notes

- **Average response time:** 1-3 seconds
- **Network dependent:** Requires internet connection
- **No caching:** Each call makes a fresh request
- **Rate limiting:** None enforced, but be respectful

## Data Privacy

- Uses DuckDuckGo's privacy-focused search
- No user tracking or profiling
- Queries are not logged or stored
- User-Agent header set to generic browser identifier

## Related Tools

- **web_fetch**: Fetch and parse content from a specific URL
- **get_current_time**: Get timestamp for time-based searches
- **upsert_record**: Save search results to a table
- **execute_agent_task**: Use AI to analyze search results
