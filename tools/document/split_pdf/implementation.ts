import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface SplitPdfInput {
  pdf_source: string
  split_method: 'pages' | 'bookmarks' | 'size' | 'ranges'
  split_options?: {
    pages_per_file?: number
    max_file_size?: number
    ranges?: Array<[number, number]>
    output_directory?: string
    output_prefix?: string
  }
}

interface SplitPdfOutput {
  output_files: Array<{
    path: string
    page_range: [number, number]
    page_count: number
    file_size: number
  }>
  total_files: number
  total_pages: number
  error?: string
}

/**
 * Calculate page ranges based on split method
 */
function calculatePageRanges(
  totalPages: number,
  method: string,
  options: {
    pages_per_file?: number
    max_file_size?: number
    ranges?: Array<[number, number]>
  }
): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  
  switch (method) {
    case 'pages':
      const pagesPerFile = options.pages_per_file || 10
      for (let i = 0; i < totalPages; i += pagesPerFile) {
        const start = i + 1
        const end = Math.min(i + pagesPerFile, totalPages)
        ranges.push([start, end])
      }
      break
    
    case 'ranges':
      if (options.ranges) {
        ranges.push(...options.ranges)
      }
      break
    
    case 'size':
      // For size-based splitting, we'll approximate based on average page size
      // This is a simplified implementation
      const avgPagesPerMB = 50 // Rough estimate
      const maxSizeMB = options.max_file_size || 10
      const pagesPerChunk = Math.floor(avgPagesPerMB * maxSizeMB)
      
      for (let i = 0; i < totalPages; i += pagesPerChunk) {
        const start = i + 1
        const end = Math.min(i + pagesPerChunk, totalPages)
        ranges.push([start, end])
      }
      break
    
    case 'bookmarks':
      // Simplified: split into individual pages
      // Full implementation would parse PDF bookmarks/outline
      for (let i = 1; i <= totalPages; i++) {
        ranges.push([i, i])
      }
      break
    
    default:
      throw new Error(`Unknown split method: ${method}`)
  }
  
  return ranges
}

/**
 * Split PDF into multiple files
 */
export default async function splitPdf(
  input: SplitPdfInput,
  ctx: ToolContext
): Promise<SplitPdfOutput> {
  const {
    pdf_source,
    split_method,
    split_options = {}
  } = input

  const {
    output_directory,
    output_prefix = 'split'
  } = split_options

  try {
    const pdfPath = path.isAbsolute(pdf_source)
      ? pdf_source
      : ctx.resolvePath(undefined, pdf_source)

    if (!await checkFileExists(pdfPath)) {
      return {
        output_files: [],
        total_files: 0,
        total_pages: 0,
        error: `PDF not found: ${pdfPath}`
      }
    }

    // Load source PDF
    const pdfBuffer = fs.readFileSync(pdfPath)
    const sourcePdf = await PDFDocument.load(pdfBuffer)
    const totalPages = sourcePdf.getPageCount()

    // Calculate page ranges
    const ranges = calculatePageRanges(totalPages, split_method, split_options)

    // Determine output directory
    const outputDir = output_directory
      ? (path.isAbsolute(output_directory)
          ? output_directory
          : ctx.resolvePath('storage', output_directory))
      : path.join(path.dirname(pdfPath), 'split')

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // Split PDF
    const outputFiles: SplitPdfOutput['output_files'] = []

    for (let i = 0; i < ranges.length; i++) {
      const [start, end] = ranges[i]
      
      // Create new PDF for this range
      const newPdf = await PDFDocument.create()
      
      // Copy pages (convert to 0-indexed)
      const pageIndices = Array.from(
        { length: end - start + 1 },
        (_, j) => start - 1 + j
      )
      
      const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices)
      copiedPages.forEach(page => newPdf.addPage(page))
      
      // Save PDF
      const outputFilename = `${output_prefix}_${String(i + 1).padStart(3, '0')}_pages_${start}-${end}.pdf`
      const outputPath = path.join(outputDir, outputFilename)
      
      const pdfBytes = await newPdf.save()
      const pdfBuffer = Buffer.from(pdfBytes)
      
      fs.writeFileSync(outputPath, pdfBuffer)
      
      outputFiles.push({
        path: outputPath,
        page_range: [start, end],
        page_count: end - start + 1,
        file_size: pdfBuffer.length
      })
    }

    return {
      output_files: outputFiles,
      total_files: outputFiles.length,
      total_pages: totalPages
    }
  } catch (error) {
    return {
      output_files: [],
      total_files: 0,
      total_pages: 0,
      error: formatError(error)
    }
  }
}
