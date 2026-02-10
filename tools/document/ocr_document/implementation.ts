import * as fs from 'fs'
import * as path from 'path'
import { createWorker } from 'tesseract.js'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import {
  type ToolContext,
  checkFileExists,
  formatError,
} from '@/lib/tools/helpers'

interface OcrDocumentInput {
  document_source: string
  source_type: 'pdf' | 'image'
  ocr_options?: {
    language?: string
    page_range?: [number, number]
    output_format?: 'text' | 'pdf' | 'hocr'
    deskew?: boolean
    enhance?: boolean
  }
}

interface OcrDocumentOutput {
  text: string
  pages?: Array<{
    page_number: number
    text: string
    confidence: number
    words?: Array<{
      text: string
      confidence: number
      bbox: [number, number, number, number]
    }>
  }>
  searchable_pdf_path?: string
  average_confidence: number
  processing_time: number
  error?: string
}

/**
 * Pre-process image for better OCR
 */
async function preprocessImage(imagePath: string, enhance: boolean): Promise<Buffer> {
  let pipeline = sharp(imagePath)
  
  if (enhance) {
    pipeline = pipeline
      .greyscale()
      .normalize()
      .sharpen()
  }
  
  return await pipeline.toBuffer()
}

/**
 * Perform OCR on a single image
 */
async function ocrImage(
  imagePath: string,
  language: string,
  enhance: boolean
): Promise<{
  text: string
  confidence: number
  words: Array<{ text: string; confidence: number; bbox: [number, number, number, number] }>
}> {
  // Pre-process image if requested
  const imageBuffer = enhance
    ? await preprocessImage(imagePath, true)
    : fs.readFileSync(imagePath)
  
  // Create Tesseract worker
  const worker = await createWorker(language)
  
  try {
    const { data } = await worker.recognize(imageBuffer)

    // Extract words from the nested structure: blocks -> paragraphs -> lines -> words
    const words: Array<{
      text: string
      confidence: number
      bbox: [number, number, number, number]
    }> = []

    if (data.blocks) {
      for (const block of data.blocks) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              words.push({
                text: word.text,
                confidence: word.confidence,
                bbox: [
                  word.bbox.x0,
                  word.bbox.y0,
                  word.bbox.x1,
                  word.bbox.y1
                ]
              })
            }
          }
        }
      }
    }

    return {
      text: data.text,
      confidence: data.confidence,
      words
    }
  } finally {
    await worker.terminate()
  }
}

/**
 * Extract images from PDF pages
 */
async function extractPdfImages(
  pdfPath: string,
  pageRange?: [number, number]
): Promise<Array<{ pageNumber: number; imagePath: string }>> {
  // Note: This is a simplified implementation
  // Full implementation would use pdf.js or similar to extract actual images
  // For now, we'll return a placeholder
  
  const buffer = fs.readFileSync(pdfPath)
  const pdfDoc = await PDFDocument.load(buffer)
  const totalPages = pdfDoc.getPageCount()
  
  const startPage = pageRange ? pageRange[0] : 1
  const endPage = pageRange ? pageRange[1] : totalPages
  
  // In production, would extract actual images from PDF pages
  // This is a placeholder structure
  const images: Array<{ pageNumber: number; imagePath: string }> = []
  
  for (let i = startPage; i <= endPage; i++) {
    // Placeholder - would extract actual page image
    images.push({
      pageNumber: i,
      imagePath: '' // Would be actual extracted image path
    })
  }
  
  return images
}

/**
 * Perform OCR on documents
 */
export default async function ocrDocument(
  input: OcrDocumentInput,
  ctx: ToolContext
): Promise<OcrDocumentOutput> {
  const {
    document_source,
    source_type,
    ocr_options = {}
  } = input

  const {
    language = 'eng',
    page_range,
    output_format = 'text',
    deskew = true,
    enhance = true
  } = ocr_options

  const startTime = Date.now()

  try {
    const docPath = path.isAbsolute(document_source)
      ? document_source
      : ctx.resolvePath(undefined, document_source)

    if (!await checkFileExists(docPath)) {
      return {
        text: '',
        average_confidence: 0,
        processing_time: 0,
        error: `Document not found: ${docPath}`
      }
    }

    let pages: OcrDocumentOutput['pages'] = []
    let allText = ''
    let totalConfidence = 0

    if (source_type === 'image') {
      // OCR single image
      const result = await ocrImage(docPath, language, enhance)
      
      pages = [{
        page_number: 1,
        text: result.text,
        confidence: result.confidence,
        words: result.words
      }]
      
      allText = result.text
      totalConfidence = result.confidence
    } else if (source_type === 'pdf') {
      // Extract images from PDF and OCR each
      // Note: This is a simplified implementation
      // Full implementation would extract actual page images
      
      return {
        text: '',
        average_confidence: 0,
        processing_time: (Date.now() - startTime) / 1000,
        error: 'PDF OCR not fully implemented. Use source_type="image" for image files, or convert PDF pages to images first.'
      }
    }

    const processingTime = (Date.now() - startTime) / 1000
    const averageConfidence = pages.length > 0
      ? totalConfidence / pages.length
      : 0

    return {
      text: allText,
      pages,
      average_confidence: averageConfidence,
      processing_time: processingTime
    }
  } catch (error) {
    return {
      text: '',
      average_confidence: 0,
      processing_time: (Date.now() - startTime) / 1000,
      error: formatError(error)
    }
  }
}
