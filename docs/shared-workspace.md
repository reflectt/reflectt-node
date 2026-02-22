# Shared Team Workspace

## Overview

The shared team workspace at `/Users/ryan/.openclaw/workspace-shared/` provides a git-backed directory for cross-agent artifacts. Each agent workspace has a `shared` symlink pointing to this directory.

## Setup

The workspace was created with:

```bash
# Create and initialize
mkdir -p /Users/ryan/.openclaw/workspace-shared
cd /Users/ryan/.openclaw/workspace-shared
git init
mkdir -p specs handoffs references templates

# Symlink into each agent workspace
for agent in link echo harmony pixel rhythm sage scout spark; do
  ln -s /Users/ryan/.openclaw/workspace-shared "/Users/ryan/.openclaw/workspace-${agent}/shared"
done
```

## Directory Structure

| Directory    | Purpose                                           |
|-------------|---------------------------------------------------|
| `specs/`     | Design specs, API contracts, architecture docs    |
| `handoffs/`  | Cross-agent handoff documents                     |
| `references/`| Shared reference material (brand, tokens, etc.)   |
| `templates/` | Reusable templates for specs, handoffs, reviews   |

## Usage

From any agent workspace:
```bash
# Read a spec
cat ./shared/specs/dashboard-redesign.md

# Add a new artifact
cp my-spec.md ./shared/specs/
cd ./shared && git add -A && git commit -m "feat: add my-spec (agent-name)"
```

## Conventions

- **Shared = shipped artifacts**, personal = WIP
- Prefix handoffs: `pixel-to-link-settings-ui.md`
- Include agent name in git commits
- See `workspace-shared/README.md` for full conventions
