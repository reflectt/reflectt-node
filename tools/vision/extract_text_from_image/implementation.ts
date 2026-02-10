import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import {
  checkFileExists,
  formatError,
  ToolContext,
} from '@/lib/tools/helpers'

interface ExtractTextFromImageInput {
  image_source: string
  image_type?: 'url' | 'base64' | 'file_path'
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  preserve_formatting?: boolean
  language_hint?: string
  max_tokens?: number
}

interface ExtractTextFromImageOutput {
  extracted_text: string
  image_source: string
  tokens_used?: number
  error?: string
}

/**
 * Extract all visible text from an image using Claude's vision capabilities
 */
export default async function extractTextFromImage(input: ExtractTextFromImageInput, ctx: ToolContext): Promise<ExtractTextFromImageOutput> {
  const {
    image_source,
    image_type = 'url',
    media_type = 'image/jpeg',
    preserve_formatting = true,
    language_hint,
    max_tokens = 2048
  } = input

  try {
    // Initialize Anthropic client
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return {
        extracted_text: '',
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
      const imagePath = ctx.resolvePath(ctx.currentSpace, 'storage', image_source)

      if (!await ctx.fileExists(imagePath)) {
        return {
          extracted_text: '',
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
        extracted_text: '',
        image_source,
        error: `Invalid image_type: ${image_type}`
      }
    }

    // Build prompt for text extraction
    let prompt = 'Extract all visible text from this image.'

    if (preserve_formatting) {
      prompt += ' Preserve the original layout, spacing, and formatting as much as possible.'
    } else {
      prompt += ' Return the text as plain text without special formatting.'
    }

    if (language_hint) {
      prompt += ` The text may be in ${language_hint}.`
    }

    prompt += ' Only return the extracted text, without any additional commentary or description.'

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
    const extractedText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n')

    return {
      extracted_text: extractedText,
      image_source,
      tokens_used: response.usage.input_tokens + response.usage.output_tokens
    }
  } catch (error) {
    return {
      extracted_text: '',
      image_source,
      error: formatError(error)
    }
  }
}
