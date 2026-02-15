#!/usr/bin/env bash
# pre-checkout-guard.sh — Prevent checkout of non-main branches in the shared production repo
# Installed as .git/hooks/pre-checkout
#
# The shared repo at ~/.openclaw/workspace/projects/reflectt-node is PRODUCTION ONLY.
# Agents must use their own workspace-{agent}/ directories for feature branch work.
#
# This hook receives three args from git:
#   $1 = ref of previous HEAD
#   $2 = ref of new HEAD
#   $3 = flag (1 = branch checkout, 0 = file checkout)

PREVIOUS_HEAD="$1"
NEW_HEAD="$2"
IS_BRANCH_CHECKOUT="$3"

# Only guard branch checkouts (not file checkouts like git checkout -- file)
if [ "$IS_BRANCH_CHECKOUT" != "1" ]; then
  exit 0
fi

# Get the branch name being checked out
TARGET_BRANCH=$(git rev-parse --abbrev-ref "$NEW_HEAD" 2>/dev/null || echo "")

# Allow main and HEAD (detached state during rebase/merge internals)
if [ "$TARGET_BRANCH" = "main" ] || [ "$TARGET_BRANCH" = "HEAD" ]; then
  exit 0
fi

# Block everything else
echo ""
echo "🚫 BLOCKED: Cannot checkout '$TARGET_BRANCH' in the shared production repo."
echo ""
echo "   This repo is PRODUCTION ONLY — it must stay on 'main'."
echo "   Feature branch work must happen in your own workspace:"
echo ""
echo "     cd ~/.openclaw/workspace-{your-agent}/reflectt-node"
echo "     git checkout $TARGET_BRANCH"
echo ""
echo "   If you need to deploy, just: git pull origin main"
echo ""

exit 1
