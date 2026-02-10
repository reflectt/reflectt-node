import {
  formatError,
  type ToolOutput,
  type ToolContext,
} from '@/lib/tools/helpers'

interface ListToolCategoriesInput {
  include_counts?: boolean
  target_space?: string
}

interface ListToolCategoriesOutput {
  success: boolean
  categories?: Array<{
    name: string
    tool_count?: number
  }>
  total?: number
  error?: string
}

export default async function listToolCategories(
  input: ListToolCategoriesInput,
  ctx: ToolContext
): Promise<ListToolCategoriesOutput> {
  try {
    const space = input.target_space || 'global'

    const categoryCounts = new Map<string, number>()

    // List all category directories
    let categoryDirs: string[] = []
    try {
      categoryDirs = await ctx.listDirs(space, 'tools')
    } catch {
      // Tools directory doesn't exist
      return { success: true, categories: [], total: 0 }
    }

    for (const category of categoryDirs) {
      // Count tools in this category
      const toolDirs = await ctx.listDirs(space, 'tools', category)

      let toolCount = 0
      for (const toolName of toolDirs) {
        try {
          await ctx.readJson(space, 'tools', category, toolName, 'definition.json')
          toolCount++
        } catch {
          // No definition.json, skip
        }
      }

      categoryCounts.set(category, toolCount)
    }

    // Convert to array
    const categories = Array.from(categoryCounts.entries())
      .map(([name, count]) => ({
        name,
        ...(input.include_counts ? { tool_count: count } : {})
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return {
      success: true,
      categories,
      total: categories.length
    }
  } catch (error) {
    return {
      success: false,
      categories: [],
      total: 0,
      error: formatError(error)
    }
  }
}
