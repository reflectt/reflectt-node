# Shared Team Workspace

## Overview

The shared team workspace at `~/.openclaw/workspace-shared/` provides a git-backed directory for cross-agent artifacts. Each agent workspace has a `shared` symlink pointing to this directory.

### Canonical Path

The **canonical** shared workspace path is:

```
~/.openclaw/workspace-shared
```

This is the default used by `artifact-mirror.ts` when `REFLECTT_SHARED_WORKSPACE` is not set. Override it with:

```bash
export REFLECTT_SHARED_WORKSPACE=/path/to/custom/shared
```

> **Note:** Prior versions defaulted to `../workspace-shared` relative to the project root, which resolved incorrectly when running from nested project directories (e.g., `reflectt-node/`). The canonical `~/.openclaw/workspace-shared` path is always correct regardless of working directory.

## Setup

The workspace was created with:

```bash
# Create and initialize
mkdir -p ~/.openclaw/workspace-shared
cd ~/.openclaw/workspace-shared
git init
mkdir -p specs handoffs references templates

# Symlink into each agent workspace
for agent in link echo harmony pixel rhythm sage scout spark; do
  ln -s ~/.openclaw/workspace-shared ~/.openclaw/workspace-${agent}/shared
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
- See `~/.openclaw/workspace-shared/README.md` for full conventions
