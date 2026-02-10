# `show_notification`

**Category:** `ui` (Streaming UI Control)

Trigger toast/alert notifications in real-time to communicate important updates, confirmations, errors, or actionable alerts. This is a **streaming UI tool** - notifications appear as tool calls stream through.

## When to use

- **Success confirmations:** "Workflow deployed successfully!"
- **Error alerts:** "Build failed - 3 tests failing"
- **Important warnings:** "Budget threshold exceeded - review spending"
- **Informational updates:** "New agent available in registry"
- **Actionable prompts:** "Do you want to see the error logs?" → action button
- **Status changes:** "Database backup completed"
- **Critical alerts:** Persistent notifications (duration: 0) that require user attention

## Severity Levels

### 📘 `info` - Informational
Blue/sky tones with info icon. Use for general updates and FYI messages.
- **Examples:** "New feature available", "Sync completed", "Agent is ready"

### ✅ `success` - Success/Positive
Green/emerald tones with checkmark icon. Use for successful operations.
- **Examples:** "Deployment successful", "File uploaded", "Task completed"

### ⚠️ `warning` - Warning/Caution
Amber/orange tones with warning icon. Use for non-critical issues requiring attention.
- **Examples:** "Budget threshold reached", "API rate limit approaching", "Outdated dependency"

### 🚨 `error` - Error/Failure
Red/rose tones with alert icon. Use for failures and critical problems.
- **Examples:** "Build failed", "Connection lost", "Permission denied"

## Input Shape

```jsonc
{
  "message": "Build failed - 3 tests failing",  // Required: notification text
  "severity": "error",                           // Required: info|success|warning|error
  "title": "Build Failure",                      // Optional: heading
  "duration": 0,                                 // Optional: 0 = persistent, default: 5000ms
  "actions": [                                   // Optional: action buttons (max 3)
    {
      "label": "View Logs",
      "action": "prompt",
      "prompt": "show me the build logs"
    },
    {
      "label": "Dismiss",
      "action": "dismiss"
    }
  ],
  "position": "top-right"                        // Optional: top-right|top-center|bottom-right
}
```

## Examples

### Success Notification
```json
{
  "message": "Workflow deployed successfully to production!",
  "severity": "success",
  "duration": 5000
}
```

### Error with Actions
```json
{
  "message": "Build failed - 3 tests failing. Check logs for details.",
  "severity": "error",
  "title": "Build Failure",
  "duration": 0,
  "actions": [
    {
      "label": "View Logs",
      "action": "prompt",
      "prompt": "show me the detailed build logs"
    },
    {
      "label": "Retry Build",
      "action": "prompt",
      "prompt": "retry the build"
    },
    {
      "label": "Dismiss",
      "action": "dismiss"
    }
  ]
}
```

### Warning Alert
```json
{
  "message": "Budget threshold exceeded - you've spent $47,500 of $50,000",
  "severity": "warning",
  "title": "Budget Alert",
  "duration": 10000,
  "actions": [
    {
      "label": "View Spending",
      "action": "prompt",
      "prompt": "show me detailed cost breakdown"
    }
  ]
}
```

### Persistent Info
```json
{
  "message": "New agent 'Analytics Pro' is now available in the registry",
  "severity": "info",
  "title": "New Agent Available",
  "duration": 0,
  "actions": [
    {
      "label": "View Agent",
      "action": "prompt",
      "prompt": "tell me about Analytics Pro agent"
    },
    {
      "label": "Later",
      "action": "dismiss"
    }
  ],
  "position": "top-center"
}
```

### Simple Status Update
```json
{
  "message": "Database backup completed",
  "severity": "success",
  "duration": 3000
}
```

## Action Types

### `dismiss`
Closes the notification immediately. No prompt required.
```json
{
  "label": "OK",
  "action": "dismiss"
}
```

### `prompt`
Sends a prompt to the chat when clicked. Requires `prompt` parameter.
```json
{
  "label": "Show Details",
  "action": "prompt",
  "prompt": "show me detailed information about this error"
}
```

## Position Options

- **`top-right`** (default) - Most common, doesn't block content
- **`top-center`** - Prominent, good for important announcements
- **`bottom-right`** - Less intrusive, good for background updates

## Duration Guidelines

- **0ms** - Persistent (requires manual dismiss) - Use for critical alerts
- **3000ms** - Quick confirmation - Use for simple success messages
- **5000ms** (default) - Standard notification - Most common use case
- **10000ms** - Important warning - Give user time to read details
- **15000ms+** - Very important information - Rare, use sparingly

## Behavior

1. **Server-side:** Validates parameters, generates unique notification ID
2. **Response:** Returns `notification` object in tool call response
3. **Client-side:** Chat UI detects `notification` in tool call stream
4. **Rendering:** 
   - Toast notification appears with appropriate severity styling
   - Icon matches severity (info/checkmark/warning/alert)
   - Position determined by `position` parameter
   - Actions rendered as buttons if provided
5. **Auto-dismiss:** If `duration > 0`, notification auto-dismisses after timeout
6. **Persistent:** If `duration === 0`, notification stays until user dismisses
7. **Actions:** Clicking action button either dismisses or sends prompt to chat

## Best Practices

1. **Be concise:** Keep messages under 100 characters when possible
2. **Use titles for emphasis:** Title draws attention, message provides details
3. **Match severity to importance:**
   - `info` for FYI messages
   - `success` for positive outcomes
   - `warning` for non-critical issues
   - `error` for failures that need attention

4. **Provide actions when helpful:**
   - Error → "View Logs" action
   - Warning → "Review Details" action
   - Info → "Learn More" action

5. **Don't spam:** Avoid multiple notifications in quick succession
6. **Use persistent wisely:** Only duration: 0 for truly critical alerts
7. **Position thoughtfully:**
   - Important announcements → top-center
   - Standard notifications → top-right
   - Background updates → bottom-right

8. **Narrate notifications:** Tell user before showing
   - "I'm sending you a notification about the build failure..."
   - "Watch for the alert - your budget threshold was exceeded..."

## Integration with AI Expression

Notifications are part of the AI's expression toolkit:

```markdown
**Pattern: Progressive Alert**
User: "Deploy the workflow"
AI: "Deploying now... I'll notify you when it completes."
    *Deploys workflow*
    *Shows success notification: "Workflow deployed!"*

**Pattern: Error with Guidance**
User: "Run the tests"
AI: "Running tests..."
    *Tests fail*
    "Uh oh, 3 tests failed. I'm showing you an alert with options."
    *Shows error notification with "View Logs" action*

**Pattern: Proactive Warning**
AI analyzing costs: "Wait - I notice your spending is getting high."
    *Shows warning notification: "Budget threshold exceeded"*
    "Click 'View Spending' in the notification to see details."
```

## Error Handling

- Missing message → Error returned
- Invalid severity → Error with valid options
- Message too long (>500 chars) → Error
- Title too long (>100 chars) → Error
- Too many actions (>3) → Error
- Invalid action type → Error
- Duration out of range (>30000ms) → Error
- Invalid position → Error with valid options
