// SPDX-License-Identifier: Apache-2.0
// Team config linter for ~/.reflectt TEAM files

import { watch, existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import { REFLECTT_HOME } from './config.js'
import { getAgentRoles } from './assignment.js'

export interface TeamConfigIssue {
  level: 'warning' | 'error'
  code: string
  message: string
  path?: string
}

export interface TeamConfigValidationResult {
  ok: boolean
  checkedAt: number
  root: string
  files: {
    teamMd: string
    rolesYaml: string
    standardsMd: string
  }
  issues: TeamConfigIssue[]
  roleNamesFromConfig: string[]
  assignmentRoleNames: string[]
}

const REQUIRED_TEAM_SECTIONS = [
  'mission',
  'principle',
  'role',
  'work',
]

const state: {
  result: TeamConfigValidationResult
  watcher: ReturnType<typeof watch> | null
  debounce: NodeJS.Timeout | null
} = {
  result: {
    ok: true,
    checkedAt: Date.now(),
    root: REFLECTT_HOME,
    files: {
      teamMd: join(REFLECTT_HOME, 'TEAM.md'),
      rolesYaml: join(REFLECTT_HOME, 'TEAM-ROLES.yaml'),
      standardsMd: join(REFLECTT_HOME, 'TEAM-STANDARDS.md'),
    },
    issues: [],
    roleNamesFromConfig: [],
    assignmentRoleNames: getAgentRoles().map((r) => r.name),
  },
  watcher: null,
  debounce: null,
}

function pushIssue(
  issues: TeamConfigIssue[],
  level: 'warning' | 'error',
  code: string,
  message: string,
  path?: string,
) {
  issues.push({ level, code, message, path })
}

function readMaybe(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function extractMarkdownSectionNames(raw: string): string[] {
  const names: string[] = []
  const rx = /^#{1,6}\s+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = rx.exec(raw)) !== null) {
    names.push(m[1].trim().toLowerCase())
  }
  return names
}

function extractRoleNamesFromYaml(raw: string): { names: string[]; malformed: boolean } {
  const names = new Set<string>()
  const lines = raw.split(/\r?\n/)

  let inAgentsSection = false
  let inRolesList = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // crude malformed signal: tabs in YAML indentation are a common breakage
    if (/^\t+/.test(line)) {
      return { names: [], malformed: true }
    }

    if (/^agents\s*:\s*$/i.test(trimmed)) {
      inAgentsSection = true
      inRolesList = false
      continue
    }

    if (/^roles\s*:\s*$/i.test(trimmed)) {
      inRolesList = true
      inAgentsSection = false
      continue
    }

    if (/^[A-Za-z0-9_-]+\s*:\s*$/.test(trimmed) && !/^agents\s*:/i.test(trimmed) && !/^roles\s*:/i.test(trimmed)) {
      if (!line.startsWith(' ')) {
        inAgentsSection = false
        inRolesList = false
      } else if (inAgentsSection) {
        names.add(trimmed.replace(/\s*:$/, ''))
      }
    }

    const nameMatch = trimmed.match(/^-\s*name\s*:\s*([A-Za-z0-9_-]+)/i)
    if (inRolesList && nameMatch) {
      names.add(nameMatch[1])
    }
  }

  if (names.size === 0) {
    // last fallback for list style occurrences anywhere in file
    const fallbackRx = /name\s*:\s*([A-Za-z0-9_-]+)/gi
    let m: RegExpExecArray | null
    while ((m = fallbackRx.exec(raw)) !== null) {
      names.add(m[1])
    }
  }

  return { names: Array.from(names), malformed: false }
}

export function validateTeamConfig(): TeamConfigValidationResult {
  const files = {
    teamMd: join(REFLECTT_HOME, 'TEAM.md'),
    rolesYaml: join(REFLECTT_HOME, 'TEAM-ROLES.yaml'),
    standardsMd: join(REFLECTT_HOME, 'TEAM-STANDARDS.md'),
  }

  const issues: TeamConfigIssue[] = []

  const teamMd = readMaybe(files.teamMd)
  if (!teamMd) {
    pushIssue(issues, 'warning', 'team_md_missing', 'TEAM.md is missing or unreadable', files.teamMd)
  } else {
    const headings = extractMarkdownSectionNames(teamMd)
    for (const token of REQUIRED_TEAM_SECTIONS) {
      const found = headings.some((h) => h.includes(token))
      if (!found) {
        pushIssue(
          issues,
          'warning',
          'team_md_missing_section',
          `TEAM.md missing required section matching "${token}"`,
          files.teamMd,
        )
      }
    }
  }

  const standardsMd = readMaybe(files.standardsMd)
  if (!standardsMd) {
    pushIssue(
      issues,
      'warning',
      'team_standards_missing',
      'TEAM-STANDARDS.md is missing or unreadable',
      files.standardsMd,
    )
  }

  const assignmentRoleNames = getAgentRoles().map((r) => r.name)
  let roleNamesFromConfig: string[] = []

  const rolesYaml = readMaybe(files.rolesYaml)
  if (!rolesYaml) {
    pushIssue(
      issues,
      'warning',
      'team_roles_missing',
      'TEAM-ROLES.yaml is missing or unreadable',
      files.rolesYaml,
    )
  } else {
    const parsed = extractRoleNamesFromYaml(rolesYaml)
    if (parsed.malformed) {
      pushIssue(
        issues,
        'warning',
        'team_roles_malformed',
        'TEAM-ROLES.yaml appears malformed (indentation/tabs parse issue)',
        files.rolesYaml,
      )
    } else {
      roleNamesFromConfig = parsed.names.map((n) => n.toLowerCase())
      if (roleNamesFromConfig.length === 0) {
        pushIssue(
          issues,
          'warning',
          'team_roles_empty',
          'TEAM-ROLES.yaml parsed but no role names were detected',
          files.rolesYaml,
        )
      }
    }
  }

  if (roleNamesFromConfig.length > 0) {
    const missingCritical = assignmentRoleNames.filter(
      (name) => !roleNamesFromConfig.includes(name.toLowerCase()),
    )
    if (missingCritical.length > 0) {
      pushIssue(
        issues,
        'error',
        'assignment_roles_missing',
        `Critical: TEAM-ROLES.yaml missing assignment-engine roles: ${missingCritical.join(', ')}`,
        files.rolesYaml,
      )
    }
  }

  const result: TeamConfigValidationResult = {
    ok: issues.every((i) => i.level !== 'error'),
    checkedAt: Date.now(),
    root: REFLECTT_HOME,
    files,
    issues,
    roleNamesFromConfig,
    assignmentRoleNames,
  }

  state.result = result
  return result
}

function logValidation(result: TeamConfigValidationResult, source: string) {
  for (const issue of result.issues) {
    const prefix = issue.level === 'error' ? '[TeamConfig][ERROR]' : '[TeamConfig][WARN]'
    const loc = issue.path ? ` (${basename(issue.path)})` : ''
    console.log(`${prefix}[${source}] ${issue.code}${loc}: ${issue.message}`)
  }
  if (result.issues.length === 0) {
    console.log(`[TeamConfig] OK (${source})`)
  }
}

export function startTeamConfigLinter(): TeamConfigValidationResult {
  const initial = validateTeamConfig()
  logValidation(initial, 'startup')

  if (state.watcher) return state.result

  try {
    state.watcher = watch(REFLECTT_HOME, (_eventType, filename) => {
      const file = String(filename || '')
      if (!file) return
      if (!['TEAM.md', 'TEAM-ROLES.yaml', 'TEAM-STANDARDS.md'].includes(file)) return

      if (state.debounce) clearTimeout(state.debounce)
      state.debounce = setTimeout(() => {
        const next = validateTeamConfig()
        logValidation(next, `watch:${file}`)
      }, 120)
    })
  } catch {
    const issue: TeamConfigIssue = {
      level: 'warning',
      code: 'watcher_unavailable',
      message: `File watch unavailable for ${REFLECTT_HOME}`,
      path: REFLECTT_HOME,
    }
    state.result = {
      ...state.result,
      checkedAt: Date.now(),
      issues: [...state.result.issues, issue],
      ok: [...state.result.issues, issue].every((i) => i.level !== 'error'),
    }
    logValidation(state.result, 'startup')
  }

  return state.result
}

export function stopTeamConfigLinter() {
  if (state.debounce) {
    clearTimeout(state.debounce)
    state.debounce = null
  }
  if (state.watcher) {
    state.watcher.close()
    state.watcher = null
  }
}

export function getTeamConfigHealth(): TeamConfigValidationResult {
  return state.result
}
