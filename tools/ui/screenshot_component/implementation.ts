/**
 * Screenshot Component Tool Implementation
 *
 * Captures screenshots of components or layouts for visual testing and debugging.
 * Uses html2canvas to render DOM elements as images.
 */

import html2canvas from 'html2canvas'

interface ScreenshotInput {
  componentId?: string
  format?: 'png' | 'jpeg' | 'webp'
  quality?: number
  fullPage?: boolean
  saveToHistory?: boolean
}

interface ScreenshotMetadata {
  id: string
  timestamp: number
  componentId?: string
  componentType?: string
  dimensions: { width: number; height: number }
  dataUrl: string
  format: string
  sizeKB: number
}

interface ScreenshotResult {
  success: boolean
  screenshot?: {
    id: string
    dataUrl: string
    dimensions: { width: number; height: number }
    timestamp: number
    sizeKB: number
    format: string
  }
  error?: string
  historyCount?: number
}

// Global screenshot history (persists for session)
const screenshotHistory: ScreenshotMetadata[] = []

/**
 * Generate a unique ID for screenshots
 */
function generateId(): string {
  return `screenshot-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Get component type from data attributes
 */
function getComponentType(componentId: string): string {
  const element = document.querySelector(`[data-module-id="${componentId}"]`)
  if (!element) return 'unknown'

  return element.getAttribute('data-component-type') ||
         element.getAttribute('data-type') ||
         element.tagName.toLowerCase()
}

/**
 * Calculate approximate size of data URL in KB
 */
function calculateSizeKB(dataUrl: string): number {
  // Base64 encoding increases size by ~33%, subtract data URL prefix
  const base64Length = dataUrl.length - dataUrl.indexOf(',') - 1
  return Math.round((base64Length * 0.75) / 1024)
}

/**
 * Screenshot Component Tool
 *
 * Captures a screenshot of a component or the entire layout.
 */
export async function screenshot_component(
  input: ScreenshotInput
): Promise<ScreenshotResult> {
  try {
    // Find target element
    let targetElement: HTMLElement

    if (input.componentId) {
      // Screenshot specific component by module ID
      const element = document.querySelector(
        `[data-module-id="${input.componentId}"]`
      )

      if (!element) {
        return {
          success: false,
          error: `Component not found in DOM: ${input.componentId}. Make sure the component has been rendered with render_manifest.`,
        }
      }

      targetElement = element as HTMLElement
    } else {
      // Screenshot entire layout
      const layoutContainer = document.querySelector('[data-layout-container]')
      targetElement = (layoutContainer || document.body) as HTMLElement
    }

    // Check if element is visible
    const style = window.getComputedStyle(targetElement)
    if (style.display === 'none' || style.visibility === 'hidden') {
      return {
        success: false,
        error: `Target element is hidden. Component: ${input.componentId || 'layout'}`,
      }
    }

    // Prepare canvas options
    const format = input.format || 'png'
    const quality = input.quality ?? 0.92
    const fullPage = input.fullPage || false

    // Calculate scroll offsets for full-page capture
    const scrollY = fullPage ? -window.scrollY : 0
    const scrollX = fullPage ? -window.scrollX : 0
    const windowHeight = fullPage
      ? document.documentElement.scrollHeight
      : window.innerHeight

    // Capture screenshot using html2canvas
    const canvas = await html2canvas(targetElement, {
      backgroundColor: null, // Transparent background
      scale: 2, // Retina quality (2x resolution)
      logging: false, // Disable debug logs
      useCORS: true, // Allow cross-origin images
      allowTaint: false, // Prevent tainted canvas
      scrollY,
      scrollX,
      windowHeight,
      imageTimeout: 15000, // 15s timeout for images
      onclone: (clonedDoc) => {
        // Ensure styles are properly cloned
        const clonedElement = clonedDoc.querySelector(
          input.componentId
            ? `[data-module-id="${input.componentId}"]`
            : '[data-layout-container]'
        )

        if (clonedElement) {
          // Force render any lazy-loaded content
          clonedElement.querySelectorAll('[loading="lazy"]').forEach((el) => {
            el.removeAttribute('loading')
          })
        }
      },
    })

    // Convert canvas to data URL
    const mimeType = `image/${format}`
    const dataUrl = canvas.toDataURL(mimeType, quality)

    // Create metadata
    const metadata: ScreenshotMetadata = {
      id: generateId(),
      timestamp: Date.now(),
      componentId: input.componentId,
      componentType: input.componentId ? getComponentType(input.componentId) : 'layout',
      dimensions: {
        width: canvas.width,
        height: canvas.height,
      },
      dataUrl,
      format,
      sizeKB: calculateSizeKB(dataUrl),
    }

    // Save to history if requested
    if (input.saveToHistory !== false) {
      screenshotHistory.push(metadata)

      // Keep only last 20 screenshots to prevent memory issues
      if (screenshotHistory.length > 20) {
        screenshotHistory.shift()
      }
    }

    return {
      success: true,
      screenshot: {
        id: metadata.id,
        dataUrl: metadata.dataUrl,
        dimensions: metadata.dimensions,
        timestamp: metadata.timestamp,
        sizeKB: metadata.sizeKB,
        format: metadata.format,
      },
      historyCount: screenshotHistory.length,
    }
  } catch (error) {
    return {
      success: false,
      error: `Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Get screenshot history
 * Exported for use by compare_screenshots tool
 */
export function getScreenshotHistory(): ScreenshotMetadata[] {
  return screenshotHistory
}

/**
 * Clear screenshot history
 */
export function clearScreenshotHistory(): void {
  screenshotHistory.length = 0
}

/**
 * Find screenshot by ID
 */
export function findScreenshot(id: string): ScreenshotMetadata | undefined {
  return screenshotHistory.find((s) => s.id === id)
}
