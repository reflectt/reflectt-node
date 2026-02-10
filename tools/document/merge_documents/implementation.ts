import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import { marked } from 'marked'
import puppeteer from 'puppeteer'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface MergeDocumentsInput {
  documents: Array<{
    path: string
    type: 'pdf' | 'word' | 'markdown' | 'html' | 'text'
    page_range?: [number, number]
  }>
  output_format: 'pdf'
  output_path?: string
  merge_options?: {
    add_page_breaks?: boolean
    add_table_of_contents?: boolean
    preserve_formatting?: boolean
    add_bookmarks?: boolean
  }
}

interface MergeDocumentsOutput {
  output_path?: string
  output_data?: string
  merge_info: {
    total_documents: number
    total_pages: number
    file_size: number
  }
  error?: string
}

/**
 * Convert non-PDF document to PDF buffer
 */
async function convertToPdfBuffer(
  filePath: string,
  fileType: string,
  ctx: ToolContext
): Promise<Buffer> {
  let content: string
  
  switch (fileType) {
    case 'markdown':
      content = fs.readFileSync(filePath, 'utf-8')
      content = marked.parse(content) as string
      break
    
    case 'html':
      content = fs.readFileSync(filePath, 'utf-8')
      break
    
    case 'text':
      content = fs.readFileSync(filePath, 'utf-8')
      content = `<pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
      break
    
    default:
      throw new Error(`Unsupported file type for conversion: ${fileType}`)
  }
  
  // Convert HTML to PDF using Puppeteer
  const html = `
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
        </style>
      </head>
      <body>${content}</body>
    </html>
  `
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    
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
 * Merge multiple documents into a single PDF
 */
export default async function mergeDocuments(
  input: MergeDocumentsInput,
  ctx: ToolContext
): Promise<MergeDocumentsOutput> {
  const {
    documents,
    output_format,
    output_path,
    merge_options = {}
  } = input

  const {
    add_page_breaks = true,
    add_bookmarks = false
  } = merge_options

  if (output_format !== 'pdf') {
    return {
      merge_info: { total_documents: 0, total_pages: 0, file_size: 0 },
      error: 'Currently only PDF output format is supported'
    }
  }

  try {
    // Create new PDF document
    const mergedPdf = await PDFDocument.create()
    let totalPages = 0
    
    // Process each document
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      const docPath = path.isAbsolute(doc.path)
        ? doc.path
        : ctx.resolvePath(undefined, doc.path)

      if (!await checkFileExists(docPath)) {
        return {
          merge_info: { total_documents: 0, total_pages: 0, file_size: 0 },
          error: `Document not found: ${docPath}`
        }
      }

      let pdfBuffer: Buffer

      if (doc.type === 'pdf') {
        // Read PDF directly
        pdfBuffer = fs.readFileSync(docPath)
      } else {
        // Convert to PDF first
        pdfBuffer = await convertToPdfBuffer(docPath, doc.type, ctx)
      }

      // Load the PDF
      const pdf = await PDFDocument.load(pdfBuffer)
      
      // Determine which pages to copy
      let pagesToCopy: number[]
      if (doc.page_range) {
        const [start, end] = doc.page_range
        pagesToCopy = Array.from(
          { length: end - start + 1 },
          (_, i) => start - 1 + i
        )
      } else {
        pagesToCopy = Array.from({ length: pdf.getPageCount() }, (_, i) => i)
      }

      // Copy pages
      const copiedPages = await mergedPdf.copyPages(pdf, pagesToCopy)
      
      // Add bookmark if requested
      const startPage = mergedPdf.getPageCount()
      
      for (const page of copiedPages) {
        mergedPdf.addPage(page)
        totalPages++
      }

      // Add bookmark (simplified - full implementation would use PDF outline)
      if (add_bookmarks) {
        // Note: pdf-lib doesn't have full bookmark support yet
        // This is a placeholder for the structure
      }

      // Add page break (blank page) between documents if requested
      if (add_page_breaks && i < documents.length - 1) {
        mergedPdf.addPage()
        totalPages++
      }
    }

    // Save or return PDF
    const pdfBytes = await mergedPdf.save()
    const pdfBuffer = Buffer.from(pdfBytes)

    const result: MergeDocumentsOutput = {
      merge_info: {
        total_documents: documents.length,
        total_pages: totalPages,
        file_size: pdfBuffer.length
      }
    }

    if (output_path) {
      const finalPath = path.isAbsolute(output_path)
        ? output_path
        : ctx.resolvePath('storage', output_path)
      
      const dir = path.dirname(finalPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      fs.writeFileSync(finalPath, pdfBuffer)
      result.output_path = finalPath
    } else {
      result.output_data = pdfBuffer.toString('base64')
    }

    return result
  } catch (error) {
    return {
      merge_info: { total_documents: 0, total_pages: 0, file_size: 0 },
      error: formatError(error)
    }
  }
}
