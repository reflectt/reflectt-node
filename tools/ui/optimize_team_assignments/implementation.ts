/**
 * Optimize Team Assignments Tool Implementation
 *
 * Globally optimizes task assignments across a team
 */

import { TaskRoutingEngine, type TeamMemberProfile } from '@/lib/intelligence/task-routing'

interface Task {
  id: string
  title: string
  description?: string
  tags?: string[]
  priority?: string
  estimatedHours?: number
}

interface OptimizeTeamAssignmentsParams {
  boardId?: string
  tasks?: Task[]
  strategy?: 'load_balance' | 'minimize_time' | 'maximize_quality'
  constraints?: {
    respectCurrentAssignments?: boolean
    maxReassignments?: number
  }
}

interface OptimizeTeamAssignmentsResult {
  success: boolean
  assignments: Array<{
    taskId: string
    taskTitle: string
    assignee: string
    assigneeName: string
    score: number
    confidence: number
    estimatedCompletion: string
  }>
  loadDistribution: Array<{
    memberId: string
    memberName: string
    tasksAssigned: number
    loadPercentage: number
    estimatedHours: number
  }>
  metrics: {
    totalTasks: number
    averageLoad: number
    loadVariance: number
    estimatedTotalTime: number
    averageQualityScore: number
  }
  recommendations: string[]
  metadata: {
    strategy: string
    processingTime: number
    reassignmentsNeeded: number
  }
  error?: string
}

/**
 * Sample team data (same as in suggest_task_assignment)
 */
const getSampleTeam = (): TeamMemberProfile[] => [
  {
    id: 'user-1',
    name: 'Sarah Johnson',
    skills: [
      { name: 'React', level: 95, confidence: 0.95, lastUsed: new Date() },
      { name: 'TypeScript', level: 90, confidence: 0.90, lastUsed: new Date() },
      { name: 'UI/UX', level: 85, confidence: 0.85, lastUsed: new Date() },
      { name: 'JavaScript', level: 88, confidence: 0.90, lastUsed: new Date() }
    ],
    currentLoad: 40,
    maxCapacity: 5,
    availableHours: 40,
    timezone: 'America/New_York',
    workingHours: { start: '9:00', end: '17:00' },
    completionRate: 0.92,
    averageVelocity: 4.5,
    qualityScore: 88,
    onTimeRate: 0.90,
    preferredTaskTypes: ['feature', 'bug'],
    preferredComplexity: 'medium',
    collaborators: [
      { id: 'user-2', affinityScore: 0.85 },
      { id: 'user-3', affinityScore: 0.75 }
    ],
    completedTasks: [
      { taskId: 't1', complexity: 60, duration: 16, quality: 90, completedOnTime: true },
      { taskId: 't2', complexity: 45, duration: 12, quality: 85, completedOnTime: true }
    ]
  },
  {
    id: 'user-2',
    name: 'Mike Chen',
    skills: [
      { name: 'Node.js', level: 92, confidence: 0.92, lastUsed: new Date() },
      { name: 'API Development', level: 88, confidence: 0.88, lastUsed: new Date() },
      { name: 'Database', level: 85, confidence: 0.85, lastUsed: new Date() },
      { name: 'Security', level: 82, confidence: 0.85, lastUsed: new Date() },
      { name: 'Python', level: 80, confidence: 0.80, lastUsed: new Date() }
    ],
    currentLoad: 65,
    maxCapacity: 5,
    availableHours: 40,
    timezone: 'America/Los_Angeles',
    workingHours: { start: '9:00', end: '17:00' },
    completionRate: 0.88,
    averageVelocity: 3.8,
    qualityScore: 92,
    onTimeRate: 0.85,
    preferredTaskTypes: ['feature', 'maintenance'],
    preferredComplexity: 'high',
    collaborators: [
      { id: 'user-1', affinityScore: 0.85 },
      { id: 'user-3', affinityScore: 0.80 }
    ],
    completedTasks: [
      { taskId: 't3', complexity: 75, duration: 24, quality: 95, completedOnTime: true },
      { taskId: 't4', complexity: 80, duration: 28, quality: 90, completedOnTime: false }
    ]
  },
  {
    id: 'user-3',
    name: 'Emma Davis',
    skills: [
      { name: 'Testing', level: 90, confidence: 0.90, lastUsed: new Date() },
      { name: 'Python', level: 85, confidence: 0.85, lastUsed: new Date() },
      { name: 'DevOps', level: 80, confidence: 0.80, lastUsed: new Date() },
      { name: 'JavaScript', level: 75, confidence: 0.75, lastUsed: new Date() }
    ],
    currentLoad: 30,
    maxCapacity: 5,
    availableHours: 40,
    timezone: 'Europe/London',
    workingHours: { start: '9:00', end: '17:00' },
    completionRate: 0.95,
    averageVelocity: 5.2,
    qualityScore: 91,
    onTimeRate: 0.93,
    preferredTaskTypes: ['testing', 'maintenance'],
    preferredComplexity: 'low',
    collaborators: [
      { id: 'user-1', affinityScore: 0.75 },
      { id: 'user-2', affinityScore: 0.80 }
    ],
    completedTasks: [
      { taskId: 't5', complexity: 40, duration: 8, quality: 88, completedOnTime: true },
      { taskId: 't6', complexity: 35, duration: 6, quality: 92, completedOnTime: true }
    ]
  }
]

/**
 * Sample tasks if none provided
 */
const getSampleTasks = (): Task[] => [
  {
    id: 'task-1',
    title: 'Build React dashboard',
    description: 'Create analytics dashboard with charts',
    tags: ['react', 'ui', 'typescript'],
    priority: 'high',
    estimatedHours: 20
  },
  {
    id: 'task-2',
    title: 'API authentication endpoint',
    description: 'Implement JWT-based auth',
    tags: ['api', 'security', 'nodejs'],
    priority: 'critical',
    estimatedHours: 16
  },
  {
    id: 'task-3',
    title: 'Write integration tests',
    description: 'Test coverage for new features',
    tags: ['testing', 'python'],
    priority: 'medium',
    estimatedHours: 12
  },
  {
    id: 'task-4',
    title: 'Database migration',
    description: 'Migrate to new schema',
    tags: ['database', 'devops'],
    priority: 'high',
    estimatedHours: 10
  },
  {
    id: 'task-5',
    title: 'UI component library',
    description: 'Build reusable components',
    tags: ['react', 'ui', 'typescript'],
    priority: 'medium',
    estimatedHours: 24
  }
]

export async function optimize_team_assignments(
  params: OptimizeTeamAssignmentsParams
): Promise<OptimizeTeamAssignmentsResult> {
  const startTime = Date.now()

  try {
    // Get team and tasks
    const team = getSampleTeam()
    const tasks = params.tasks || getSampleTasks()
    const strategy = params.strategy || 'load_balance'

    if (tasks.length === 0) {
      return {
        success: false,
        assignments: [],
        loadDistribution: [],
        metrics: {
          totalTasks: 0,
          averageLoad: 0,
          loadVariance: 0,
          estimatedTotalTime: 0,
          averageQualityScore: 0
        },
        recommendations: [],
        metadata: {
          strategy,
          processingTime: Date.now() - startTime,
          reassignmentsNeeded: 0
        },
        error: 'No tasks provided for optimization'
      }
    }

    // Initialize routing engine
    const engine = new TaskRoutingEngine(team)

    // Analyze all tasks
    const taskAnalyses = tasks.map(task => ({
      id: task.id,
      analysis: engine.analyzeTask({
        title: task.title,
        description: task.description,
        tags: task.tags,
        priority: task.priority,
        estimatedHours: task.estimatedHours
      })
    }))

    // Optimize assignments
    const optimizedAssignments = engine.optimizeAssignments(taskAnalyses, strategy)

    // Map team member names
    const teamMap = new Map(team.map(m => [m.id, m]))

    // Track load per member
    const memberLoads = new Map<string, { tasksCount: number, totalHours: number }>()
    team.forEach(member => {
      memberLoads.set(member.id, { tasksCount: 0, totalHours: 0 })
    })

    // Format assignments
    const formattedAssignments = Array.from(optimizedAssignments.entries()).map(([taskId, suggestion]) => {
      const task = tasks.find(t => t.id === taskId)!
      const member = teamMap.get(suggestion.assignee)!
      const analysis = taskAnalyses.find(ta => ta.id === taskId)!.analysis

      // Update member load
      const load = memberLoads.get(suggestion.assignee)!
      load.tasksCount++
      load.totalHours += analysis.estimatedHours

      return {
        taskId,
        taskTitle: task.title,
        assignee: suggestion.assignee,
        assigneeName: member.name,
        score: suggestion.score,
        confidence: Math.round(suggestion.confidence * 100) / 100,
        estimatedCompletion: suggestion.estimatedCompletionTime.toISOString()
      }
    })

    // Calculate load distribution
    const loadDistribution = Array.from(memberLoads.entries()).map(([memberId, load]) => {
      const member = teamMap.get(memberId)!
      const loadPercentage = (load.totalHours / member.availableHours) * 100 + member.currentLoad

      return {
        memberId,
        memberName: member.name,
        tasksAssigned: load.tasksCount,
        loadPercentage: Math.round(loadPercentage),
        estimatedHours: Math.round(load.totalHours)
      }
    })

    // Calculate metrics
    const loads = loadDistribution.map(ld => ld.loadPercentage)
    const averageLoad = loads.reduce((sum, l) => sum + l, 0) / loads.length
    const loadVariance = loads.reduce((sum, l) => sum + Math.pow(l - averageLoad, 2), 0) / loads.length

    const totalHours = loadDistribution.reduce((sum, ld) => sum + ld.estimatedHours, 0)
    const maxVelocity = Math.max(...team.map(m => m.averageVelocity))
    const estimatedTotalTime = totalHours / maxVelocity

    const averageQualityScore = formattedAssignments.reduce((sum, a) => {
      const member = teamMap.get(a.assignee)!
      return sum + member.qualityScore
    }, 0) / formattedAssignments.length

    // Generate recommendations
    const recommendations: string[] = []

    if (loadVariance > 400) {
      recommendations.push('High load variance detected - consider rebalancing workload')
    }

    const overloadedMembers = loadDistribution.filter(ld => ld.loadPercentage > 90)
    if (overloadedMembers.length > 0) {
      recommendations.push(
        `${overloadedMembers.length} team member(s) at >90% capacity: ${overloadedMembers.map(m => m.memberName).join(', ')}`
      )
    }

    const underutilizedMembers = loadDistribution.filter(ld => ld.loadPercentage < 50 && ld.tasksAssigned > 0)
    if (underutilizedMembers.length > 0) {
      recommendations.push(
        `${underutilizedMembers.length} team member(s) underutilized (<50%): ${underutilizedMembers.map(m => m.memberName).join(', ')}`
      )
    }

    if (strategy === 'minimize_time') {
      recommendations.push('Time-optimized: Tasks assigned to fastest performers, may increase load imbalance')
    } else if (strategy === 'maximize_quality') {
      recommendations.push('Quality-optimized: Tasks assigned to best skill matches, delivery time may vary')
    } else {
      recommendations.push('Load-balanced: Even distribution across team, optimal for sustainable pace')
    }

    return {
      success: true,
      assignments: formattedAssignments,
      loadDistribution,
      metrics: {
        totalTasks: tasks.length,
        averageLoad: Math.round(averageLoad),
        loadVariance: Math.round(loadVariance),
        estimatedTotalTime: Math.round(estimatedTotalTime * 10) / 10,
        averageQualityScore: Math.round(averageQualityScore)
      },
      recommendations,
      metadata: {
        strategy,
        processingTime: Date.now() - startTime,
        reassignmentsNeeded: 0 // Would calculate based on existing assignments
      }
    }
  } catch (error) {
    return {
      success: false,
      assignments: [],
      loadDistribution: [],
      metrics: {
        totalTasks: 0,
        averageLoad: 0,
        loadVariance: 0,
        estimatedTotalTime: 0,
        averageQualityScore: 0
      },
      recommendations: [],
      metadata: {
        strategy: params.strategy || 'load_balance',
        processingTime: Date.now() - startTime,
        reassignmentsNeeded: 0
      },
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}
