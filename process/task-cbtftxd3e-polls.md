# task-1772249860746-cbtftxd3e — Team Polls

## Summary
Complete polls system: SQLite backend + dashboard UI with live voting.

## API
- POST /polls — create (question, options, createdBy, expiresInMinutes)
- POST /polls/:id/vote — vote (voter, choice)
- GET /polls/:id — results with tally
- GET /polls — list all
- POST /polls/:id/close — close

## Dashboard
- Polls panel on Chat page
- Create form, vote buttons, result bars, auto-refresh 30s

## PR
https://github.com/reflectt/reflectt-node/pull/511
