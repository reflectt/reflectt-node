import { layoutActions } from '@/lib/ui-control/layout-store-v2'
import { LayoutIntent } from '@/lib/ui-control/layout-types'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

interface SetLayoutIntentInput {
  intent: LayoutIntent
  clearComponents?: boolean
}

interface SetLayoutIntentSuccess {
  success: true
  intent: LayoutIntent
  message: string
  space_id: string
}

interface SetLayoutIntentFailure {
  success: false
  error: string
  space_id: string
}

type SetLayoutIntentOutput = SetLayoutIntentSuccess | SetLayoutIntentFailure

export default async function setLayoutIntentTool(
  params: SetLayoutIntentInput,
  ctx: ToolContext
): Promise<SetLayoutIntentOutput> {
  try {
    const actions = layoutActions()

    // Validate intent
    if (!params.intent) {
      throw new Error('Intent is required')
    }

    // Set the intent (automatically clears ephemeral components)
    actions.setIntent(params.intent)

    return {
      success: true,
      intent: params.intent,
      message: `Layout intent set to '${params.intent}'. Ephemeral components cleared.`,
      space_id: ctx.currentSpace
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to set layout intent',
      space_id: ctx.currentSpace
    }
  }
}
