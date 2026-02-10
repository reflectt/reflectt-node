# Extract Text from Image (OCR)

Extract all visible text from an image using Claude's vision capabilities.

## Description

Optical Character Recognition (OCR) tool that extracts text from images containing documents, signs, labels, screenshots, or any written content. Can preserve formatting and supports multiple languages.

## Usage

```typescript
import extractTextFromImage from './implementation'

const result = await extractTextFromImage({
  image_source: 'https://example.com/document.jpg',
  image_type: 'url',
  preserve_formatting: true
}, dataDir, globalDir)

console.log(result.extracted_text)
```

## Parameters

- `image_source` (required): URL, base64 data, or file path to the image
- `image_type` (optional): Type of source - 'url', 'base64', or 'file_path' (default: 'url')
- `media_type` (optional): MIME type - 'image/jpeg', 'image/png', 'image/gif', 'image/webp' (default: 'image/jpeg')
- `preserve_formatting` (optional): Keep original text layout (default: true)
- `language_hint` (optional): Language hint for better accuracy (e.g., 'English', 'Spanish')
- `max_tokens` (optional): Maximum response length (default: 2048)

## Returns

```typescript
{
  extracted_text: string    // All extracted text from the image
  image_source: string      // Original image source
  tokens_used?: number      // Total tokens consumed
  error?: string           // Error message if failed
}
```

## Examples

### Extract from Scanned Document
```typescript
const result = await extractTextFromImage({
  image_source: '/path/to/scan.pdf.jpg',
  image_type: 'file_path',
  preserve_formatting: true
})
```

### Plain Text from Screenshot
```typescript
const result = await extractTextFromImage({
  image_source: 'https://example.com/screenshot.png',
  image_type: 'url',
  preserve_formatting: false
})
```

### Multilingual Text
```typescript
const result = await extractTextFromImage({
  image_source: '/path/to/sign.jpg',
  image_type: 'file_path',
  language_hint: 'Spanish and English'
})
```

## Requirements

- `ANTHROPIC_API_KEY` environment variable must be set
- Valid image source with readable text
- Supported image formats: JPEG, PNG, GIF, WebP

## Use Cases

- Digitizing paper documents
- Reading text from photos
- Extracting data from screenshots
- Converting images to searchable text
- Reading signs, labels, and packaging
- Processing forms and receipts

## Tips for Best Results

- Use high-resolution images for better accuracy
- Ensure text is clearly visible and not blurred
- Good lighting improves recognition
- Provide language hints for non-English text
- Set `preserve_formatting: true` for documents with layout

## Error Handling

Returns error message in `error` field if:
- API key not configured
- Image file not found
- Invalid image format
- API request fails

## Related Tools

- `analyze_image` - General image analysis
- `detect_objects_in_image` - Object detection
