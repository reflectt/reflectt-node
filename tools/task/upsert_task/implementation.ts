import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
  addTimestamps,
  updateTimestamp,
  type ToolOutput,
} from '@/lib/tools/helpers';

interface UpsertTaskInput {
  id: string;
  agent: string;
  title: string;
  description: string;
  status?: string;
  priority?: string;
  context?: any;
  target_space?: string;
}

interface UpsertTaskOutput {
  success: boolean;
  path?: string;
  message?: string;
  error?: string;
}

async function upsertTaskImpl(
  input: UpsertTaskInput,
  ctx: ToolContext
): Promise<UpsertTaskOutput> {
  const {
    id,
    agent,
    title,
    description,
    status = 'active',
    priority = 'medium',
    context,
    target_space
  } = input;

  const validation = validateAll([
    () => validateRequired(id, 'id'),
    () => validateRequired(agent, 'agent'),
    () => validateRequired(title, 'title'),
    () => validateRequired(description, 'description'),
  ]);
  if (!validation.valid) {
    throw new Error(validation.errors[0].message);
  }

  // Find the agent's category using ToolContext
  let agentCategory: string | null = null;

  try {
    const categories = await ctx.listDirs(target_space, 'agents');
    for (const cat of categories) {
      try {
        const agentDef = await ctx.readJson(target_space, 'agents', cat, agent, 'definition.json');
        if (agentDef) {
          agentCategory = cat;
          break;
        }
      } catch {
        // Agent not in this category, continue searching
        continue;
      }
    }
  } catch (error) {
    const targetDesc = target_space === 'global'
      ? 'global'
      : target_space
      ? `space '${target_space}'`
      : 'current space';
    throw new Error(`Agent '${agent}' not found in ${targetDesc}/agents`);
  }

  if (!agentCategory) {
    const targetDesc = target_space === 'global'
      ? 'global'
      : target_space
      ? `space '${target_space}'`
      : 'current space';
    throw new Error(`Agent '${agent}' not found in ${targetDesc}/agents`);
  }

  // Check if task already exists (for timestamp handling)
  let existingTask = null;
  try {
    existingTask = await ctx.readJson(
      target_space,
      'agents',
      agentCategory,
      agent,
      'tasks',
      id,
      'definition.json'
    );
  } catch {
    // Task doesn't exist yet, which is fine
  }

  // Build task object with timestamps
  const taskData = existingTask
    ? updateTimestamp({
        ...existingTask,
        id,
        title,
        description,
        agent,
        status,
        priority,
        context: context || {},
      })
    : addTimestamps({
        id,
        title,
        description,
        agent,
        status,
        priority,
        context: context || {},
      });

  // Ensure directory exists
  await ctx.ensureDir(target_space, 'agents', agentCategory, agent, 'tasks', id);

  // Write definition.json
  await ctx.writeJson(
    target_space,
    'agents',
    agentCategory,
    agent,
    'tasks',
    id,
    'definition.json',
    taskData
  );

  // Generate README.md
  const readmeContent = `# ${title}

**Agent:** ${agent}
**Status:** ${status}
**Priority:** ${priority}

## Description

${description}

## Details

- **Task ID:** ${id}
- **Created:** ${taskData.created_at}
- **Updated:** ${taskData.updated_at}

${context && Object.keys(context).length > 0 ? `## Context

\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`
` : ''}

---

*This task is part of the ${agentCategory} category.*
`;

  await ctx.writeText(
    target_space,
    'agents',
    agentCategory,
    agent,
    'tasks',
    id,
    'README.md',
    readmeContent
  );

  // Trigger task management event (non-blocking)
  try {
    await ctx.executeTool('trigger_event', {
      event_type: existingTask ? 'system.task_updated' : 'system.task_created',
      space_id: target_space,
      data: {
        task_id: id,
        task_title: title,
        agent_name: agent,
        agent_category: agentCategory,
        operation: existingTask ? 'updated' : 'created',
        status,
        priority,
        timestamp: new Date().toISOString()
      },
      metadata: {
        source_tool: 'upsert_task',
        operation: existingTask ? 'task_updated' : 'task_created'
      }
    });
  } catch (eventError) {
    console.warn(`Failed to trigger event: ${eventError}`);
  }

  return {
    success: true,
    path: `agents/${agentCategory}/${agent}/tasks/${id}/definition.json`,
    message: `Task ${id} for agent ${agent} ${existingTask ? 'updated' : 'created'} successfully`
  };
}

export default async function upsertTask(
  input: UpsertTaskInput,
  ctx: ToolContext
): Promise<UpsertTaskOutput> {
  try {
    const result = await upsertTaskImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
