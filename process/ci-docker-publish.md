# CI Docker Publish

**Task:** `task-1772209309830-iy56v8oto`  
**PR:** [#452](https://github.com/reflectt/reflectt-node/pull/452)  
**Branch:** `link/ci-docker-publish`

## Done Criteria → Evidence

| Criteria | Evidence |
|----------|----------|
| GitHub Action builds Docker image on main merges | `.github/workflows/docker-publish.yml` triggers on push to main |
| Pushes to ghcr.io with latest + sha tags | `docker/metadata-action` generates `latest` + `sha-XXXXXXX` tags |
| README includes docker run example with ghcr.io | Will update in PR #451 merge or follow-up |
| Proof: link to GHCR package + run logs | Available after first main merge with this workflow |

## Notes

- Multi-platform: linux/amd64 + linux/arm64
- Uses GHA cache for layer caching (fast rebuilds)
- Only needs default GITHUB_TOKEN (no secrets to configure)
- Depends on PR #451 for the Dockerfile being on main
