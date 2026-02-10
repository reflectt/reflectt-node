# set_layout_sequence

Orchestrate a sequence of layout changes with timing for progressive disclosure UX patterns.

## Purpose

This tool enables AI agents to create timed sequences of layout transitions, perfect for:
- **Guided tours**: Walk users through features step-by-step
- **Progressive disclosure**: Reveal complexity gradually
- **Automated demos**: Showcase functionality without interaction
- **Multi-step workflows**: Guide users through complex processes
- **Presentation mode**: Auto-advance through content sections

## Parameters

### `steps` (required)
Array of layout steps to execute in sequence.

Each step has:
- `mode` (required): Layout mode to use ('standard', 'split', 'fullscreen', etc.)
- `duration` (optional): Time in milliseconds to stay in this layout (default: 3000). Use 0 to stay indefinitely.
- `slots` (optional): Slot configuration (same structure as `set_ui_layout`)
- `transition` (optional): Animation style - 'instant', 'subtle', 'normal', 'dramatic' (default: 'normal')

### `loop` (optional)
Whether to loop back to first step after sequence completes. Default: false.

### `onComplete` (optional)
Message to send to chat when sequence completes (only if loop is false).

## Example Usage

### Onboarding Tour
```typescript
{
  "steps": [
    {
      "mode": "standard",
      "duration": 2000,
      "transition": "subtle"
    },
    {
      "mode": "sidebar-focus",
      "duration": 3000,
      "slots": {
        "sidebar": { "visible": true, "collapsed": false }
      },
      "transition": "normal"
    },
    {
      "mode": "split",
      "duration": 3000,
      "slots": {
        "primary": { "visible": true },
        "secondary": { "visible": true }
      },
      "transition": "normal"
    },
    {
      "mode": "dashboard",
      "duration": 4000,
      "transition": "dramatic"
    }
  ],
  "loop": false,
  "onComplete": "Tour complete! Ready to explore?"
}
```

### Focus Loop
```typescript
{
  "steps": [
    {
      "mode": "standard",
      "duration": 5000
    },
    {
      "mode": "sidebar-focus",
      "duration": 5000
    },
    {
      "mode": "fullscreen",
      "duration": 5000
    }
  ],
  "loop": true
}
```

### Comparison Sequence
```typescript
{
  "steps": [
    {
      "mode": "split",
      "duration": 3000,
      "slots": {
        "primary": { "visible": true },
        "secondary": { "visible": true }
      }
    },
    {
      "mode": "master-detail",
      "duration": 3000
    },
    {
      "mode": "three-column",
      "duration": 3000
    }
  ],
  "loop": false
}
```

## Implementation Notes

The sequence is validated server-side but executed client-side by the PortalExperienceStore. This allows:
- Smooth transitions without network latency between steps
- User interruption (e.g., manually changing layout stops the sequence)
- Accurate timing independent of server response times

The client store will:
1. Receive the validated sequence
2. Execute each step with configured timing
3. Apply transition styles for smooth animations
4. Handle looping if enabled
5. Send onComplete message if specified
