import type { ToolContext } from '@/lib/tools/helpers/tool-context';
import { getData } from '@/lib/data-layer';

interface SaveUserProfileInput {
  user_id: string;
  profile: {
    name?: string;
    preferences?: Record<string, any>;
    working_style?: Record<string, any>;
    domains?: string[];
    timezone?: string;
    metadata?: Record<string, any>;
  };
  invalidate_cache?: boolean;
}

export default async function save_user_profile(input: SaveUserProfileInput, context: ToolContext) {
  const { user_id, profile, invalidate_cache = true } = input;

  try {
    const dataLayer = getData(context);
    
    // Store profile data as memory facts (preferences)
    // Each profile field becomes a fact
    const facts = [];
    
    if (profile.name) {
      facts.push({
        type: 'preference',
        fact: `User's name is ${profile.name}`,
        entity: user_id,
        attribute: 'name',
        value: profile.name,
        confidence: 1.0
      });
    }
    
    if (profile.timezone) {
      facts.push({
        type: 'preference',
        fact: `User's timezone is ${profile.timezone}`,
        entity: user_id,
        attribute: 'timezone',
        value: profile.timezone,
        confidence: 1.0
      });
    }
    
    if (profile.domains) {
      facts.push({
        type: 'preference',
        fact: `User works in domains: ${profile.domains.join(', ')}`,
        entity: user_id,
        attribute: 'domains',
        value: profile.domains,
        confidence: 1.0
      });
    }
    
    if (profile.preferences) {
      for (const [key, value] of Object.entries(profile.preferences)) {
        facts.push({
          type: 'preference',
          fact: `User preference: ${key} = ${JSON.stringify(value)}`,
          entity: user_id,
          attribute: `preference.${key}`,
          value: value,
          confidence: 0.9
        });
      }
    }
    
    if (profile.working_style) {
      for (const [key, value] of Object.entries(profile.working_style)) {
        facts.push({
          type: 'behavior',
          fact: `User working style: ${key} = ${JSON.stringify(value)}`,
          entity: user_id,
          attribute: `working_style.${key}`,
          value: value,
          confidence: 0.9
        });
      }
    }
    
    // Save each fact to memory_facts table
    const savedFacts = [];
    for (const factData of facts) {
      const factId = `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const fact = {
        id: factId,
        user_id,
        space_id: null, // User profile is global
        ...factData,
        source_conversation_ids: [],
        learned_at: new Date().toISOString(),
        last_reinforced: new Date().toISOString(),
        reinforcement_count: 1,
        related_fact_ids: []
      };
      
      await dataLayer.create('memory_facts', null, factId, fact);
      savedFacts.push(fact);
    }

    // Invalidate context cache when profile changes
    if (invalidate_cache) {
      try {
        // Delete from memory_context_cache using user_id as the id
        await dataLayer.delete('memory_context_cache', null, user_id);
      } catch {
        // Cache doesn't exist or couldn't be deleted
      }
    }

    return {
      success: true,
      user_id,
      facts_saved: savedFacts.length,
      cache_invalidated: invalidate_cache
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      user_id
    };
  }
}