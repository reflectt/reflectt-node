import {
  type ToolContext,
} from '@/lib/tools/helpers';
import { getData } from '@/lib/data-layer';

interface ConversationEntry {
  timestamp?: string;
  user_message: string;
  intent: string;
  actions_taken?: string[];
  agents_used?: string[];
  outcome?: string;
  metadata?: Record<string, any>;
}

interface UpdateConversationHistoryInput {
  user_id: string;
  entry: ConversationEntry;
  max_history?: number;
}

export default async function update_conversation_history(input: UpdateConversationHistoryInput, ctx: ToolContext) {
  const { user_id, entry } = input;

  try {
    const dataLayer = getData(ctx);
    const target = ctx.currentSpace || 'global';
    const spaceId = target === 'global' ? null : target;

    // Create a memory_recent_activity record
    const activityId = `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const activity = {
      id: activityId,
      user_id,
      space_id: spaceId,
      conversation_id: entry.metadata?.conversation_id || `conv_${Date.now()}`,
      timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString(),
      summary: entry.user_message,
      intent: entry.intent,
      outcome: entry.outcome || 'success',
      key_decisions: entry.actions_taken || [],
      relevance_score: 1.0,
      agent_slug: entry.agents_used?.[0] || 'unknown',
      created_at: new Date().toISOString()
    };

    await dataLayer.create('memory_recent_activity', spaceId, activityId, activity);

    // Optionally trim old history (keep only recent max_history items)
    // For now, we'll rely on database queries with LIMIT instead of manual trimming
    const recentActivity = await dataLayer.list('memory_recent_activity', spaceId,
      { user_id },
      { limit: 1 }
    );

    return {
      success: true,
      user_id,
      activity_id: activityId,
      total_entries: recentActivity.total
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      user_id
    };
  }
}