# Contributing to reflectt-node

## Merge Flow

All changes to `main` go through pull requests. Direct pushes to `main` are blocked.

### Required steps to merge

1. **Create a feature branch**

   ```bash
   git checkout -b your-branch-name
   ```

2. **Make your changes, commit, and push**

   ```bash
   git add .
   git commit -m "your change description"
   git push origin your-branch-name
   ```

3. **Open a pull request**

   ```bash
   gh pr create --base main --title "Your PR title" --body "Description of changes"
   ```

4. **Wait for CI checks to pass**

   The following checks must pass before merge:
   - `task-linkify-regression-gate` — validates task-linkify behavior, SSOT indicator states, and URL-guard logic

5. **Get a review approval**

   At least one reviewer must approve the PR.

6. **Merge**

   ```bash
   gh pr merge --squash
   ```

### What's enforced

| Rule | Status |
|------|--------|
| PRs required (no direct push to main) | ✅ Enforced |
| `task-linkify-regression-gate` must pass | ✅ Required |
| At least 1 review approval | ✅ Required |
| Admin bypass disabled | ✅ Enforced for all users |
| Branch up-to-date before merge | ✅ Required (strict mode) |

### Running tests locally before pushing

```bash
npm run build
npm run test:task-linkify:regression
npm run test:ssot-indicator:regression
```

If all pass, your PR should clear CI.

### If CI fails

1. Check the GitHub Actions run for the failing job
2. Run the same test locally to reproduce
3. Fix and push — CI re-runs automatically

### Emergency bypass

Admin bypass is disabled. If an emergency requires direct push:
1. Temporarily re-enable admin bypass via GitHub repo settings
2. Make the push
3. Immediately re-disable admin bypass
4. Document the bypass in the PR/commit message

This should be extremely rare and always documented.
