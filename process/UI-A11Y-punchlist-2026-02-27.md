# reflectt-node UI/A11y Punchlist (Draft)

**Author:** pixel · **Date:** 2026-02-28 · **Surface:** reflectt-node dashboard  
**Task:** task-1772201860564-kwghp5r05

---

## Format: Issue / Impact / Recommendation / Acceptance Check

### 🔴 P1 — Fix Now

| # | Issue | Impact | Recommendation | Acceptance Check |
|---|-------|--------|----------------|------------------|
| 1 | **Panel rows / table rows not keyboard-reachable** — `.panel-row` and `table tr` have `:hover` and `:focus-visible` styles but no `tabindex="0"` or ARIA roles, so keyboard users can't reach them | Keyboard-only users can't interact with task rows, agent rows, review items | Add `tabindex="0"` and `role="row"` to interactive panel rows/table rows rendered in JS. For clickable rows, add `role="link"` or `role="button"` + `aria-label` | Tab through Tasks/Health/Reviews pages → every interactive row receives focus ring |
| 2 | **Color-only status indicators** — heartbeat dot (`.status-dot`), drift state, convergence state rely solely on color (green/orange/red) | Users with color vision deficiency can't distinguish states | Add text labels alongside dots: `● Online`, `◐ Degraded`, `○ Offline`. Use `--green`/`--yellow`/`--red` tokens. Add `aria-label` to dot elements | Status is comprehensible with grayscale filter applied |
| 3 | **Contrast: `--text-muted` (#6b7a8d) on `--bg` (#0a0e14)** — ratio ~3.5:1, below WCAG AA 4.5:1 for normal text | Timestamps, metadata, secondary text hard to read | Lighten `--text-muted` to `#8b95a5` (≥4.5:1 on `--bg`) or `#7d8999` (4.5:1 minimum) | All `--text-muted` usage passes WCAG AA contrast checker |

### 🟡 P2 — Next Sprint

| # | Issue | Impact | Recommendation | Acceptance Check |
|---|-------|--------|----------------|------------------|
| 4 | **Modal focus trap missing** — task modal (`#task-modal`) doesn't trap focus; Tab escapes into background content | Keyboard/screen-reader users lose context in modals | Add focus-trap on open: capture first/last focusable, loop Tab, restore focus on close. Use `inert` on background when supported | Open modal → Tab cycles within modal only; Escape closes and returns focus to trigger |
| 5 | **`aria-live` regions missing for dynamic content** — kanban columns, chat messages, agent status update without announcing to screen readers | Screen reader users miss real-time updates | Add `aria-live="polite"` to chat message container, agent status area, kanban task counts. Add `aria-live="assertive"` to error/alert banners | VoiceOver/NVDA announces new chat messages and status changes |
| 6 | **Sidebar nav items lack `aria-current="page"`** — active page not communicated to assistive tech | Screen readers don't indicate which page is active | Set `aria-current="page"` on active `.sidebar-link` when hash changes | Screen reader announces "current page" for active nav item |
| 7 | **Emoji-only buttons lack text alternatives** — focus toggle "🎯 Focus" is OK, but sidebar toggle "☰" relies on `aria-label` inconsistently | Some interactive elements not labeled for screen readers | Audit all `<button>` elements: ensure every one has visible text or `aria-label`. Check: dismiss buttons, sidebar toggle, view toggles | `axe-core` reports 0 "button has accessible name" violations |
| 8 | **`poll-input:focus` uses `outline: none`** — removes default outline without providing visible alternative (only border-color change) | Keyboard users may miss focus on poll inputs, especially with low contrast | Replace `outline: none` with `outline: var(--focus-ring); outline-offset: var(--focus-offset)` or add `box-shadow: 0 0 0 3px var(--accent-dim)` equivalent | Poll inputs show visible focus indicator matching design system |
| 9 | **Reduced-motion: kanban drag animations still fire** — `prefers-reduced-motion` kills CSS animations but JS-driven class transitions (kanban reorder) may still animate | Users with vestibular disorders see unexpected motion | Check JS-driven transitions respect `matchMedia('(prefers-reduced-motion: reduce)')`. Disable kanban column transitions + card reorder animations when active | Enable reduced-motion in OS → no visible animations on dashboard |

### 🟢 P3 — Polish

| # | Issue | Impact | Recommendation | Acceptance Check |
|---|-------|--------|----------------|------------------|
| 10 | **Skip-to-content link missing** — no way to bypass sidebar navigation | Keyboard users must tab through all nav items to reach main content | Add hidden skip link: `<a href="#main-content" class="skip-link">Skip to main content</a>` that appears on focus | Tab from page load → "Skip to main content" appears; activating it moves focus to main area |
| 11 | **Heading hierarchy gaps** — some pages may jump from `<h2>` section headers to inline `<strong>` labels without proper heading levels | Screen reader navigation by headings is inconsistent | Audit heading levels per page: ensure no skips (h1 → h2 → h3). Use headings not `<strong>` for section labels in expanded panels | `axe-core` reports 0 heading-order violations |
| 12 | **Artifact viewer pages (server.ts) have no landmark regions** — `<header>` and `<main>` exist but no `<nav>`, no `role="banner"` | Screen reader landmark navigation is limited | Add `role="banner"` to header, ensure `<main>` has `role="main"`. Consider adding breadcrumb nav | Screen reader shows ≥2 landmarks on artifact pages |

---

## Top 3 A11y Fixes to Implement Next (follow-on task suggestions)

### 1. **Interactive row keyboard access** (P1, ~2h)
Add `tabindex="0"` + ARIA roles to panel rows and table rows that have click handlers. Wire `Enter`/`Space` keydown to trigger same action as click. Covers: task cards, review items, agent cards, health cards.

### 2. **Contrast remediation: `--text-muted` token** (P1, ~30min)
Change `--text-muted` from `#6b7a8d` to `#8b95a5`. Verify all downstream usage still looks intentional. Update `ui-kit.html` reference.

### 3. **Modal focus trap** (P2, ~1h)
Implement focus trap for `#task-modal` and any future modals. Use `inert` attribute on `.app-layout` when modal is open. Restore focus to trigger element on close.

---

*This punchlist was generated from a static code audit of `src/dashboard.ts` (1907 lines) and `src/server.ts` artifact viewers. Live testing with `axe-core` and VoiceOver recommended to catch runtime issues.*
