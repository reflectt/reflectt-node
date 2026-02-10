# Analyze Video

Analyze video content by extracting and analyzing representative frames.

## Description

Video analysis tool that extracts frames at intervals and analyzes them using Claude's vision capabilities. Provides comprehensive summaries of video content, scenes, objects, actions, and visible text.

## Usage

```typescript
import analyzeVideo from './implementation'

const result = await analyzeVideo({
  video_source: '/path/to/video.mp4',
  video_type: 'file_path',
  num_frames: 10,
  analysis_focus: 'summary'
}, dataDir, globalDir)

console.log(result.overall_summary)
result.frame_analyses.forEach(frame => {
  console.log(`${frame.timestamp}: ${frame.analysis}`)
})
```

## Parameters

- `video_source` (required): Path to video file
- `video_type` (optional): 'url' or 'file_path' (default: 'file_path', URL not yet implemented)
- `num_frames` (optional): Number of frames to extract (1-20, default: 5)
- `analysis_focus` (optional): What to analyze - 'general', 'actions', 'objects', 'text', 'people', 'scenes', 'summary' (default: 'general')
- `include_timestamps` (optional): Include timestamps for each frame (default: true)
- `max_tokens` (optional): Maximum response length (default: 2048)

## Returns

```typescript
{
  overall_summary: string      // Comprehensive summary of entire video
  frame_analyses: FrameAnalysis[]  // Analysis of each frame
  total_frames_analyzed: number    // Number of frames processed
  video_source: string             // Original video path
  tokens_used?: number             // Total tokens consumed
  error?: string                   // Error message if failed
}

interface FrameAnalysis {
  frame_number: number    // Frame index (1-based)
  timestamp?: string      // Time in video (MM:SS format)
  analysis: string        // Frame analysis text
}
```

## Analysis Focus Options

- **general**: Basic description of what's in each frame
- **actions**: Focuses on movements and activities
- **objects**: Identifies and describes visible objects
- **text**: Extracts any visible text (OCR)
- **people**: Describes people, their appearance and actions
- **scenes**: Analyzes settings, environments, and scenes
- **summary**: Comprehensive overview of everything

## Examples

### Tutorial Video Analysis
```typescript
const result = await analyzeVideo({
  video_source: '/path/to/tutorial.mp4',
  num_frames: 10,
  analysis_focus: 'summary',
  include_timestamps: true
})
```

### Action Detection
```typescript
const result = await analyzeVideo({
  video_source: '/path/to/security-footage.mp4',
  num_frames: 15,
  analysis_focus: 'actions'
})
```

### Object Detection Throughout Video
```typescript
const result = await analyzeVideo({
  video_source: '/path/to/demo.mp4',
  num_frames: 8,
  analysis_focus: 'objects'
})
```

### Extract Text from Video
```typescript
const result = await analyzeVideo({
  video_source: '/path/to/presentation.mp4',
  num_frames: 20,
  analysis_focus: 'text'
})
```

## Requirements

- `ANTHROPIC_API_KEY` environment variable must be set
- **FFmpeg** must be installed on the system
- Valid video file
- Sufficient disk space for temporary frame files

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

- Content moderation
- Video summarization
- Tutorial indexing
- Security footage analysis
- Product demo review
- Meeting transcription
- Event highlights
- Educational content analysis

## How It Works

1. Extracts `num_frames` evenly distributed throughout the video
2. Analyzes each frame individually using Claude Vision
3. Generates per-frame analysis based on `analysis_focus`
4. Creates an overall summary combining all frame analyses
5. Cleans up temporary frame files

## Performance Notes

- Processing time scales with `num_frames`
- Typical frame analysis: 2-5 seconds per frame
- Total time = (num_frames × 3s) + summary generation
- Token usage increases with more frames and longer analyses

## Error Handling

Returns error message in `error` field if:
- API key not configured
- Video file not found
- FFmpeg not installed
- Invalid video format
- API request fails

## Limitations

- URL video sources not yet implemented (download and use file_path)
- Maximum 20 frames to manage costs and processing time
- Requires FFmpeg installation
- Only analyzes extracted frames, not full video

## Related Tools

- `extract_frames_from_video` - Extract frames only
- `analyze_image` - Analyze single images
