import type { ToolContext } from '@/lib/tools/helpers/tool-context';
import { getData } from '@/lib/data-layer';

interface LoadUserProfileInput {
  user_id: string;
  create_if_missing?: boolean;
  include_context?: boolean;
}

export default async function load_user_profile(input: LoadUserProfileInput, context: ToolContext) {
  const { user_id, create_if_missing = true, include_context = false } = input;

  try {
    const dataLayer = getData(context);

    // Load facts for this user from memory_facts
    const facts = await dataLayer.list('memory_facts', null, 
      { user_id, space_id: null },
      { limit: 100 }
    );

    // Reconstruct profile from facts
    const profile: any = {
      user_id,
      name: null,
      preferences: {},
      working_style: {},
      domains: [],
      timezone: null,
      metadata: {}
    };

    for (const fact of facts.items) {
      if (fact.attribute === 'name') {
        profile.name = fact.value;
      } else if (fact.attribute === 'timezone') {
        profile.timezone = fact.value;
      } else if (fact.attribute === 'domains') {
        profile.domains = fact.value || [];
      } else if (fact.attribute?.startsWith('preference.')) {
        const key = fact.attribute.replace('preference.', '');
        profile.preferences[key] = fact.value;
      } else if (fact.attribute?.startsWith('working_style.')) {
        const key = fact.attribute.replace('working_style.', '');
        profile.working_style[key] = fact.value;
      }
    }

    const created = facts.items.length === 0;

    if (created && !create_if_missing) {
      return {
        success: false,
        error: `Profile not found for user: ${user_id}`,
        user_id
      };
    }

    // If no facts found and create_if_missing is true, return default profile
    if (created && create_if_missing) {
      profile.name = user_id;
      profile.preferences = {
        communication_style: 'balanced',
        detail_level: 'medium',
        confirmation_required: true
      };
      profile.working_style = {
        autonomy: 'collaborative',
        risk_tolerance: 'medium'
      };
    }

    // Optionally include recent context from memory_context_cache
    let recentContext = null;
    if (include_context) {
      try {
        const cache: any = await dataLayer.read('memory_context_cache', null, user_id);

        if (cache) {
          // Check if cache is still valid
          const cacheAge = Date.now() - new Date(cache.last_updated).getTime();
          const ttl = cache.ttl || 86400; // 24 hours default
          if (cacheAge < ttl * 1000) {
            // Load recent activity
            const activity = await dataLayer.list('memory_recent_activity', null,
              { user_id },
              { limit: 10 }
            );
            
            recentContext = {
              summary: cache.context_summary,
              activity_count: activity.items.length,
              last_updated: cache.last_updated
            };
          }
        }
      } catch {
        // No cache available
      }
    }

    return {
      success: true,
      user_id,
      profile,
      created,
      recent_context: recentContext
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      user_id
    };
  }
}