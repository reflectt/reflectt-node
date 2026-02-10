# Vision Tools

AI-powered image and video analysis tools using Claude's vision capabilities.

## Overview

The vision category provides tools for analyzing images and videos, extracting text (OCR), detecting objects, and processing visual content. All image analysis tools leverage Claude 3.5 Sonnet's multimodal vision capabilities.

## Available Tools

### Image Analysis Tools

#### 1. **Analyze Image** (`analyze_image`)
General-purpose image analysis with customizable prompts.

**Use Cases:**
- Product descriptions
- Scene understanding
- Visual question answering
- Content moderation
- Accessibility descriptions

**Example:**
```typescript
const result = await analyzeImage({
  image_source: 'https://example.com/product.jpg',
  prompt: 'Describe this product in detail'
})
```

#### 2. **Extract Text from Image** (`extract_text_from_image`)
OCR (Optical Character Recognition) for extracting text from images.

**Use Cases:**
- Document digitization
- Receipt processing
- Sign reading
- Screenshot text extraction
- Form data extraction

**Example:**
```typescript
const result = await extractTextFromImage({
  image_source: '/path/to/document.jpg',
  preserve_formatting: true
})
```

#### 3. **Detect Objects in Image** (`detect_objects_in_image`)
Identify and locate objects, people, and items in images.

**Use Cases:**
- Inventory counting
- Security monitoring
- Retail analytics
- People counting
- Vehicle detection

**Example:**
```typescript
const result = await detectObjectsInImage({
  image_source: '/path/to/scene.jpg',
  object_types: ['person', 'vehicle'],
  include_locations: true
})
```

### Video Analysis Tools

#### 4. **Analyze Video** (`analyze_video`)
Extract and analyze frames from videos for comprehensive content analysis.

**Use Cases:**
- Video summarization
- Content moderation
- Tutorial indexing
- Security footage analysis
- Meeting transcription

**Example:**
```typescript
const result = await analyzeVideo({
  video_source: '/path/to/video.mp4',
  num_frames: 10,
  analysis_focus: 'summary'
})
```

#### 5. **Extract Frames from Video** (`extract_frames_from_video`)
Extract individual frames from videos as images.

**Use Cases:**
- Thumbnail generation
- Frame-by-frame analysis
- Creating preview grids
- Video indexing
- ML training data

**Example:**
```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'count',
  frame_count: 10
})
```

## Quick Start

### Prerequisites

1. **For Image Analysis:**
   - `ANTHROPIC_API_KEY` environment variable
   - Valid image sources (URLs, files, or base64)

2. **For Video Analysis:**
   - `ANTHROPIC_API_KEY` environment variable
   - **FFmpeg** installed on system
   - Valid video files

### Installing FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt-get install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html)

### Basic Usage

```typescript
// Import tools
import analyzeImage from './vision/analyze_image/implementation'
import extractTextFromImage from './vision/extract_text_from_image/implementation'
import detectObjectsInImage from './vision/detect_objects_in_image/implementation'
import analyzeVideo from './vision/analyze_video/implementation'
import extractFramesFromVideo from './vision/extract_frames_from_video/implementation'

// Analyze an image
const imageAnalysis = await analyzeImage({
  image_source: '/path/to/image.jpg',
  image_type: 'file_path',
  prompt: 'What is in this image?'
}, dataDir, globalDir)

console.log(imageAnalysis.analysis)
```

## Supported Image Formats

- JPEG (`.jpg`, `.jpeg`)
- PNG (`.png`)
- GIF (`.gif`)
- WebP (`.webp`)

## Image Source Types

All image tools support three source types:

1. **URL**: `https://example.com/image.jpg`
2. **File Path**: `/path/to/image.jpg` (absolute or relative)
3. **Base64**: `data:image/jpeg;base64,...` or raw base64 string

## Common Patterns

### Analyze Local Image
```typescript
const result = await analyzeImage({
  image_source: './images/photo.jpg',
  image_type: 'file_path'
}, dataDir, globalDir)
```

### OCR from URL
```typescript
const result = await extractTextFromImage({
  image_source: 'https://example.com/document.png',
  image_type: 'url',
  preserve_formatting: true
}, dataDir, globalDir)
```

### Object Detection with Filters
```typescript
const result = await detectObjectsInImage({
  image_source: '/path/to/scene.jpg',
  image_type: 'file_path',
  object_types: ['person', 'car'],
  min_confidence: 'high'
}, dataDir, globalDir)
```

### Video Analysis Pipeline
```typescript
// Step 1: Extract frames
const frames = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'count',
  frame_count: 5,
  include_base64: true
}, dataDir, globalDir)

// Step 2: Analyze each frame
for (const frame of frames.frames) {
  const analysis = await analyzeImage({
    image_source: frame.base64_data!,
    image_type: 'base64'
  }, dataDir, globalDir)

  console.log(`Frame ${frame.frame_number} at ${frame.timestamp}s:`)
  console.log(analysis.analysis)
}
```

## Performance & Cost

### Token Usage
- Simple image analysis: ~500-1000 tokens
- Detailed analysis: ~1000-2000 tokens
- OCR: ~500-2000 tokens depending on text amount
- Video analysis: (tokens per frame × num_frames) + summary

### Processing Time
- Image analysis: 1-3 seconds
- OCR: 2-4 seconds
- Object detection: 2-5 seconds
- Video frame extraction: 0.5-2 seconds per frame
- Video analysis: (3-5s per frame) + summary

### Best Practices
- Use lower `max_tokens` for simple tasks
- Batch process images when possible
- Use `frame_count` wisely for videos (5-10 usually sufficient)
- Cache results to avoid reprocessing
- Consider using `min_confidence` to reduce false positives

## Error Handling

All tools return errors in the `error` field:

```typescript
const result = await analyzeImage({...}, dataDir, globalDir)

if (result.error) {
  console.error('Error:', result.error)
} else {
  console.log('Success:', result.analysis)
}
```

### Common Errors

- `ANTHROPIC_API_KEY environment variable not set`
- `Image file not found: /path/to/file`
- `FFmpeg error: ... Make sure ffmpeg is installed`
- `Invalid image_type: ...`
- `Video file not found: ...`

## Tool Comparison

| Tool | Input | Output | Use Case |
|------|-------|--------|----------|
| analyze_image | Image | Text description | General analysis, Q&A |
| extract_text_from_image | Image | Extracted text | OCR, documents |
| detect_objects_in_image | Image | Object list | Counting, inventory |
| analyze_video | Video | Frame analyses + summary | Video understanding |
| extract_frames_from_video | Video | Frame images | Thumbnails, preprocessing |

## Advanced Usage

### Batch Image Analysis
```typescript
const images = ['image1.jpg', 'image2.jpg', 'image3.jpg']

const results = await Promise.all(
  images.map(img => analyzeImage({
    image_source: img,
    image_type: 'file_path'
  }, dataDir, globalDir))
)
```

### Multi-Language OCR
```typescript
const result = await extractTextFromImage({
  image_source: '/path/to/multilingual.jpg',
  image_type: 'file_path',
  language_hint: 'English, Spanish, and French'
}, dataDir, globalDir)
```

### Focused Video Analysis
```typescript
// Extract key moments
const keyFrames = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'timestamps',
  timestamps: [0, 60, 120, 180],  // Beginning and every minute
  include_base64: true
}, dataDir, globalDir)

// Analyze each key moment
for (const frame of keyFrames.frames) {
  const objects = await detectObjectsInImage({
    image_source: frame.base64_data!,
    image_type: 'base64',
    object_types: ['person']
  }, dataDir, globalDir)

  console.log(`${frame.timestamp}s: Found ${objects.total_count} people`)
}
```

## Limitations

### Image Tools
- Maximum image size: Limited by API (typically 5MB)
- Token limits apply to responses
- Best results with clear, high-quality images

### Video Tools
- Requires FFmpeg installation
- No direct URL video support (download first)
- Frame extraction limited to 100 frames
- Processing time scales with frame count
- Temporary storage needed for frame files

## Related Documentation

- [Anthropic Vision Documentation](https://docs.anthropic.com/en/docs/vision)
- [Claude Vision Guide](https://docs.anthropic.com/en/docs/vision)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)

## Support

For issues or questions:
1. Check tool-specific README in each subdirectory
2. Verify API key configuration
3. Ensure FFmpeg is installed (for video tools)
4. Review error messages for specific guidance
