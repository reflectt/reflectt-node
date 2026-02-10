# Web Fetch

## Description

Fetch the content of a web page. Returns the text content of the page. Use this after web_search to get detailed information from specific URLs.

## Purpose and Use Cases

- **Primary use**: Fetch the content of a web page. Returns the text content of the page. Use this after web_search to get detailed information from specific URLs.
- **Integration**: Works with web category tools
- **Requirements**: Needs 

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | The URL to fetch |




## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import webFetch from './implementation'

const result = await webFetch(
  {
    // Add parameters here
  }
)

console.log(result)
```


## Examples


### Example 1: Fetch content from a documentation page

```typescript
const result = await webFetch(
  {
  "url": "https://example.com/docs/api-reference"
}
)

// Expected: Returns the text content of the page
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other web category tools
