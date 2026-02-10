import Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

interface AnalysisCache {
  [key: string]: {
    result: any;
    timestamp: number;
  };
}

const analysisCache: AnalysisCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface AnalyzeUserRequestParams {
  user_id: string;
  message: string;
  conversation_context?: Array<{ role: string; content: string }>;
  use_cache?: boolean;
  include_recommendations?: boolean;
}

export default async function analyze_user_request(
  params: AnalyzeUserRequestParams,
  toolContext: any
): Promise<any> {
  const {
    user_id,
    message,
    conversation_context = [],
    use_cache = true,
    include_recommendations = true,
  } = params;

  const startTime = Date.now();

  // Check cache
  if (use_cache) {
    const cacheKey = crypto
      .createHash("md5")
      .update(`${user_id}:${message}`)
      .digest("hex");
    const cached = analysisCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log("✓ Returning cached analysis");
      return {
        ...cached.result,
        metadata: {
          ...cached.result.metadata,
          from_cache: true,
        },
      };
    }
  }

  console.log(`🔍 Analyzing request for user: ${user_id}`);

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Build the analysis prompt
  const analysisPrompt = `Analyze this user request and provide a complete context package.

User ID: ${user_id}
Message: "${message}"

${conversation_context.length > 0 ? `Recent conversation:\n${conversation_context.map((m) => `${m.role}: ${m.content}`).join("\n")}` : ""}

Run the full analysis pipeline:
1. Analyze intent (consult intelligence:intent_analyzer)
2. Load user context (load_user_profile, get_learned_patterns)
3. Match historical patterns
4. Get routing recommendations (consult intelligence:routing_advisor)
5. Build unified context package

Return the complete JSON context package as specified in your prompt.`;

  // Execute the agent using context.executeTool
  const result = await toolContext.executeTool('chat_with_agent', {
    agent_slug: "intelligence:request_analyzer",
    message: analysisPrompt,
    max_tokens: 4096,
  });

  if (!result.success) {
    throw new Error(`Analysis failed: ${result.error}`);
  }

  // Parse the response
  let contextPackage;
  try {
    // Try to extract JSON from the response
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      contextPackage = JSON.parse(jsonMatch[0]);
    } else {
      // If no JSON found, create a basic package
      contextPackage = {
        intent: {
          primary: "unknown",
          domain: "general",
          complexity: "medium",
          confidence: 0.5,
          entities: [],
        },
        routing: {
          recommended_agent: "general:concierge",
          confidence: 0.5,
          reasoning: "Could not parse analysis result",
        },
        raw_response: result.response,
      };
    }
  } catch (error) {
    console.error("Failed to parse analysis result:", error);
    contextPackage = {
      intent: {
        primary: "unknown",
        domain: "general",
        complexity: "medium",
        confidence: 0.5,
        entities: [],
      },
      routing: {
        recommended_agent: "general:concierge",
        confidence: 0.5,
        reasoning: "Analysis parsing failed",
      },
      error: String(error),
    };
  }

  // Add metadata
  const processingTime = Date.now() - startTime;
  contextPackage.metadata = {
    ...contextPackage.metadata,
    analysis_timestamp: new Date().toISOString(),
    processing_time_ms: processingTime,
    from_cache: false,
  };

  // Cache the result
  if (use_cache) {
    const cacheKey = crypto
      .createHash("md5")
      .update(`${user_id}:${message}`)
      .digest("hex");
    analysisCache[cacheKey] = {
      result: contextPackage,
      timestamp: Date.now(),
    };
  }

  console.log(
    `✓ Analysis complete in ${processingTime}ms - Recommended: ${contextPackage.routing?.recommended_agent}`
  );

  return contextPackage;
}
