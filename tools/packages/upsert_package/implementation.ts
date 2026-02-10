/**
 * upsert_package - Create or update a Reflectt package
 *
 * Creates complete package structure with agents, workflows, schemas, and rules.
 * Packages are reusable across all spaces (like npm for domains).
 */

import type { ToolContext } from '../../../lib/tools/helpers/tool-context'
import { PackageDefinition } from '../../../lib/packages'

interface UpsertPackageInput {
  package_name: string
  description: string
  category?: string
  dependencies?: string[]
  agents?: any[]
  workflows?: any[]
  schemas?: any[]
  rules?: any[]
  industries?: string[]
  metadata?: Record<string, any>
}

export async function upsert_package(
  inputs: UpsertPackageInput,
  ctx: ToolContext
): Promise<{ success: boolean; package_path: string; message: string; exports: any }> {
  const {
    package_name,
    description,
    category = 'other',
    dependencies = [],
    agents = [],
    workflows = [],
    schemas = [],
    rules = [],
    industries = [],
    metadata = {}
  } = inputs

  // Validate package name format
  if (!package_name.startsWith('@reflectt/') && !package_name.startsWith('@workrocket/')) {
    throw new Error('Package name must start with @reflectt/ (e.g., @reflectt/retail)')
  }

  const pkgDir = package_name.replace('@reflectt/', '').replace('@workrocket/', '')
  const packagePath = ctx.resolvePath('global', '..', 'packages', pkgDir)

  console.log(`[upsert_package] Creating package: ${package_name}`)
  console.log(`[upsert_package] Location: ${packagePath}`)

  // Create package directory structure
  await ctx.ensureDir('global', '..', 'packages', pkgDir)
  await ctx.ensureDir('global', '..', 'packages', pkgDir, 'agents')
  await ctx.ensureDir('global', '..', 'packages', pkgDir, 'workflows')
  await ctx.ensureDir('global', '..', 'packages', pkgDir, 'schemas')
  await ctx.ensureDir('global', '..', 'packages', pkgDir, 'rules')

  // Extract agent/workflow IDs for exports
  const agentIds = agents.map(a => a.id || a.slug?.split(':')[1] || a.name?.toLowerCase().replace(/\s+/g, '_'))
  const workflowIds = workflows.map(w => w.id)
  const schemaIds = schemas.map(s => s.table_name || s.name)
  const ruleIds = rules.map(r => r.rule_id || r.id)

  // Create package definition
  const packageDef: PackageDefinition = {
    name: package_name,
    type: 'reflectt-package',
    description,
    dependencies,
    exports: {
      agents: agentIds,
      tasks: [], // Tasks are part of agents
      workflows: workflowIds,
      schemas: schemaIds,
      rules: ruleIds
    },
    metadata: {
      category,
      industries,
      maturity: 'alpha',
      ...metadata
    },
    created_at: new Date().toISOString()
  }

  // Write package definition
  await ctx.writeJson('global', '..', 'packages', pkgDir, 'definition.json', packageDef)

  // Create README
  const readme = generatePackageReadme(package_name, description, packageDef.exports, industries)
  await ctx.writeText('global', '..', 'packages', pkgDir, 'README.md', readme)

  // Write agents
  for (const agent of agents) {
    const agentId = agent.id || agent.slug?.split(':')[1] || agent.name?.toLowerCase().replace(/\s+/g, '_')
    await ctx.ensureDir('global', '..', 'packages', pkgDir, 'agents', agentId)
    await ctx.writeJson('global', '..', 'packages', pkgDir, 'agents', agentId, 'definition.json', agent)
    
    if (agent.prompt) {
      await ctx.writeText('global', '..', 'packages', pkgDir, 'agents', agentId, 'prompt.md', agent.prompt)
    }
  }

  // Write workflows
  for (const workflow of workflows) {
    const workflowId = workflow.id
    await ctx.ensureDir('global', '..', 'packages', pkgDir, 'workflows', workflowId)
    await ctx.writeJson('global', '..', 'packages', pkgDir, 'workflows', workflowId, 'definition.json', {
      ...workflow,
      package: package_name
    })
  }

  // Write schemas
  for (const schema of schemas) {
    const schemaName = schema.table_name || schema.name
    await ctx.writeJson('global', '..', 'packages', pkgDir, 'schemas', `${schemaName}.json`, schema)
  }

  // Write rules
  for (const rule of rules) {
    const ruleId = rule.rule_id || rule.id
    await ctx.writeJson('global', '..', 'packages', pkgDir, 'rules', `${ruleId}.json`, {
      ...rule,
      metadata: {
        ...rule.metadata,
        package: package_name
      }
    })
  }

  // Create package contents summary
  const contentsSummary = `# ${package_name} Contents

## Agents (${agentIds.length})
${agentIds.map(id => `- ${id}`).join('\n')}

## Workflows (${workflowIds.length})
${workflowIds.map(id => `- ${id}`).join('\n')}

## Schemas (${schemaIds.length})
${schemaIds.map(id => `- ${id}`).join('\n')}

## Rules (${ruleIds.length})
${ruleIds.map(id => `- ${id}`).join('\n')}
`
  await ctx.writeText('global', '..', 'packages', pkgDir, 'PACKAGE_CONTENTS.md', contentsSummary)

  console.log(`[upsert_package] ✅ Package created successfully!`)
  console.log(`[upsert_package] Agents: ${agentIds.length}, Workflows: ${workflowIds.length}, Schemas: ${schemaIds.length}, Rules: ${ruleIds.length}`)

  return {
    success: true,
    package_path: packagePath,
    message: `Package ${package_name} created successfully with ${agentIds.length} agents, ${workflowIds.length} workflows, ${schemaIds.length} schemas, ${ruleIds.length} rules`,
    exports: packageDef.exports
  }
}

function generatePackageReadme(
  packageName: string,
  description: string,
  exports: PackageDefinition['exports'],
  industries: string[]
): string {
  return `# ${packageName}

${description}

## Installation

Add to your space's \`space.json\`:

\`\`\`json
{
  "packages": ["${packageName}"]
}
\`\`\`

## What's Included

### Agents (${exports.agents.length})
${exports.agents.map(a => `- **${a}**`).join('\n')}

### Workflows (${exports.workflows.length})
${exports.workflows.map(w => `- **${w}**`).join('\n')}

### Schemas (${exports.schemas.length})
${exports.schemas.map(s => `- **${s}**`).join('\n')}

### Rules (${exports.rules.length})
${exports.rules.map(r => `- **${r}**`).join('\n')}

## Industries

${industries.length > 0 ? industries.join(', ') : 'General purpose'}

## Usage

Once installed, agents and workflows from this package are automatically available in your space.

## Support

Part of the Reflectt package ecosystem.
`
}

export default upsert_package
