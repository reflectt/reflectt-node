import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

/**
 * create_slide - Office Suite AI Tool
 *
 * Allows AI agents to programmatically create and manipulate presentation slides
 * in the SlideDeck component. Supports full slide lifecycle: create, update, delete,
 * reorder, and duplicate operations with complete control over layouts, content,
 * transitions, and styling.
 *
 * This tool enables AI to:
 * - Generate entire presentations from outlines
 * - Add slides with appropriate layouts and content
 * - Update existing slides with improved content
 * - Restructure presentations by reordering
 * - Create consistent slide decks from templates
 *
 * Use Cases:
 * - "Create a title slide for 'Q4 Financial Results'"
 * - "Add 3 slides summarizing the key points"
 * - "Update slide 2 with the latest data"
 * - "Reorder slides to put conclusion before Q&A"
 * - "Duplicate the template slide for each department"
 *
 * Component Integration:
 * The tool uses patch_component_state with array operations to manipulate the
 * slides array in SlideDeck. The component handles rendering, transitions, and
 * presentation mode.
 *
 * @param input - Slide operation parameters
 * @param ctx - Tool execution context
 * @returns Success with operation details or error
 */
export default async function createSlideTool(
  input: unknown,
  ctx: ToolContext
): Promise<CreateSlideOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required moduleId
    if (!params.moduleId || typeof params.moduleId !== 'string') {
      throw new Error('Missing required parameter: moduleId')
    }

    const moduleId = params.moduleId.trim()
    if (moduleId.length === 0) {
      throw new Error('moduleId cannot be empty')
    }

    // Validate operation
    const validOperations = ['create', 'update', 'delete', 'reorder', 'duplicate']
    const operation = params.operation || 'create'
    if (!validOperations.includes(operation)) {
      throw new Error(`Invalid operation: "${operation}". Must be one of: ${validOperations.join(', ')}`)
    }

    // Validate slideIndex for operations that need it
    let slideIndex: number | undefined
    if (['update', 'delete', 'duplicate'].includes(operation)) {
      if (params.slideIndex === undefined || params.slideIndex === null) {
        throw new Error(`operation "${operation}" requires slideIndex parameter`)
      }
      if (typeof params.slideIndex !== 'number') {
        throw new Error('slideIndex must be a number')
      }
      if (params.slideIndex < 0) {
        throw new Error('slideIndex must be non-negative')
      }
      slideIndex = Math.floor(params.slideIndex)
    } else if (operation === 'create' && params.slideIndex !== undefined) {
      // Optional for create (specifies insert position)
      if (typeof params.slideIndex !== 'number' || params.slideIndex < 0) {
        throw new Error('slideIndex must be a non-negative number')
      }
      slideIndex = Math.floor(params.slideIndex)
    }

    // Validate slide data for create/update
    let slideData: any = null
    if (['create', 'update'].includes(operation)) {
      if (!params.slide) {
        throw new Error(`operation "${operation}" requires slide parameter`)
      }
      if (typeof params.slide !== 'object' || params.slide === null) {
        throw new Error('slide must be an object')
      }

      slideData = validateAndBuildSlide(params.slide)
    }

    // Validate newOrder for reorder
    let newOrder: number[] | undefined
    if (operation === 'reorder') {
      if (!params.newOrder || !Array.isArray(params.newOrder)) {
        throw new Error('operation "reorder" requires newOrder parameter (array of indices)')
      }
      if (params.newOrder.length === 0) {
        throw new Error('newOrder cannot be empty')
      }
      // Validate all indices are numbers
      for (let i = 0; i < params.newOrder.length; i++) {
        if (typeof params.newOrder[i] !== 'number' || params.newOrder[i] < 0) {
          throw new Error(`newOrder[${i}] must be a non-negative number`)
        }
      }
      newOrder = params.newOrder.map((n: number) => Math.floor(n))
    }

    // Build operation command
    const slideCommand: any = {
      _slideOperation: {
        type: operation,
        slideIndex,
        slideData,
        newOrder,
        timestamp: now()
      }
    }

    console.log('[create_slide]', {
      moduleId,
      operation,
      slideIndex,
      hasSlideData: !!slideData,
      slideTitle: slideData?.title,
      slideLayout: slideData?.layout,
      newOrderLength: newOrder?.length,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      slide_operation: {
        moduleId,
        operation,
        slideIndex,
        slideData,
        newOrder,
        propsPatch: slideCommand,
        timestamp: now()
      },
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

/**
 * Validate and build slide data object
 */
function validateAndBuildSlide(slide: any): any {
  const slideData: any = {
    id: `slide-${Date.now()}`,
    title: '',
    layout: 'content',
    background: {
      type: 'color',
      value: '#ffffff'
    },
    transition: 'fade',
    elements: []
  }

  // Validate title
  if (slide.title !== undefined) {
    if (typeof slide.title !== 'string') {
      throw new Error('slide.title must be a string')
    }
    slideData.title = slide.title
  }

  // Validate layout
  if (slide.layout !== undefined) {
    const validLayouts = ['title', 'content', 'two-column', 'image-text', 'blank']
    if (!validLayouts.includes(slide.layout)) {
      throw new Error(`slide.layout must be one of: ${validLayouts.join(', ')}`)
    }
    slideData.layout = slide.layout
  }

  // Validate content
  if (slide.content && typeof slide.content === 'object') {
    slideData.content = {}

    if (slide.content.text !== undefined) {
      if (typeof slide.content.text !== 'string') {
        throw new Error('slide.content.text must be a string')
      }
      slideData.content.text = slide.content.text
    }

    if (slide.content.image !== undefined) {
      if (typeof slide.content.image !== 'string') {
        throw new Error('slide.content.image must be a string (URL)')
      }
      slideData.content.image = slide.content.image
    }

    if (slide.content.bullets !== undefined) {
      if (!Array.isArray(slide.content.bullets)) {
        throw new Error('slide.content.bullets must be an array')
      }
      for (let i = 0; i < slide.content.bullets.length; i++) {
        if (typeof slide.content.bullets[i] !== 'string') {
          throw new Error(`slide.content.bullets[${i}] must be a string`)
        }
      }
      slideData.content.bullets = slide.content.bullets
    }

    if (slide.content.notes !== undefined) {
      if (typeof slide.content.notes !== 'string') {
        throw new Error('slide.content.notes must be a string')
      }
      slideData.content.notes = slide.content.notes
    }

    if (slide.content.subtitle !== undefined) {
      if (typeof slide.content.subtitle !== 'string') {
        throw new Error('slide.content.subtitle must be a string')
      }
      slideData.content.subtitle = slide.content.subtitle
    }
  }

  // Validate background
  if (slide.background && typeof slide.background === 'object') {
    const validBgTypes = ['color', 'gradient', 'image']
    if (slide.background.type && !validBgTypes.includes(slide.background.type)) {
      throw new Error(`slide.background.type must be one of: ${validBgTypes.join(', ')}`)
    }
    slideData.background = {
      type: slide.background.type || 'color',
      value: slide.background.value || '#ffffff'
    }
  }

  // Validate transition
  if (slide.transition !== undefined) {
    const validTransitions = ['none', 'fade', 'slide', 'zoom', 'flip', 'cube']
    if (!validTransitions.includes(slide.transition)) {
      throw new Error(`slide.transition must be one of: ${validTransitions.join(', ')}`)
    }
    slideData.transition = slide.transition
  }

  // Validate speaker notes
  if (slide.speakerNotes !== undefined) {
    if (typeof slide.speakerNotes !== 'string') {
      throw new Error('slide.speakerNotes must be a string')
    }
    slideData.speakerNotes = slide.speakerNotes
  }

  return slideData
}

// Types
interface CreateSlideSuccess {
  success: true
  slide_operation: {
    moduleId: string
    operation: string
    slideIndex?: number
    slideData?: any
    newOrder?: number[]
    propsPatch: Record<string, any>
    timestamp: string
  }
  space_id: string
}

interface CreateSlideFailure {
  success: false
  error: string
  space_id: string
}

type CreateSlideOutput = CreateSlideSuccess | CreateSlideFailure
