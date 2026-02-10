/**
 * Analyze Team Capacity Tool Implementation
 *
 * Provides capacity analysis and bottleneck identification
 */

import { TaskRoutingEngine, SkillDiscovery, type TeamMemberProfile } from '@/lib/intelligence/task-routing'

interface AnalyzeTeamCapacityParams {
  teamMembers?: string[]
  timeframe?: 'current' | 'week' | 'sprint' | 'month'
  includeSkillGaps?: boolean
}

interface AnalyzeTeamCapacityResult {
  success: boolean
  capacity: {
    totalCapacity: number
    usedCapacity: number
    availableCapacity: number
    utilizationPercentage: number
  }
  members: Array<{
    id: string
    name: string
    capacity: number
    load: number
    loadPercentage: number
    available: number
    status: 'available' | 'busy' | 'overloaded'
    skills: Array<{ name: string, level: number }>
  }>
  bottlenecks: Array<{
    id: string
    name: string
    loadPercentage: number
    reason: string
  }>
  skillCoverage: Array<{
    skill: string
    teamMembersWithSkill: number
    averageLevel: number
    isCritical: boolean
  }>
  skillGaps?: Array<{
    skill: string
    demand: number
    supply: number
    gap: number
    recommendation: string
  }>
  recommendations: string[]
  metadata: {
    timeframe: string
    teamSize: number
    processingTime: number
  }
  error?: string
}

/**
 * Sample team data
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
    currentLoad: 85, // High load - bottleneck
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
      { name: 'Python', level: 80, confidence: 0.80, lastUsed: new Date() },
      { name: 'DevOps', level: 75, confidence: 0.75, lastUsed: new Date() } // Only one with DevOps
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
      { name: 'JavaScript', level: 75, confidence: 0.75, lastUsed: new Date() }
    ],
    currentLoad: 30, // Low load - underutilized
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
 * Sample upcoming tasks for skill gap analysis
 */
const getSampleUpcomingTasks = () => [
  { title: 'Deploy to AWS', tags: ['devops', 'cloud'] },
  { title: 'Kubernetes setup', tags: ['devops', 'kubernetes'] },
  { title: 'CI/CD pipeline', tags: ['devops', 'automation'] }
]

export async function analyze_team_capacity(
  params: AnalyzeTeamCapacityParams
): Promise<AnalyzeTeamCapacityResult> {
  const startTime = Date.now()

  try {
    // Get team data
    let team = getSampleTeam()

    // Filter if specific members requested
    if (params.teamMembers && params.teamMembers.length > 0) {
      team = team.filter(member => params.teamMembers!.includes(member.id))
    }

    const timeframe = params.timeframe || 'current'

    // Initialize routing engine
    const engine = new TaskRoutingEngine(team)

    // Analyze capacity
    const capacityAnalysis = engine.analyzeCapacity(timeframe)

    // Format members with status
    const members = capacityAnalysis.memberCapacities.map(member => {
      const profile = team.find(t => t.id === member.id)!

      let status: 'available' | 'busy' | 'overloaded' = 'available'
      if (member.load > 80) status = 'overloaded'
      else if (member.load > 60) status = 'busy'

      return {
        id: member.id,
        name: member.name,
        capacity: member.capacity,
        load: member.load,
        loadPercentage: Math.round(member.load),
        available: Math.round(member.available),
        status,
        skills: profile.skills.map(s => ({ name: s.name, level: s.level }))
      }
    })

    // Identify bottlenecks with reasons
    const bottlenecks = members
      .filter(m => m.loadPercentage > 80)
      .map(m => ({
        id: m.id,
        name: m.name,
        loadPercentage: m.loadPercentage,
        reason: m.loadPercentage > 95
          ? 'Critical overload - immediate rebalancing needed'
          : 'High utilization - limited capacity for new work'
      }))

    // Analyze skill coverage
    const allSkills = new Map<string, { members: number, totalLevel: number, isCritical: boolean }>()

    team.forEach(member => {
      member.skills.forEach(skill => {
        if (!allSkills.has(skill.name)) {
          allSkills.set(skill.name, { members: 0, totalLevel: 0, isCritical: false })
        }
        const coverage = allSkills.get(skill.name)!
        coverage.members++
        coverage.totalLevel += skill.level
      })
    })

    const skillCoverage = Array.from(allSkills.entries()).map(([skill, data]) => ({
      skill,
      teamMembersWithSkill: data.members,
      averageLevel: Math.round(data.totalLevel / data.members),
      isCritical: data.members === 1 // Single point of failure
    }))

    // Skill gap analysis if requested
    let skillGaps: Array<{
      skill: string
      demand: number
      supply: number
      gap: number
      recommendation: string
    }> | undefined

    if (params.includeSkillGaps) {
      const skillDiscovery = new SkillDiscovery()
      const upcomingTasks = getSampleUpcomingTasks()

      const gaps = skillDiscovery.identifySkillGaps(team, upcomingTasks)

      skillGaps = gaps.map(gap => ({
        skill: gap.skill,
        demand: gap.demand,
        supply: gap.supply,
        gap: gap.gap,
        recommendation: gap.gap > 2
          ? `Critical gap - consider hiring or training for ${gap.skill}`
          : gap.gap > 1
          ? `Moderate gap - ${gap.skill} could become bottleneck`
          : `Minor gap - monitor ${gap.skill} demand`
      }))
    }

    // Calculate capacity metrics
    const utilizationPercentage = Math.round(
      (capacityAnalysis.usedCapacity / capacityAnalysis.totalCapacity) * 100
    )

    // Generate recommendations
    const recommendations: string[] = []

    if (bottlenecks.length > 0) {
      recommendations.push(
        `${bottlenecks.length} team member(s) overloaded: Consider redistributing work from ${bottlenecks.map(b => b.name).join(', ')}`
      )
    }

    const underutilized = members.filter(m => m.loadPercentage < 50)
    if (underutilized.length > 0) {
      recommendations.push(
        `${underutilized.length} team member(s) underutilized: ${underutilized.map(m => m.name).join(', ')} have capacity for more work`
      )
    }

    const criticalSkills = skillCoverage.filter(sc => sc.isCritical)
    if (criticalSkills.length > 0) {
      recommendations.push(
        `${criticalSkills.length} skill bottleneck(s) identified: ${criticalSkills.map(cs => cs.skill).join(', ')} - single points of failure`
      )
    }

    if (utilizationPercentage < 60) {
      recommendations.push('Team has significant available capacity - good time to take on new projects')
    } else if (utilizationPercentage > 85) {
      recommendations.push('Team at high utilization - limited capacity for urgent work or new initiatives')
    }

    if (skillGaps && skillGaps.length > 0) {
      const criticalGaps = skillGaps.filter(sg => sg.gap > 2)
      if (criticalGaps.length > 0) {
        recommendations.push(
          `Critical skill gaps for upcoming work: ${criticalGaps.map(g => g.skill).join(', ')}`
        )
      }
    }

    return {
      success: true,
      capacity: {
        totalCapacity: Math.round(capacityAnalysis.totalCapacity),
        usedCapacity: Math.round(capacityAnalysis.usedCapacity),
        availableCapacity: Math.round(capacityAnalysis.availableCapacity),
        utilizationPercentage
      },
      members,
      bottlenecks,
      skillCoverage,
      skillGaps,
      recommendations,
      metadata: {
        timeframe,
        teamSize: team.length,
        processingTime: Date.now() - startTime
      }
    }
  } catch (error) {
    return {
      success: false,
      capacity: {
        totalCapacity: 0,
        usedCapacity: 0,
        availableCapacity: 0,
        utilizationPercentage: 0
      },
      members: [],
      bottlenecks: [],
      skillCoverage: [],
      recommendations: [],
      metadata: {
        timeframe: params.timeframe || 'current',
        teamSize: 0,
        processingTime: Date.now() - startTime
      },
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}
