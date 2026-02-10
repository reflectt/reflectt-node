import {
  formatError,
  validateRequired,
  now,
  type ToolOutput,
} from '@/lib/tools/helpers';
import { type ToolContext } from '@/lib/tools/helpers/tool-context';

interface CreateTaskRunInput {
  task_id: string;
  agent_name: string;
  task_title: string;
  description: string;
  prompt?: string;
  context?: any;
  steps?: Array<{
    step_number: number;
    description: string;
  }>;
}

interface CreateTaskRunOutput extends ToolOutput<Record<string, unknown>> {
  success: boolean;
  run_id?: string;
  run_path?: string;
}

interface TaskRun {
  run_id: string;
  task_id: string;
  task_title: string;
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  description: string;
  prompt?: string;
  context?: any;
  steps?: Array<{
    step_number: number;
    description: string;
    completed: boolean;
    completed_at?: string;
  }>;
  result?: string;
  error?: string;
  tools_used?: Array<{
    tool: string;
    input: any;
    result: any;
    timestamp: string;
  }>;
  agent_model?: string;
  total_tokens?: number;
  total_cost?: number;
}

async function createTaskRunImpl(
  input: CreateTaskRunInput,
  ctx: ToolContext
): Promise<CreateTaskRunOutput> {
  validateRequired(input.task_id, 'task_id');
  validateRequired(input.agent_name, 'agent_name');
  validateRequired(input.task_title, 'task_title');

  const timestamp = now().replace(/[:.]/g, '-').replace('Z', '');
  const runId = `${input.task_id}_${timestamp}`;

  // Find agent's domain by searching the nested structure in current space AND global
  // Parse agent name - could be "agent_name" or "domain:agent_name"
  const agentParts = input.agent_name.split(':')
  const agentName = agentParts.length > 1 ? agentParts[1] : agentParts[0]
  const expectedDomain = agentParts.length > 1 ? agentParts[0] : null
  
  // Search in both current space and global
  const spacesToCheck = [undefined, 'global']
  let agentDomain: string | null = null
  let agentSpace: string | undefined = undefined
  
  for (const spaceTarget of spacesToCheck) {
    if (agentDomain) break // Already found
    
    const categories = await ctx.listDirs(spaceTarget, 'agents')
    
    for (const category of categories) {
      // If domain specified, only check that domain
      if (expectedDomain && category !== expectedDomain) {
        continue
      }
      
      if (ctx.fileExists(spaceTarget, 'agents', category, agentName)) {
        agentDomain = category
        agentSpace = spaceTarget
        break
      }
    }
  }

  if (!agentDomain) {
    throw new Error(`Agent "${input.agent_name}" not found in any domain`)
  }

  // Ensure runs directory exists
  await ctx.ensureDir(undefined, 'agents', agentDomain, agentName, 'tasks', input.task_id, 'runs')

  // Create task run
  const taskRun: TaskRun = {
    run_id: runId,
    task_id: input.task_id,
    task_title: input.task_title,
    agent: input.agent_name,
    status: 'pending',
    started_at: now(),
    description: input.description,
    prompt: input.prompt,
    context: input.context,
    steps: input.steps?.map(s => ({
      step_number: s.step_number,
      description: s.description,
      completed: false
    })),
    tools_used: []
  }

  // Write task run to file
  await ctx.writeJson(undefined, 'agents', agentDomain, agentName, 'tasks', input.task_id, 'runs', `${timestamp}.json`, taskRun)

  // Return absolute path for backward compatibility
  const runPath = ctx.resolvePath(undefined, 'agents', agentDomain, agentName, 'tasks', input.task_id, 'runs', `${timestamp}.json`)

  return {
    success: true,
    run_id: runId,
    run_path: runPath
  };
}

export default async function createTaskRun(
  input: CreateTaskRunInput,
  ctx: ToolContext
): Promise<CreateTaskRunOutput> {
  try {
    const result = await createTaskRunImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
