# API Docs Quality Checklist

Use this checklist before merging docs updates tied to endpoint changes.

## Required checks
- [ ] New/changed endpoint is listed with method + path
- [ ] Required request fields are explicit
- [ ] Error cases and status expectations are noted
- [ ] At least one curl example exists
- [ ] Contract gates (doing/validating/done) are updated when relevant
- [ ] Quickstarts/index links updated if new guide added

## Quality bar
- Prefer concrete examples over abstract prose
- Keep snippets copy/paste ready
- Include source of truth path in PR body
- Map done criteria to specific doc sections in handoff comment

## Regression check
Run and compare:
```bash
curl -s http://127.0.0.1:4445/docs
```

Confirm latest guide links and endpoint rows are visible in rendered docs output.
