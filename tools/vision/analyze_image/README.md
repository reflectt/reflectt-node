# Analyze Image

Analyze an image using Claude's vision capabilities.

## Description

Provides detailed descriptions of images, identifies objects, text, people, scenes, and can answer specific questions about the image content. Uses Claude 3.5 Sonnet's multimodal vision capabilities.

## Usage

```typescript
import analyzeImage from './implementation'

const result = await analyzeImage({
  image_source: 'https://example.com/product.jpg',
  image_type: 'url',
  prompt: 'Describe this product in detail'
}, dataDir, globalDir)

console.log(result.analysis)
```

## Parameters

- `image_source` (required): URL, base64 data, or file path to the image
- `image_type` (optional): Type of source - 'url', 'base64', or 'file_path' (default: 'url')
- `media_type` (optional): MIME type - 'image/jpeg', 'image/png', 'image/gif', 'image/webp' (default: 'image/jpeg')
- `prompt` (optional): Specific question or instruction about the image
- `max_tokens` (optional): Maximum response length (default: 1024)

## Returns

```typescript
{
  analysis: string          // Detailed analysis of the image
  image_source: string      // Original image source
  tokens_used?: number      // Total tokens consumed
  error?: string           // Error message if failed
}
```

## Examples

### General Image Analysis
```typescript
const result = await analyzeImage({
  image_source: '/path/to/photo.jpg',
  image_type: 'file_path'
})
```

### Specific Question
```typescript
const result = await analyzeImage({
  image_source: 'https://example.com/room.jpg',
  image_type: 'url',
  prompt: 'What furniture is visible in this room?'
})
```

### Product Description
```typescript
const result = await analyzeImage({
  image_source: 'data:image/jpeg;base64,...',
  image_type: 'base64',
  media_type: 'image/jpeg',
  prompt: 'Describe this product including its features and condition'
})
```

## Requirements

- `ANTHROPIC_API_KEY` environment variable must be set
- Valid image source (accessible URL, valid file path, or base64 data)
- Supported image formats: JPEG, PNG, GIF, WebP

## Error Handling

The tool returns an error message in the `error` field if:
- API key is not configured
- Image file not found
- Invalid image type
- API request fails

## Related Tools

- `extract_text_from_image` - Extract text via OCR
- `detect_objects_in_image` - Detect and list objects
