/**
 * Suggest Task Assignment Tool Implementation
 *
 * Provides intelligent task assignment suggestions using the routing engine
 */

import { TaskRoutingEngine, type TeamMemberProfile } from '@/lib/intelligence/task-routing'

interface SuggestTaskAssignmentParams {
  taskId?: string
  taskDetails?: {
    title: string
    description?: string
    tags?: string[]
    priority?: string
    estimatedHours?: number
  }
  teamMembers?: string[]
  maxSuggestions?: number
  includeReasoning?: boolean
}

interface SuggestTaskAssignmentResult {
  success: boolean
  suggestions: Array<{
    assignee: string
    assigneeName: string
    confidence: number
    score: number
    reasoning: string[]
    estimatedCompletionTime: string
    risks: string[]
    benefits: string[]
    alternatives: Array<{
      assignee: string
      assigneeName: string
      score: number
    }>
  }>
  taskAnalysis: {
    complexity: number
    estimatedHours: number
    requiredSkills: Array<{skill: string, importance: number}>
    urgency: number
    category: string
  }
  metadata: {
    processingTime: number
    teamSize: number
    averageLoad: number
  }
  error?: string
}

/**
 * Sample team data (in production, this would be loaded from database)
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

export async function suggest_task_assignment(
  params: SuggestTaskAssignmentParams
): Promise<SuggestTaskAssignmentResult> {
  const startTime = Date.now()

  try {
    // Validate input
    if (!params.taskDetails && !params.taskId) {
      return {
        success: false,
        suggestions: [],
        taskAnalysis: {
          complexity: 0,
          estimatedHours: 0,
          requiredSkills: [],
          urgency: 0,
          category: 'general'
        },
        metadata: {
          processingTime: 0,
          teamSize: 0,
          averageLoad: 0
        },
        error: 'Either taskDetails or taskId must be provided'
      }
    }

    // Get team data
    let team = getSampleTeam()

    // Filter team if specific members requested
    if (params.teamMembers && params.teamMembers.length > 0) {
      team = team.filter(member => params.teamMembers!.includes(member.id))
    }

    // Initialize routing engine
    const engine = new TaskRoutingEngine(team)

    // Task details
    const taskDetails = params.taskDetails || {
      title: 'Unknown Task',
      description: '',
      tags: [],
      priority: 'medium'
    }

    // Analyze task
    const taskAnalysis = engine.analyzeTask({
      title: taskDetails.title,
      description: taskDetails.description,
      tags: taskDetails.tags,
      priority: taskDetails.priority,
      estimatedHours: taskDetails.estimatedHours
    })

    // Get suggestions
    const suggestions = engine.getSuggestions(taskAnalysis, {
      maxSuggestions: params.maxSuggestions || 3,
      includeReasoning: params.includeReasoning !== false
    })

    // Map team member names
    const teamMap = new Map(team.map(m => [m.id, m.name]))

    // Format results
    const formattedSuggestions = suggestions.map(suggestion => ({
      assignee: suggestion.assignee,
      assigneeName: teamMap.get(suggestion.assignee) || suggestion.assignee,
      confidence: Math.round(suggestion.confidence * 100) / 100,
      score: suggestion.score,
      reasoning: suggestion.reasoning,
      estimatedCompletionTime: suggestion.estimatedCompletionTime.toISOString(),
      risks: suggestion.risks,
      benefits: suggestion.benefits,
      alternatives: suggestion.alternatives.map(alt => ({
        assignee: alt.assignee,
        assigneeName: teamMap.get(alt.assignee) || alt.assignee,
        score: alt.score
      }))
    }))

    // Calculate metadata
    const avgLoad = team.reduce((sum, m) => sum + m.currentLoad, 0) / team.length

    const processingTime = Date.now() - startTime

    return {
      success: true,
      suggestions: formattedSuggestions,
      taskAnalysis: {
        complexity: taskAnalysis.complexity,
        estimatedHours: taskAnalysis.estimatedHours,
        requiredSkills: taskAnalysis.requiredSkills,
        urgency: taskAnalysis.urgency,
        category: taskAnalysis.category
      },
      metadata: {
        processingTime,
        teamSize: team.length,
        averageLoad: Math.round(avgLoad)
      }
    }
  } catch (error) {
    return {
      success: false,
      suggestions: [],
      taskAnalysis: {
        complexity: 0,
        estimatedHours: 0,
        requiredSkills: [],
        urgency: 0,
        category: 'general'
      },
      metadata: {
        processingTime: Date.now() - startTime,
        teamSize: 0,
        averageLoad: 0
      },
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}
