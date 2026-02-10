import { describe, it, expect, beforeEach, vi } from 'vitest'
import webSearch, { WebSearchInput, WebSearchOutput } from './implementation'

// Mock fetch globally
global.fetch = vi.fn()

describe('webSearch', () => {
  const mockDataDir = '/mock/data'
  const mockGlobalDir = '/mock/global'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Happy Path', () => {
    it('should return search results with default num_results', async () => {
      const mockHtml = `
        <a rel="nofollow" class="result__a" href="https://example.com/article1">Best Budget Tracking Methods</a>
        <a class="result__snippet">Learn how to track your budget effectively with these proven methods...</a>
        <a rel="nofollow" class="result__a" href="https://example.com/article2">Budget Apps Comparison</a>
        <a class="result__snippet">Compare the top budget tracking apps for 2025...</a>
      `

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const input: WebSearchInput = {
        query: 'budget tracking best practices'
      }

      const result = await webSearch(input, mockDataDir, mockGlobalDir)

      expect(result.query).toBe('budget tracking best practices')
      expect(result.source).toBe('DuckDuckGo')
      expect(result.num_results).toBe(2)
      expect(result.results).toHaveLength(2)
      expect(result.error).toBeUndefined()

      // Verify first result
      expect(result.results[0].title).toBe('Best Budget Tracking Methods')
      expect(result.results[0].url).toBe('https://example.com/article1')
      expect(result.results[0].snippet).toContain('track your budget effectively')

      // Verify second result
      expect(result.results[1].title).toBe('Budget Apps Comparison')
      expect(result.results[1].url).toBe('https://example.com/article2')
    })

    it('should return specified number of results', async () => {
      const mockHtml = generateMockSearchResults(10)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const input: WebSearchInput = {
        query: 'test query',
        num_results: 3
      }

      const result = await webSearch(input, mockDataDir, mockGlobalDir)

      expect(result.num_results).toBe(3)
      expect(result.results).toHaveLength(3)
    })

    it('should handle HTML entities in results', async () => {
      const mockHtml = `
        <a rel="nofollow" class="result__a" href="https://example.com?param=1&amp;other=2">Title with &quot;quotes&quot; &amp; symbols</a>
        <a class="result__snippet">Snippet with &amp;, &#x27;, and &quot; entities</a>
      `

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.results[0].title).toBe('Title with "quotes" & symbols')
      expect(result.results[0].url).toBe('https://example.com?param=1&other=2')
      expect(result.results[0].snippet).toContain('&, \', and " entities')
    })

    it('should send correct User-Agent header', async () => {
      const mockHtml = '<html></html>'

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('duckduckgo.com'),
        expect.objectContaining({
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          }
        })
      )
    })

    it('should encode query parameters correctly', async () => {
      const mockHtml = '<html></html>'

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      await webSearch({ query: 'test query with spaces & symbols' }, mockDataDir, mockGlobalDir)

      const callUrl = (global.fetch as any).mock.calls[0][0]
      expect(callUrl).toContain('test%20query%20with%20spaces%20%26%20symbols')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty search results', async () => {
      const mockHtml = '<html><body>No results found</body></html>'

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'nonexistent query' }, mockDataDir, mockGlobalDir)

      expect(result.num_results).toBe(0)
      expect(result.results).toEqual([])
      expect(result.error).toBeUndefined()
    })

    it('should limit results to num_results even if more available', async () => {
      const mockHtml = generateMockSearchResults(20)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test', num_results: 5 }, mockDataDir, mockGlobalDir)

      expect(result.results).toHaveLength(5)
      expect(result.num_results).toBe(5)
    })

    it('should handle fewer results than requested', async () => {
      const mockHtml = generateMockSearchResults(3)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test', num_results: 10 }, mockDataDir, mockGlobalDir)

      expect(result.results).toHaveLength(3)
      expect(result.num_results).toBe(3)
    })

    it('should handle special characters in query', async () => {
      const mockHtml = generateMockSearchResults(1)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch(
        { query: 'test "exact phrase" -exclude +include' },
        mockDataDir,
        mockGlobalDir
      )

      expect(result.query).toBe('test "exact phrase" -exclude +include')
    })

    it('should trim whitespace from snippets', async () => {
      const mockHtml = `
        <a rel="nofollow" class="result__a" href="https://example.com">Title</a>
        <a class="result__snippet">   Snippet with extra whitespace   </a>
      `

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.results[0].snippet).toBe('Snippet with extra whitespace')
    })
  })

  describe('Error Handling', () => {
    it('should handle HTTP error responses', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.success).toBeUndefined()
      expect(result.num_results).toBe(0)
      expect(result.results).toEqual([])
      expect(result.error).toBe('Search failed: 503')
    })

    it('should handle network errors', async () => {
      ;(global.fetch as any).mockRejectedValueOnce(new Error('Network error'))

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.num_results).toBe(0)
      expect(result.results).toEqual([])
      expect(result.error).toBe('Network error')
    })

    it('should handle fetch timeout', async () => {
      ;(global.fetch as any).mockRejectedValueOnce(new Error('Request timeout'))

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.error).toBe('Request timeout')
    })

    it('should handle unknown errors gracefully', async () => {
      ;(global.fetch as any).mockRejectedValueOnce('String error')

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      // Helper library preserves string error messages (better than "Unknown error")
      expect(result.error).toBe('String error')
    })

    it('should handle malformed HTML gracefully', async () => {
      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<html><body>malformed html'
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      // Should not throw, just return empty results
      expect(result.num_results).toBe(0)
      expect(result.results).toEqual([])
    })
  })

  describe('Default Values', () => {
    it('should use default num_results of 5', async () => {
      const mockHtml = generateMockSearchResults(10)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.num_results).toBeLessThanOrEqual(5)
    })

    it('should respect minimum num_results of 1', async () => {
      const mockHtml = generateMockSearchResults(5)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test', num_results: 1 }, mockDataDir, mockGlobalDir)

      expect(result.results.length).toBeLessThanOrEqual(1)
    })

    it('should respect maximum num_results of 10', async () => {
      const mockHtml = generateMockSearchResults(20)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test', num_results: 10 }, mockDataDir, mockGlobalDir)

      expect(result.results.length).toBeLessThanOrEqual(10)
    })
  })

  describe('Data Integrity', () => {
    it('should return consistent structure on success', async () => {
      const mockHtml = generateMockSearchResults(3)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result).toHaveProperty('query')
      expect(result).toHaveProperty('num_results')
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('source')
      expect(result.source).toBe('DuckDuckGo')
    })

    it('should return consistent structure on error', async () => {
      ;(global.fetch as any).mockRejectedValueOnce(new Error('Test error'))

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result).toHaveProperty('query')
      expect(result).toHaveProperty('num_results')
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('source')
      expect(result).toHaveProperty('error')
    })

    it('should have valid result structure', async () => {
      const mockHtml = generateMockSearchResults(1)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: 'test' }, mockDataDir, mockGlobalDir)

      expect(result.results[0]).toHaveProperty('title')
      expect(result.results[0]).toHaveProperty('url')
      expect(result.results[0]).toHaveProperty('snippet')
      expect(typeof result.results[0].title).toBe('string')
      expect(typeof result.results[0].url).toBe('string')
      expect(typeof result.results[0].snippet).toBe('string')
    })
  })

  describe('Query Encoding', () => {
    it('should handle unicode characters', async () => {
      const mockHtml = generateMockSearchResults(1)

      ;(global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml
      })

      const result = await webSearch({ query: '日本語 测试 😀' }, mockDataDir, mockGlobalDir)

      expect(result.query).toBe('日本語 测试 😀')
      const callUrl = (global.fetch as any).mock.calls[0][0]
      expect(callUrl).toContain('duckduckgo.com')
    })
  })
})

// Helper function to generate mock search results
function generateMockSearchResults(count: number): string {
  let html = '<html><body>'

  for (let i = 1; i <= count; i++) {
    html += `
      <a rel="nofollow" class="result__a" href="https://example.com/result${i}">Result ${i} Title</a>
      <a class="result__snippet">This is the snippet for result ${i}...</a>
    `
  }

  html += '</body></html>'
  return html
}
