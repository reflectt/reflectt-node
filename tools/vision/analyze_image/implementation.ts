import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface AnalyzeImageInput {
  image_source: string
  image_type?: 'url' | 'base64' | 'file_path'
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  prompt?: string
  max_tokens?: number
}

interface AnalyzeImageOutput {
  analysis: string
  image_source: string
  tokens_used?: number
  error?: string
}

/**
 * Analyze an image using Claude's vision capabilities
 */
export default async function analyzeImage(
  input: AnalyzeImageInput,
  ctx: ToolContext
): Promise<AnalyzeImageOutput> {
  const {
    image_source,
    image_type = 'url',
    media_type = 'image/jpeg',
    prompt = 'Describe this image in detail, including all visible objects, text, people, and the overall scene.',
    max_tokens = 1024
  } = input

  try {
    // Initialize Anthropic client
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return {
        analysis: '',
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
      const imagePath = path.isAbsolute(image_source)
        ? image_source
        : ctx.resolvePath(undefined, image_source)

      if (!await checkFileExists(imagePath)) {
        return {
          analysis: '',
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
        analysis: '',
        image_source,
        error: `Invalid image_type: ${image_type}`
      }
    }

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
    const analysis = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n')

    return {
      analysis,
      image_source,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens
    }
  } catch (error) {
    return {
      analysis: '',
      image_source,
      error: formatError(error)
    }
  }
}
