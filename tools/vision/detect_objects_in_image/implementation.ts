import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import {
  checkFileExists,
  formatError,
  ToolContext,
} from '@/lib/tools/helpers'

interface DetectObjectsInImageInput {
  image_source: string
  image_type?: 'url' | 'base64' | 'file_path'
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  object_types?: string[]
  include_locations?: boolean
  min_confidence?: 'low' | 'medium' | 'high'
  max_tokens?: number
}

interface DetectedObject {
  name: string
  description: string
  location?: string
  confidence?: string
}

interface DetectObjectsInImageOutput {
  objects: DetectedObject[]
  total_count: number
  image_source: string
  tokens_used?: number
  error?: string
}

/**
 * Detect and identify objects in an image using Claude's vision capabilities
 */
export default async function detectObjectsInImage(input: DetectObjectsInImageInput, ctx: ToolContext): Promise<DetectObjectsInImageOutput> {
  const {
    image_source,
    image_type = 'url',
    media_type = 'image/jpeg',
    object_types,
    include_locations = true,
    min_confidence = 'medium',
    max_tokens = 1024
  } = input

  try {
    // Initialize Anthropic client
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return {
        objects: [],
        total_count: 0,
        image_source,
        error: 'ANTHROPIC_API_KEY environment variable not set'
      }
    }

    const client = new Anthropic({ apiKey })

    // Prepare image data based on source type
    let imageContent: Anthropic.ImageBlockParam

    if (image_type === 'url') {
      imageContent = {
        type: 'image',
        source: {
          type: 'url',
          url: image_source
        }
      }
    } else if (image_type === 'base64') {
      imageContent = {
        type: 'image',
        source: {
          type: 'base64',
          media_type,
          data: image_source
        }
      }
    } else if (image_type === 'file_path') {
      // Read file and convert to base64
      const imagePath = ctx.resolvePath(ctx.currentSpace, 'storage',image_source)
      
      if (!await ctx.fileExists(imagePath)) {
        return {
          objects: [],
          total_count: 0,
          image_source,
          error: `Image file not found: ${imagePath}`
        }
      }

      const imageBuffer = fs.readFileSync(imagePath)
      const base64Data = imageBuffer.toString('base64')

      imageContent = {
        type: 'image',
        source: {
          type: 'base64',
          media_type,
          data: base64Data
        }
      }
    } else {
      return {
        objects: [],
        total_count: 0,
        image_source,
        error: `Invalid image_type: ${image_type}`
      }
    }

    // Build prompt for object detection
    let prompt = 'Identify and list all objects visible in this image.'

    if (object_types && object_types.length > 0) {
      prompt += ` Focus specifically on detecting: ${object_types.join(', ')}.`
    }

    if (include_locations) {
      prompt += ' For each object, include its approximate location or position in the image (e.g., top-left, center, bottom-right).'
    }

    prompt += ` Only include objects where you have ${min_confidence} or higher confidence.`

    prompt += ' Return the results as a JSON array with objects in this format: [{"name": "object name", "description": "brief description", "location": "position in image", "confidence": "low/medium/high"}]'

    // Call Claude API with vision
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens,
      messages: [
        {
          role: 'user',
          content: [
            imageContent,
            {
              type: 'text',
              text: prompt
            }
          ]
        }
      ]
    })

    // Extract text from response
    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n')

    // Try to parse JSON response
    let objects: DetectedObject[] = []

    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        objects = JSON.parse(jsonMatch[0])
      } else {
        // Fallback: parse as plain text list
        const lines = responseText.split('\n').filter(line => line.trim())
        objects = lines.map(line => ({
          name: line.trim(),
          description: line.trim(),
          location: include_locations ? 'unknown' : undefined,
          confidence: min_confidence
        }))
      }
    } catch (parseError) {
      // If JSON parsing fails, return raw response as single object
      objects = [{
        name: 'Detection Result',
        description: responseText,
        location: undefined,
        confidence: undefined
      }]
    }

    return {
      objects,
      total_count: objects.length,
      image_source,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens
    }
  } catch (error) {
    return {
      objects: [],
      total_count: 0,
      image_source,
      error: formatError(error)
    }
  }
}
