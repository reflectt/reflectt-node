# TASK-u7edc3c9y — Team Polls UI (design)

PR: https://github.com/reflectt/reflectt-node/pull/510

## What shipped
- `public/polls-mock.html` — interactive HTML mock (creation form, vote, live results bars)
- Spec doc (Pixel): `shared/process/TASK-u7edc3c9y.md`

## How to view
1) Checkout PR branch (or pull from main once merged)
2) Open:

```bash
open public/polls-mock.html
```

## Design intent (implementation guidance)
- Use Reflectt Design Tokens v1 (see `docs/DESIGN-TOKENS.md`)
- Focus-visible uses tokenized ring / shadow
- Hover affordances avoid sticky hover on touch devices

## Notes
This is a design artifact PR (no backend). Implementation should follow in a separate task/PR.
