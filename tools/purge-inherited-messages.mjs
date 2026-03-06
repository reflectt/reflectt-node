#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Purge inherited Mac Daddy messages from Docker-BackOffice SQLite
//
// Context: Docker-BackOffice data volume was seeded from Mac Daddy data.
// PR #412 stopped new cross-host chat leaks, but 248 historical kai messages
// remain. This script removes messages that originated from Mac Daddy sessions.
//
// Usage:
//   node tools/purge-inherited-messages.mjs --dry-run   # preview what would be deleted
//   node tools/purge-inherited-messages.mjs --execute    # actually delete
//
// Must be run inside the Docker container or with DB_PATH pointing to the
// BackOffice SQLite file.

import Database from 'better-sqlite3'
import { existsSync } from 'fs'

const DB_PATH = process.env.DB_PATH || '/data/data/reflectt.db'
const isDryRun = process.argv.includes('--dry-run')
const isExecute = process.argv.includes('--execute')

if (!isDryRun && !isExecute) {
  console.error('Usage: node tools/purge-inherited-messages.mjs [--dry-run | --execute]')
  process.exit(1)
}

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`)
  console.error('Set DB_PATH env var or run inside the Docker container.')
  process.exit(1)
}

const db = new Database(DB_PATH, { readonly: isDryRun })

// Mac Daddy kai messages: from='kai', before the cross-host leak fix (PR #412)
// These are the 248 messages that were seeded into BackOffice from Mac Daddy.
// We identify them by sender='kai' since kai only runs on Mac Daddy.
// BackOffice has its own agents (finance-agent, legal-agent, ops-agent, etc.)

const kaiCount = db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE "from" = ?').get('kai')
console.log(`Found ${kaiCount.c} kai messages in BackOffice DB`)

if (isDryRun) {
  console.log('\n--- DRY RUN ---')
  const sample = db.prepare(
    'SELECT id, channel, timestamp, content FROM chat_messages WHERE "from" = ? ORDER BY timestamp ASC LIMIT 5'
  ).all('kai')
  console.log('Sample messages to delete:')
  for (const m of sample) {
    console.log(`  ${new Date(m.timestamp).toISOString()} #${m.channel} ${m.content?.slice(0, 60)}`)
  }
  const byChannel = db.prepare(
    'SELECT channel, COUNT(*) as c FROM chat_messages WHERE "from" = ? GROUP BY channel ORDER BY c DESC'
  ).all('kai')
  console.log('\nBy channel:', byChannel.map(r => `${r.channel}=${r.c}`).join(', '))
  console.log(`\nWould delete ${kaiCount.c} messages. Run with --execute to proceed.`)
} else {
  const result = db.prepare('DELETE FROM chat_messages WHERE "from" = ?').run('kai')
  console.log(`Deleted ${result.changes} kai messages`)

  // Verify
  const remaining = db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE "from" = ?').get('kai')
  console.log(`Remaining kai messages: ${remaining.c}`)
  console.log(`Total messages after purge: ${db.prepare('SELECT COUNT(*) as c FROM chat_messages').get().c}`)
}

db.close()
console.log('Done.')
