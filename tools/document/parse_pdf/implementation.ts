import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

type PdfParseModule = typeof import('pdf-parse')
type PdfParseFn = (data: Buffer, options?: Record<string, any>) => Promise<any>
type PdfLibModule = typeof import('pdf-lib')

let pdfParseModulePromise: Promise<PdfParseModule | null> | null = null
let pdfLibModulePromise: Promise<PdfLibModule | null> | null = null

async function loadPdfParseModule(): Promise<PdfParseModule | null> {
  if (!pdfParseModulePromise) {
    pdfParseModulePromise = import('pdf-parse')
      .then((mod) => mod)
      .catch(() => {
        console.warn('pdf-parse not available. Text extraction will be disabled.')
        return null
      })
  }
  return pdfParseModulePromise
}

async function loadPdfLibModule(): Promise<PdfLibModule | null> {
  if (!pdfLibModulePromise) {
    pdfLibModulePromise = import('pdf-lib')
      .then((mod) => mod)
      .catch(() => {
        console.warn('pdf-lib not available. Metadata extraction will be disabled.')
        return null
      })
  }
  return pdfLibModulePromise
}

function resolvePdfParseFn(mod: PdfParseModule): PdfParseFn {
  const candidate = (mod as unknown as { default?: PdfParseFn }).default ?? (mod as unknown as PdfParseFn)
  return candidate as PdfParseFn
}

interface ParsePdfInput {
  pdf_source: string
  source_type?: 'file_path' | 'url'
  extract_options?: {
    text?: boolean
    tables?: boolean
    metadata?: boolean
    images?: boolean
    page_range?: [number, number]
  }
}

interface ParsePdfOutput {
  text?: string
  pages?: Array<{
    page_number: number
    text: string
  }>
  tables?: Array<{
    page: number
    data: Array<Array<string>>
  }>
  metadata?: {
    title?: string
    author?: string
    subject?: string
    creator?: string
    producer?: string
    creation_date?: string
    modification_date?: string
    page_count: number
    pdf_version?: string
  }
  images?: Array<{
    page: number
    data: string
    format: string
  }>
  error?: string
}

/**
 * Download file from URL to buffer
 */
async function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    }).on('error', reject)
  })
}

/**
 * Simple table detection heuristic
 * Looks for aligned text patterns that suggest tabular data
 */
function detectTables(text: string, pageNumber: number): Array<{ page: number; data: Array<Array<string>> }> {
  const lines = text.split('\n').filter(line => line.trim())
  const tables: Array<{ page: number; data: Array<Array<string>> }> = []
  
  let currentTable: Array<Array<string>> = []
  let inTable = false
  
  for (const line of lines) {
    // Detect table rows by looking for multiple spaces or tabs
    const cells = line.split(/\s{2,}|\t/).filter(cell => cell.trim())
    
    if (cells.length >= 2) {
      // Likely a table row
      currentTable.push(cells)
      inTable = true
    } else if (inTable && currentTable.length >= 2) {
      // End of table
      tables.push({
        page: pageNumber,
        data: currentTable
      })
      currentTable = []
      inTable = false
    } else if (inTable) {
      // Single cell, might be continuation or end
      currentTable = []
      inTable = false
    }
  }
  
  // Add last table if exists
  if (currentTable.length >= 2) {
    tables.push({
      page: pageNumber,
      data: currentTable
    })
  }
  
  return tables
}

/**
 * Parse PDF and extract text, metadata, tables, and images
 */
export default async function parsePdf(
  input: ParsePdfInput,
  ctx: ToolContext
): Promise<ParsePdfOutput> {
  const {
    pdf_source,
    source_type = 'file_path',
    extract_options = {}
  } = input

  const {
    text: extractText = true,
    tables: extractTables = false,
    metadata: extractMetadata = true,
    images: extractImages = false,
    page_range
  } = extract_options

  try {
    const [pdfParseModule, pdfLibModule] = await Promise.all([
      loadPdfParseModule(),
      loadPdfLibModule()
    ])

    const pdfParseFn = pdfParseModule ? resolvePdfParseFn(pdfParseModule) : null
    const PDFDocumentCtor = pdfLibModule?.PDFDocument ?? null

    // Check if PDF libraries are available
    if (!pdfParseFn || !PDFDocumentCtor) {
      return {
        error: 'PDF parsing libraries not available. This tool requires pdf-parse and pdf-lib packages, which may have compatibility issues in some Node.js environments. Please install them manually or use an alternative PDF tool.'
      }
    }

    // Get PDF buffer
    let pdfBuffer: Buffer

    if (source_type === 'url') {
      pdfBuffer = await downloadFile(pdf_source)
    } else {
      const pdfPath = path.isAbsolute(pdf_source)
        ? pdf_source
        : ctx.resolvePath(undefined, pdf_source)

      if (!await checkFileExists(pdfPath)) {
        return {
          error: `PDF file not found: ${pdfPath}`
        }
      }

      pdfBuffer = fs.readFileSync(pdfPath)
    }

    const result: ParsePdfOutput = {}

    // Parse with pdf-parse for text extraction
    if (extractText || extractTables) {
      const pdfData = await pdfParseFn(pdfBuffer, {
        pagerender: page_range ? (pageData: any) => {
          const pageNum = pageData.pageIndex + 1
          if (page_range && (pageNum < page_range[0] || pageNum > page_range[1])) {
            return ''
          }
          return pageData.getTextContent().then((textContent: any) => {
            return textContent.items.map((item: any) => item.str).join(' ')
          })
        } : undefined
      })

      if (extractText) {
        result.text = pdfData.text
        
        // Extract per-page text if needed
        if (page_range || extractTables) {
          result.pages = []
          const pageTexts = pdfData.text.split('\f') // Form feed separates pages
          
          pageTexts.forEach((pageText, index) => {
            const pageNum = index + 1
            if (!page_range || (pageNum >= page_range[0] && pageNum <= page_range[1])) {
              result.pages!.push({
                page_number: pageNum,
                text: pageText.trim()
              })
            }
          })
        }
      }

      // Detect tables if requested
      if (extractTables && result.pages) {
        result.tables = []
        for (const page of result.pages) {
          const pageTables = detectTables(page.text, page.page_number)
          result.tables.push(...pageTables)
        }
      }
    }

    // Extract metadata with pdf-lib
    if (extractMetadata || extractImages) {
  const pdfDoc = await PDFDocumentCtor.load(pdfBuffer)
      
      if (extractMetadata) {
        result.metadata = {
          title: pdfDoc.getTitle(),
          author: pdfDoc.getAuthor(),
          subject: pdfDoc.getSubject(),
          creator: pdfDoc.getCreator(),
          producer: pdfDoc.getProducer(),
          creation_date: pdfDoc.getCreationDate()?.toISOString(),
          modification_date: pdfDoc.getModificationDate()?.toISOString(),
          page_count: pdfDoc.getPageCount()
        }
      }

      // Extract images if requested (basic implementation)
      if (extractImages) {
        result.images = []
        const pages = pdfDoc.getPages()
        
        for (let i = 0; i < pages.length; i++) {
          const pageNum = i + 1
          if (page_range && (pageNum < page_range[0] || pageNum > page_range[1])) {
            continue
          }
          
          // Note: Full image extraction requires more complex PDF parsing
          // This is a placeholder for the structure
          // In production, would use pdf.js or similar for full image extraction
        }
      }
    }

    return result
  } catch (error) {
    return {
      error: formatError(error)
    }
  }
}
