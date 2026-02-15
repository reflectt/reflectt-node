#!/usr/bin/env bash
# Install git hooks for reflectt-node
# Run once: bash scripts/install-hooks.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_DIR/.git/hooks"

echo "Installing git hooks for reflectt-node..."

# Install post-merge hook
ln -sf "$REPO_DIR/scripts/post-merge-rebuild.sh" "$HOOKS_DIR/post-merge"
chmod +x "$HOOKS_DIR/post-merge"
echo "  ✓ post-merge hook installed (auto-rebuild on git pull)"

echo "Done. After git pull, the service will auto-rebuild and restart."
echo "Rebuild logs: /tmp/reflectt-node-rebuild.log"
