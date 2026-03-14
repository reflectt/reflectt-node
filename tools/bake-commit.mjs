#!/usr/bin/env node
// tools/bake-commit.mjs — Bakes current git SHA into commit.txt at build time.
//
// server.ts reads: new URL('../commit.txt', import.meta.url)
// i.e. from the same directory as dist/index.js → needs commit.txt at the package root.
//
// Without this, prod (launchctl CWD ≠ repo) gets 'unknown' from git rev-parse.
// With this, the correct SHA is always baked into the build artifact.

import { execSync } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let sha = 'unknown'
try {
  sha = execSync('git rev-parse --short HEAD', {
    encoding: 'utf8', timeout: 3000, cwd: root,
  }).trim()
} catch { /* no git context — CI or non-repo environment */ }

// Write to package root — server.ts resolves '../commit.txt' relative to dist/index.js
writeFileSync(join(root, 'commit.txt'), sha + '\n', 'utf8')
console.log(`[bake-commit] SHA: ${sha} → commit.txt`)
