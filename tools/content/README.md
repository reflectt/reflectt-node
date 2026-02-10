# Content Management Tools

Comprehensive content management tools for creating, scheduling, publishing, analyzing, and archiving content across multiple platforms.

## Available Tools

### 1. create_content
Create new content drafts for social media and publishing platforms.

```typescript
const result = await context.executeTool('create_content', {
  title: 'Our Amazing New Feature',
  body: 'We\'re excited to announce...',
  media_urls: ['https://example.com/feature.jpg'],
  tags: ['innovation', 'feature', 'announcement'],
  platform: 'blog'
})
```

**Platforms:** Twitter, Instagram, Facebook, Blog, Newsletter
**Status:** Draft (ready for scheduling or publishing)
**Media:** Up to 10 files
**Tags:** Up to 30 tags
**Validation:** Title (3-200 chars), Body (10-10000 chars)

---

### 2. schedule_content
Schedule content publication for future date/time.

```typescript
const result = await context.executeTool('schedule_content', {
  content_id: 'content_123456',
  platform: 'twitter',
  scheduled_for: '2025-11-12T14:00:00Z'
})
```

**Max Schedule:** 365 days in advance
**State Transition:** Draft → Scheduled
**Validation:** Future date, content existence
**Tracking:** Retry count, error messages

---

### 3. publish_content
Immediately publish content to platforms (no delay).

```typescript
const result = await context.executeTool('publish_content', {
  content_id: 'content_123456',
  platform: 'instagram'
})

// Returns published post URL
```

**State Transition:** Draft/Scheduled → Published
**URL Generation:** Platform-specific URLs created
**Record:** Published data stored with metrics
**Immediate:** No queue or scheduling

---

### 4. analyze_engagement
Analyze content performance metrics and insights.

```typescript
// Single content analysis
const result = await context.executeTool('analyze_engagement', {
  content_id: 'content_123456'
})

// Date range analysis
const result = await context.executeTool('analyze_engagement', {
  date_range: {
    start_date: '2025-11-01T00:00:00Z',
    end_date: '2025-11-30T23:59:59Z'
  }
})
```

**Metrics:** Total posts, engagement, avg rate, top posts
**Best Time:** Optimal posting time recommendation
**Platform Breakdown:** Engagement per platform
**Default:** 30-day lookback if no date range
**Top Posts:** Top 5 performing content

---

### 5. archive_content
Archive old content for storage and cleanup.

```typescript
// Archive specific content
const result = await context.executeTool('archive_content', {
  content_ids: ['content_123', 'content_456', 'content_789']
})

// Archive by date range
const result = await context.executeTool('archive_content', {
  date_range: {
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-10-31T23:59:59Z'
  }
})
```

**Batch Limit:** Up to 1000 items per archive
**Size Tracking:** Bytes converted to MB
**Archive Location:** S3 path generation
**State:** Archived content marked and accessible
**Manifest:** Archive manifest created for recovery

---

## Content Lifecycle

```
CREATE_CONTENT (Draft)
    ↓
[Edit] → [Publish Now] or [Schedule]
    ↓              ↓
Published    Scheduled (Queue)
    ↓              ↓
[Analytics] ← [Auto-publish at time]
    ↓
[Archive when old]
```

---

## Data Structures

### Content Object
```typescript
{
  id: string
  title: string
  body: string
  media_urls: string[]
  tags: string[]
  platform: 'twitter' | 'instagram' | 'facebook' | 'blog' | 'newsletter'
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  author: string
  word_count: number
  character_count: number
  created_at: string
  updated_at: string
  published_at?: string
  scheduled_for?: string
  platform_post_id?: string
  views: number
  likes: number
  shares: number
}
```

### Scheduled Content Object
```typescript
{
  id: string
  content_id: string
  platform: string
  scheduled_for: string
  status: 'scheduled' | 'published' | 'failed'
  created_at: string
  retry_count: number
  last_error?: string
  published_at?: string
}
```

### Published Content Object
```typescript
{
  id: string
  content_id: string
  platform: string
  url: string
  published_at: string
  views: number
  likes: number
  comments: number
  shares: number
  original_title: string
  original_body: string
}
```

### Engagement Analysis Object
```typescript
{
  total_posts: number
  total_engagement: number
  avg_engagement_rate: number
  top_posts: Array<{
    content_id: string
    title: string
    platform: string
    engagement_score: number
    likes: number
    comments: number
    shares: number
    views: number
  }>
  best_time_to_post: string
  engagement_by_platform: Record<string, number>
  period: string
}
```

---

## Common Workflows

### Draft → Schedule → Analyze
```typescript
// 1. Create draft
const draft = await context.executeTool('create_content', {
  title: 'New Blog Post',
  body: 'Full article content...',
  platform: 'blog'
})

// 2. Schedule for future publication
const scheduled = await context.executeTool('schedule_content', {
  content_id: draft.content_id,
  platform: 'blog',
  scheduled_for: '2025-11-15T10:00:00Z'
})

// 3. After publication, analyze
const analytics = await context.executeTool('analyze_engagement', {
  content_id: draft.content_id
})
```

### Create & Publish Now
```typescript
const draft = await context.executeTool('create_content', {
  title: 'Breaking News',
  body: 'Important announcement!',
  platform: 'twitter'
})

const published = await context.executeTool('publish_content', {
  content_id: draft.content_id,
  platform: 'twitter'
})

console.log('Posted at:', published.platform_url)
```

### Multi-Platform Publishing
```typescript
const draft = await context.executeTool('create_content', {
  title: 'Campaign Announcement',
  body: 'Customizable content...',
  platform: 'twitter' // Primary platform
})

// Publish to multiple platforms
const twitter = await context.executeTool('publish_content', {
  content_id: draft.content_id,
  platform: 'twitter'
})

const facebook = await context.executeTool('publish_content', {
  content_id: draft.content_id,
  platform: 'facebook'
})

const instagram = await context.executeTool('publish_content', {
  content_id: draft.content_id,
  platform: 'instagram'
})
```

### Monthly Content Audit
```typescript
// Analyze past month
const monthlyStats = await context.executeTool('analyze_engagement', {
  date_range: {
    start_date: '2025-10-01T00:00:00Z',
    end_date: '2025-10-31T23:59:59Z'
  }
})

// Archive old content
const archived = await context.executeTool('archive_content', {
  date_range: {
    start_date: '2025-01-01T00:00:00Z',
    end_date: '2025-09-30T23:59:59Z'
  }
})

console.log(`Archived ${archived.archived_count} items`)
```

---

## Platform-Specific Notes

### Twitter
- Character limit: 280 chars
- Optimal: Text + 1-4 images
- Hashtags: Use 1-2 relevant tags

### Instagram
- Character limit: 2200 chars
- Optimal: High-quality images
- Hashtags: Use 20-30 relevant tags

### Facebook
- Character limit: 2200 chars
- Optimal: Images + engaging text
- Hashtags: Use sparingly (1-3)

### Blog
- No character limit
- Supports: Long-form content, multiple images
- Best: Detailed articles, guides
- Format: HTML/Markdown support

### Newsletter
- No character limit
- Optimal: Curated content, links
- Format: HTML/Plain text
- Frequency: Weekly/Monthly recommended

---

## Validation Rules

### Title
- Minimum: 3 characters
- Maximum: 200 characters
- Required: Yes

### Body
- Minimum: 10 characters
- Maximum: 10,000 characters
- Required: Yes

### Media URLs
- Format: Must be HTTP(S) URLs
- Maximum: 10 files per content
- Types: Images, videos, audio

### Tags
- Maximum: 30 tags
- Format: Alphanumeric + hyphens
- Stored as-is for hashtag conversion

### Platform
- Values: twitter, instagram, facebook, blog, newsletter
- Required: Yes
- One per content item

---

## Error Handling

All tools return standard format:

```typescript
{
  success: boolean
  error?: string
  [result fields]
}
```

Common errors:
- "Title must be between 3 and 200 characters"
- "Scheduled time must be in the future"
- "Content with ID [id] not found"
- "Cannot archive more than 1000 items at once"

---

## Performance Tips

1. **Batch Operations:** Archive multiple items together
2. **Schedule Wisely:** Use best_time_to_post recommendations
3. **Content Reuse:** Create once, publish to multiple platforms
4. **Analysis:** Run monthly analysis for insights
5. **Archival:** Archive content older than 6-12 months

---

## Integration with Social Tools

Content Management works seamlessly with Social Media tools:

```typescript
// Create content
const content = await context.executeTool('create_content', {...})

// Post directly to social
const post = await context.executeTool('post_to_social', {
  platform: 'twitter',
  text: content.body,
  media_urls: content.media_urls
})

// Monitor engagement
const analytics = await context.executeTool('get_social_analytics', {
  post_id: post.post_id,
  platform: 'twitter'
})
```

---

## Next Steps

1. **Build tool registry** to enable in agent system
2. **Create dashboard UI** for content management
3. **Add real platform APIs** (currently mock data)
4. **Implement features:**
   - Content templates
   - Bulk operations
   - CSV/JSON import
   - AI content suggestions
   - Sentiment analysis

See `/PHASE_4_TOOLS_SUMMARY.md` for detailed documentation.
