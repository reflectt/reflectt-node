# Fix @mention parsing for hyphenated agent names

**Task:** task-1772218257657-9imacy2qy
**PR:** #462 (merged)
**Fix:** Updated regex from `/@(\w+)/g` to `/@([\w][\w-]*[\w]|[\w]+)/g`

## Test Results
- `@finance-agent` → `finance-agent` ✅
- `@agent-1` → `agent-1` ✅
- `@agent-2` → `agent-2` ✅
- `@link` → `link` ✅
- `@foo-` → `foo` (trailing hyphen stripped) ✅
