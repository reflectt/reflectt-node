#!/usr/bin/env node
// Internal Names Guard
// Fails CI if internal team proper nouns leak into shipped product surfaces.
// Config: tools/internal-names-guard.config.json

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const CONFIG_PATH = path.resolve('tools/internal-names-guard.config.json')

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  return JSON.parse(raw)
}

function gitLsFiles() {
  const out = execSync('git ls-files', { encoding: 'utf8' })
  return out
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

function isBinary(buf) {
  // crude but effective: null byte
  return buf.includes(0)
}

function compileRegex(pattern, flags) {
  try {
    return new RegExp(pattern, flags)
  } catch (e) {
    throw new Error(`Invalid regex pattern: ${pattern} /${flags}: ${String(e)}`)
  }
}

function allowedByConfig(filePath, matchText, cfg) {
  const allow = Array.isArray(cfg.allow) ? cfg.allow : []
  for (const rule of allow) {
    const pathRe = compileRegex(rule.pathPattern, rule.pathFlags || '')
    const patRe = compileRegex(rule.pattern, rule.flags || 'g')
    if (pathRe.test(filePath) && patRe.test(matchText)) return true
  }
  return false
}

function main() {
  const cfg = loadConfig()

  const includePrefixes = cfg.includePrefixes || []
  const excludePrefixes = cfg.excludePrefixes || []

  const banned = (cfg.banned || []).map(b => ({
    ...b,
    re: compileRegex(b.pattern, b.flags || 'g'),
  }))

  // Diff-based mode: only check newly-added lines vs mainline.
  // This prevents freezing shipping due to legacy strings while still blocking new leakage.
  const baseRef = process.env.INTERNAL_NAMES_GUARD_BASE || 'origin/main'
  let mergeBase = null
  try {
    mergeBase = execSync(`git merge-base HEAD ${baseRef}`, { encoding: 'utf8' }).trim()
  } catch {
    // Fall back to full scan if merge-base fails (rare)
  }

  const hits = []

  if (mergeBase) {
    const diff = execSync(`git diff --unified=0 ${mergeBase}..HEAD`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
    // Track current file from diff headers
    let currentFile = null
    let currentNewLine = null

    const allowedFile = fp => {
      if (includePrefixes.length && !includePrefixes.some(p => fp.startsWith(p))) return false
      if (excludePrefixes.some(p => fp.startsWith(p))) return false
      return true
    }

    for (const rawLine of diff.split(/\r?\n/)) {
      const line = rawLine
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice('+++ b/'.length).trim()
        currentNewLine = null
        continue
      }
      if (!currentFile || !allowedFile(currentFile)) continue

      // Parse hunk header for new-line numbers: @@ -a,b +c,d @@
      if (line.startsWith('@@')) {
        const m = line.match(/\+([0-9]+)(?:,([0-9]+))?/)
        currentNewLine = m ? Number(m[1]) : null
        continue
      }

      // Ignore removals and file headers
      if (line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file')) continue

      if (line.startsWith('+') && !line.startsWith('+++')) {
        const added = line.slice(1)
        for (const b of banned) {
          b.re.lastIndex = 0
          if (!b.re.test(added)) continue
          if (allowedByConfig(currentFile, added, cfg)) continue
          hits.push({
            file: currentFile,
            line: currentNewLine,
            pattern: b.pattern,
            reason: b.reason || 'banned',
            preview: added.trim().slice(0, 200),
          })
        }
        if (currentNewLine != null) currentNewLine += 1
      } else if (line.startsWith(' ')) {
        // context line advances new line counter
        if (currentNewLine != null) currentNewLine += 1
      }
    }
  } else {
    // Full scan fallback
    const files = gitLsFiles().filter(fp => {
      if (includePrefixes.length && !includePrefixes.some(p => fp.startsWith(p))) return false
      if (excludePrefixes.some(p => fp.startsWith(p))) return false
      return true
    })

    for (const fp of files) {
      let buf
      try {
        buf = fs.readFileSync(fp)
      } catch {
        continue
      }
      if (isBinary(buf)) continue

      const text = buf.toString('utf8')
      const lines = text.split(/\r?\n/)

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const b of banned) {
          b.re.lastIndex = 0
          if (!b.re.test(line)) continue
          if (allowedByConfig(fp, line, cfg)) continue
          hits.push({ file: fp, line: i + 1, pattern: b.pattern, reason: b.reason || 'banned', preview: line.trim().slice(0, 200) })
        }
      }
    }
  }

  if (hits.length === 0) {
    console.log('[internal-names-guard] OK')
    return
  }

  console.error('[internal-names-guard] FAIL — internal names/domains detected in shipped surfaces')
  for (const h of hits.slice(0, 200)) {
    console.error(`- ${h.file}:${h.line}  (${h.reason})  /${h.pattern}/  :: ${h.preview}`)
  }
  if (hits.length > 200) {
    console.error(`...and ${hits.length - 200} more`) 
  }
  console.error('\nIf a match is intentional, add a narrow allow rule in tools/internal-names-guard.config.json (pathPattern + pattern).')
  process.exit(1)
}

main()
