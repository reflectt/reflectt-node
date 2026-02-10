import * as fs from 'fs'
import * as path from 'path'
import * as mammoth from 'mammoth'
import { marked } from 'marked'
import puppeteer from 'puppeteer'
import TurndownService from 'turndown'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

type PdfParseModule = typeof import('pdf-parse')
type PdfParseFn = (data: Buffer, options?: Record<string, any>) => Promise<any>

let pdfParseModulePromise: Promise<PdfParseModule | null> | null = null

async function loadPdfParseModule(): Promise<PdfParseModule | null> {
  if (!pdfParseModulePromise) {
    pdfParseModulePromise = import('pdf-parse')
      .then((mod) => mod)
      .catch(() => {
        console.warn('pdf-parse not available. PDF conversion will not work.')
        return null
      })
  }
  return pdfParseModulePromise
}

function resolvePdfParseFn(mod: PdfParseModule): PdfParseFn {
  const candidate = (mod as unknown as { default?: PdfParseFn }).default ?? (mod as unknown as PdfParseFn)
  return candidate as PdfParseFn
}

interface ConvertDocumentInput {
  input_path: string
  input_format: 'pdf' | 'word' | 'markdown' | 'html' | 'text'
  output_format: 'pdf' | 'markdown' | 'html' | 'text'
  output_path?: string
  conversion_options?: {
    preserve_formatting?: boolean
    extract_images?: boolean
    quality?: 'low' | 'medium' | 'high'
  }
}

interface ConvertDocumentOutput {
  output_path?: string
  output_data?: string
  conversion_info: {
    input_format: string
    output_format: string
    file_size: number
    page_count?: number
  }
  warnings?: string[]
  error?: string
}

/**
 * Convert PDF to text/markdown/html
 */
async function convertFromPdf(
  filePath: string,
  outputFormat: string,
  _preserveFormatting: boolean
): Promise<{ content: string; pageCount: number }> {
  const pdfModule = await loadPdfParseModule()
  if (!pdfModule) {
    throw new Error('pdf-parse library not available. Cannot convert from PDF.')
  }

  const pdfParse = resolvePdfParseFn(pdfModule)
  const buffer = fs.readFileSync(filePath)
  const pdfData = await pdfParse(buffer)
  
  let content = pdfData.text
  
  if (outputFormat === 'markdown') {
    // Basic text to markdown conversion
    content = content
      .split('\n\n')
      .map(para => para.trim())
      .filter(Boolean)
      .join('\n\n')
  } else if (outputFormat === 'html') {
    // Convert to HTML paragraphs
    content = content
      .split('\n\n')
      .map(para => `<p>${para.trim()}</p>`)
      .join('\n')
  }
  
  return {
    content,
    pageCount: pdfData.numpages
  }
}

/**
 * Convert Word to text/markdown/html
 */
async function convertFromWord(
  filePath: string,
  outputFormat: string,
  preserveFormatting: boolean
): Promise<{ content: string }> {
  const buffer = fs.readFileSync(filePath)
  
  if (outputFormat === 'html' && preserveFormatting) {
    const result = await mammoth.convertToHtml({ buffer })
    return { content: result.value }
  } else if (outputFormat === 'markdown') {
    // Convert to HTML first, then to markdown
    const htmlResult = await mammoth.convertToHtml({ buffer })
    const turndownService = new TurndownService()
    const markdown = turndownService.turndown(htmlResult.value)
    return { content: markdown }
  } else {
    const result = await mammoth.extractRawText({ buffer })
    return { content: result.value }
  }
}

/**
 * Convert markdown/html/text to PDF
 */
async function convertToPdf(
  content: string,
  inputFormat: string
): Promise<Buffer> {
  let html: string
  
  if (inputFormat === 'markdown') {
    html = marked.parse(content) as string
  } else if (inputFormat === 'html') {
    html = content
  } else {
    html = `<pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
  }
  
  const fullHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #333;
            padding: 20px;
          }
          pre { background: #f5f5f5; padding: 1em; border-radius: 4px; }
          table { border-collapse: collapse; width: 100%; margin: 1em 0; }
          th, td { border: 1px solid #ddd; padding: 8px; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  
  try {
    const page = await browser.newPage()
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' })
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true
    })

    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}

/**
 * Convert between document formats
 */
export default async function convertDocument(
  input: ConvertDocumentInput,
  ctx: ToolContext
): Promise<ConvertDocumentOutput> {
  const {
    input_path,
    input_format,
    output_format,
    output_path,
    conversion_options = {}
  } = input

  const { preserve_formatting = true } = conversion_options

  const warnings: string[] = []

  try {
    const inputFilePath = path.isAbsolute(input_path)
      ? input_path
      : ctx.resolvePath(undefined, input_path)

    if (!await checkFileExists(inputFilePath)) {
      return {
        conversion_info: {
          input_format,
          output_format,
          file_size: 0
        },
        error: `Input file not found: ${inputFilePath}`
      }
    }

    let outputContent: string | Buffer
    let pageCount: number | undefined

    // Conversion logic
    if (input_format === output_format) {
      // No conversion needed, just copy
      outputContent = fs.readFileSync(inputFilePath)
      warnings.push('Input and output formats are the same, file copied without conversion')
    } else if (output_format === 'pdf') {
      // Convert to PDF

      if (input_format === 'pdf') {
        outputContent = fs.readFileSync(inputFilePath)
      } else if (input_format === 'word') {
        const result = await convertFromWord(inputFilePath, 'html', preserve_formatting)
        outputContent = await convertToPdf(result.content, 'html')
      } else {
        const content = fs.readFileSync(inputFilePath, 'utf-8')
        outputContent = await convertToPdf(content, input_format)
      }
    } else {
      // Convert from PDF or Word to text/markdown/html
      if (input_format === 'pdf') {
        const result = await convertFromPdf(inputFilePath, output_format, preserve_formatting)
        outputContent = result.content
        pageCount = result.pageCount
      } else if (input_format === 'word') {
        const result = await convertFromWord(inputFilePath, output_format, preserve_formatting)
        outputContent = result.content
      } else {
    // Text format conversions
    const content = fs.readFileSync(inputFilePath, 'utf-8')
        
        if (input_format === 'markdown' && output_format === 'html') {
          outputContent = marked.parse(content) as string
        } else if (input_format === 'html' && output_format === 'markdown') {
          const turndownService = new TurndownService()
          outputContent = turndownService.turndown(content)
        } else {
          outputContent = content
        }
      }
    }

    // Determine file size
    const fileSize = Buffer.isBuffer(outputContent)
      ? outputContent.length
      : Buffer.byteLength(outputContent, 'utf-8')

    const result: ConvertDocumentOutput = {
      conversion_info: {
        input_format,
        output_format,
        file_size: fileSize,
        page_count: pageCount
      },
      warnings: warnings.length > 0 ? warnings : undefined
    }

    // Save or return output
    if (output_path) {
      const finalPath = path.isAbsolute(output_path)
        ? output_path
        : ctx.resolvePath('storage', output_path)
      
      const dir = path.dirname(finalPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      if (Buffer.isBuffer(outputContent)) {
        fs.writeFileSync(finalPath, outputContent)
      } else {
        fs.writeFileSync(finalPath, outputContent, 'utf-8')
      }
      
      result.output_path = finalPath
    } else {
      if (Buffer.isBuffer(outputContent)) {
        result.output_data = outputContent.toString('base64')
      } else {
        result.output_data = outputContent
      }
    }

    return result
  } catch (error) {
    return {
      conversion_info: {
        input_format,
        output_format,
        file_size: 0
      },
      warnings: warnings.length > 0 ? warnings : undefined,
      error: formatError(error)
    }
  }
}
