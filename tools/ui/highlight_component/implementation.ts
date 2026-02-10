/**
 * Highlight Component Tool Implementation
 *
 * Visually highlights a component with a colored border for debugging.
 * Useful for identifying components and debugging layout issues.
 */

import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

interface HighlightComponentInput {
  componentId: string
  color?: string
  duration?: number
  label?: string
  thickness?: number
}

interface HighlightComponentSuccess {
  success: true
  componentId: string
  message: string
  highlightId: string
}

interface HighlightComponentFailure {
  success: false
  error: string
}

type HighlightComponentOutput =
  | HighlightComponentSuccess
  | HighlightComponentFailure

/**
 * Get DOM element for component
 */
function getComponentElement(componentId: string): Element | null {
  if (typeof document === 'undefined') {
    return null
  }

  // Try multiple selectors
  const selectors = [
    `[data-component-id="${componentId}"]`,
    `[data-module-id="${componentId}"]`,
    `#${componentId}`
  ]

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }

  return null
}

/**
 * Create highlight overlay element
 */
function createHighlightOverlay(
  target: Element,
  color: string,
  thickness: number,
  label?: string
): HTMLElement {
  const overlay = document.createElement('div')
  const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).slice(2)}`

  overlay.id = highlightId
  overlay.setAttribute('data-highlight-overlay', 'true')

  const rect = target.getBoundingClientRect()

  // Position overlay absolutely over the target
  Object.assign(overlay.style, {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    border: `${thickness}px solid ${color}`,
    pointerEvents: 'none',
    zIndex: '9999',
    boxSizing: 'border-box',
    animation: 'highlight-pulse 1s ease-in-out infinite'
  })

  // Add label if provided
  if (label) {
    const labelEl = document.createElement('div')
    labelEl.textContent = label

    Object.assign(labelEl.style, {
      position: 'absolute',
      top: '-2px',
      left: '-2px',
      backgroundColor: color,
      color: 'white',
      padding: '2px 6px',
      fontSize: '11px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      borderRadius: '0 0 4px 0',
      whiteSpace: 'nowrap',
      transform: 'translateY(-100%)'
    })

    overlay.appendChild(labelEl)
  }

  // Add pulse animation if not exists
  if (!document.querySelector('style[data-highlight-animation]')) {
    const style = document.createElement('style')
    style.setAttribute('data-highlight-animation', 'true')
    style.textContent = `
      @keyframes highlight-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
    `
    document.head.appendChild(style)
  }

  // Add to DOM
  document.body.appendChild(overlay)

  return overlay
}

/**
 * Remove highlight overlay
 */
function removeHighlight(highlightId: string): void {
  const overlay = document.getElementById(highlightId)
  if (overlay) {
    // Fade out
    overlay.style.transition = 'opacity 0.3s ease-out'
    overlay.style.opacity = '0'

    setTimeout(() => {
      overlay.remove()
    }, 300)
  }
}

/**
 * Update highlight position on scroll/resize
 */
function trackElementPosition(
  overlay: HTMLElement,
  target: Element,
  updateInterval = 100
): number {
  const update = () => {
    if (!document.body.contains(overlay) || !document.body.contains(target)) {
      clearInterval(intervalId)
      return
    }

    const rect = target.getBoundingClientRect()
    overlay.style.top = `${rect.top}px`
    overlay.style.left = `${rect.left}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
  }

  const intervalId = window.setInterval(update, updateInterval)
  return intervalId
}

export default async function highlightComponent(
  input: HighlightComponentInput,
  ctx: ToolContext
): Promise<HighlightComponentOutput> {
  try {
    const {
      componentId,
      color = 'red',
      duration = 3000,
      label,
      thickness = 3
    } = input

    // Get component element
    const element = getComponentElement(componentId)

    if (!element) {
      return {
        success: false,
        error: `Component "${componentId}" not found in DOM. Component may not be mounted or ID may be incorrect.`
      }
    }

    // Create highlight overlay
    const overlay = createHighlightOverlay(element, color, thickness, label)
    const highlightId = overlay.id

    // Track element position (for scroll/resize)
    const intervalId = trackElementPosition(overlay, element)

    // Auto-remove after duration (if not permanent)
    if (duration > 0) {
      setTimeout(() => {
        clearInterval(intervalId)
        removeHighlight(highlightId)
      }, duration)
    }

    const message =
      duration > 0
        ? `Highlighted component "${componentId}" with ${color} border for ${duration}ms`
        : `Highlighted component "${componentId}" with ${color} border (permanent until cleared)`

    return {
      success: true,
      componentId,
      message,
      highlightId
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
