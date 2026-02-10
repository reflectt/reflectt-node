import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

/**
 * compose_email - Office Suite AI Tool
 *
 * Allows AI agents to programmatically compose, modify, and send emails through
 * the EmailComposer component. Provides full control over email composition including
 * recipients, content, attachments, templates, and scheduling.
 *
 * This tool bridges the gap between AI capabilities (writing, drafting, responding)
 * and the email UI, enabling:
 * - Auto-drafting emails based on context
 * - Smart reply generation and population
 * - Bulk email composition
 * - Template-based email creation
 * - Scheduled email campaigns
 *
 * Use Cases:
 * - "Draft an email to john@example.com about the quarterly report"
 * - "Reply to the latest email with a professional thank you"
 * - "Schedule a follow-up email for next Monday"
 * - "Send the weekly newsletter to all subscribers"
 *
 * Component Integration:
 * The tool uses patch_component_state to update the EmailComposer component's
 * internal state, triggering the editor to populate with the email data. The
 * component handles validation, sending, and user interaction.
 *
 * @param input - Email composition parameters
 * @param ctx - Tool execution context
 * @returns Success with email composition details or error
 */
export default async function composeEmailTool(
  input: unknown,
  ctx: ToolContext
): Promise<ComposeEmailOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required moduleId
    if (!params.moduleId || typeof params.moduleId !== 'string') {
      throw new Error('Missing required parameter: moduleId')
    }

    const moduleId = params.moduleId.trim()
    if (moduleId.length === 0) {
      throw new Error('moduleId cannot be empty')
    }

    // Validate action
    const action = params.action || 'compose'
    const validActions = ['compose', 'send', 'save_draft']
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action: "${action}". Must be one of: ${validActions.join(', ')}`)
    }

    // For send action, require at least one recipient and subject
    if (action === 'send') {
      if (!params.to || !Array.isArray(params.to) || params.to.length === 0) {
        throw new Error('action "send" requires at least one recipient in "to" field')
      }
      if (!params.subject || typeof params.subject !== 'string' || params.subject.trim().length === 0) {
        throw new Error('action "send" requires a non-empty subject')
      }
    }

    // Parse recipients
    const to = parseRecipients(params.to)
    const cc = parseRecipients(params.cc)
    const bcc = parseRecipients(params.bcc)

    // Validate subject
    let subject = ''
    if (params.subject) {
      if (typeof params.subject !== 'string') {
        throw new Error('subject must be a string')
      }
      subject = params.subject.trim()
      if (subject.length > 500) {
        throw new Error('subject cannot exceed 500 characters')
      }
    }

    // Validate body (or template)
    let body = ''
    let bodyHtml = ''
    if (params.body) {
      if (typeof params.body !== 'string') {
        throw new Error('body must be a string')
      }
      body = params.body
      // If body contains HTML tags, treat as HTML
      if (/<[a-z][\s\S]*>/i.test(body)) {
        bodyHtml = body
      } else {
        // Plain text - convert to HTML
        bodyHtml = `<p>${body.replace(/\n/g, '</p><p>')}</p>`
      }
    }

    // Validate template
    let template = null
    if (params.template) {
      if (typeof params.template !== 'string') {
        throw new Error('template must be a string')
      }
      template = params.template.trim()
    }

    // Validate attachments
    const attachments = parseAttachments(params.attachments)

    // Validate schedule
    let schedule = null
    if (params.schedule) {
      if (typeof params.schedule !== 'string') {
        throw new Error('schedule must be an ISO 8601 timestamp string')
      }
      schedule = params.schedule
      // Validate ISO format
      const date = new Date(schedule)
      if (isNaN(date.getTime())) {
        throw new Error('schedule must be a valid ISO 8601 timestamp')
      }
      // Ensure future date
      if (date.getTime() < Date.now()) {
        throw new Error('schedule must be a future timestamp')
      }
    }

    // Validate priority
    const priority = params.priority || 'normal'
    if (!['low', 'normal', 'high'].includes(priority)) {
      throw new Error('priority must be "low", "normal", or "high"')
    }

    // Validate readReceipt
    const readReceipt = params.readReceipt === true

    // Build the email composition state patch
    const emailData: any = {}

    // Set view mode based on action
    if (action === 'compose') {
      emailData.viewMode = 'compose'
    }

    // Set recipients
    if (to.length > 0) {
      emailData.toRecipients = to
    }
    if (cc.length > 0) {
      emailData.ccRecipients = cc
      emailData.showCC = true
    }
    if (bcc.length > 0) {
      emailData.bccRecipients = bcc
      emailData.showBCC = true
    }

    // Set subject
    if (subject) {
      emailData.subject = subject
    }

    // Set body content
    if (bodyHtml) {
      emailData.editorContent = bodyHtml
    }

    // Set template
    if (template) {
      emailData.selectedTemplate = template
    }

    // Set attachments
    if (attachments.length > 0) {
      emailData.attachments = attachments
    }

    // Set priority
    if (priority !== 'normal') {
      emailData.priority = priority
    }

    // Set read receipt
    if (readReceipt) {
      emailData.readReceipt = true
    }

    // Set schedule
    if (schedule) {
      emailData.scheduledSend = schedule
    }

    // For send action, trigger send
    if (action === 'send') {
      emailData._triggerSend = true
    }

    // For save_draft action, trigger save
    if (action === 'save_draft') {
      emailData._triggerSaveDraft = true
    }

    console.log('[compose_email]', {
      moduleId,
      action,
      to: to.length,
      cc: cc.length,
      bcc: bcc.length,
      hasSubject: !!subject,
      hasBody: !!bodyHtml,
      hasTemplate: !!template,
      attachmentCount: attachments.length,
      schedule,
      priority,
      readReceipt,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      email_composition: {
        moduleId,
        action,
        propsPatch: emailData,
        recipients: {
          to: to.map(r => r.email),
          cc: cc.map(r => r.email),
          bcc: bcc.map(r => r.email)
        },
        subject,
        bodyLength: body.length,
        attachmentCount: attachments.length,
        scheduled: !!schedule,
        timestamp: now()
      },
      space_id: ctx.currentSpace
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: ctx.currentSpace
    }
  }
}

/**
 * Parse recipients from various input formats
 */
function parseRecipients(input: any): Array<{ email: string; name?: string; type?: string }> {
  if (!input) return []

  if (!Array.isArray(input)) {
    throw new Error('Recipients must be an array')
  }

  return input.map((item, index) => {
    if (typeof item === 'string') {
      // Simple email string
      if (!isValidEmail(item)) {
        throw new Error(`Invalid email address at index ${index}: ${item}`)
      }
      return { email: item }
    } else if (typeof item === 'object' && item !== null) {
      // Object with email and optional name
      if (!item.email || typeof item.email !== 'string') {
        throw new Error(`Recipient at index ${index} must have an "email" field`)
      }
      if (!isValidEmail(item.email)) {
        throw new Error(`Invalid email address at index ${index}: ${item.email}`)
      }
      return {
        email: item.email,
        name: item.name || undefined,
        type: item.type || undefined
      }
    } else {
      throw new Error(`Recipient at index ${index} must be a string or object`)
    }
  })
}

/**
 * Parse attachments from input
 */
function parseAttachments(input: any): Array<{
  id: string
  name: string
  url: string
  size?: number
  type?: string
}> {
  if (!input) return []

  if (!Array.isArray(input)) {
    throw new Error('Attachments must be an array')
  }

  return input.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Attachment at index ${index} must be an object`)
    }

    if (!item.name || typeof item.name !== 'string') {
      throw new Error(`Attachment at index ${index} must have a "name" field`)
    }

    if (!item.url || typeof item.url !== 'string') {
      throw new Error(`Attachment at index ${index} must have a "url" field`)
    }

    return {
      id: `attachment-${Date.now()}-${index}`,
      name: item.name,
      url: item.url,
      size: item.size || undefined,
      type: item.type || undefined
    }
  })
}

/**
 * Simple email validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// Types
interface ComposeEmailSuccess {
  success: true
  email_composition: {
    moduleId: string
    action: string
    propsPatch: Record<string, any>
    recipients: {
      to: string[]
      cc: string[]
      bcc: string[]
    }
    subject: string
    bodyLength: number
    attachmentCount: number
    scheduled: boolean
    timestamp: string
  }
  space_id: string
}

interface ComposeEmailFailure {
  success: false
  error: string
  space_id: string
}

type ComposeEmailOutput = ComposeEmailSuccess | ComposeEmailFailure
