// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * GitHub Webhook → Chat Bridge
 *
 * Formats incoming GitHub webhook events as chat messages with
 * agent-remapped mentions and posts them to the 'github' channel.
 * Replaces Discord's native GitHub integration to ensure @mentions
 * resolve to agent names instead of shared GitHub usernames.
 */

import { remapGitHubMentions } from './github-webhook-attribution.js'

interface GitHubEvent {
  action?: string
  sender?: { login?: string }
  repository?: { full_name?: string; name?: string }
  pull_request?: {
    number?: number
    title?: string
    html_url?: string
    user?: { login?: string }
    merged?: boolean
    body?: string
  }
  issue?: {
    number?: number
    title?: string
    html_url?: string
    user?: { login?: string }
  }
  comment?: {
    body?: string
    html_url?: string
    user?: { login?: string }
  }
  review?: {
    state?: string
    body?: string
    html_url?: string
    user?: { login?: string }
  }
  ref?: string
  head_commit?: {
    message?: string
    author?: { username?: string }
  }
  check_run?: {
    name?: string
    conclusion?: string
    html_url?: string
  }
  workflow_run?: {
    name?: string
    conclusion?: string
    html_url?: string
    head_branch?: string
  }
}

/**
 * Format a GitHub webhook event into a chat message.
 * Returns null if the event should not be posted to chat.
 */
export function formatGitHubEvent(eventType: string, payload: GitHubEvent): string | null {
  const repo = payload.repository?.name || payload.repository?.full_name || 'unknown'
  const sender = payload.sender?.login || 'unknown'

  let message: string | null = null

  switch (eventType) {
    case 'pull_request': {
      const pr = payload.pull_request
      if (!pr) break
      const action = payload.action
      if (action === 'opened') {
        message = `@${sender} 📝 **PR opened** #${pr.number}: [${pr.title}](${pr.html_url})\nRepo: \`${repo}\``
      } else if (action === 'closed' && pr.merged) {
        message = `@${sender} ✅ **PR merged** #${pr.number}: [${pr.title}](${pr.html_url})\nRepo: \`${repo}\``
      } else if (action === 'closed') {
        message = `@${sender} ❌ **PR closed** #${pr.number}: [${pr.title}](${pr.html_url})\nRepo: \`${repo}\``
      } else if (action === 'review_requested') {
        message = `@${sender} 👀 **Review requested** on #${pr.number}: [${pr.title}](${pr.html_url})\nRepo: \`${repo}\``
      }
      break
    }

    case 'pull_request_review': {
      const review = payload.review
      const pr = payload.pull_request
      if (!review || !pr) break
      const state = review.state === 'approved' ? '✅ approved' :
                    review.state === 'changes_requested' ? '🔄 changes requested' :
                    '💬 commented'
      message = `@${sender} ${state} on #${pr.number}: [${pr.title}](${pr.html_url})\nRepo: \`${repo}\``
      if (review.body) message += `\n> ${review.body.slice(0, 200)}`
      break
    }

    case 'issue_comment':
    case 'pull_request_review_comment': {
      const comment = payload.comment
      const issue = payload.issue || payload.pull_request
      if (!comment || !issue) break
      const type = payload.pull_request ? 'PR' : 'Issue'
      message = `@${sender} 💬 **Comment** on ${type} #${issue.number}: [${issue.title}](${issue.html_url})\nRepo: \`${repo}\``
      if (comment.body) message += `\n> ${comment.body.slice(0, 200)}`
      break
    }

    case 'issues': {
      const issue = payload.issue
      if (!issue || payload.action !== 'opened') break
      message = `@${sender} 🐛 **Issue opened** #${issue.number}: [${issue.title}](${issue.html_url})\nRepo: \`${repo}\``
      break
    }

    case 'push': {
      const commit = payload.head_commit
      if (!commit) break
      const branch = payload.ref?.replace('refs/heads/', '') || 'unknown'
      message = `@${sender} 📦 **Push** to \`${branch}\` on \`${repo}\`\n> ${commit.message?.split('\n')[0]?.slice(0, 100) || 'no message'}`
      break
    }

    case 'workflow_run': {
      const run = payload.workflow_run
      if (!run || payload.action !== 'completed') break
      const icon = run.conclusion === 'success' ? '✅' : run.conclusion === 'failure' ? '❌' : '⚠️'
      message = `${icon} **${run.name}** ${run.conclusion} on \`${run.head_branch}\`\nRepo: \`${repo}\` [View](${run.html_url})`
      break
    }

    case 'check_run': {
      const check = payload.check_run
      if (!check || payload.action !== 'completed' || check.conclusion === 'success') break
      // Only post failed checks
      message = `❌ **Check failed**: ${check.name} — ${check.conclusion}\nRepo: \`${repo}\` [View](${check.html_url})`
      break
    }

    default:
      // Don't post unknown event types
      return null
  }

  // Remap GitHub mentions to agent names
  return message ? remapGitHubMentions(message) : null
}
