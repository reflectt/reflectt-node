import {
  type ToolContext,
  withErrorHandling,
} from '@/lib/tools/helpers'

interface ListWorkflowsInput {
  target_space?: string
  filter_tags?: string[]
  sort_by?: 'name' | 'created_at' | 'updated_at'
  sort_order?: 'asc' | 'desc'
}

interface ListWorkflowsOutput {
  success: boolean
  workflows?: any[]
  total?: number
  error?: string
}

export default async function listWorkflows(
  input: ListWorkflowsInput,
  ctx: ToolContext
): Promise<ListWorkflowsOutput> {
  return withErrorHandling(async () => {
    try {
      // Scan all workflow directories for definition.json files
      const workflowDirs = await ctx.listDirs(input.target_space, 'workflows')

      let workflows = await Promise.all(
        workflowDirs.map(async workflowId => {
          try {
            return await ctx.readJson(input.target_space, 'workflows', workflowId, 'definition.json')
          } catch {
            return null
          }
        })
      )
      workflows = workflows.filter(w => w !== null)

      // Filter by tags
      if (input.filter_tags && input.filter_tags.length > 0) {
        workflows = workflows.filter(w =>
          w.tags && input.filter_tags!.some(tag => w.tags.includes(tag))
        )
      }

      // Sort
      const sortBy = input.sort_by || 'name'
      const sortOrder = input.sort_order || 'asc'

      workflows.sort((a, b) => {
        let aVal = a[sortBy]
        let bVal = b[sortBy]

        if (sortBy === 'name') {
          aVal = aVal?.toLowerCase() || ''
          bVal = bVal?.toLowerCase() || ''
        }

        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
        return 0
      })

      // Return summaries
      const summaries = workflows.map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        step_count: w.steps?.length || 0,
        tags: w.tags,
        version: w.version,
        created_at: w.created_at,
        updated_at: w.updated_at
      }))

      return {
        workflows: summaries,
        total: summaries.length
      }
    } catch {
      // No workflows directory exists
      return { workflows: [], total: 0 }
    }
  })
}
