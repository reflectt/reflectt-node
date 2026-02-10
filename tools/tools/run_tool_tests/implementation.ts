import { readFile } from 'fs/promises'
import { execSync } from 'child_process'
import { unlink } from 'fs/promises'
import {
  formatError,
  validateRequired,
  validateAll,
  type ToolOutput,
  type ToolContext,
} from '@/lib/tools/helpers'

interface RunToolTestsInput {
  tool_name: string
  category: string
  target_space?: string
  verbose?: boolean
}

interface RunToolTestsData {
  passed?: boolean
  results?: string
  coverage?: {
    lines?: number
    statements?: number
    functions?: number
    branches?: number
  }
  test_count?: number
  duration?: string
}

interface RunToolTestsOutput extends ToolOutput<RunToolTestsData> {
  success: boolean
  passed?: boolean
  results?: string
  coverage?: {
    lines?: number
    statements?: number
    functions?: number
    branches?: number
  }
  test_count?: number
  duration?: string
}

async function runToolTestsImpl(
  input: RunToolTestsInput,
  ctx: ToolContext
): Promise<RunToolTestsOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
    () => validateRequired(input.category, 'category'),
  ])

  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  const { tool_name, category, target_space, verbose = false } = input
  const space = target_space || 'global'

  // Check if test file exists
  const testPath = ctx.resolvePath(space, 'tools', category, tool_name, 'implementation.test.ts')

  try {
    await ctx.readText(space, 'tools', category, tool_name, 'implementation.test.ts')
  } catch {
    throw new Error(`Test file not found for tool '${tool_name}' in category '${category}'`)
  }

  try {
    // Run Jest on the specific test file
    const coverageFlag = verbose ? '--coverage' : '--no-coverage'
    const verboseFlag = verbose ? '--verbose' : ''
    const jsonOutputPath = `/tmp/jest-output-${tool_name}.json`

    const command = `npx jest "${testPath}" ${coverageFlag} ${verboseFlag} --json --outputFile=${jsonOutputPath}`

    const output = execSync(command, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    })

    // Read the JSON output
    let testResults: any = {}

    try {
      
      const jsonContent = await readFile(jsonOutputPath, 'utf-8')
      testResults = JSON.parse(jsonContent)
      // Clean up temp file
      await unlink(jsonOutputPath)
    } catch {
      // JSON file not created
    }

    // Parse results
    const passed = testResults.success === true
    const numTests = testResults.numTotalTests || 0
    const duration = testResults.testResults?.[0]?.perfStats?.runtime
      ? `${testResults.testResults[0].perfStats.runtime}ms`
      : undefined

    // Extract coverage if available
    let coverage: any = undefined
    if (verbose && testResults.coverageMap) {
      const coverageData = testResults.coverageMap
      coverage = {
        lines: coverageData.total?.lines?.pct,
        statements: coverageData.total?.statements?.pct,
        functions: coverageData.total?.functions?.pct,
        branches: coverageData.total?.branches?.pct,
      }
    }

    return {
      success: true,
      passed,
      results: output,
      coverage,
      test_count: numTests,
      duration,
    }
  } catch (error: any) {
    // Jest returns non-zero exit code on test failure
    const output = error.stdout || error.message

    return {
      success: true,
      passed: false,
      results: output,
      test_count: 0,
    }
  }
}

export default async function runToolTests(
  input: RunToolTestsInput,
  ctx: ToolContext
): Promise<RunToolTestsOutput> {
  try {
    return { success: true, ...(await runToolTestsImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
