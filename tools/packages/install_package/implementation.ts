/**
 * install_package - Install a package into a space
 * 
 * Makes package agents/workflows available, creates schemas, registers in space.json
 */

import type { ToolContext } from '../../../lib/tools/helpers/tool-context'
import { loadPackage, resolvePackageDependencies, loadSpaceConfig } from '../../../lib/packages'
import { readFile } from 'fs/promises'
import { join } from 'path'

interface InstallPackageInput {
  package_name: string
  space_id?: string
  auto_install_schemas?: boolean
  enabled_agents?: string[]
  enabled_workflows?: string[]
  config?: Record<string, any>
}

export async function install_package(
  inputs: InstallPackageInput,
  ctx: ToolContext
): Promise<{ success: boolean; message: string; installed: string[]; schemas_created: string[] }> {
  const {
    package_name,
    space_id = ctx.currentSpace,
    auto_install_schemas = true,
    enabled_agents,
    enabled_workflows,
    config = {}
  } = inputs

  console.log(`[install_package] Installing ${package_name} into ${space_id}`)

  // 1. Load package definition
  let pkg
  try {
    pkg = await loadPackage(package_name)
  } catch (error: any) {
    throw new Error(`Package ${package_name} not found: ${error.message}`)
  }

  // 2. Resolve dependencies
  console.log(`[install_package] Resolving dependencies...`)
  const allPackages = await resolvePackageDependencies(package_name)
  const installedPackages = allPackages.map(p => p.name)
  console.log(`[install_package] Dependency chain: ${installedPackages.join(' → ')}`)

  // 3. Load or create space config
  let spaceConfig
  try {
    spaceConfig = await loadSpaceConfig(space_id)
  } catch {
    // Space config doesn't exist, create minimal one
    spaceConfig = {
      space_id,
      name: space_id,
      packages: [],
      package_config: {}
    }
  }

  // 4. Add package to space config if not already there
  if (!spaceConfig.packages.includes(package_name)) {
    spaceConfig.packages.push(package_name)
  }

  // 5. Configure package
  spaceConfig.package_config = spaceConfig.package_config || {}
  spaceConfig.package_config[package_name] = {
    enabled: true,
    auto_install_schemas,
    enabled_agents: enabled_agents || pkg.exports.agents,
    enabled_workflows: enabled_workflows || pkg.exports.workflows,
    config
  }

  // 6. Save space config
  // Use space_id as target (or 'global' if installing to global)
  const target = (space_id === 'global' ? 'global' : space_id) as any
  await ctx.writeJson(target, 'space.json', spaceConfig)
  console.log(`[install_package] ✅ Updated space.json`)

  // 7. Install schemas if requested
  const schemasCreated: string[] = []
  if (auto_install_schemas && pkg.exports.schemas && pkg.exports.schemas.length > 0) {
    console.log(`[install_package] Installing ${pkg.exports.schemas.length} schemas...`)
    
    for (const schemaName of pkg.exports.schemas) {
      try {
        // Read schema definition from package
        const pkgDir = package_name.replace('@reflectt/', '').replace('@workrocket/', '')
        const schemaPath = join(process.cwd(), 'data', 'packages', pkgDir, 'schemas', `${schemaName}.json`)
        const schemaContent = await readFile(schemaPath, 'utf-8')
        const schema = JSON.parse(schemaContent)
        
        // Create table using create_table tool (if available)
        try {
          await ctx.executeTool('create_table', {
            table_name: schema.table_name,
            columns: schema.columns,
            space_id: space_id
          })
          schemasCreated.push(schema.table_name)
          console.log(`[install_package]   ✅ Created table: ${schema.table_name}`)
        } catch (tableError: any) {
          console.log(`[install_package]   ⚠️  Table ${schema.table_name} might already exist: ${tableError.message}`)
          // Continue anyway - table might already exist
        }
      } catch (error: any) {
        console.log(`[install_package]   ⚠️  Failed to install schema ${schemaName}: ${error.message}`)
      }
    }
  }

  console.log(`[install_package] ✅ Package ${package_name} installed successfully!`)
  console.log(`[install_package] Available agents: ${pkg.exports.agents.join(', ')}`)
  console.log(`[install_package] Available workflows: ${pkg.exports.workflows.join(', ')}`)

  return {
    success: true,
    message: `Package ${package_name} installed successfully. ${pkg.exports.agents.length} agents and ${pkg.exports.workflows.length} workflows are now available.`,
    installed: installedPackages,
    schemas_created: schemasCreated
  }
}

export default install_package
