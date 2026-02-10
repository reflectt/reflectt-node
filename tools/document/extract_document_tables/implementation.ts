import * as fs from 'fs'
import * as path from 'path'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'
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
        console.warn('pdf-parse not available. PDF table extraction will not work.')
        return null
      })
  }
  return pdfParseModulePromise
}

function resolvePdfParseFn(mod: PdfParseModule): PdfParseFn {
  const candidate = (mod as unknown as { default?: PdfParseFn }).default ?? (mod as unknown as PdfParseFn)
  return candidate as PdfParseFn
}

interface ExtractDocumentTablesInput {
  document_source: string
  document_type?: 'pdf' | 'word' | 'excel'
  table_options?: {
    page_range?: [number, number]
    detect_headers?: boolean
    output_format?: 'json' | 'csv' | 'markdown'
    min_rows?: number
    min_cols?: number
  }
}

interface TableData {
  table_id: number
  page?: number
  row_count: number
  col_count: number
  headers?: string[]
  data: Array<Array<any>>
  confidence?: number
}

interface ExtractDocumentTablesOutput {
  tables: TableData[]
  total_tables: number
  output_format: string
  error?: string
}

/**
 * Detect document type from extension
 */
function detectDocumentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  if (['.doc', '.docx'].includes(ext)) return 'word'
  if (['.xls', '.xlsx'].includes(ext)) return 'excel'
  return 'unknown'
}

/**
 * Detect if first row is likely a header
 */
function detectHeaders(data: Array<Array<any>>): { headers?: string[]; dataRows: Array<Array<any>> } {
  if (data.length === 0) {
    return { dataRows: data }
  }
  
  const firstRow = data[0]
  const secondRow = data[1]
  
  if (!secondRow) {
    return { dataRows: data }
  }
  
  // Check if first row looks like headers:
  // - All strings
  // - Different types from second row
  // - No empty cells
  const firstRowAllStrings = firstRow.every(cell => 
    typeof cell === 'string' && cell.trim().length > 0
  )
  
  const hasNumericData = secondRow.some(cell => 
    typeof cell === 'number' || !isNaN(parseFloat(cell))
  )
  
  if (firstRowAllStrings && hasNumericData) {
    return {
      headers: firstRow.map(String),
      dataRows: data.slice(1)
    }
  }
  
  return { dataRows: data }
}

/**
 * Convert table to CSV format
 */
function tableToCSV(table: TableData): string {
  const rows: string[] = []
  
  if (table.headers) {
    rows.push(table.headers.map(h => `"${h}"`).join(','))
  }
  
  for (const row of table.data) {
    rows.push(row.map(cell => `"${cell ?? ''}"`).join(','))
  }
  
  return rows.join('\n')
}

/**
 * Convert table to Markdown format
 */
function tableToMarkdown(table: TableData): string {
  const lines: string[] = []
  
  if (table.headers) {
    lines.push('| ' + table.headers.join(' | ') + ' |')
    lines.push('| ' + table.headers.map(() => '---').join(' | ') + ' |')
  }
  
  for (const row of table.data) {
    lines.push('| ' + row.map(cell => cell ?? '').join(' | ') + ' |')
  }
  
  return lines.join('\n')
}

/**
 * Extract tables from PDF
 */
async function extractPdfTables(
  filePath: string,
  options: { page_range?: [number, number]; min_rows: number; min_cols: number }
): Promise<TableData[]> {
  const pdfModule = await loadPdfParseModule()
  if (!pdfModule) {
    throw new Error('pdf-parse library not available. Cannot extract tables from PDF.')
  }

  const pdfParse = resolvePdfParseFn(pdfModule)
  const buffer = fs.readFileSync(filePath)
  const pdfData = await pdfParse(buffer)
  
  const tables: TableData[] = []
  const pageTexts = pdfData.text.split('\f') // Form feed separates pages
  
  pageTexts.forEach((pageText, index) => {
    const pageNum = index + 1
    
    if (options.page_range && (pageNum < options.page_range[0] || pageNum > options.page_range[1])) {
      return
    }
    
    // Simple table detection: look for aligned text
    const lines = pageText.split('\n').filter(line => line.trim())
    let currentTable: Array<Array<string>> = []
    
    for (const line of lines) {
      // Detect table rows by multiple spaces or tabs
      const cells = line.split(/\s{2,}|\t/).filter(cell => cell.trim())
      
      if (cells.length >= options.min_cols) {
        currentTable.push(cells)
      } else if (currentTable.length >= options.min_rows) {
        // End of table
        tables.push({
          table_id: tables.length + 1,
          page: pageNum,
          row_count: currentTable.length,
          col_count: Math.max(...currentTable.map(row => row.length)),
          data: currentTable,
          confidence: 0.7 // Heuristic confidence
        })
        currentTable = []
      } else {
        currentTable = []
      }
    }
    
    // Add last table if exists
    if (currentTable.length >= options.min_rows) {
      tables.push({
        table_id: tables.length + 1,
        page: pageNum,
        row_count: currentTable.length,
        col_count: Math.max(...currentTable.map(row => row.length)),
        data: currentTable,
        confidence: 0.7
      })
    }
  })
  
  return tables
}

/**
 * Extract tables from Word document
 */
async function extractWordTables(
  filePath: string,
  options: { min_rows: number; min_cols: number }
): Promise<TableData[]> {
  const buffer = fs.readFileSync(filePath)
  
  // Extract HTML to find tables
  const result = await mammoth.convertToHtml({ buffer })
  const html = result.value
  
  // Simple HTML table parsing
  const tables: TableData[] = []
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let match
  
  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[1]
    const rows: Array<Array<string>> = []
    
    // Extract rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch
    
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1]
      const cells: string[] = []
      
      // Extract cells (th or td)
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi
      let cellMatch
      
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const cellText = cellMatch[1].replace(/<[^>]+>/g, '').trim()
        cells.push(cellText)
      }
      
      if (cells.length > 0) {
        rows.push(cells)
      }
    }
    
    if (rows.length >= options.min_rows && rows[0].length >= options.min_cols) {
      tables.push({
        table_id: tables.length + 1,
        row_count: rows.length,
        col_count: Math.max(...rows.map(row => row.length)),
        data: rows,
        confidence: 0.9 // High confidence for actual HTML tables
      })
    }
  }
  
  return tables
}

/**
 * Extract tables from Excel document
 */
function extractExcelTables(
  filePath: string,
  options: { min_rows: number; min_cols: number }
): Promise<TableData[]> {
  const workbook = XLSX.readFile(filePath)
  const tables: TableData[] = []
  
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName]
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
    
    const rowCount = range.e.r - range.s.r + 1
    const colCount = range.e.c - range.s.c + 1
    
    if (rowCount >= options.min_rows && colCount >= options.min_cols) {
      const data = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: null
      }) as Array<Array<any>>
      
      tables.push({
        table_id: tables.length + 1,
        row_count: rowCount,
        col_count: colCount,
        data,
        confidence: 1.0 // Perfect confidence for Excel
      })
    }
  })
  
  return Promise.resolve(tables)
}

/**
 * Extract structured table data from documents
 */
export default async function extractDocumentTables(
  input: ExtractDocumentTablesInput,
  ctx: ToolContext
): Promise<ExtractDocumentTablesOutput> {
  const {
    document_source,
    document_type,
    table_options = {}
  } = input

  const {
    page_range,
    detect_headers = true,
    output_format = 'json',
    min_rows = 2,
    min_cols = 2
  } = table_options

  try {
    const docPath = path.isAbsolute(document_source)
      ? document_source
      : ctx.resolvePath(undefined, document_source)

    if (!await checkFileExists(docPath)) {
      return {
        tables: [],
        total_tables: 0,
        output_format,
        error: `Document not found: ${docPath}`
      }
    }

    const detectedType = document_type || detectDocumentType(docPath)
    let tables: TableData[]

    switch (detectedType) {
      case 'pdf':
        tables = await extractPdfTables(docPath, { page_range, min_rows, min_cols })
        break
      
      case 'word':
        tables = await extractWordTables(docPath, { min_rows, min_cols })
        break
      
      case 'excel':
        tables = await extractExcelTables(docPath, { min_rows, min_cols })
        break
      
      default:
        return {
          tables: [],
          total_tables: 0,
          output_format,
          error: `Unsupported document type: ${detectedType}`
        }
    }

    // Detect headers if requested
    if (detect_headers) {
      tables = tables.map(table => {
        const { headers, dataRows } = detectHeaders(table.data)
        return {
          ...table,
          headers,
          data: dataRows,
          row_count: dataRows.length
        }
      })
    }

    // Convert format if needed
    if (output_format === 'csv') {
      // Store CSV in data field as string
      tables = tables.map(table => ({
        ...table,
        data: [[tableToCSV(table)]] as any
      }))
    } else if (output_format === 'markdown') {
      tables = tables.map(table => ({
        ...table,
        data: [[tableToMarkdown(table)]] as any
      }))
    }

    return {
      tables,
      total_tables: tables.length,
      output_format
    }
  } catch (error) {
    return {
      tables: [],
      total_tables: 0,
      output_format,
      error: formatError(error)
    }
  }
}
