// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Contacts directory — minimal people/org directory.
 *
 * Not a full CRM. Just enough to answer "who is this person?"
 * and "what is their context?" Linked to tasks and indexed
 * in the vector store for knowledge search.
 *
 * SQLite table: contacts
 */

import { getDb } from './db.js'

// ── Types ──

export interface Contact {
  id: string
  name: string
  org: string | null
  emails: string[]
  handles: Record<string, string>   // { discord: "user#1234", github: "username", ... }
  tags: string[]
  notes: string
  source: string | null             // how we know them (e.g. "discord community", "pilot signup")
  owner: string | null              // agent who owns the relationship
  last_contact: number | null       // epoch ms
  related_task_ids: string[]
  created_at: number
  updated_at: number
}

export interface CreateContactInput {
  name: string
  org?: string
  emails?: string[]
  handles?: Record<string, string>
  tags?: string[]
  notes?: string
  source?: string
  owner?: string
  last_contact?: number
  related_task_ids?: string[]
}

export interface UpdateContactInput {
  name?: string
  org?: string
  emails?: string[]
  handles?: Record<string, string>
  tags?: string[]
  notes?: string
  source?: string
  owner?: string
  last_contact?: number
  related_task_ids?: string[]
}

export interface ContactListOpts {
  name?: string
  org?: string
  tag?: string
  owner?: string
  q?: string
  limit?: number
  offset?: number
}

// ── DB row ──

interface ContactRow {
  id: string
  name: string
  org: string | null
  emails: string
  handles: string
  tags: string
  notes: string
  source: string | null
  owner: string | null
  last_contact: number | null
  related_task_ids: string
  created_at: number
  updated_at: number
}

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    org: row.org,
    emails: JSON.parse(row.emails || '[]'),
    handles: JSON.parse(row.handles || '{}'),
    tags: JSON.parse(row.tags || '[]'),
    notes: row.notes || '',
    source: row.source,
    owner: row.owner,
    last_contact: row.last_contact,
    related_task_ids: JSON.parse(row.related_task_ids || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 11)
  return `contact-${ts}-${rand}`
}

// ── Migration ──

export function initContactsTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      org TEXT,
      emails TEXT NOT NULL DEFAULT '[]',
      handles TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT,
      owner TEXT,
      last_contact INTEGER,
      related_task_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_org ON contacts(org)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner)`)
}

// ── CRUD ──

export function createContact(input: CreateContactInput): Contact {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  const contact: Contact = {
    id,
    name: input.name,
    org: input.org || null,
    emails: input.emails || [],
    handles: input.handles || {},
    tags: input.tags || [],
    notes: input.notes || '',
    source: input.source || null,
    owner: input.owner || null,
    last_contact: input.last_contact || null,
    related_task_ids: input.related_task_ids || [],
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO contacts (id, name, org, emails, handles, tags, notes, source, owner, last_contact, related_task_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contact.id, contact.name, contact.org,
    JSON.stringify(contact.emails), JSON.stringify(contact.handles),
    JSON.stringify(contact.tags), contact.notes,
    contact.source, contact.owner, contact.last_contact,
    JSON.stringify(contact.related_task_ids),
    contact.created_at, contact.updated_at,
  )

  return contact
}

export function getContact(id: string): Contact | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow | undefined
  return row ? rowToContact(row) : null
}

export function updateContact(id: string, input: UpdateContactInput): Contact | null {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as ContactRow | undefined
  if (!existing) return null

  const now = Date.now()
  const sets: string[] = ['updated_at = ?']
  const params: unknown[] = [now]

  if (input.name !== undefined) { sets.push('name = ?'); params.push(input.name) }
  if (input.org !== undefined) { sets.push('org = ?'); params.push(input.org) }
  if (input.emails !== undefined) { sets.push('emails = ?'); params.push(JSON.stringify(input.emails)) }
  if (input.handles !== undefined) { sets.push('handles = ?'); params.push(JSON.stringify(input.handles)) }
  if (input.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(input.tags)) }
  if (input.notes !== undefined) { sets.push('notes = ?'); params.push(input.notes) }
  if (input.source !== undefined) { sets.push('source = ?'); params.push(input.source) }
  if (input.owner !== undefined) { sets.push('owner = ?'); params.push(input.owner) }
  if (input.last_contact !== undefined) { sets.push('last_contact = ?'); params.push(input.last_contact) }
  if (input.related_task_ids !== undefined) { sets.push('related_task_ids = ?'); params.push(JSON.stringify(input.related_task_ids)) }

  params.push(id)
  db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  return getContact(id)
}

export function deleteContact(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id)
  return result.changes > 0
}

export function listContacts(opts: ContactListOpts = {}): { contacts: Contact[]; total: number } {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (opts.org) { where.push('org = ?'); params.push(opts.org) }
  if (opts.owner) { where.push('owner = ?'); params.push(opts.owner) }
  if (opts.tag) { where.push("tags LIKE '%' || ? || '%'"); params.push(`"${opts.tag}"`) }
  if (opts.name) {
    where.push("name LIKE '%' || ? || '%'")
    params.push(opts.name)
  }
  if (opts.q) {
    where.push("(name LIKE '%' || ? || '%' OR org LIKE '%' || ? || '%' OR notes LIKE '%' || ? || '%' OR emails LIKE '%' || ? || '%')")
    params.push(opts.q, opts.q, opts.q, opts.q)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit || 50, 200)
  const offset = opts.offset || 0

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM contacts ${whereClause}`).get(...params) as { c: number }
  const rows = db.prepare(
    `SELECT * FROM contacts ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as ContactRow[]

  return { contacts: rows.map(rowToContact), total: countRow.c }
}

export function countContacts(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as c FROM contacts').get() as { c: number }
  return row.c
}
