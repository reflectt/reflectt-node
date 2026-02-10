interface RecordRoutingFeedbackParams {
  user_id: string;
  message: string;
  recommended_agent?: string;
  actual_agent: string;
  outcome: "success" | "partial" | "failure";
  clarifications_needed?: string[];
  notes?: string;
}

export default async function record_routing_feedback(
  params: RecordRoutingFeedbackParams,
  toolContext: any
): Promise<any> {
  const {
    user_id,
    message,
    recommended_agent,
    actual_agent,
    outcome,
    clarifications_needed = [],
    notes = "",
  } = params;

  console.log(
    `📊 Recording feedback: ${recommended_agent} → ${actual_agent} (${outcome})`
  );

  const feedbackPrompt = `Process this routing feedback and update the system's intelligence.

User ID: ${user_id}
Original Message: "${message}"
Recommended Agent: ${recommended_agent || "none"}
Actual Agent Used: ${actual_agent}
Outcome: ${outcome}
Clarifications Needed: ${clarifications_needed.join(", ") || "none"}
Notes: ${notes || "none"}

Analyze this feedback and:
1. Update confidence scores for relevant patterns
2. Learn new patterns if applicable
3. Update user profile with insights
4. Record in conversation history

Return a JSON summary of what was learned.`;

  // Execute the agent using context.executeTool
  const result = await toolContext.executeTool('chat_with_agent', {
    agent_slug: "intelligence:feedback_learner",
    message: feedbackPrompt,
    max_tokens: 4096,
  });

  if (!result.success) {
    throw new Error(`Feedback processing failed: ${result.error}`);
  }

  // Parse the response
  let learningResult;
  try {
    const jsonMatch = result.response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      learningResult = JSON.parse(jsonMatch[0]);
    } else {
      learningResult = {
        summary: result.response,
        patterns_updated: [],
        patterns_created: [],
        profile_updates: {},
        insights: [],
      };
    }
  } catch (error) {
    console.error("Failed to parse learning result:", error);
    learningResult = {
      summary: "Feedback recorded but parsing failed",
      error: String(error),
      raw_response: result.response,
    };
  }

  console.log(
    `✓ Feedback processed - Updated: ${learningResult.patterns_updated?.length || 0}, Created: ${learningResult.patterns_created?.length || 0}`
  );

  return {
    success: true,
    ...learningResult,
    metadata: {
      timestamp: new Date().toISOString(),
      user_id,
      outcome,
    },
  };
}
