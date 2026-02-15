#!/usr/bin/env bash
# Install git hooks for reflectt-node
# Run once: bash scripts/install-hooks.sh
#
# For the SHARED production repo only — installs:
#   - post-merge: auto-rebuild + restart on git pull
#   - pre-checkout: blocks checkout to non-main branches

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_DIR/.git/hooks"

echo "Installing git hooks for reflectt-node..."

# Install post-merge hook (auto-rebuild)
ln -sf "$REPO_DIR/scripts/post-merge-rebuild.sh" "$HOOKS_DIR/post-merge"
chmod +x "$HOOKS_DIR/post-merge"
echo "  ✓ post-merge hook installed (auto-rebuild on git pull)"

# Install pre-checkout guard (production safety)
# Only install if this is the shared production repo (not agent workspaces)
if echo "$REPO_DIR" | grep -q "workspace/projects/reflectt-node"; then
  ln -sf "$REPO_DIR/scripts/pre-checkout-guard.sh" "$HOOKS_DIR/pre-checkout"
  chmod +x "$HOOKS_DIR/pre-checkout"
  echo "  ✓ pre-checkout hook installed (blocks non-main checkout in shared repo)"
else
  echo "  ⊘ pre-checkout hook skipped (not the shared production repo)"
fi

echo ""
echo "Done."
echo "  Post-merge: auto-rebuild + restart on git pull"
echo "  Pre-checkout: rejects feature branch checkouts in production"
echo "  Rebuild logs: /tmp/reflectt-node-rebuild.log"
