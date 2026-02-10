/**
 * list_packages - List available reflectt.ai packages
 */

import type { ToolContext } from '../../../lib/tools/helpers/tool-context'
import { listAvailablePackages, loadPackage, getSpacePackages } from '../../../lib/packages'

interface ListPackagesInput {
  filter?: string
  space_id?: string
}

interface PackageInfo {
  name: string
  description: string
  category?: string
  agents_count: number
  workflows_count: number
  schemas_count: number
  rules_count: number
  industries?: string[]
  installed?: boolean
}

export async function list_packages(
  inputs: ListPackagesInput,
  _ctx: ToolContext
): Promise<{ packages: PackageInfo[]; total: number; installed_in_space?: string[] }> {
  const { filter, space_id } = inputs

  console.log(`[list_packages] Discovering available packages...`)

  // Get all available packages
  const packageNames = await listAvailablePackages()
  console.log(`[list_packages] Found ${packageNames.length} packages`)

  // Get installed packages for space if requested
  let installedPackages: string[] = []
  if (space_id) {
    installedPackages = await getSpacePackages(space_id)
    console.log(`[list_packages] Space ${space_id} has ${installedPackages.length} packages installed`)
  }

  // Load package details
  const packages: PackageInfo[] = []
  for (const pkgName of packageNames) {
    try {
      const pkg = await loadPackage(pkgName)
      
      // Apply filter if provided
      if (filter) {
        const searchText = `${pkg.name} ${pkg.description} ${pkg.metadata?.category || ''}`.toLowerCase()
        if (!searchText.includes(filter.toLowerCase())) {
          continue
        }
      }

      packages.push({
        name: pkg.name,
        description: pkg.description,
        category: pkg.metadata?.category,
        agents_count: pkg.exports.agents.length,
        workflows_count: pkg.exports.workflows.length,
        schemas_count: pkg.exports.schemas.length,
        rules_count: pkg.exports.rules.length,
        industries: pkg.metadata?.industries,
        installed: installedPackages.includes(pkg.name)
      })
    } catch (error: any) {
      console.log(`[list_packages] Failed to load ${pkgName}: ${error.message}`)
    }
  }

  // Sort by name
  packages.sort((a, b) => a.name.localeCompare(b.name))

  console.log(`[list_packages] Returning ${packages.length} packages`)

  return {
    packages,
    total: packages.length,
    ...(space_id && { installed_in_space: installedPackages })
  }
}

export default list_packages
