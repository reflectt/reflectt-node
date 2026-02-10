# Social Media Tools

Comprehensive social media management tools for posting, scheduling, searching, monitoring, and analyzing content across Twitter, Instagram, and Facebook.

## Available Tools

### 1. post_to_social
Post content immediately or schedule for later publication.

```typescript
const result = await context.executeTool('post_to_social', {
  platform: 'twitter',
  text: 'Check out our latest update! #awesome',
  media_urls: ['https://example.com/image.jpg'],
  schedule_for: '2025-11-10T10:00:00Z' // optional
})
```

**Supports:** Twitter, Instagram, Facebook
**Character Limits:** Twitter (280), Instagram/Facebook (2200)
**Max Media:** 10 files per post

---

### 2. schedule_post
Schedule posts for future publication with queue management.

```typescript
const result = await context.executeTool('schedule_post', {
  platform: 'instagram',
  text: 'Tomorrow's special announcement!',
  media_urls: ['https://example.com/promo.jpg'],
  scheduled_for: '2025-11-11T14:00:00Z'
})
```

**Max Schedule:** 180 days in advance
**Validation:** Checks future date, validates platforms
**Queue:** Tracks position and retry count

---

### 3. get_social_analytics
Get engagement metrics for published posts.

```typescript
const result = await context.executeTool('get_social_analytics', {
  post_id: 'tw_12345',
  platform: 'twitter'
})

// Returns:
// {
//   likes: 245,
//   comments: 18,
//   shares: 12,
//   views: 3450,
//   engagement_rate: 7.5,
//   impressions: 4200,
//   reach: 3570,
//   retweets: 8
// }
```

**Metrics:** Likes, comments, shares, views, impressions, reach
**Platform-Specific:** Retweets (Twitter), Saves (Instagram)

---

### 4. search_social_content
Search across platforms for content by keyword or hashtag.

```typescript
const result = await context.executeTool('search_social_content', {
  platform: 'twitter',
  query: '#innovation OR @company',
  limit: 20
})

// Returns top 20 posts ranked by engagement
```

**Result Limit:** 1-100 (default: 10)
**Ranking:** By engagement (likes + comments + shares)
**Includes:** Author, text, engagement, URL, timestamp

---

### 5. monitor_mentions
Monitor brand mentions across platforms in real-time.

```typescript
const result = await context.executeTool('monitor_mentions', {
  keyword: 'our-brand',
  platforms: ['twitter', 'instagram', 'facebook'],
  since_date: '2025-11-08T00:00:00Z' // optional, default 24h
})

// Returns mentions with sentiment analysis
```

**Sentiment:** Positive, negative, neutral
**Metrics:** Engagement per mention
**Breakdown:** Sentiment count summary
**Date Range:** Custom lookback window

---

## Data Structures

### Post Object
```typescript
{
  id: string
  platform: 'twitter' | 'instagram' | 'facebook'
  text: string
  media_urls: string[]
  status: 'published' | 'scheduled' | 'archived'
  engagement: {
    likes: number
    comments: number
    shares: number
    views: number
  }
  created_at: string
  published_at?: string
  platform_post_id?: string
  url?: string
}
```

### Mention Object
```typescript
{
  id: string
  platform: string
  author: string
  author_handle: string
  text: string
  engagement: {
    likes: number
    comments: number
    shares: number
  }
  sentiment: 'positive' | 'negative' | 'neutral'
  url: string
  created_at: string
}
```

---

## Common Workflows

### Post & Analyze Flow
```typescript
// 1. Post content
const post = await context.executeTool('post_to_social', {
  platform: 'twitter',
  text: 'New product launch! 🚀'
})

// 2. Later, get analytics
const analytics = await context.executeTool('get_social_analytics', {
  post_id: post.post_id,
  platform: 'twitter'
})
```

### Schedule & Monitor Flow
```typescript
// 1. Schedule content
const scheduled = await context.executeTool('schedule_post', {
  platform: 'instagram',
  text: 'Coming soon...',
  scheduled_for: '2025-11-15T10:00:00Z'
})

// 2. Monitor mentions during campaign
const mentions = await context.executeTool('monitor_mentions', {
  keyword: 'campaign-hashtag',
  platforms: ['twitter', 'instagram']
})
```

### Search & Monitor Competitors
```typescript
// Search for competitor content
const results = await context.executeTool('search_social_content', {
  platform: 'twitter',
  query: '@competitor OR #competitor-brand',
  limit: 50
})

// Monitor your own mentions
const myMentions = await context.executeTool('monitor_mentions', {
  keyword: 'our-company',
  platforms: ['twitter', 'instagram', 'facebook']
})
```

---

## Error Handling

All tools return standard success/error format:

```typescript
{
  success: boolean
  error?: string
  [result fields if successful]
}
```

Handle errors gracefully:

```typescript
const result = await context.executeTool('post_to_social', { ... })

if (!result.success) {
  console.error('Failed to post:', result.error)
  // Handle error
} else {
  console.log('Posted:', result.url)
}
```

---

## Rate Limiting

- **Posts:** No specific limit (platform APIs may have limits)
- **Analytics:** Can fetch up to 100 posts per request
- **Search:** Limited to 100 results per query
- **Mentions:** Real-time monitoring with 24-48h lookback

---

## Platform Notes

### Twitter (X)
- Character limit: 280
- Supports: Text, images, videos
- Engagement metrics: Likes, retweets, replies, views

### Instagram
- Character limit: 2200
- Supports: Images, videos, carousels
- Engagement metrics: Likes, comments, shares, saves

### Facebook
- Character limit: 2200
- Supports: Text, images, videos, links
- Engagement metrics: Likes, comments, shares, views

---

## Next Steps

1. **Build tool registry** to enable these tools in the agent system
2. **Create UI components** for posting, scheduling, analytics dashboard
3. **Integrate real platform APIs** (currently using mock data)
4. **Add advanced features** like A/B testing, optimal timing, templates

See `/PHASE_4_TOOLS_SUMMARY.md` for detailed documentation.
