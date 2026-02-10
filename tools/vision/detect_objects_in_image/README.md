# Detect Objects in Image

Detect and identify objects, people, animals, and items in an image.

## Description

Object detection tool that identifies all visible objects in an image with descriptions and relative locations. Returns structured data about detected items with confidence levels.

## Usage

```typescript
import detectObjectsInImage from './implementation'

const result = await detectObjectsInImage({
  image_source: 'https://example.com/room.jpg',
  image_type: 'url',
  include_locations: true
}, dataDir, globalDir)

console.log(`Found ${result.total_count} objects`)
result.objects.forEach(obj => {
  console.log(`${obj.name} - ${obj.description} (${obj.location})`)
})
```

## Parameters

- `image_source` (required): URL, base64 data, or file path to the image
- `image_type` (optional): Type of source - 'url', 'base64', or 'file_path' (default: 'url')
- `media_type` (optional): MIME type - 'image/jpeg', 'image/png', 'image/gif', 'image/webp' (default: 'image/jpeg')
- `object_types` (optional): Array of specific object types to detect (e.g., ['people', 'vehicles'])
- `include_locations` (optional): Include position information (default: true)
- `min_confidence` (optional): Minimum confidence level - 'low', 'medium', 'high' (default: 'medium')
- `max_tokens` (optional): Maximum response length (default: 1024)

## Returns

```typescript
{
  objects: DetectedObject[]  // Array of detected objects
  total_count: number        // Total number of objects found
  image_source: string       // Original image source
  tokens_used?: number       // Total tokens consumed
  error?: string            // Error message if failed
}

interface DetectedObject {
  name: string              // Object name/type
  description: string       // Brief description
  location?: string        // Position in image (e.g., "top-left")
  confidence?: string      // Confidence level
}
```

## Examples

### Detect All Objects
```typescript
const result = await detectObjectsInImage({
  image_source: '/path/to/photo.jpg',
  image_type: 'file_path'
})
```

### Count Specific Objects
```typescript
const result = await detectObjectsInImage({
  image_source: 'https://example.com/parking.jpg',
  image_type: 'url',
  object_types: ['car', 'truck', 'vehicle']
})
console.log(`Found ${result.total_count} vehicles`)
```

### High-Confidence Detection Only
```typescript
const result = await detectObjectsInImage({
  image_source: '/path/to/scene.jpg',
  image_type: 'file_path',
  min_confidence: 'high',
  include_locations: true
})
```

### Detect People
```typescript
const result = await detectObjectsInImage({
  image_source: 'https://example.com/crowd.jpg',
  image_type: 'url',
  object_types: ['person', 'people']
})
```

## Requirements

- `ANTHROPIC_API_KEY` environment variable must be set
- Valid image source
- Supported image formats: JPEG, PNG, GIF, WebP

## Use Cases

- Inventory management
- Security monitoring
- Retail analytics
- Content moderation
- Accessibility (image descriptions)
- Automated tagging
- People counting
- Vehicle detection

## Confidence Levels

- **low**: Includes tentative detections, may have false positives
- **medium**: Balanced accuracy and coverage (recommended)
- **high**: Only very confident detections, may miss some objects

## Location Format

When `include_locations: true`, positions are described as:
- `top-left`, `top-center`, `top-right`
- `middle-left`, `center`, `middle-right`
- `bottom-left`, `bottom-center`, `bottom-right`

## Error Handling

Returns error message in `error` field if:
- API key not configured
- Image file not found
- Invalid image format
- API request fails

## Related Tools

- `analyze_image` - General image analysis
- `extract_text_from_image` - OCR text extraction
