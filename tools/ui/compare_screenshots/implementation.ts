/**
 * Compare Screenshots Tool Implementation
 *
 * Performs pixel-by-pixel comparison of two screenshots to detect visual differences.
 * Useful for visual regression testing and validating UI changes.
 */

import { findScreenshot } from '../screenshot_component/implementation'

interface CompareScreenshotsInput {
  screenshot1Id: string
  screenshot2Id: string
  threshold?: number
  ignoreAntialiasing?: boolean
  highlightColor?: string
}

interface ComparisonResult {
  success: boolean
  comparison?: {
    identical: boolean
    diffPixels: number
    totalPixels: number
    diffPercentage: string
    diffImageUrl: string
    threshold: number
    verdict: 'identical' | 'minor_differences' | 'moderate_differences' | 'major_differences'
    analysis: string
  }
  error?: string
  dimensions?: {
    screenshot1: { width: number; height: number }
    screenshot2: { width: number; height: number }
  }
}

/**
 * Load an image from a data URL
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/**
 * Get image data from an image element
 */
function getImageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height

  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  return ctx.getImageData(0, 0, img.width, img.height)
}

/**
 * Parse CSS color to RGBA array
 */
function parseColor(color: string): [number, number, number] {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.substring(1)
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      return [r, g, b]
    } else if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      return [r, g, b]
    }
  }

  // Default to magenta
  return [255, 0, 255]
}

/**
 * Lightweight pixelmatch implementation
 * Compares two images pixel by pixel and returns the number of different pixels
 */
function pixelmatch(
  img1: Uint8ClampedArray,
  img2: Uint8ClampedArray,
  output: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    threshold: number
    includeAA?: boolean
    diffColor?: [number, number, number]
  }
): number {
  const { threshold, includeAA = false, diffColor = [255, 0, 255] } = options
  const maxDelta = 35215 // Maximum color difference (255^2 * 3)

  let diff = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = (y * width + x) * 4

      // Get RGB values
      const r1 = img1[pos]
      const g1 = img1[pos + 1]
      const b1 = img1[pos + 2]
      const a1 = img1[pos + 3]

      const r2 = img2[pos]
      const g2 = img2[pos + 1]
      const b2 = img2[pos + 2]
      const a2 = img2[pos + 3]

      // Calculate color difference
      const delta =
        (r1 - r2) * (r1 - r2) +
        (g1 - g2) * (g1 - g2) +
        (b1 - b2) * (b1 - b2) +
        (a1 - a2) * (a1 - a2)

      // Check if difference is significant
      if (delta > maxDelta * threshold * threshold) {
        // Check for antialiasing if enabled
        if (!includeAA && isAntialiased(img1, x, y, width, height, img2)) {
          // Draw as similar
          output[pos] = r1
          output[pos + 1] = g1
          output[pos + 2] = b1
          output[pos + 3] = a1
        } else {
          // Draw difference
          output[pos] = diffColor[0]
          output[pos + 1] = diffColor[1]
          output[pos + 2] = diffColor[2]
          output[pos + 3] = 255
          diff++
        }
      } else {
        // Draw original pixel (dimmed)
        output[pos] = Math.floor(r1 * 0.3)
        output[pos + 1] = Math.floor(g1 * 0.3)
        output[pos + 2] = Math.floor(b1 * 0.3)
        output[pos + 3] = a1
      }
    }
  }

  return diff
}

/**
 * Check if a pixel is likely part of antialiasing
 */
function isAntialiased(
  img: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  img2: Uint8ClampedArray
): boolean {
  // Check neighbors for antialiasing patterns
  const pos = (y * width + x) * 4
  let minAlpha = 255
  let maxAlpha = 0

  // Check 3x3 grid around pixel
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue

      const nx = x + dx
      const ny = y + dy

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const npos = (ny * width + nx) * 4
        const alpha = img[npos + 3]
        minAlpha = Math.min(minAlpha, alpha)
        maxAlpha = Math.max(maxAlpha, alpha)
      }
    }
  }

  // If there's a significant alpha variation, it's likely antialiasing
  return maxAlpha - minAlpha > 50
}

/**
 * Generate analysis text based on comparison results
 */
function generateAnalysis(
  diffPercentage: number,
  diffPixels: number,
  identical: boolean
): string {
  if (identical) {
    return 'Screenshots are pixel-perfect identical. No visual changes detected.'
  }

  if (diffPercentage < 0.1) {
    return `Minimal differences detected (${diffPercentage}%). Likely due to rendering variations or antialiasing. Changes are not visually significant.`
  }

  if (diffPercentage < 1) {
    return `Minor differences detected (${diffPercentage}%, ${diffPixels} pixels). Small visual changes that may be intentional or due to minor styling adjustments.`
  }

  if (diffPercentage < 5) {
    return `Moderate differences detected (${diffPercentage}%, ${diffPixels} pixels). Noticeable visual changes that should be reviewed. May indicate component state changes or styling updates.`
  }

  return `Major differences detected (${diffPercentage}%, ${diffPixels} pixels). Significant visual changes that likely indicate major UI modifications, layout changes, or potential regressions.`
}

/**
 * Compare Screenshots Tool
 *
 * Compares two screenshots and generates a visual diff.
 */
export async function compare_screenshots(
  input: CompareScreenshotsInput
): Promise<ComparisonResult> {
  try {
    // Find screenshots in history
    const ss1 = findScreenshot(input.screenshot1Id)
    const ss2 = findScreenshot(input.screenshot2Id)

    if (!ss1) {
      return {
        success: false,
        error: `Screenshot not found: ${input.screenshot1Id}. Screenshot may have been removed from history (only last 20 are kept).`,
      }
    }

    if (!ss2) {
      return {
        success: false,
        error: `Screenshot not found: ${input.screenshot2Id}. Screenshot may have been removed from history (only last 20 are kept).`,
      }
    }

    // Load images
    const img1 = await loadImage(ss1.dataUrl)
    const img2 = await loadImage(ss2.dataUrl)

    // Ensure same dimensions
    if (img1.width !== img2.width || img1.height !== img2.height) {
      return {
        success: false,
        error: 'Screenshots have different dimensions. Cannot compare images of different sizes.',
        dimensions: {
          screenshot1: { width: img1.width, height: img1.height },
          screenshot2: { width: img2.width, height: img2.height },
        },
      }
    }

    // Get image data
    const data1 = getImageData(img1)
    const data2 = getImageData(img2)

    // Create diff canvas
    const canvas = document.createElement('canvas')
    canvas.width = img1.width
    canvas.height = img1.height
    const ctx = canvas.getContext('2d')!

    const diffData = ctx.createImageData(img1.width, img1.height)

    // Parse highlight color
    const highlightColor = parseColor(input.highlightColor || '#ff00ff')

    // Compare pixels
    const threshold = input.threshold ?? 0.1
    const ignoreAntialiasing = input.ignoreAntialiasing ?? true

    const numDiffPixels = pixelmatch(
      data1.data,
      data2.data,
      diffData.data,
      img1.width,
      img1.height,
      {
        threshold,
        includeAA: !ignoreAntialiasing,
        diffColor: highlightColor,
      }
    )

    // Create diff image
    ctx.putImageData(diffData, 0, 0)
    const diffImageUrl = canvas.toDataURL('image/png')

    const totalPixels = img1.width * img1.height
    const diffPercentage = (numDiffPixels / totalPixels) * 100

    // Determine verdict
    let verdict: 'identical' | 'minor_differences' | 'moderate_differences' | 'major_differences'
    if (numDiffPixels === 0) {
      verdict = 'identical'
    } else if (diffPercentage < 1) {
      verdict = 'minor_differences'
    } else if (diffPercentage < 5) {
      verdict = 'moderate_differences'
    } else {
      verdict = 'major_differences'
    }

    return {
      success: true,
      comparison: {
        identical: numDiffPixels === 0,
        diffPixels: numDiffPixels,
        totalPixels,
        diffPercentage: diffPercentage.toFixed(3),
        diffImageUrl,
        threshold,
        verdict,
        analysis: generateAnalysis(
          parseFloat(diffPercentage.toFixed(3)),
          numDiffPixels,
          numDiffPixels === 0
        ),
      },
    }
  } catch (error) {
    return {
      success: false,
      error: `Screenshot comparison failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
