# reflectt init — bootstrap team ops directory

## Task
`task-1771262329467-1y3osfyut`

## Summary
Enhanced `reflectt init` to create a complete team ops directory at `~/.reflectt/` with TEAM.md, TEAM-ROLES.yaml, TEAM-STANDARDS.md, .gitignore, config.json, and git initialization. Idempotent, headless-friendly, passes the multi-team test.

## Changes
- `defaults/TEAM.md`: 32 lines — culture template
- `defaults/TEAM-STANDARDS.md`: 32 lines — ops standards
- `defaults/.gitignore`: 23 lines — runtime exclusions
- `src/cli.ts`: 177 additions — enhanced init command

## Tests
93 passing. Route-docs: 118/118.

## PR
https://github.com/reflectt/reflectt-node/pull/124
