import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface ExtractDocumentMetadataInput {
  document_source: string
  document_type?: 'pdf' | 'word' | 'excel' | 'powerpoint'
  extract_options?: {
    include_statistics?: boolean
    include_properties?: boolean
    include_security?: boolean
  }
}

interface DocumentMetadata {
  // Core metadata
  title?: string
  author?: string
  subject?: string
  keywords?: string[]
  creator?: string
  producer?: string
  
  // Dates
  created?: string
  modified?: string
  
  // Document info
  page_count?: number
  word_count?: number
  character_count?: number
  
  // File info
  file_size: number
  file_format: string
  format_version?: string
  
  // Security
  encrypted?: boolean
  permissions?: string[]
  
  // Custom properties
  custom?: Record<string, any>
}

interface ExtractDocumentMetadataOutput {
  metadata: DocumentMetadata
  error?: string
}

/**
 * Detect document type from file extension
 */
function detectDocumentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const typeMap: Record<string, string> = {
    '.pdf': 'pdf',
    '.doc': 'word',
    '.docx': 'word',
    '.xls': 'excel',
    '.xlsx': 'excel',
    '.ppt': 'powerpoint',
    '.pptx': 'powerpoint'
  }
  return typeMap[ext] || 'unknown'
}

/**
 * Extract metadata from PDF
 */
async function extractPdfMetadata(
  filePath: string,
  options: { include_statistics?: boolean; include_security?: boolean }
): Promise<DocumentMetadata> {
  const buffer = fs.readFileSync(filePath)
  const pdfDoc = await PDFDocument.load(buffer)
  
  const metadata: DocumentMetadata = {
    title: pdfDoc.getTitle(),
    author: pdfDoc.getAuthor(),
    subject: pdfDoc.getSubject(),
    creator: pdfDoc.getCreator(),
    producer: pdfDoc.getProducer(),
    created: pdfDoc.getCreationDate()?.toISOString(),
    modified: pdfDoc.getModificationDate()?.toISOString(),
    page_count: pdfDoc.getPageCount(),
    file_size: buffer.length,
    file_format: 'PDF',
    keywords: pdfDoc.getKeywords()?.split(',').map(k => k.trim()).filter(Boolean)
  }
  
  if (options.include_security) {
    metadata.encrypted = pdfDoc.isEncrypted
  }
  
  return metadata
}

/**
 * Extract metadata from Word document
 */
async function extractWordMetadata(
  filePath: string,
  options: { include_statistics?: boolean }
): Promise<DocumentMetadata> {
  const buffer = fs.readFileSync(filePath)
  const stats = fs.statSync(filePath)
  
  // Extract text to count words if statistics requested
  let wordCount: number | undefined
  let characterCount: number | undefined
  
  if (options.include_statistics) {
    try {
      const result = await mammoth.extractRawText({ buffer })
      const text = result.value
      wordCount = text.split(/\s+/).filter(Boolean).length
      characterCount = text.length
    } catch (error) {
      // If extraction fails, continue without statistics
    }
  }
  
  const metadata: DocumentMetadata = {
    file_size: stats.size,
    file_format: 'Word',
    format_version: path.extname(filePath).toLowerCase() === '.docx' ? 'DOCX (Office Open XML)' : 'DOC (Legacy)',
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    word_count: wordCount,
    character_count: characterCount
  }
  
  // Note: Full metadata extraction from .docx requires parsing the XML
  // This is a basic implementation
  
  return metadata
}

/**
 * Extract metadata from Excel document
 */
function extractExcelMetadata(
  filePath: string,
  options: { include_statistics?: boolean }
): DocumentMetadata {
  const workbook = XLSX.readFile(filePath)
  const stats = fs.statSync(filePath)
  
  const sheetCount = workbook.SheetNames.length
  let totalRows = 0
  let totalCells = 0
  
  if (options.include_statistics) {
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName]
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
      const rows = range.e.r - range.s.r + 1
      const cols = range.e.c - range.s.c + 1
      totalRows += rows
      totalCells += rows * cols
    })
  }
  
  const metadata: DocumentMetadata = {
    file_size: stats.size,
    file_format: 'Excel',
    format_version: path.extname(filePath).toLowerCase() === '.xlsx' ? 'XLSX (Office Open XML)' : 'XLS (Legacy)',
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    page_count: sheetCount,
    custom: {
      sheet_count: sheetCount,
      total_rows: totalRows,
      total_cells: totalCells,
      sheet_names: workbook.SheetNames
    }
  }
  
  // Extract built-in properties if available
  if (workbook.Props) {
    metadata.title = workbook.Props.Title
    metadata.author = workbook.Props.Author
    metadata.subject = workbook.Props.Subject
    metadata.creator = (workbook.Props as any).Creator || workbook.Props.Author
    metadata.keywords = workbook.Props.Keywords?.split(',').map(k => k.trim()).filter(Boolean)
  }
  
  return metadata
}

/**
 * Extract metadata from PowerPoint document
 */
function extractPowerpointMetadata(filePath: string): DocumentMetadata {
  const stats = fs.statSync(filePath)
  
  // Basic metadata from file system
  // Full metadata extraction would require parsing the .pptx XML structure
  const metadata: DocumentMetadata = {
    file_size: stats.size,
    file_format: 'PowerPoint',
    format_version: path.extname(filePath).toLowerCase() === '.pptx' ? 'PPTX (Office Open XML)' : 'PPT (Legacy)',
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString()
  }
  
  return metadata
}

/**
 * Extract comprehensive metadata from documents
 */
export default async function extractDocumentMetadata(
  input: ExtractDocumentMetadataInput,
  ctx: ToolContext
): Promise<ExtractDocumentMetadataOutput> {
  const {
    document_source,
    document_type,
    extract_options = {}
  } = input

  const {
    include_statistics = true,
    include_properties = true,
    include_security = false
  } = extract_options

  try {
    const docPath = path.isAbsolute(document_source)
      ? document_source
      : ctx.resolvePath(undefined, document_source)

    if (!await checkFileExists(docPath)) {
      return {
        metadata: { file_size: 0, file_format: 'unknown' },
        error: `Document not found: ${docPath}`
      }
    }

    const detectedType = document_type || detectDocumentType(docPath)
    let metadata: DocumentMetadata

    switch (detectedType) {
      case 'pdf':
        metadata = await extractPdfMetadata(docPath, { include_statistics, include_security })
        break
      
      case 'word':
        metadata = await extractWordMetadata(docPath, { include_statistics })
        break
      
      case 'excel':
        metadata = extractExcelMetadata(docPath, { include_statistics })
        break
      
      case 'powerpoint':
        metadata = extractPowerpointMetadata(docPath)
        break
      
      default:
        return {
          metadata: { file_size: 0, file_format: 'unknown' },
          error: `Unsupported document type: ${detectedType}`
        }
    }

    return { metadata }
  } catch (error) {
    return {
      metadata: { file_size: 0, file_format: 'unknown' },
      error: formatError(error)
    }
  }
}
