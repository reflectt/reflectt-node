/**
 * Memory management system
 * Persists agent memories as markdown files
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { eventBus } from './events.js'

const WORKSPACE_BASE = '/Users/ryan/.openclaw'

interface MemoryEntry {
  path: string
  filename: string
  content: string
  size: number
  modified: number
}

class MemoryManager {
  /**
   * Get the workspace directory for an agent
   */
  private getAgentWorkspace(agent: string): string {
    return join(WORKSPACE_BASE, `workspace-${agent}`)
  }

  /**
   * Get the memory directory for an agent
   */
  private getMemoryDir(agent: string): string {
    return join(this.getAgentWorkspace(agent), 'memory')
  }

  /**
   * Get today's date in YYYY-MM-DD format
   */
  private getTodayFilename(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}.md`
  }

  /**
   * Ensure the memory directory exists
   */
  private async ensureMemoryDir(agent: string): Promise<void> {
    const memoryDir = this.getMemoryDir(agent)
    await fs.mkdir(memoryDir, { recursive: true })
  }

  /**
   * Get all memory files for an agent
   */
  async getMemories(agent: string): Promise<MemoryEntry[]> {
    const memories: MemoryEntry[] = []

    try {
      // Check for MEMORY.md at workspace root
      const workspaceRoot = this.getAgentWorkspace(agent)
      const memoryMdPath = join(workspaceRoot, 'MEMORY.md')
      
      try {
        const content = await fs.readFile(memoryMdPath, 'utf-8')
        const stats = await fs.stat(memoryMdPath)
        memories.push({
          path: memoryMdPath,
          filename: 'MEMORY.md',
          content,
          size: stats.size,
          modified: stats.mtimeMs,
        })
      } catch (err: any) {
        // MEMORY.md doesn't exist, that's ok
      }

      // Check memory directory
      const memoryDir = this.getMemoryDir(agent)
      
      try {
        const files = await fs.readdir(memoryDir)
        
        // Filter for .md files and sort by date (most recent first)
        const mdFiles = files
          .filter(f => f.endsWith('.md'))
          .sort()
          .reverse()
        
        for (const file of mdFiles) {
          const filePath = join(memoryDir, file)
          try {
            const content = await fs.readFile(filePath, 'utf-8')
            const stats = await fs.stat(filePath)
            memories.push({
              path: filePath,
              filename: file,
              content,
              size: stats.size,
              modified: stats.mtimeMs,
            })
          } catch (err) {
            console.error(`[Memory] Failed to read ${file}:`, err)
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        // Memory directory doesn't exist yet, that's fine
      }
    } catch (err) {
      console.error('[Memory] Failed to get memories:', err)
      throw err
    }

    return memories
  }

  /**
   * Append content to an agent's daily memory file
   */
  async appendToDaily(agent: string, content: string): Promise<{ path: string; filename: string }> {
    await this.ensureMemoryDir(agent)

    const filename = this.getTodayFilename()
    const filePath = join(this.getMemoryDir(agent), filename)

    // Add timestamp and ensure newlines
    const timestamp = new Date().toISOString()
    const entry = `\n[${timestamp}]\n${content.trim()}\n`

    try {
      await fs.appendFile(filePath, entry, 'utf-8')
      
      // Emit event to event bus
      eventBus.emitMemoryWritten(agent, filename, filePath)
      
      return { path: filePath, filename }
    } catch (err) {
      console.error('[Memory] Failed to append to daily:', err)
      throw err
    }
  }

  /**
   * Search across all memory files for an agent
   */
  async searchMemories(agent: string, query: string): Promise<Array<{
    filename: string
    line: number
    match: string
  }>> {
    const memories = await this.getMemories(agent)
    const results: Array<{ filename: string; line: number; match: string }> = []
    const queryLower = query.toLowerCase()

    for (const memory of memories) {
      const lines = memory.content.split('\n')
      
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(queryLower)) {
          results.push({
            filename: memory.filename,
            line: index + 1,
            match: line.trim(),
          })
        }
      })
    }

    return results
  }
}

export const memoryManager = new MemoryManager()
