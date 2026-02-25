// SPDX-License-Identifier: Apache-2.0
// Shared utility: classify test-harness tasks
//
// Test tasks are created by pipeline validation runs (intake tests, bridge tests,
// working-contract tests, etc.) and must be excluded from production metrics,
// board health, and stats by default.

import type { Task } from './types.js'

/**
 * Returns true if a task is a test-harness-generated task.
 *
 * Classification rules:
 * 1. metadata.is_test === true
 * 2. metadata.source_reflection starts with 'ref-test-'
 * 3. metadata.source_insight starts with 'ins-test-'
 * 4. Title matches "test run <13-digit-timestamp>"
 * 5. Task ID starts with 'test-' or matches 'task-test-*'
 */
export function isTestHarnessTask(task: Task): boolean {
  const meta = (task.metadata || {}) as Record<string, unknown>
  if (meta.is_test === true) return true
  if (typeof meta.source_reflection === 'string' && meta.source_reflection.startsWith('ref-test-')) return true
  if (typeof meta.source_insight === 'string' && meta.source_insight.startsWith('ins-test-')) return true
  if (/test run \d{13}/i.test(task.title || '')) return true
  // ID-based classification: task IDs created by test harnesses
  const id = task.id || ''
  if (id.startsWith('test-') || /^task-test-/i.test(id)) return true
  return false
}

/**
 * SQL WHERE clause fragment to exclude test-harness tasks at the DB level.
 * Use for raw SQL queries that can't go through listTasks().
 *
 * Usage: `SELECT ... FROM tasks WHERE ${TEST_TASK_EXCLUDE_SQL}`
 * Pair with include_test parameter: `WHERE (? = 1 OR ${TEST_TASK_EXCLUDE_SQL})`
 */
export const TEST_TASK_EXCLUDE_SQL = `(
  json_extract(metadata, '$.is_test') IS NOT 1
  AND (json_extract(metadata, '$.source_reflection') IS NULL OR json_extract(metadata, '$.source_reflection') NOT LIKE 'ref-test-%')
  AND (json_extract(metadata, '$.source_insight') IS NULL OR json_extract(metadata, '$.source_insight') NOT LIKE 'ins-test-%')
  AND title NOT LIKE '%test run 1%'
  AND id NOT LIKE 'test-%'
  AND id NOT LIKE 'task-test-%'
)`
