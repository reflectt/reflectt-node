import * as fs from 'fs'
import * as path from 'path'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface ParseOfficeDocumentInput {
  document_source: string
  document_type: 'word' | 'excel' | 'powerpoint'
  extract_options?: {
    preserve_formatting?: boolean
    sheet_names?: string[]
    include_formulas?: boolean
    extract_images?: boolean
  }
}

interface ParseOfficeDocumentOutput {
  content: string | object
  metadata?: {
    title?: string
    author?: string
    created?: string
    modified?: string
    page_count?: number
    sheet_count?: number
  }
  sheets?: Array<{
    name: string
    data: Array<Array<any>>
    row_count: number
    col_count: number
    formulas?: Array<{
      cell: string
      formula: string
    }>
  }>
  images?: Array<{
    data: string
    format: string
  }>
  error?: string
}

/**
 * Parse Word document
 */
async function parseWordDocument(
  filePath: string,
  options: { preserve_formatting?: boolean; extract_images?: boolean }
): Promise<ParseOfficeDocumentOutput> {
  const buffer = fs.readFileSync(filePath)
  const stats = fs.statSync(filePath)
  
  let content: string
  const images: Array<{ data: string; format: string }> = []
  
  if (options.preserve_formatting) {
    // Convert to HTML
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: options.extract_images
          ? mammoth.images.imgElement((image) => {
              return image.read('base64').then((imageBuffer) => {
                const base64 = imageBuffer.toString()
                images.push({
                  data: base64,
                  format: image.contentType || 'image/png'
                })
                return {
                  src: `data:${image.contentType};base64,${base64}`
                }
              })
            })
          : undefined
      }
    )
    content = result.value
  } else {
    // Extract plain text
    const result = await mammoth.extractRawText({ buffer })
    content = result.value
  }
  
  // Count pages (approximate based on character count)
  const pageCount = Math.ceil(content.length / 3000) // ~3000 chars per page
  
  return {
    content,
    metadata: {
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      page_count: pageCount
    },
    images: images.length > 0 ? images : undefined
  }
}

/**
 * Parse Excel document
 */
function parseExcelDocument(
  filePath: string,
  options: { sheet_names?: string[]; include_formulas?: boolean }
): ParseOfficeDocumentOutput {
  const workbook = XLSX.readFile(filePath, {
    cellFormula: options.include_formulas,
    cellStyles: false
  })
  
  const stats = fs.statSync(filePath)
  const sheets: ParseOfficeDocumentOutput['sheets'] = []
  
  // Determine which sheets to process
  const sheetsToProcess = options.sheet_names?.length
    ? workbook.SheetNames.filter(name => options.sheet_names!.includes(name))
    : workbook.SheetNames
  
  for (const sheetName of sheetsToProcess) {
    const sheet = workbook.Sheets[sheetName]
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
    
    // Convert to array of arrays
    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null
    }) as Array<Array<any>>
    
    const sheetInfo: any = {
      name: sheetName,
      data,
      row_count: range.e.r - range.s.r + 1,
      col_count: range.e.c - range.s.c + 1
    }
    
    // Extract formulas if requested
    if (options.include_formulas) {
      const formulas: Array<{ cell: string; formula: string }> = []
      
      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
          const cell = sheet[cellAddress]
          
          if (cell && cell.f) {
            formulas.push({
              cell: cellAddress,
              formula: cell.f
            })
          }
        }
      }
      
      if (formulas.length > 0) {
        sheetInfo.formulas = formulas
      }
    }
    
    sheets.push(sheetInfo)
  }
  
  // Create summary content
  const content = {
    sheet_count: sheets.length,
    sheets: sheets.map(s => ({
      name: s.name,
      rows: s.row_count,
      cols: s.col_count
    }))
  }
  
  return {
    content,
    metadata: {
      sheet_count: workbook.SheetNames.length,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString()
    },
    sheets
  }
}

/**
 * Parse PowerPoint document
 */
async function parsePowerpointDocument(
  filePath: string
): Promise<ParseOfficeDocumentOutput> {
  const stats = fs.statSync(filePath)
  
  // Note: Full PowerPoint parsing requires complex XML parsing
  // This is a basic implementation that extracts file info
  // For production, would use a library like officegen or parse the XML directly
  
  return {
    content: 'PowerPoint parsing not fully implemented. Use extract_document_metadata for basic info.',
    metadata: {
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString()
    },
    error: 'Full PowerPoint text extraction not yet implemented'
  }
}

/**
 * Parse Office documents (Word, Excel, PowerPoint)
 */
export default async function parseOfficeDocument(
  input: ParseOfficeDocumentInput,
  ctx: ToolContext
): Promise<ParseOfficeDocumentOutput> {
  const {
    document_source,
    document_type,
    extract_options = {}
  } = input

  const {
    preserve_formatting = false,
    sheet_names,
    include_formulas = false,
    extract_images = false
  } = extract_options

  try {
    const docPath = path.isAbsolute(document_source)
      ? document_source
      : ctx.resolvePath(undefined, document_source)

    if (!await checkFileExists(docPath)) {
      return {
        content: '',
        error: `Document not found: ${docPath}`
      }
    }

    switch (document_type) {
      case 'word':
        return await parseWordDocument(docPath, { preserve_formatting, extract_images })
      
      case 'excel':
        return parseExcelDocument(docPath, { sheet_names, include_formulas })
      
      case 'powerpoint':
        return await parsePowerpointDocument(docPath)
      
      default:
        return {
          content: '',
          error: `Unsupported document type: ${document_type}`
        }
    }
  } catch (error) {
    return {
      content: '',
      error: formatError(error)
    }
  }
}
