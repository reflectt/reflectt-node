import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

type SlotBehavior = 'visible' | 'hidden' | 'drawer'

type SlotName = 'primary' | 'secondary' | 'sidebar' | 'top'

interface ResponsiveSlotRules {
  mobile: Partial<Record<SlotName, SlotBehavior>>
  tablet: Partial<Record<SlotName, SlotBehavior>>
  desktop: Partial<Record<SlotName, SlotBehavior>>
}

interface SetResponsiveSlotsInput {
  mobile: Partial<Record<SlotName, SlotBehavior>>
  tablet: Partial<Record<SlotName, SlotBehavior>>
  desktop: Partial<Record<SlotName, SlotBehavior>>
}

interface SetResponsiveSlotsSuccess {
  success: true
  responsive_rules: ResponsiveSlotRules
  message: string
  space_id: string
}

interface SetResponsiveSlotsFailure {
  success: false
  error: string
  space_id: string
}

type SetResponsiveSlotsOutput = SetResponsiveSlotsSuccess | SetResponsiveSlotsFailure

/**
 * set_responsive_slots - Responsive Layout Tool
 *
 * Configures how slots behave at different screen sizes for responsive layouts.
 * This enables mobile-first design patterns and progressive enhancement strategies.
 *
 * How it works:
 * 1. Server validates responsive rules for mobile, tablet, and desktop
 * 2. Returns success payload with validated rules
 * 3. Client-side store saves rules and applies appropriate configuration
 * 4. On viewport resize, active rules automatically update slot visibility
 * 5. 'drawer' behavior converts slots to bottom drawers on smaller screens
 *
 * Slot Behaviors:
 * - visible: Slot is rendered inline at this screen size
 * - hidden: Slot is not rendered at this screen size
 * - drawer: Slot content is moved to a bottom drawer (mobile pattern)
 *
 * Common Patterns:
 * - Mobile-first: Start minimal, progressively reveal on larger screens
 * - Progressive reveal: Hide secondary content on mobile, show on tablet+
 * - Drawer pattern: Move sidebar/secondary to drawer on mobile
 * - Responsive sidebar: Hide on mobile, show on tablet+, expand on desktop
 *
 * Use Cases:
 * - Mobile optimization: Simplify layout for small screens
 * - Touch-friendly UI: Convert complex layouts to drawer-based navigation
 * - Progressive enhancement: Add features as screen size increases
 * - Responsive dashboards: Adapt widget visibility to viewport
 * - Multi-device experiences: Consistent UX across devices
 *
 * Example Rules:
 * {
 *   mobile: {
 *     sidebar: 'hidden',      // Hide sidebar on mobile
 *     secondary: 'drawer'     // Move secondary to drawer
 *   },
 *   tablet: {
 *     sidebar: 'visible',     // Show sidebar on tablet
 *     secondary: 'visible'    // Show secondary inline
 *   },
 *   desktop: {
 *     sidebar: 'visible',     // Keep sidebar visible
 *     secondary: 'visible'    // Keep secondary visible
 *   }
 * }
 */
export default async function setResponsiveSlotsTool(
  input: SetResponsiveSlotsInput,
  ctx: ToolContext
): Promise<SetResponsiveSlotsOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required breakpoints
    const requiredBreakpoints = ['mobile', 'tablet', 'desktop']
    for (const breakpoint of requiredBreakpoints) {
      if (!params[breakpoint]) {
        throw new Error(`Missing required breakpoint: ${breakpoint}`)
      }

      if (typeof params[breakpoint] !== 'object' || Array.isArray(params[breakpoint])) {
        throw new Error(`${breakpoint} must be an object`)
      }
    }

    const validSlots: SlotName[] = ['primary', 'secondary', 'sidebar', 'top']
    const validBehaviors: SlotBehavior[] = ['visible', 'hidden', 'drawer']

    // Validate each breakpoint's slot rules
    const rules: ResponsiveSlotRules = {
      mobile: {},
      tablet: {},
      desktop: {}
    }

    for (const breakpoint of requiredBreakpoints) {
      const breakpointRules = params[breakpoint]

      for (const slotName of Object.keys(breakpointRules)) {
        // Validate slot name
        if (!validSlots.includes(slotName as SlotName)) {
          throw new Error(
            `${breakpoint}.${slotName}: invalid slot name. Must be one of: ${validSlots.join(', ')}`
          )
        }

        // Validate behavior
        const behavior = breakpointRules[slotName]
        if (!validBehaviors.includes(behavior)) {
          throw new Error(
            `${breakpoint}.${slotName}: invalid behavior "${behavior}". Must be one of: ${validBehaviors.join(', ')}`
          )
        }

        // Store validated rule
        rules[breakpoint as keyof ResponsiveSlotRules][slotName as SlotName] = behavior
      }
    }

    // Count total rules configured
    const ruleCount =
      Object.keys(rules.mobile).length +
      Object.keys(rules.tablet).length +
      Object.keys(rules.desktop).length

    // Log responsive rules configuration
    console.log('[set_responsive_slots]', {
      rules,
      ruleCount,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      responsive_rules: rules,
      message: `Responsive slot rules configured. Slots will adapt automatically on viewport changes. ${ruleCount} rules applied across 3 breakpoints.`,
      space_id: ctx.currentSpace
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: ctx.currentSpace
    }
  }
}
