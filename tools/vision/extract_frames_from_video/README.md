# Extract Frames from Video

Extract individual frames from a video file at specified intervals or timestamps.

## Description

Frame extraction tool that saves video frames as image files for separate analysis. Supports multiple extraction methods: by interval, by count, or at specific timestamps. Useful for creating thumbnails, analyzing specific moments, or preparing frames for further processing.

## Usage

```typescript
import extractFramesFromVideo from './implementation'

const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'count',
  frame_count: 10,
  output_format: 'jpg'
}, dataDir, globalDir)

console.log(`Extracted ${result.total_frames} frames to ${result.output_directory}`)
result.frames.forEach(frame => {
  console.log(`Frame ${frame.frame_number} at ${frame.timestamp}s: ${frame.file_name}`)
})
```

## Parameters

- `video_source` (required): Path to the video file
- `extraction_method` (optional): 'interval', 'count', or 'timestamps' (default: 'count')
- `interval_seconds` (optional): Extract every N seconds (for 'interval' method)
- `frame_count` (optional): Total frames to extract (1-100, default: 5, for 'count' method)
- `timestamps` (optional): Array of specific times in seconds (for 'timestamps' method)
- `output_directory` (optional): Where to save frames (default: 'extracted_frames' in dataDir)
- `output_format` (optional): 'jpg' or 'png' (default: 'jpg')
- `quality` (optional): Quality 1-100, higher is better (default: 90)
- `include_base64` (optional): Include base64 data in response (default: false)

## Returns

```typescript
{
  frames: ExtractedFrame[]    // Array of extracted frame info
  total_frames: number        // Number of frames extracted
  video_source: string        // Original video path
  output_directory: string    // Where frames were saved
  video_duration?: number     // Video length in seconds
  error?: string             // Error message if failed
}

interface ExtractedFrame {
  frame_number: number    // Frame index (1-based)
  timestamp: number       // Time in video (seconds)
  file_path: string      // Full path to saved frame
  file_name: string      // Frame filename
  base64_data?: string   // Base64 data if requested
}
```

## Extraction Methods

### Count Method (Evenly Distributed)
Extracts a specific number of frames evenly distributed throughout the video.

```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'count',
  frame_count: 10
})
```

### Interval Method (Time-Based)
Extracts one frame every N seconds.

```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'interval',
  interval_seconds: 5  // Every 5 seconds
})
```

### Timestamps Method (Specific Times)
Extracts frames at exact timestamps.

```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'timestamps',
  timestamps: [10, 30, 60, 120]  // At 10s, 30s, 60s, 120s
})
```

## Examples

### Create Video Thumbnails
```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'count',
  frame_count: 6,
  output_format: 'jpg',
  quality: 85,
  output_directory: '/path/to/thumbnails'
})
```

### High-Quality Frame Extraction
```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'interval',
  interval_seconds: 10,
  output_format: 'png',
  quality: 100
})
```

### Extract with Base64 for Immediate Analysis
```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/video.mp4',
  extraction_method: 'timestamps',
  timestamps: [30, 60],
  include_base64: true
})

// Can immediately analyze frames
for (const frame of result.frames) {
  const analysis = await analyzeImage({
    image_source: frame.base64_data!,
    image_type: 'base64'
  })
  console.log(analysis)
}
```

### Extract Key Moments
```typescript
const result = await extractFramesFromVideo({
  video_source: '/path/to/presentation.mp4',
  extraction_method: 'timestamps',
  timestamps: [0, 300, 600, 900],  // Start, 5min, 10min, 15min
  output_format: 'jpg'
})
```

## Requirements

- **FFmpeg** must be installed on the system
- Valid video file
- Sufficient disk space for extracted frames
- Write permissions to output directory

## Installing FFmpeg

### macOS
```bash
brew install ffmpeg
```

### Ubuntu/Debian
```bash
sudo apt-get install ffmpeg
```

### Windows
Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## Use Cases

- Thumbnail generation
- Video preview creation
- Frame-by-frame analysis
- Quality assurance
- Content moderation
- Creating animated GIFs
- Video indexing
- Preparing data for ML training

## Output Format Comparison

| Format | Pros | Cons |
|--------|------|------|
| **JPG** | Smaller file size, faster processing | Lossy compression |
| **PNG** | Lossless, supports transparency | Larger file size |

## Quality Settings

- **90-100**: Excellent quality, larger files
- **70-89**: Good quality, balanced file size
- **50-69**: Acceptable quality, smaller files
- **1-49**: Poor quality (not recommended)

## Performance Notes

- JPG is ~70% smaller than PNG
- Extraction speed: ~0.5-2 seconds per frame
- Disk space: ~100KB-2MB per frame depending on resolution and format
- Base64 encoding adds ~33% to memory usage

## Error Handling

Returns error message in `error` field if:
- Video file not found
- FFmpeg not installed or not in PATH
- Invalid extraction method configuration
- Insufficient disk space
- Write permission denied
- Invalid video format

## Limitations

- Maximum 100 frames per extraction (configurable)
- Timestamps must be within video duration
- Requires FFmpeg installation
- No built-in video downloading (use file_path only)

## Related Tools

- `analyze_video` - Analyze video content with frame extraction
- `analyze_image` - Analyze extracted frames
