# Reflectt Design Tokens v1

**Source of truth for UI parity across reflectt-node and reflectt-cloud.**

These CSS custom properties are defined in `src/dashboard.ts` (`:root` block) and should be mirrored by any surface that wants to "look like Reflectt."

## How cloud should consume these tokens

1. Copy the `:root { ... }` block from `src/dashboard.ts` into a shared stylesheet (e.g. `tokens.css` or `globals.css`).
2. Reference tokens by name (e.g. `var(--accent)`, `var(--space-4)`).
3. When node updates tokens, cloud pulls the diff.

Long-term: extract tokens into a standalone `tokens.css` file that both surfaces import.

---

## Token Reference

### Color: Backgrounds
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0a0e14` | Page background |
| `--surface` | `#141920` | Card / panel background |
| `--surface-raised` | `#1a2028` | Elevated surface (cards on cards) |

### Color: Borders
| Token | Value | Usage |
|---|---|---|
| `--border` | `#252d38` | Primary borders |
| `--border-subtle` | `#1e2530` | Subtle dividers |

### Color: Text
| Token | Value | Usage |
|---|---|---|
| `--text` | `#d4dae3` | Body text |
| `--text-bright` | `#eef1f5` | Headings, emphasis |
| `--text-muted` | `#6b7a8d` | Secondary / metadata |

### Color: Brand / Accent
| Token | Value | Usage |
|---|---|---|
| `--accent` | `#4da6ff` | Links, primary buttons, focus rings |
| `--accent-dim` | `rgba(77,166,255,0.12)` | Accent backgrounds (tags, badges) |
| `--accent-hover` | `#6ab8ff` | Hover state for accent elements |

### Color: Semantic
| Token | Value | Usage |
|---|---|---|
| `--green` / `--green-dim` | `#3fb950` | Success, online, healthy |
| `--yellow` / `--yellow-dim` | `#d4a017` | Warning, pending |
| `--red` / `--red-dim` | `#f85149` | Error, failure, blocked |
| `--purple` | `#b48eff` | Roles, tags, decorative |
| `--orange` / `--orange-dim` | `#e08a20` | Stale, attention |

### Typography
| Token | Value | Usage |
|---|---|---|
| `--font-family` | Inter, system stack | All body text |
| `--font-mono` | SF Mono, Fira Code, etc | Code, terminal, IDs |
| `--text-xs` | 10px | Fine print, role labels |
| `--text-sm` | 11px | Status text, metadata |
| `--text-base` | 13px | Default body text |
| `--text-md` | 14px | Slightly larger body |
| `--text-lg` | 16px | Panel headers |
| `--text-xl` | 18px | Page headers |
| `--text-2xl` | 22px | Section titles |
| `--text-3xl` | 28px | Hero / marketing |
| `--line-height-tight` | 1.3 | Headings |
| `--line-height-normal` | 1.55 | Body text |
| `--line-height-relaxed` | 1.7 | Long-form prose |
| `--font-weight-normal` | 400 | Body |
| `--font-weight-medium` | 500 | Subtle emphasis |
| `--font-weight-semibold` | 600 | Labels, card titles |
| `--font-weight-bold` | 700 | Headings, logo |

### Spacing (4px base)
| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--space-16` | 64px |

### Radii
| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 4px | Small elements (badges) |
| `--radius` | 8px | Default (buttons, inputs) |
| `--radius-md` | 10px | Panels, cards |
| `--radius-lg` | 14px | Large cards, modals |
| `--radius-full` | 999px | Pills, avatars |

### Shadows
| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.12)` | Subtle depth |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.15)` | Cards, popovers |
| `--shadow-lg` | `0 8px 24px rgba(0,0,0,0.2)` | Modals, dropdowns |
| `--shadow-hover` | `0 4px 12px rgba(0,0,0,0.15)` | Button hover lift |
| `--shadow-active` | `0 2px 6px rgba(0,0,0,0.10)` | Button press |

### Transitions
| Token | Value | Usage |
|---|---|---|
| `--transition-fast` | 150ms | Micro-interactions |
| `--transition-normal` | 250ms | Panel expand/collapse |
| `--transition-slow` | 400ms | Page transitions |
| `--easing-smooth` | `cubic-bezier(0.4,0,0.2,1)` | All animations |

### Interaction (focus / hover)
| Token | Value | Usage |
|---|---|---|
| `--focus-ring` | `2px solid var(--accent)` | Keyboard focus outline |
| `--focus-offset` | 2px | Default outline offset |
| `--focus-offset-strong` | 4px | Relaxed offset (not :active) |
