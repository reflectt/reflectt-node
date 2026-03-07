// Shared version — reads from package.json at runtime so it's never stale
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const PKG_VERSION = (() => {
  try {
    const pkgPath = join(__dirname, '..', 'package.json')
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version ?? '0.0.0'
  } catch { return '0.0.0' }
})()
