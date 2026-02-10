# Test Tool

## Description

Run tests for a tool by executing it with sample inputs and verifying outputs

## Purpose and Use Cases

- **Primary use**: Run tests for a tool by executing it with sample inputs and verifying outputs
- **Integration**: Works with tools category tools
- **Requirements**: Needs dataDir, globalDir

## Input Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tool_name` | string | The function_name of the tool to test |
| `test_inputs` | object | Sample inputs to pass to the tool |


### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_space` | string | - | Optional target space for space-specific tools |
| `expected_output` | object | - | Optional expected output to validate against |


## Output Format

See implementation for specific output type.

## Example Usage

```typescript
import testTool from './implementation'

const result = await testTool(
  {
    // Add parameters here
  },
  dataDir,
  globalDir
)

console.log(result)
```



## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other tools category tools
