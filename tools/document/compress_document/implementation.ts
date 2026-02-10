import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface CompressDocumentInput {
  document_source: string
  document_type?: 'pdf'
  output_path?: string
  compression_options?: {
    quality?: 'low' | 'medium' | 'high'
    compress_images?: boolean
    image_quality?: number
    remove_metadata?: boolean
    optimize_fonts?: boolean
  }
}

interface CompressDocumentOutput {
  output_path?: string
  output_data?: string
  compression_info: {
    original_size: number
    compressed_size: number
    reduction_percent: number
    quality_level: string
  }
  error?: string
}

/**
 * Compress PDF document
 */
export default async function compressDocument(
  input: CompressDocumentInput,
  ctx: ToolContext
): Promise<CompressDocumentOutput> {
  const {
    document_source,
    document_type = 'pdf',
    output_path,
    compression_options = {}
  } = input

  const {
    quality = 'medium',
    compress_images = true,
    image_quality = 75,
    remove_metadata = false,
    optimize_fonts = true
  } = compression_options

  if (document_type !== 'pdf') {
    return {
      compression_info: {
        original_size: 0,
        compressed_size: 0,
        reduction_percent: 0,
        quality_level: quality
      },
      error: 'Currently only PDF compression is supported'
    }
  }

  try {
    const docPath = path.isAbsolute(document_source)
      ? document_source
      : ctx.resolvePath(undefined, document_source)

    if (!await checkFileExists(docPath)) {
      return {
        compression_info: {
          original_size: 0,
          compressed_size: 0,
          reduction_percent: 0,
          quality_level: quality
        },
        error: `Document not found: ${docPath}`
      }
    }

    // Read original PDF
    const originalBuffer = fs.readFileSync(docPath)
    const originalSize = originalBuffer.length
    
    // Load PDF
    const pdfDoc = await PDFDocument.load(originalBuffer)

    // Remove metadata if requested
    if (remove_metadata) {
      pdfDoc.setTitle('')
      pdfDoc.setAuthor('')
      pdfDoc.setSubject('')
      pdfDoc.setKeywords([])
      pdfDoc.setProducer('')
      pdfDoc.setCreator('')
    }

    // Note: pdf-lib has limited compression capabilities
    // For production, would use additional libraries like:
    // - sharp for image compression
    // - ghostscript bindings for advanced PDF optimization
    // - pdf2json for more granular control
    
    // Save with compression
    // pdf-lib automatically applies some compression
    const compressedBytes = await pdfDoc.save({
      useObjectStreams: true, // Compress object streams
      addDefaultPage: false,
      objectsPerTick: 50
    })
    
    const compressedBuffer = Buffer.from(compressedBytes)
    const compressedSize = compressedBuffer.length
    
    // Calculate reduction
    const reductionPercent = ((originalSize - compressedSize) / originalSize) * 100

    const result: CompressDocumentOutput = {
      compression_info: {
        original_size: originalSize,
        compressed_size: compressedSize,
        reduction_percent: Math.max(0, reductionPercent),
        quality_level: quality
      }
    }

    // Save or return compressed PDF
    if (output_path) {
      const finalPath = path.isAbsolute(output_path)
        ? output_path
        : ctx.resolvePath('storage', output_path)
      
      const dir = path.dirname(finalPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      fs.writeFileSync(finalPath, compressedBuffer)
      result.output_path = finalPath
    } else {
      result.output_data = compressedBuffer.toString('base64')
    }

    return result
  } catch (error) {
    return {
      compression_info: {
        original_size: 0,
        compressed_size: 0,
        reduction_percent: 0,
        quality_level: quality
      },
      error: formatError(error)
    }
  }
}
