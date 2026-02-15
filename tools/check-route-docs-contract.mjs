#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SERVER_PATH = path.join(ROOT, 'src', 'server.ts')
const DOCS_PATH = path.join(ROOT, 'public', 'docs.md')

const IGNORE_ROUTES = new Set([
  'GET /avatars/:filename',
  'GET /dashboard.js',
  'GET /dashboard-animations.css',
])

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function extractServerRoutes(serverSource) {
  const routeRegex = /app\.(get|post|patch|delete)(?:\s*<[\s\S]*?>)?\s*\(\s*['"`]([^'"`]+)['"`]/g
  const routes = new Set()
  let match
  while ((match = routeRegex.exec(serverSource)) !== null) {
    const method = match[1].toUpperCase()
    const route = match[2]
    const key = `${method} ${route}`
    if (!IGNORE_ROUTES.has(key)) routes.add(key)
  }
  return routes
}

function extractDocsRoutes(docsSource) {
  const tableRowRegex = /^\|\s*(GET|POST|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|/gm
  const routes = new Set()
  let match
  while ((match = tableRowRegex.exec(docsSource)) !== null) {
    const method = match[1].toUpperCase()
    const route = match[2]
    routes.add(`${method} ${route}`)
  }
  return routes
}

function sorted(arrOrSet) {
  return [...arrOrSet].sort((a, b) => a.localeCompare(b))
}

function diff(a, b) {
  const missing = []
  for (const item of a) {
    if (!b.has(item)) missing.push(item)
  }
  return missing
}

function main() {
  const serverSource = read(SERVER_PATH)
  const docsSource = read(DOCS_PATH)

  const serverRoutes = extractServerRoutes(serverSource)
  const docsRoutes = extractDocsRoutes(docsSource)

  const undocumented = sorted(diff(serverRoutes, docsRoutes))
  const staleDocs = sorted(diff(docsRoutes, serverRoutes))

  if (undocumented.length === 0 && staleDocs.length === 0) {
    console.log('✅ Route/docs contract check passed')
    console.log(`   Server routes: ${serverRoutes.size}`)
    console.log(`   Docs routes:   ${docsRoutes.size}`)
    process.exit(0)
  }

  console.error('❌ Route/docs contract check failed')

  if (undocumented.length > 0) {
    console.error('\nUndocumented routes (in src/server.ts but missing in public/docs.md):')
    for (const route of undocumented) console.error(`  - ${route}`)
  }

  if (staleDocs.length > 0) {
    console.error('\nStale docs routes (in public/docs.md but missing in src/server.ts):')
    for (const route of staleDocs) console.error(`  - ${route}`)
  }

  console.error('\nTip: update public/docs.md endpoint tables to match src/server.ts.')
  process.exit(1)
}

main()
