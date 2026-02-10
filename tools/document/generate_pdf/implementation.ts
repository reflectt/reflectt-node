import * as fs from 'fs'
import * as path from 'path'
import { marked } from 'marked'
import puppeteer, { type Browser, type PDFOptions, type PaperFormat } from 'puppeteer'
import {
  type ToolContext,
  formatError,
} from '@/lib/tools/helpers'

interface GeneratePdfInput {
  content: string
  content_type: 'markdown' | 'html' | 'text'
  output_path?: string
  options?: {
    title?: string
    author?: string
    subject?: string
    page_size?: 'A4' | 'Letter' | 'Legal'
    margins?: {
      top?: number
      right?: number
      bottom?: number
      left?: number
    }
    header?: string
    footer?: string
    css?: string
    landscape?: boolean
  }
}

interface GeneratePdfOutput {
  pdf_path?: string
  pdf_data?: string
  page_count?: number
  file_size: number
  error?: string
}

/**
 * Convert content to HTML based on type
 */
function contentToHtml(content: string, contentType: 'markdown' | 'html' | 'text'): string {
  switch (contentType) {
    case 'markdown':
      return marked.parse(content) as string
    case 'html':
      return content
    case 'text':
      return `<pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
    default:
      return content
  }
}

/**
 * Get page format configuration
 */
function getPageFormat(pageSize: string = 'A4'): { format: PaperFormat } {
  const formats: Record<string, { format: PaperFormat }> = {
    'A4': { format: 'a4' },
    'Letter': { format: 'letter' },
    'Legal': { format: 'legal' }
  }
  return formats[pageSize] || formats['A4']
}

/**
 * Generate PDF from markdown, HTML, or text
 */
export default async function generatePdf(
  input: GeneratePdfInput,
  ctx: ToolContext
): Promise<GeneratePdfOutput> {
  const {
    content,
    content_type,
    output_path,
    options = {}
  } = input

  const {
    title,
    author,
    subject,
    page_size = 'A4',
    margins = {},
    header,
    footer,
    css,
    landscape = false
  } = options

  const {
    top = 20,
    right = 20,
    bottom = 20,
    left = 20
  } = margins

  let browser: Browser | null = null

  try {
    // Convert content to HTML
    const htmlContent = contentToHtml(content, content_type)

    // Build complete HTML document
    const defaultCss = `
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        font-size: 12pt;
        line-height: 1.6;
        color: #333;
        max-width: 100%;
        margin: 0;
        padding: 0;
      }
      h1, h2, h3, h4, h5, h6 {
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        font-weight: 600;
      }
      h1 { font-size: 2em; }
      h2 { font-size: 1.5em; }
      h3 { font-size: 1.25em; }
      p { margin: 0.5em 0; }
      pre {
        background: #f5f5f5;
        padding: 1em;
        border-radius: 4px;
        overflow-x: auto;
      }
      code {
        background: #f5f5f5;
        padding: 0.2em 0.4em;
        border-radius: 3px;
        font-family: 'Courier New', monospace;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
        text-align: left;
      }
      th {
        background-color: #f5f5f5;
        font-weight: 600;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      blockquote {
        border-left: 4px solid #ddd;
        padding-left: 1em;
        margin-left: 0;
        color: #666;
      }
    `

    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          ${title ? `<title>${title}</title>` : ''}
          <style>
            ${defaultCss}
            ${css || ''}
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `

    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })

    const page = await browser.newPage()
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' })

    // Generate PDF
    const pdfOptions: PDFOptions = {
      ...getPageFormat(page_size),
      landscape,
      margin: {
        top: `${top}mm`,
        right: `${right}mm`,
        bottom: `${bottom}mm`,
        left: `${left}mm`
      },
      printBackground: true,
      preferCSSPageSize: false
    }

    // Add header/footer if provided
    if (header) {
      pdfOptions.headerTemplate = header
      pdfOptions.displayHeaderFooter = true
    }
    if (footer) {
      pdfOptions.footerTemplate = footer
      pdfOptions.displayHeaderFooter = true
    }

    // Determine output path
    let finalPath: string | undefined
    if (output_path) {
      finalPath = path.isAbsolute(output_path)
        ? output_path
        : ctx.resolvePath('storage', output_path)
      
      // Ensure directory exists
      const dir = path.dirname(finalPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      pdfOptions.path = finalPath
    }

    const pdfBuffer = await page.pdf(pdfOptions)

    await browser.close()
    browser = null

    // Get page count (approximate from buffer size)
    // More accurate would require parsing the PDF
    const estimatedPageCount = Math.ceil(pdfBuffer.length / 50000)

    const result: GeneratePdfOutput = {
      file_size: pdfBuffer.length,
      page_count: estimatedPageCount
    }

    if (finalPath) {
      result.pdf_path = finalPath
    } else {
      result.pdf_data = Buffer.from(pdfBuffer).toString('base64')
    }

    return result
  } catch (error) {
    if (browser) {
      await browser.close()
    }
    return {
      file_size: 0,
      error: formatError(error)
    }
  }
}
