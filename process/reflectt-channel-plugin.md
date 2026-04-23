# Reflectt Channel Plugin

**Original task:** `task-1772209309856-0ggpra1so`
**Original PR:** [#453](https://github.com/reflectt/reflectt-node/pull/453)
**Removal task:** `task-1776933463432-i2dmsr477`

## Status

The plugin source no longer lives in this repo. It moved to its own repository:

- **Source of truth:** https://github.com/reflectt/reflectt-channel-openclaw
- **Install:** see that repo's `README.md` / `INSTALL.md`

Managed Fly gateways pull a fresh tarball of `reflectt-channel-openclaw@main` on every cold-start (see `apps/api/src/fly-provisioner.ts` in `reflectt-cloud`). Local installs should clone or download the standalone repo directly — `openclaw plugins install /path/to/reflectt-channel-openclaw`.

## Why the bundled copy was removed

`reflectt-node/plugins/reflectt-channel/` had drifted months behind the standalone repo. Anyone running `openclaw plugins install ./plugins/reflectt-channel` from a fresh clone would silently install stale code while production hosts ran a newer build. Deleting the bundled path makes the install footgun fail loudly (`no such directory`) instead of succeeding with the wrong bytes.
