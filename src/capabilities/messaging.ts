/**
 * Messaging capability — outbound SMS and email via cloud relay.
 *
 * Agents call the local node endpoints below. The node authenticates
 * with the cloud API using REFLECTT_HOST_TOKEN (set automatically on
 * enrollment) — no Supabase credentials needed by the agent.
 *
 * Auth flow:
 *   Agent → POST /sms/send (local node)
 *        → node cloudRelay → POST /api/hosts/:hostId/relay/sms (cloud)
 *        → cloud validates host credential → Twilio API
 *
 *   Agent → POST /email/send (local node)
 *        → node cloudRelay → POST /api/hosts/:hostId/relay/email (cloud)
 *        → cloud validates host credential → Resend API
 *
 * @module capabilities/messaging
 */

// ---------------------------------------------------------------------------
// Outbound SMS
// ---------------------------------------------------------------------------

/**
 * POST /sms/send
 *
 * Send an outbound SMS through the team's configured Twilio number.
 *
 * Request body:
 *   - from: string — E.164 phone number registered to this team (e.g. "+19062999626")
 *   - to: string — Recipient E.164 phone number (e.g. "+17785817926")
 *   - body: string — SMS message text (max 1600 chars)
 *   - agent?: string — Sending agent name (for audit log)
 *
 * Response (200):
 *   - messageSid: string — Twilio message SID
 *   - status: string — Twilio delivery status (e.g. "queued")
 *
 * Errors:
 *   - 400 — Missing required fields or invalid phone number
 *   - 500 — Cloud relay unavailable (node not connected to cloud)
 *   - 502 — Twilio send failed
 *
 * Example:
 *   curl -X POST http://localhost:4445/sms/send \
 *     -H "Content-Type: application/json" \
 *     -d '{"from":"+1XXXXXXXXXX","to":"+1XXXXXXXXXX","body":"Hello from your agent","agent":"agent-name"}'
 */
export interface OutboundSmsRequest {
  from: string             // E.164 phone number registered to this team
  to: string               // Recipient E.164 phone number
  body: string             // Message text (max 1600 chars)
  agent?: string           // Sending agent name (audit)
}

export interface OutboundSmsResponse {
  messageSid: string       // Twilio message SID
  status: string           // e.g. "queued", "sent"
}

// ---------------------------------------------------------------------------
// Outbound Email
// ---------------------------------------------------------------------------

/**
 * POST /email/send
 *
 * Send an outbound email through the team's configured Resend domain.
 *
 * Request body:
 *   - from: string — Team alias or shared inbox address (e.g. "team@example.com")
 *   - to: string | string[] — Recipient email(s)
 *   - subject: string — Email subject
 *   - html?: string — HTML body (one of html or text required)
 *   - text?: string — Plain text body
 *   - replyTo?: string — Reply-to address
 *   - cc?: string | string[] — CC recipients
 *   - bcc?: string | string[] — BCC recipients
 *   - agent?: string — Sending agent name (for audit log)
 *
 * Response (200):
 *   - messageId: string — Resend message ID
 *
 * Errors:
 *   - 400 — Missing required fields or invalid email
 *   - 403 — from address not registered as a team alias
 *   - 500 — Cloud relay unavailable (node not connected to cloud)
 *   - 502 — Resend send failed
 *
 * Example:
 *   curl -X POST http://localhost:4445/email/send \
 *     -H "Content-Type: application/json" \
 *     -d '{"from":"team@example.com","to":"customer@example.com","subject":"Hello","text":"Hi there","agent":"agent-name"}'
 */
export interface OutboundEmailRequest {
  from: string             // Team alias or shared inbox address
  to: string | string[]    // Recipient(s)
  subject: string          // Email subject
  html?: string            // HTML body (one of html or text required)
  text?: string            // Plain text body
  replyTo?: string         // Reply-to address
  cc?: string | string[]   // CC recipients
  bcc?: string | string[]  // BCC recipients
  agent?: string           // Sending agent name (audit)
}

export interface OutboundEmailResponse {
  messageId: string        // Resend message ID
}
