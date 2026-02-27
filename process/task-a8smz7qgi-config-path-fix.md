# Config Path Mismatch Fix — task-1772209309878-a8smz7qgi

## Bug
reflectt-channel plugin reads config from `channels.reflectt.url` but OpenClaw's general plugin docs reference `plugins.entries.<id>.config`. Users following those docs would set `plugins.entries.reflectt-channel.config.url` — which the plugin silently ignored, falling back to localhost default.

## Fix
- `resolveAccount()` now checks both paths: `channels.reflectt` (precedence) → `plugins.entries.reflectt-channel.config` (fallback)
- Startup validates server connectivity and logs actionable error with exact config key names
- README documents both paths with precedence note
- Plugin version bumped 0.2.0 → 0.2.1

## Proof
- tsc --noEmit clean
- Both config locations resolve correctly (channels.reflectt wins when both set)
- Error message shows exact keys to set when server unreachable
