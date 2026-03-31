// restart-drift-guard.ts
// Runs on server startup to check critical task state and reassert ownership
// Part of task-1773752635115-pa5gy3srk

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'

const CRITICAL_TAG = 'critical'

interface DriftFix {
  taskId: string
  field: string
  oldValue: string | undefined
  newValue: string
}

export async function runRestartDriftGuard(): Promise<DriftFix[]> {
  const fixes: DriftFix[] = []
  const now = Date.now()

  // Get all tasks with critical tag
  const criticalTasks = taskManager.listTasks({ 
    tags: [CRITICAL_TAG] 
  })

  console.log(`[RestartDrift] Checking ${criticalTasks.length} critical tasks...`)

  for (const task of criticalTasks) {
    // Skip completed tasks
    if (task.status === 'done' || task.status === 'cancelled') {
      continue
    }

    // Check: assignee drift (task has critical tag but no assignee)
    if (!task.assignee || task.assignee === 'unassigned') {
      // Try to assign based on task metadata or default
      const suggestedAssignee = task.metadata?.suggested_assignee as string | undefined
      
      if (suggestedAssignee) {
        const patched = taskManager.patchTaskMetadata(task.id, {
          assignee: suggestedAssignee
        })
        
        if (patched) {
          fixes.push({
            taskId: task.id,
            field: 'assignee',
            oldValue: task.assignee || 'unassigned',
            newValue: suggestedAssignee
          })
          
          // Post comment about the fix
          chatManager.sendMessage({
            channel: 'task-comments',
            from: 'system',
            content: `[RestartDrift] ${task.id}: Auto-assigned to @${suggestedAssignee} — assignee was missing on startup.`
          })
        }
      }
    }

    // Check: blocked flag drift (task should be blocked but isn't)
    const shouldBeBlocked = task.metadata?.should_be_blocked === true
    const isBlocked = task.metadata?.blocked === true
    
    if (shouldBeBlocked && !isBlocked) {
      const patched = taskManager.patchTaskMetadata(task.id, {
        blocked: true,
        blocked_reason: 'auto-restored by restart-drift-guard'
      })
      
      if (patched) {
        fixes.push({
          taskId: task.id,
          field: 'blocked',
          oldValue: 'false',
          newValue: 'true (restored)'
        })
        
        chatManager.sendMessage({
          channel: 'task-comments',
          from: 'system',
          content: `[RestartDrift] ${task.id}: Auto-restored blocked=true — task was marked should_be_blocked but wasn't blocked on startup.`
        })
      }
    }
  }

  console.log(`[RestartDrift] Applied ${fixes.length} fixes`)

  // Post summary comment if any fixes were applied
  if (fixes.length > 0) {
    const fixSummary = fixes.map(f => `- ${f.taskId}: ${f.field} ${f.oldValue} → ${f.newValue}`).join('\n')
    console.log(`[RestartDrift] Summary:\n${fixSummary}`)
    
    chatManager.sendMessage({
      channel: 'general',
      from: 'system',
      content: `[RestartDrift] Startup check complete. Applied ${fixes.length} fixes:\n${fixSummary}`
    })
  }

  return fixes
}
