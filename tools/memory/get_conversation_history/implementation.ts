import {
  type ToolContext,
} from '@/lib/tools/helpers';
import { getData } from '@/lib/data-layer';

interface GetConversationHistoryInput {
  user_id: string;
  limit?: number;
  filter_intent?: string;
  filter_agent?: string;
}

export default async function get_conversation_history(input: GetConversationHistoryInput, ctx: ToolContext) {
  const { user_id, limit = 20, filter_intent, filter_agent } = input;

  try {
    const dataLayer = getData(ctx);
    const target = ctx.currentSpace || 'global';
    const spaceId = target === 'global' ? null : target;

    // Load recent activity from memory_recent_activity table
    const filters: any = { user_id };
    if (filter_intent) {
      filters.intent = filter_intent;
    }
    if (filter_agent) {
      filters.agent_slug = filter_agent;
    }

    const result = await dataLayer.list('memory_recent_activity', spaceId,
      filters,
      { limit }
    );

    // Transform to expected format
    const entries = result.items.map((activity: any) => ({
      id: activity.id,
      timestamp: activity.timestamp,
      user_message: activity.summary,
      intent: activity.intent,
      outcome: activity.outcome,
      actions_taken: activity.key_decisions || [],
      agents_used: [activity.agent_slug],
      metadata: {
        conversation_id: activity.conversation_id,
        relevance_score: activity.relevance_score
      }
    }));

    return {
      success: true,
      user_id,
      entries,
      total: result.total,
      returned: entries.length,
      filters_applied: {
        intent: filter_intent,
        agent: filter_agent,
        limit
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      user_id,
      entries: [],
      total: 0
    };
  }
}