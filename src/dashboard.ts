// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Dashboard HTML — self-contained page served at /dashboard
 * v2: Pixel's redesign + chat input for Ryan
 */

export function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>reflectt-node dashboard</title>
<style>
  /* ============================================================
     REFLECTT DESIGN SYSTEM TOKENS v1
     Source of truth for node + cloud UI parity.
     Cloud should import/mirror these variables.
     ============================================================ */
  :root {
    /* --- Color: Backgrounds --- */
    --bg: #0a0e14;
    --surface: #141920;
    --surface-raised: #1a2028;

    /* --- Color: Borders --- */
    --border: #252d38;
    --border-subtle: #1e2530;

    /* --- Color: Text --- */
    --text: #d4dae3;
    --text-bright: #eef1f5;
    --text-muted: #6b7a8d;

    /* --- Color: Brand / Accent --- */
    --accent: #4da6ff;
    --accent-dim: rgba(77, 166, 255, 0.12);
    --accent-hover: #6ab8ff;

    /* --- Color: Semantic --- */
    --green: #3fb950;
    --green-dim: rgba(63, 185, 80, 0.12);
    --yellow: #d4a017;
    --yellow-dim: rgba(212, 160, 23, 0.12);
    --red: #f85149;
    --red-dim: rgba(248, 81, 73, 0.12);
    --purple: #b48eff;
    --orange: #e08a20;
    --orange-dim: rgba(224, 138, 32, 0.12);

    /* --- Typography: Scale (modular, base 14px) --- */
    --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
    --text-xs: 10px;
    --text-sm: 11px;
    --text-base: 13px;
    --text-md: 14px;
    --text-lg: 16px;
    --text-xl: 18px;
    --text-2xl: 22px;
    --text-3xl: 28px;
    --line-height-tight: 1.3;
    --line-height-normal: 1.55;
    --line-height-relaxed: 1.7;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --font-weight-bold: 700;
    --letter-spacing-tight: -0.3px;
    --letter-spacing-normal: 0;
    --letter-spacing-wide: 0.5px;

    /* --- Spacing: Scale (4px base) --- */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;
    --space-8: 32px;
    --space-10: 40px;
    --space-12: 48px;
    --space-16: 64px;

    /* --- Radii --- */
    --radius-sm: 4px;
    --radius: 8px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-full: 999px;

    /* --- Shadows --- */
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.15);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.2);
    --shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.15);
    --shadow-active: 0 2px 6px rgba(0, 0, 0, 0.10);

    /* --- Transitions --- */
    --transition-fast: 150ms;
    --transition-normal: 250ms;
    --transition-slow: 400ms;
    --easing-smooth: cubic-bezier(0.4, 0, 0.2, 1);

    /* --- Interaction (focus / hover) --- */
    --focus-ring: 2px solid var(--accent);
    --focus-offset: 2px;
    --focus-offset-strong: 4px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  /* ============================================================
     CANONICAL BUTTON PRIMITIVES
     ============================================================ */
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 14px; border-radius: var(--radius-sm);
    font-size: var(--text-base); font-weight: var(--font-weight-semibold);
    font-family: inherit; cursor: pointer;
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
    transition: all var(--transition-fast) var(--easing-smooth);
    text-decoration: none; line-height: 1.4; min-height: 32px;
  }
  .btn:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
  .btn:disabled, .btn[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  @media (hover: hover) and (pointer: fine) {
    .btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  }
  .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  @media (hover: hover) and (pointer: fine) {
    .btn-primary:hover:not(:disabled) { opacity: 0.85; border-color: var(--accent); color: #fff; }
  }
  .btn-danger { background: var(--red-dim); color: var(--red); border-color: var(--red); }
  @media (hover: hover) and (pointer: fine) {
    .btn-danger:hover:not(:disabled) { background: var(--red); color: #fff; border-color: var(--red); }
  }
  .btn-ghost { background: transparent; border-color: transparent; color: var(--text-muted); padding: 4px 8px; }
  @media (hover: hover) and (pointer: fine) {
    .btn-ghost:hover:not(:disabled) { background: var(--accent-dim); color: var(--accent); border-color: transparent; }
  }
  .btn.active, .btn[aria-pressed="true"] { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }

  .link {
    color: var(--accent); text-decoration: none; font-weight: var(--font-weight-semibold);
    transition: color var(--transition-fast) var(--easing-smooth);
  }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); border-radius: 3px; }

  body {
    font-family: var(--font-family);
    background: var(--bg);
    color: var(--text);
    line-height: var(--line-height-normal);
    font-size: var(--text-md);
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-4) var(--space-8);
    background: linear-gradient(180deg, #0f141a 0%, var(--bg) 100%);
    border-bottom: 1px solid var(--border-subtle);
    min-height: 56px;
  }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .header-logo { font-size: var(--text-xl); font-weight: var(--font-weight-bold); color: var(--text-bright); letter-spacing: var(--letter-spacing-tight); white-space: nowrap; }
  .header-logo span { color: var(--accent); }
  .header-right { display: flex; align-items: center; gap: var(--space-3); font-size: var(--text-base); color: var(--text-muted); flex-wrap: wrap; }

  /* ============================================================
     SIDEBAR NAV
     Hash-based client-side routing. Sidebar + page containers.
     ============================================================ */
  .app-layout { display: flex; min-height: calc(100vh - 56px); }
  .sidebar {
    width: 200px; flex-shrink: 0; background: var(--surface);
    border-right: 1px solid var(--border); padding: var(--space-4) 0;
    position: sticky; top: 0; height: calc(100vh - 56px); overflow-y: auto;
    display: flex; flex-direction: column;
  }
  .sidebar-nav { display: flex; flex-direction: column; gap: 2px; padding: 0 var(--space-2); flex: 1; }
  .sidebar-link {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
    font-size: var(--text-base); font-weight: var(--font-weight-medium);
    color: var(--text-muted); text-decoration: none; cursor: pointer;
    border: none; background: transparent; font-family: inherit; width: 100%;
    transition: all var(--transition-fast) var(--easing-smooth);
    min-height: 36px;
  }
  .sidebar-link:focus-visible {
    outline: var(--focus-ring); outline-offset: -2px;
  }
  .sidebar-link .nav-icon { font-size: 16px; width: 22px; text-align: center; flex-shrink: 0; }
  .sidebar-link .nav-label { flex: 1; text-align: left; }
  .sidebar-link .nav-badge {
    font-size: 10px; font-weight: 700; min-width: 18px; text-align: center;
    padding: 1px 5px; border-radius: 999px;
    background: var(--border); color: var(--text-muted);
  }
  @media (hover: hover) and (pointer: fine) {
    .sidebar-link:hover { background: var(--surface-raised); color: var(--text); }
  }
  .sidebar-link.active {
    background: var(--accent-dim); color: var(--accent); font-weight: var(--font-weight-semibold);
  }
  .sidebar-link.active .nav-badge {
    background: var(--accent-dim); color: var(--accent);
  }
  .sidebar-divider { height: 1px; background: var(--border); margin: var(--space-2) var(--space-3); }
  .sidebar-section {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--text-muted); font-weight: var(--font-weight-semibold);
    padding: var(--space-3) var(--space-3) var(--space-1);
  }

  /* Page containers: show/hide based on route */
  .page { display: none; }
  .page.active { display: block; }

  /* Mobile: collapse sidebar */
  .sidebar-toggle {
    display: none; position: fixed; top: var(--space-2); left: var(--space-2);
    z-index: 60; width: 36px; height: 36px; border-radius: var(--radius-sm);
    border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
    font-size: 18px; cursor: pointer; align-items: center; justify-content: center;
  }
  .sidebar-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,0.5); z-index: 45;
  }
  @media (max-width: 767px) {
    .sidebar-toggle { display: flex; }
    .sidebar {
      position: fixed; top: 0; left: 0; z-index: 50; height: 100vh;
      transform: translateX(-100%); transition: transform var(--transition-normal) var(--easing-smooth);
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar-overlay.open { display: block; }
    .app-layout { flex-direction: column; }
  }

  .release-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    padding: 4px 8px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--surface-raised);
  }
  .release-badge.stale {
    border-color: var(--orange);
    background: var(--orange-dim);
    color: #f4c27a;
  }
  .release-badge.fresh {
    border-color: var(--green);
    background: var(--green-dim);
    color: #9de6a8;
  }
  .status-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--green); margin-right: 5px; vertical-align: middle;
    box-shadow: 0 0 6px rgba(63, 185, 80, 0.4);
  }
  .agent-strip {
    display: flex; gap: var(--space-3); padding: var(--space-4) var(--space-8); overflow-x: auto;
    border-bottom: 1px solid var(--border-subtle); background: var(--surface);
  }
  .agent-card {
    flex: 0 0 auto; display: flex; align-items: center; gap: var(--space-3);
    padding: var(--space-3) var(--space-4); background: var(--surface-raised); border: 1px solid var(--border);
    border-radius: var(--radius-md); min-width: 200px; transition: border-color var(--transition-fast) var(--easing-smooth);
  }
  .agent-card.active { border-left: 3px solid var(--green); }
  .agent-card.idle { opacity: 0.6; }
  .agent-card.offline { opacity: 0.35; }
  .agent-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .agent-emoji { font-size: var(--text-2xl); line-height: 1; }
  .agent-info { flex: 1; min-width: 0; }
  .agent-name { font-size: var(--text-base); font-weight: var(--font-weight-semibold); color: var(--text-bright); }
  .agent-role { font-size: var(--text-xs); color: var(--purple); text-transform: uppercase; letter-spacing: var(--letter-spacing-wide); margin-bottom: var(--space-1); }
  .agent-status-text { font-size: var(--text-sm); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agent-pr-link {
    display: inline-flex;
    margin-top: 3px;
    font-size: var(--text-xs);
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
    width: fit-content;
  }
  .agent-pr-link:hover { text-decoration: underline; }
  .agent-pr-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .agent-badge { font-size: var(--text-xs); font-weight: 600; padding: 2px 8px; border-radius: var(--radius-md); text-transform: uppercase; letter-spacing: 0.3px; }
  .agent-badge.working { background: var(--green-dim); color: var(--green); }
  .agent-badge.idle { background: var(--border); color: var(--text-muted); }
  .agent-badge.offline { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .main { padding: 24px 28px; display: flex; flex-direction: column; gap: var(--space-6); flex: 1; min-width: 0; }
  .panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-md); overflow: hidden;
    transition: border-color var(--transition-fast) var(--easing-smooth);
  }
  .panel-header {
    padding: var(--space-4) var(--space-5); font-size: var(--text-lg); font-weight: var(--font-weight-semibold); color: var(--text-bright);
    border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;
  }
  .panel-header .count { font-size: var(--text-sm); color: var(--text-muted); font-weight: var(--font-weight-normal); }
  .panel-body { padding: var(--space-4) var(--space-5); max-height: 450px; overflow-y: auto; }
  .truth-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }
  .truth-item {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 10px 12px;
  }
  .truth-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .truth-value {
    font-size: 12px;
    color: var(--text-bright);
    line-height: 1.35;
    word-break: break-word;
  }
  .project-tabs { display: flex; gap: 2px; padding: 10px 18px 0; border-bottom: 1px solid var(--border); }
  .project-tab {
    padding: 8px 16px; font-size: var(--text-base); font-weight: 500; border: none; background: transparent;
    color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent;
    transition: all 0.15s; margin-bottom: -1px;
  }
  .project-tab:hover { color: var(--text); }
  .project-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .kanban { display: flex; gap: var(--space-3); padding: 16px 18px; overflow-x: auto; min-height: 180px; }
  .kanban-col { flex: 1; min-width: 160px; }
  .kanban-col-header {
    font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600;
    color: var(--text-muted); margin-bottom: 10px; padding-bottom: 8px;
    border-bottom: 2px solid var(--border); display: flex; justify-content: space-between; align-items: center;
  }
  .kanban-col-header .cnt { font-weight: 400; font-size: var(--text-sm); background: var(--border); padding: 1px 7px; border-radius: var(--radius); }
  .kanban-col[data-status="doing"] .kanban-col-header { border-bottom-color: var(--accent); }
  .kanban-col[data-status="blocked"] .kanban-col-header { border-bottom-color: var(--red); }
  .kanban-col[data-status="validating"] .kanban-col-header { border-bottom-color: var(--yellow); }
  .kanban-col[data-status="done"] .kanban-col-header { border-bottom-color: var(--green); }
  .task-card {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 10px 12px; margin-bottom: 8px; transition: border-color 0.15s;
    cursor: pointer;
  }
  .task-card:hover { border-color: var(--accent); }
  
  /* Task Modal */
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.7); display: none; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal-overlay.show { display: flex; }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto;
  }
  .modal-header {
    padding: 18px 20px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .modal-header h2 { font-size: var(--text-lg); font-weight: 600; color: var(--text-bright); margin: 0; }
  .modal-close {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-size: 20px; padding: 0; width: 24px; height: 24px;
  }
  .modal-close:hover { color: var(--text); }
  .modal-body { padding: 20px; }
  .modal-section { margin-bottom: 20px; }
  .modal-section:last-child { margin-bottom: 0; }

  /* Artifact list (task modal) */
  .artifact-list { display: flex; flex-direction: column; gap: 10px; }
  .artifact-row {
    background: var(--bg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
  }
  .artifact-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .artifact-path { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; color: var(--text-bright); }
  .artifact-meta { font-size: var(--text-sm); color: var(--text-muted); margin-top: 4px; }
  .artifact-actions { display: flex; gap: var(--space-2); margin-top: 8px; flex-wrap: wrap; }
  .artifact-btn {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-size: var(--text-sm);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
    transition: all var(--transition-fast) var(--easing-smooth);
  }
  @media (hover: hover) and (pointer: fine) {
    .artifact-btn:hover { border-color: var(--accent); color: var(--accent); }
  }
  .artifact-pill {
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-full);
    padding: 2px 8px;
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.2px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--surface-raised);
    flex-shrink: 0;
  }
  .artifact-pill.ok { border-color: var(--green); color: #9de6a8; background: var(--green-dim); }
  .artifact-pill.missing { border-color: var(--red); color: #ff9a94; background: var(--red-dim); }
  .modal-label { font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--text-muted); font-weight: 600; margin-bottom: 8px;
  }
  .modal-value { font-size: var(--text-md); color: var(--text); line-height: 1.5; }
  .modal-inline-row { display: flex; align-items: center; gap: 10px; }
  .modal-copy-btn {
    border: 1px solid var(--border-subtle); background: transparent; color: var(--text-muted);
    border-radius: var(--radius-sm); font-size: var(--text-sm); padding: 4px 8px;
    cursor: pointer; font-family: inherit;
    transition: all var(--transition-fast) var(--easing-smooth);
  }
  @media (hover: hover) and (pointer: fine) {
    .modal-copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  }
  .modal-select, .modal-input {
    width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 12px; font-size: var(--text-md); outline: none;
  }
  .modal-select:focus, .modal-input:focus { border-color: var(--accent); }
  .status-buttons {
    display: flex; gap: var(--space-2); flex-wrap: wrap;
  }
  .status-btn {
    padding: 6px 14px; font-size: var(--text-base); font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
    cursor: pointer; font-family: inherit;
    transition: all var(--transition-fast) var(--easing-smooth);
  }
  @media (hover: hover) and (pointer: fine) {
    .status-btn:hover { border-color: var(--accent); color: var(--accent); }
  }
  .status-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
  .modal-btn {
    padding: 8px 16px; font-size: var(--text-base); font-weight: var(--font-weight-semibold);
    border-radius: var(--radius-sm);
    border: none; cursor: pointer; font-family: inherit;
    transition: all var(--transition-fast) var(--easing-smooth);
  }
  .modal-btn-primary {
    background: var(--accent); color: #fff;
  }
  @media (hover: hover) and (pointer: fine) {
    .modal-btn-primary:hover { opacity: 0.85; }
  }
  .modal-btn-secondary {
    background: var(--border); color: var(--text);
  }
  @media (hover: hover) and (pointer: fine) {
    .modal-btn-secondary:hover { background: var(--text-muted); }
  }
  .task-title { font-size: var(--text-base); font-weight: 500; color: var(--text-bright); margin-bottom: 6px; line-height: 1.4; }
  .task-meta { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
  .priority-badge { display: inline-block; padding: 2px 7px; border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 700; letter-spacing: 0.3px; }
  .priority-badge.P0 { background: var(--red-dim); color: var(--red); }
  .priority-badge.P1 { background: var(--orange-dim); color: var(--orange); }
  .priority-badge.P2 { background: var(--yellow-dim); color: var(--yellow); }
  .priority-badge.P3 { background: var(--border); color: var(--text-muted); }
  .assignee-tag { font-size: var(--text-sm); color: var(--text-muted); display: flex; align-items: center; gap: var(--space-1); }
  .assignee-tag .role-small { font-size: 9px; color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .done-toggle { font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 4px 0; }
  .done-toggle:hover { color: var(--text); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); }
  @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }
  .channel-tabs { display: flex; gap: 2px; padding: 8px 18px 0; overflow-x: auto; }
  .channel-tab {
    padding: 6px 12px; font-size: 12px; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    cursor: pointer; background: transparent; border: none; color: var(--text-muted); font-weight: 500; transition: all 0.15s;
  }
  .channel-tab:hover { background: var(--surface-raised); color: var(--text); }
  .channel-tab.active { background: var(--surface-raised); color: var(--accent); }
  .channel-tab .meta { font-size: var(--text-xs); color: var(--text-muted); margin-left: 6px; }
  .channel-tab .mention-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent); margin-left: 6px; box-shadow: 0 0 8px rgba(77, 166, 255, 0.6);
  }
  .msg { padding: 7px 0; border-bottom: 1px solid var(--border-subtle); font-size: var(--text-base); }
  .msg:last-child { border-bottom: none; }
  .msg-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 3px; }
  .msg-from { font-weight: 600; color: var(--accent); font-size: var(--text-base); max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  .msg-role { font-size: var(--text-xs); color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .msg-channel { font-size: var(--text-sm); color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 1px 6px; border-radius: 3px; }
  .msg-time { font-size: var(--text-sm); color: var(--text-muted); margin-left: auto; white-space: nowrap; }
  .msg-edited { font-size: var(--text-xs); color: var(--text-muted); opacity: 0.8; }
  .msg-content { color: var(--text); font-size: 12.5px; line-height: 1.4; word-break: break-word; white-space: pre-wrap; }
  .task-id-link {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    font-weight: 600;
    cursor: pointer;
  }
  .task-id-link:hover { opacity: 0.9; }
  .task-id-link .task-preview-tooltip {
    display: none; position: absolute; z-index: 200; bottom: 120%; left: 50%; transform: translateX(-50%);
    background: var(--surface-raised); border: 1px solid var(--border-subtle); border-radius: 6px;
    padding: 8px 10px; font-size: var(--text-sm); line-height: 1.4; white-space: nowrap; pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,.3); color: var(--text);
  }
  .task-id-link:hover .task-preview-tooltip, .task-id-link:focus .task-preview-tooltip { display: block; }
  .task-preview-tooltip .tp-title { font-weight: 600; color: var(--text); }
  .task-preview-tooltip .tp-meta { color: var(--text-muted); font-size: var(--text-xs); margin-top: 2px; }
  .task-id-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .msg-content.collapsed { max-height: 80px; overflow: hidden; position: relative; cursor: pointer; }
  .msg-content.collapsed::after {
    content: '▼ click to expand'; display: block; position: absolute; bottom: 0; left: 0; right: 0;
    background: linear-gradient(transparent, var(--surface) 60%); padding-top: 30px; text-align: center;
    font-size: var(--text-sm); color: var(--accent); font-style: italic;
  }
  .msg-content.expanded { max-height: none; cursor: pointer; }
  .msg.mentioned {
    border-left: 2px solid var(--accent);
    padding-left: 8px;
    background: linear-gradient(90deg, rgba(77, 166, 255, 0.08), transparent 65%);
  }
  .event-row { padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12px; display: flex; align-items: center; gap: var(--space-2); }
  .event-row:last-child { border-bottom: none; }
  .event-type { display: inline-block; padding: 2px 8px; border-radius: var(--radius-sm); font-size: var(--text-xs); font-weight: 600; background: var(--border); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0; }
  .event-agent { color: var(--accent); font-weight: 600; flex-shrink: 0; }
  .event-desc { color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-time { color: var(--text-muted); font-size: var(--text-sm); flex-shrink: 0; }
  .empty {
    color: var(--text-muted); font-style: normal; font-size: var(--text-base);
    padding: 28px 16px; text-align: center; line-height: 1.5;
    background: var(--bg); border: 1px dashed var(--border);
    border-radius: var(--radius-sm); margin: 4px 0;
  }
  .ssot-meta {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin-bottom: 8px; padding: 8px 10px; border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm); background: var(--surface-raised); font-size: 12px;
  }
  .ssot-meta-text { color: var(--text-muted); }
  .ssot-state-badge {
    font-size: var(--text-sm); font-weight: 700; border-radius: var(--radius-full); padding: 2px 8px;
    border: 1px solid transparent; text-transform: uppercase; letter-spacing: 0.2px;
  }
  .ssot-state-badge.fresh { color: var(--green); border-color: var(--green); background: var(--green-dim); }
  .ssot-state-badge.warn { color: var(--yellow); border-color: var(--yellow); background: var(--yellow-dim); }
  .ssot-state-badge.stale { color: var(--red); border-color: var(--red); background: var(--red-dim); }
  .ssot-state-badge.unknown { color: var(--text-muted); border-color: var(--text-muted); background: var(--border); }
  .ssot-list { display: grid; gap: var(--space-2); }
  .ssot-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
    background: var(--surface-raised);
  }
  .ssot-item-label { font-size: 12px; color: var(--text); }
  .ssot-link {
    color: var(--accent); text-decoration: none; font-size: 12px; font-weight: 600;
  }
  .ssot-link:hover { text-decoration: underline; }
  .ssot-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
  .ssot-missing { font-size: var(--text-sm); color: var(--yellow); border: 1px solid var(--yellow); border-radius: var(--radius-md); padding: 2px 6px; }
  /* Chat input */
  .chat-input-bar {
    display: flex; gap: var(--space-2); padding: 12px 18px;
    border-top: 1px solid var(--border); background: var(--surface-raised);
  }
  .chat-input-bar select {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 10px; font-size: var(--text-base); min-width: 120px;
  }
  .chat-input-bar input {
    flex: 1; background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 12px; font-size: var(--text-base); outline: none;
  }
  .chat-input-bar input:focus { border-color: var(--accent); }
  .chat-input-bar input::placeholder { color: var(--text-muted); }
  .chat-input-bar button {
    background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sm);
    padding: 8px 18px; font-size: var(--text-base); font-weight: var(--font-weight-semibold);
    cursor: pointer; font-family: inherit;
    transition: all var(--transition-fast) var(--easing-smooth);
  }
  @media (hover: hover) and (pointer: fine) {
    .chat-input-bar button:hover { opacity: 0.85; }
  }
  .chat-input-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  
  /* Team Health Widget */
  .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-3); margin-bottom: 20px; }
  .health-card {
    background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 12px 14px; display: flex; align-items: center; gap: 10px; transition: all 0.2s;
  }
  .health-card:hover { border-color: var(--accent); }
  .health-card.health-critical {
    border-color: rgba(248, 81, 73, 0.55);
    background: linear-gradient(90deg, rgba(248, 81, 73, 0.12), transparent 72%);
  }
  .health-card.health-warning {
    border-color: rgba(212, 160, 23, 0.45);
    background: linear-gradient(90deg, rgba(212, 160, 23, 0.09), transparent 72%);
  }
  .health-card.health-info {
    border-color: rgba(63, 185, 80, 0.35);
    background: linear-gradient(90deg, rgba(63, 185, 80, 0.07), transparent 75%);
  }
  .health-indicator {
    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    box-shadow: 0 0 8px currentColor;
  }
  .health-indicator.active { background: var(--green); color: var(--green); }
  .health-indicator.idle { background: var(--yellow); color: var(--yellow); }
  .health-indicator.silent { background: var(--orange); color: var(--orange); }
  .health-indicator.watch { background: var(--yellow); color: var(--yellow); }
  .health-indicator.blocked, .health-indicator.offline { background: var(--red); color: var(--red); }
  .health-card.needs-review {
    border-color: rgba(212, 160, 23, 0.45);
    background: linear-gradient(90deg, rgba(212, 160, 23, 0.08), transparent 70%);
  }
  .health-card.stuck-active-task {
    border-color: rgba(248, 81, 73, 0.55);
    background: linear-gradient(90deg, rgba(248, 81, 73, 0.14), transparent 75%);
  }
  .health-info { flex: 1; min-width: 0; }
  .health-name { font-size: var(--text-base); font-weight: 600; color: var(--text-bright); }
  .health-status { font-size: var(--text-sm); color: var(--text-muted); }
  .health-task { font-size: var(--text-sm); color: var(--purple); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .health-section { margin-bottom: 16px; }
  .health-section:last-child { margin-bottom: 0; }
  .health-section-title { font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
  .blocker-item {
    background: var(--red-dim); border-left: 3px solid var(--red); padding: 8px 10px;
    border-radius: var(--radius-sm); margin-bottom: 6px; font-size: 12px;
  }
  .blocker-item:last-child { margin-bottom: 0; }
  .blocker-agent { font-weight: 600; color: var(--red); }
  .blocker-text { color: var(--text); margin-top: 3px; line-height: 1.4; }
  .blocker-meta { font-size: var(--text-xs); color: var(--text-muted); margin-top: 3px; }
  .overlap-item {
    background: var(--yellow-dim); border-left: 3px solid var(--yellow); padding: 8px 10px;
    border-radius: var(--radius-sm); margin-bottom: 6px; font-size: 12px;
  }
  .overlap-item:last-child { margin-bottom: 0; }
  .overlap-agents { font-weight: 600; color: var(--yellow); }
  .overlap-topic { color: var(--text); margin-top: 3px; }

  /* Collaboration Compliance */
  .compliance-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin-bottom: 12px; }
  .sla-chip {
    border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12px;
    display: flex; justify-content: space-between; gap: var(--space-2); background: var(--bg);
  }
  .sla-chip.ok { border-color: rgba(63,185,80,.4); background: rgba(63,185,80,.08); }
  .sla-chip.warning { border-color: rgba(212,160,23,.45); background: rgba(212,160,23,.1); }
  .sla-chip.violation, .sla-chip.escalated { border-color: rgba(248,81,73,.5); background: rgba(248,81,73,.12); }
  .compliance-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .compliance-table th, .compliance-table td { text-align: left; padding: 8px; font-size: 12px; border-bottom: 1px solid var(--border-subtle); }
  .compliance-table th { color: var(--text-muted); font-size: var(--text-sm); text-transform: uppercase; letter-spacing: .4px; }
  .state-pill { display: inline-block; padding: 2px 8px; border-radius: var(--radius-full); font-size: var(--text-sm); text-transform: uppercase; letter-spacing: .3px; }
  .state-pill.ok { color: var(--green); background: var(--green-dim); }
  .state-pill.warning { color: var(--yellow); background: var(--yellow-dim); }
  .state-pill.violation, .state-pill.escalated { color: var(--red); background: var(--red-dim); }
  .copy-template-btn {
    background: var(--surface-raised); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 5px 8px; font-size: var(--text-sm);
    cursor: pointer; font-family: inherit;
    transition: all var(--transition-fast) var(--easing-smooth);
  }
  @media (hover: hover) and (pointer: fine) {
    .copy-template-btn:hover { border-color: var(--accent); color: var(--accent); }
  }

  /* Review Queue Panel */
  .review-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 12px; border-bottom: 1px solid var(--border-subtle);
    font-size: var(--text-base); transition: background 0.15s;
  }
  .review-item:last-child { border-bottom: none; }
  .review-item:hover { background: var(--surface-raised); cursor: pointer; }
  .review-item-left { flex: 1; min-width: 0; }
  .review-item-title { color: var(--text-bright); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .review-item-meta { font-size: var(--text-sm); color: var(--text-muted); margin-top: 2px; display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .review-item-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
  .sla-badge {
    display: inline-flex; align-items: center; padding: 3px 8px;
    border-radius: var(--radius-full); font-size: var(--text-sm); font-weight: 600; letter-spacing: 0.2px;
  }
  .sla-badge.ok { color: var(--green); background: var(--green-dim); border: 1px solid rgba(63,185,80,.3); }
  .sla-badge.warning { color: var(--yellow); background: var(--yellow-dim); border: 1px solid rgba(212,160,23,.3); }
  .sla-badge.breach { color: var(--red); background: var(--red-dim); border: 1px solid rgba(248,81,73,.3); animation: sla-pulse 2s ease-in-out infinite; }
  @keyframes sla-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
  .review-empty { text-align: center; padding: 24px; color: var(--text-muted); font-size: var(--text-base); }

  /* Outcome Feed */
  .outcome-rollup {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    margin-bottom: 10px;
  }
  .outcome-rollup-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 8px 10px;
  }
  .outcome-rollup-card .label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .outcome-rollup-card .value {
    margin-top: 2px;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-bright);
  }
  .outcome-rollup-card.high { border-color: rgba(248,81,73,.45); background: rgba(248,81,73,.08); }
  .outcome-rollup-card.medium { border-color: rgba(212,160,23,.45); background: rgba(212,160,23,.10); }
  .outcome-rollup-card.low { border-color: rgba(63,185,80,.40); background: rgba(63,185,80,.10); }
  .outcome-item {
    border-bottom: 1px solid var(--border-subtle);
    padding: 9px 0;
  }
  .outcome-item:last-child { border-bottom: none; }
  .outcome-item-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-bright);
  }
  .outcome-item-meta {
    margin-top: 3px;
    font-size: var(--text-sm);
    color: var(--text-muted);
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .outcome-impact-pill {
    border-radius: var(--radius-full);
    padding: 1px 8px;
    font-size: var(--text-xs);
    letter-spacing: 0.4px;
    text-transform: uppercase;
    font-weight: 700;
  }
  .outcome-impact-pill.high { color: var(--red); background: var(--red-dim); }
  .outcome-impact-pill.medium { color: var(--yellow); background: var(--yellow-dim); }
  .outcome-impact-pill.low { color: var(--green); background: var(--green-dim); }

  .incident-item {
    border-left: 3px solid var(--orange); background: var(--orange-dim); border-radius: var(--radius-sm);
    padding: 8px 10px; margin-bottom: 6px; font-size: 12px;
  }
  .incident-type { font-weight: 600; color: var(--text-bright); }
  .template-box {
    margin-top: 8px; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; font-size: var(--text-sm); color: var(--text-muted);
  }

  @media (max-width: 767px) {
    .header, .agent-strip, .main {
      padding-left: 16px;
      padding-right: 16px;
    }
    .header {
      padding-top: 12px;
      padding-bottom: 12px;
      align-items: flex-start;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .header-right {
      width: 100%;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      flex-wrap: wrap;
    }
    .agent-strip { gap: var(--space-2); }
    .agent-card { min-width: 170px; padding: 8px 10px; border-radius: 12px; }
    .main { padding-top: 20px; padding-bottom: 20px; gap: var(--space-5); }
    .panel { border-radius: 12px; }
    .panel-header { padding: 12px 16px; font-size: var(--text-md); }
    .panel-body { padding: 12px 16px; max-height: 360px; }
    .project-tabs, .channel-tabs {
      padding-left: 16px;
      padding-right: 16px;
      gap: 6px;
      flex-wrap: wrap;
    }
    .kanban {
      display: block;
      padding: 12px 16px;
      overflow-x: visible;
      min-height: 0;
    }
    .kanban-col { min-width: 0; margin-bottom: 14px; }
    .kanban-col:last-child { margin-bottom: 0; }
    .task-card { margin-bottom: 12px; border-radius: var(--radius); }
    .project-tab, .channel-tab, .done-toggle {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
    }
    .project-tab { padding: 10px 14px; }
    .channel-tab { padding: 8px 12px; }
    .done-toggle { padding: 8px 0; }
    .chat-input-bar { padding: 10px 12px; flex-wrap: wrap; }
    .chat-input-bar select { min-width: 105px; flex: 0 0 auto; }
    .chat-input-bar input { min-width: 0; width: 100%; }
    .chat-input-bar button { width: 100%; min-height: 44px; }
    .health-grid { grid-template-columns: 1fr; gap: var(--space-2); }
    .outcome-rollup { grid-template-columns: 1fr; }
  }

  @media (max-width: 420px) {
    .header, .agent-strip, .main { padding-left: 12px; padding-right: 12px; }
    .panel-header { padding: 10px 12px; }
    .panel-body { padding: 10px 12px; max-height: 320px; }
    .kanban { padding: 10px 12px; }
    .task-card { padding: 9px 10px; }
    .task-title { font-size: 12px; }
    .msg { padding: 5px 0; }
    .msg-header { gap: var(--space-1); }
    .msg-from { max-width: none; }
    .msg-time { margin-left: 0; }
    .chat-input-bar { padding: 8px 10px; }
    .chat-input-bar select { min-width: 0; width: 100%; }
  }

  @media (min-width: 768px) and (max-width: 1023px) {
    .header, .agent-strip, .main {
      padding-left: 16px;
      padding-right: 16px;
    }
    .main {
      max-width: 960px;
      margin: 0 auto;
    }
    .header { gap: 10px; flex-wrap: wrap; }
    .header-right { margin-left: auto; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .two-col { gap: var(--space-4); }
    .kanban { padding: 14px 16px; gap: 10px; }
    .kanban-col { min-width: 180px; }
  }

  @media (min-width: 1024px) {
    .header, .agent-strip, .main {
      max-width: 1200px;
      margin-left: auto;
      margin-right: auto;
      width: 100%;
    }
    .header, .agent-strip { padding-left: 24px; padding-right: 24px; }
    .main { padding-left: 24px; padding-right: 24px; }
    .header-right { gap: var(--space-3); }
  }

  /* ============================================
     Dashboard Animations - Pixel Design System
     ============================================ */
  :root {
    --transition-fast: 150ms;
    --transition-base: 250ms;
    --transition-slow: 400ms;
    --easing-smooth: cubic-bezier(0.4, 0.0, 0.2, 1);
    --easing-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
    --easing-ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
  }

  /* Task Card Interactions */
  .task-card {
    transition: all var(--transition-base) var(--easing-smooth);
    transform: translateY(0);
    animation: fadeSlideIn var(--transition-slow) var(--easing-ease-out);
  }
  .task-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .task-card:active {
    transform: translateY(0);
    transition-duration: var(--transition-fast);
  }

  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Stagger animation for task lists */
  .task-card:nth-child(1) { animation-delay: 0ms; }
  .task-card:nth-child(2) { animation-delay: 50ms; }
  .task-card:nth-child(3) { animation-delay: 100ms; }
  .task-card:nth-child(4) { animation-delay: 150ms; }
  .task-card:nth-child(5) { animation-delay: 200ms; }
  .task-card:nth-child(n+6) { animation-delay: 250ms; }

  /* Priority Badge Animations */
  .priority-badge {
    transition: transform var(--transition-fast) var(--easing-bounce);
  }
  .task-card:hover .priority-badge {
    transform: scale(1.1);
  }
  .priority-P0 {
    animation: pulseCritical 2s ease-in-out infinite;
  }
  @keyframes pulseCritical {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  /* Status Transitions */
  .status-badge {
    transition: all var(--transition-base) var(--easing-smooth);
  }
  .task-card[data-status-changed="true"] {
    animation: statusFlash var(--transition-slow) ease-out;
  }
  @keyframes statusFlash {
    0% { background-color: rgba(34, 197, 94, 0.1); }
    100% { background-color: transparent; }
  }

  /* Modal Animations */
  .modal-overlay {
    animation: fadeIn var(--transition-base) ease-out;
  }
  .modal {
    animation: slideUpFade var(--transition-slow) var(--easing-ease-out);
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideUpFade {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .modal-overlay.closing {
    animation: fadeOut var(--transition-fast) ease-in;
  }
  .modal.closing {
    animation: slideDownFade var(--transition-fast) ease-in;
  }
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes slideDownFade {
    from { opacity: 1; transform: translateY(0) scale(1); }
    to { opacity: 0; transform: translateY(10px) scale(0.98); }
  }

  /* Button Interactions */
  button, .button {
    transition: all var(--transition-fast) var(--easing-smooth);
    position: relative;
  }

  /* Avoid sticky hover on touch devices */
  @media (hover: hover) and (pointer: fine) {
    button:hover, .button:hover {
      transform: translateY(-1px);
      box-shadow: var(--shadow-hover);
    }
  }

  button:active, .button:active {
    transform: translateY(0);
    box-shadow: var(--shadow-active);
  }

  /* Avatar Animations */
  .agent-emoji {
    transition: transform var(--transition-base) var(--easing-smooth);
  }
  .agent-card:hover .agent-emoji {
    transform: scale(1.1) rotate(5deg);
  }

  /* Status Indicator Breathing */
  .status-dot {
    animation: breathe 2s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.1); }
  }

  /* Kanban Column Transitions */
  .kanban-col {
    transition: background-color var(--transition-base) var(--easing-smooth);
  }

  /* Focus States (Accessibility) */
  :focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-offset);
    transition: outline-offset var(--transition-fast) var(--easing-smooth);
  }
  :focus-visible:not(:active) {
    outline-offset: var(--focus-offset-strong);
  }

  /* Link interactions (make links feel like links) */
  .panel a {
    text-decoration: none;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
  }
  .panel a:hover {
    text-decoration: underline;
  }

  /* Focus-visible parity: match hover styles for keyboard navigation */
  button:focus-visible, .button:focus-visible {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .task-card:focus-visible { border-color: var(--accent); }
  .health-card:focus-visible { border-color: var(--accent); }
  .agent-card:focus-visible .agent-emoji { transform: scale(1.1) rotate(5deg); }
  .channel-tab:focus-visible { background: var(--surface-raised); color: var(--text); }
  .project-tab:focus-visible { color: var(--text); }
  .focus-toggle:focus-visible { border-color: var(--accent); color: var(--text); }
  .status-btn:focus-visible { border-color: var(--accent); color: var(--accent); }
  .artifact-btn:focus-visible { border-color: var(--accent); color: var(--accent); }
  .modal-copy-btn:focus-visible { border-color: var(--accent); color: var(--accent); }
  .copy-template-btn:focus-visible { border-color: var(--accent); color: var(--accent); }
  .modal-close:focus-visible { color: var(--text); }
  .modal-btn-primary:focus-visible { opacity: 0.85; }
  .modal-btn-secondary:focus-visible { background: var(--text-muted); }
  .done-toggle:focus-visible { color: var(--text); }
  .review-item:focus-visible { background: var(--surface-raised); }
  .gs-link:focus-visible { text-decoration: underline; }

  /* ── Focus-visible parity: elements with hover but missing focus ── */

  /* Feedback cards: vote + action buttons */
  .feedback-card:focus-visible { border-color: var(--accent); }
  .feedback-card .fb-votes:focus-visible { color: var(--accent); }
  .feedback-card .fb-actions button:focus-visible { background: var(--surface-raised); color: var(--text-bright); }

  /* Approval cards: approve/reject/edit buttons */
  .approval-card .btn-approve:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
  .approval-card .btn-reject:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
  .approval-card .btn-edit:focus-visible { border-color: var(--accent) !important; color: var(--accent); }
  .batch-approve-bar button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

  /* Getting started: steps + dismiss */
  .getting-started .dismiss-btn:focus-visible { color: var(--text); background: var(--accent-dim); }
  .getting-started .gs-step:focus-visible { border-color: var(--accent); }

  /* PR review header links */
  .pr-review-header a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; border-radius: 3px; }

  /* Chat input send button */
  .chat-input-bar button:focus-visible { opacity: 0.85; outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Pause toggle paused state: accent focus ring in paused mode */
  .pause-toggle-btn.paused:focus-visible { outline-color: var(--red); }

  /* Panel rows: keyboard navigation highlight (matches hover) */
  .panel-row:focus-visible { background: var(--surface-raised); }
  .panel-row:focus-within { background: var(--surface-raised); }

  /* Table rows: keyboard navigation highlight (matches hover) */
  .table tr:focus-visible td,
  table tr:focus-visible td { background: var(--surface-raised); }

  /* Review items: keyboard highlight */
  .review-item:focus-visible { background: var(--surface-raised); }

  /* Reduced Motion Preferences */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* ============================================
     Focus Mode — single active lane emphasis
     ============================================ */
  .focus-toggle {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: var(--radius-full); font-size: 12px; font-weight: 600;
    cursor: pointer; border: 1px solid var(--border); background: var(--surface-raised);
    color: var(--text-muted); transition: all var(--transition-base) var(--easing-smooth);
    user-select: none;
  }
  .focus-toggle:hover { border-color: var(--accent); color: var(--text); }
  .focus-toggle.active {
    background: var(--accent-dim); border-color: var(--accent); color: var(--accent);
  }
  .focus-toggle .focus-icon { font-size: var(--text-md); }

  /* Focus mode active: dim non-active kanban columns */
  body.focus-mode .kanban-col:not([data-status="doing"]) {
    opacity: 0.3;
    transform: scale(0.97);
    transition: all var(--transition-slow) var(--easing-smooth);
    pointer-events: none;
  }
  body.focus-mode .kanban-col:not([data-status="doing"]):hover {
    opacity: 0.6;
    pointer-events: auto;
  }
  body.focus-mode .kanban-col[data-status="doing"] {
    flex: 2;
    transition: flex var(--transition-slow) var(--easing-smooth);
  }
  body.focus-mode .kanban-col[data-status="doing"] .kanban-col-header {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }

  /* QA contract badge on task cards in focus mode */
  .qa-contract {
    margin-top: 8px; padding: 6px 8px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
    font-size: var(--text-sm); line-height: 1.5;
  }
  .qa-contract .qa-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .qa-contract .qa-row + .qa-row { margin-top: 3px; }
  .qa-contract .qa-label { color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-size: var(--text-xs); }
  .qa-contract .qa-value { color: var(--text-bright); font-weight: 500; }
  .qa-contract .qa-value.missing { color: var(--yellow); font-style: italic; }
  .qa-contract .qa-value.has-artifact { color: var(--green); }

  /* Feedback Cards */
  .feedback-card {
    padding: 10px 12px; border-bottom: 1px solid var(--border-subtle);
  }
  .feedback-card:last-child { border-bottom: none; }
  .feedback-card .fb-header {
    display: flex; align-items: center; gap: 6px; font-size: var(--text-sm);
  }
  .feedback-card .fb-category { font-weight: 600; }
  .feedback-card .fb-category.bug { color: var(--red); }
  .feedback-card .fb-category.feature { color: var(--accent); }
  .feedback-card .fb-category.general { color: var(--text-muted); }
  .feedback-card .fb-source { color: var(--text-dim); }
  .feedback-card .fb-time { color: var(--text-dim); margin-left: auto; }
  .feedback-card .fb-message {
    font-size: 12px; color: var(--text-bright); margin-top: 4px; line-height: 1.4;
  }
  .feedback-card .fb-footer {
    display: flex; align-items: center; gap: var(--space-2); margin-top: 6px; font-size: var(--text-xs);
  }
  .feedback-card .fb-email { color: var(--text-dim); }
  .feedback-card .fb-votes { color: var(--text-muted); cursor: pointer; }
  .feedback-card .fb-votes:hover { color: var(--accent); }
  .feedback-card .fb-actions { margin-left: auto; display: flex; gap: var(--space-1); }
  .feedback-card .fb-actions button {
    font-size: var(--text-xs); padding: 2px 8px; border-radius: var(--radius-sm); cursor: pointer;
    border: 1px solid var(--border-subtle); background: none; color: var(--text-muted);
  }
  .feedback-card .fb-actions button:hover { background: var(--surface-raised); color: var(--text-bright); }

  /* Approval Queue */
  .approval-card {
    padding: 10px 12px; margin-bottom: 6px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
  }
  .approval-card .approval-header {
    display: flex; justify-content: space-between; align-items: center; gap: var(--space-2);
  }
  .approval-card .approval-title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .approval-card .approval-meta {
    font-size: var(--text-xs); color: var(--text-muted); margin-top: 4px;
  }
  .approval-card .approval-actions {
    display: flex; gap: var(--space-1); margin-top: 8px; justify-content: flex-end;
  }
  .approval-card .approval-actions button {
    font-size: var(--text-xs); padding: 3px 10px; border-radius: var(--radius-sm); cursor: pointer; border: none;
  }
  .approval-card .btn-approve { background: var(--green); color: #fff; }
  .approval-card .btn-reject { background: var(--red); color: #fff; }
  .approval-card .btn-edit { background: none; border: 1px solid var(--border) !important; color: var(--text-muted); }
  .approval-card .confidence-score {
    font-size: var(--text-sm); font-weight: 700; padding: 2px 6px; border-radius: var(--radius);
  }
  .approval-card .confidence-score.high { background: rgba(76,175,80,0.15); color: var(--green); }
  .approval-card .confidence-score.low { background: rgba(255,193,7,0.15); color: var(--yellow); }
  .batch-approve-bar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border-subtle);
    font-size: var(--text-sm); color: var(--text-muted);
  }
  .batch-approve-bar button {
    font-size: var(--text-sm); padding: 4px 12px; border-radius: var(--radius-sm); border: none;
    background: var(--green); color: #fff; cursor: pointer; font-weight: 600;
  }
  .batch-approve-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
  /* Routing Policy Editor */
  .policy-agent-card {
    padding: 10px 12px; margin-bottom: 8px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
  }
  .policy-agent-card .agent-name { font-size: var(--text-base); font-weight: 600; color: var(--text-bright); }
  .policy-agent-card .tag-row { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: 6px; }
  .policy-agent-card .tag-chip {
    display: inline-flex; align-items: center; gap: 3px;
    font-size: var(--text-xs); padding: 2px 8px; border-radius: var(--radius-md);
    background: var(--surface); border: 1px solid var(--border-subtle); color: var(--text-muted);
  }
  .policy-agent-card .tag-chip .tag-remove {
    cursor: pointer; color: var(--red); font-size: var(--text-sm); margin-left: 2px;
  }
  .policy-agent-card .weight-row {
    display: flex; align-items: center; gap: var(--space-2); margin-top: 8px; font-size: var(--text-sm);
  }
  .policy-agent-card .weight-row input[type="range"] { flex: 1; }
  .policy-agent-card .weight-row .weight-val { font-weight: 600; color: var(--text-bright); min-width: 28px; }
  .policy-save-bar {
    display: flex; justify-content: flex-end; align-items: center; gap: var(--space-2);
    padding: 8px 0; margin-top: 8px; border-top: 1px solid var(--border-subtle);
  }
  .policy-save-bar button { font-size: var(--text-sm); padding: 4px 12px; border-radius: var(--radius-sm); border: none; cursor: pointer; }
  .policy-save-bar .btn-save { background: var(--accent); color: #fff; font-weight: 600; }
  .policy-save-bar .btn-discard { background: none; border: 1px solid var(--border) !important; color: var(--text-muted); }

  /* PR Review Quality Panel */
  .pr-review-section { margin-bottom: 14px; }
  .pr-review-section-title {
    font-size: 12px; font-weight: 600; color: var(--text-bright);
    margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
  }
  .pr-review-header {
    padding: 10px 12px; background: var(--surface-raised); border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle); margin-bottom: 10px;
  }
  .pr-review-header .pr-title { font-size: var(--text-base); font-weight: 600; color: var(--text-bright); }
  .pr-review-header .pr-meta { font-size: var(--text-sm); color: var(--text-muted); margin-top: 4px; }
  .pr-review-header a { color: var(--accent); text-decoration: none; }
  .pr-review-header a:hover { text-decoration: underline; }
  .diff-scope-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: var(--space-2);
    margin-bottom: 8px;
  }
  .diff-stat-card {
    padding: 8px 10px; background: var(--surface-raised); border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle); text-align: center;
  }
  .diff-stat-card .stat-value { font-size: var(--text-lg); font-weight: 700; color: var(--text-bright); }
  .diff-stat-card .stat-label { font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
  .risk-badge {
    display: inline-block; padding: 2px 8px; border-radius: var(--radius-md);
    font-size: var(--text-sm); font-weight: 600;
  }
  .risk-badge.small { background: rgba(76,175,80,0.15); color: var(--green); }
  .risk-badge.medium { background: rgba(255,193,7,0.15); color: var(--yellow); }
  .risk-badge.large { background: rgba(244,67,54,0.15); color: var(--red); }
  .dir-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 3px 0; font-size: var(--text-sm); border-bottom: 1px solid var(--border-subtle);
  }
  .dir-row:last-child { border-bottom: none; }
  .dir-name { color: var(--text-bright); font-family: monospace; font-size: var(--text-sm); }
  .dir-stats { color: var(--text-muted); font-size: var(--text-xs); }
  .ci-check-row {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 0; font-size: var(--text-sm);
  }
  .ci-check-row .check-icon { font-size: var(--text-base); flex-shrink: 0; }
  .ci-check-row .check-name { color: var(--text-bright); flex: 1; }
  .ci-check-row .check-duration { color: var(--text-dim); font-size: var(--text-xs); }
  .ci-check-row a { color: var(--accent); text-decoration: none; font-size: var(--text-xs); }
  .criterion-row {
    padding: 6px 8px; margin-bottom: 4px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
  }
  .criterion-row .criterion-text { font-size: 12px; color: var(--text-bright); margin-bottom: 4px; display: flex; align-items: flex-start; gap: 6px; }
  .criterion-row .criterion-evidence { font-size: var(--text-xs); color: var(--text-muted); padding-left: 20px; }
  .criterion-row .criterion-evidence .evidence-item { margin-top: 2px; }
  .confidence-badge {
    display: inline-block; padding: 1px 6px; border-radius: var(--radius);
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
  }
  .confidence-badge.high { background: rgba(76,175,80,0.15); color: var(--green); }
  .confidence-badge.medium { background: rgba(255,193,7,0.15); color: var(--yellow); }
  .confidence-badge.low { background: rgba(255,152,0,0.15); color: #ff9800; }
  .confidence-badge.none { background: rgba(244,67,54,0.15); color: var(--red); }

  /* Focus mode: dim agent cards not working on active tasks */
  body.focus-mode .agent-card:not(.active) {
    opacity: 0.25;
    transition: opacity var(--transition-base) var(--easing-smooth);
  }
  body.focus-mode .agent-card:not(.active):hover {
    opacity: 0.7;
  }

  /* Focus mode: collapse non-essential panels */
  body.focus-mode .panel.focus-collapse .panel-body,
  body.focus-mode .panel.focus-collapse .channel-tabs,
  body.focus-mode .panel.focus-collapse .chat-input-bar,
  body.focus-mode .panel.focus-collapse .project-tabs,
  body.focus-mode .panel.focus-collapse .kanban {
    display: none;
  }
  body.focus-mode .panel.focus-collapse {
    opacity: 0.5;
    transition: opacity var(--transition-base) var(--easing-smooth);
    cursor: pointer;
  }
  body.focus-mode .panel.focus-collapse:hover {
    opacity: 0.8;
  }
  body.focus-mode .panel.focus-collapse .panel-header::after {
    content: ' (click to expand)';
    font-size: var(--text-sm); color: var(--text-muted); font-weight: 400; font-style: italic;
  }

  /* Getting Started panel */
  .getting-started {
    background: linear-gradient(135deg, var(--surface) 0%, var(--bg) 100%);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md); overflow: hidden;
    box-shadow: 0 0 20px rgba(77, 166, 255, 0.08), 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .getting-started.hidden { display: none; }
  .getting-started .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; font-weight: 700; font-size: 16px; color: var(--text-bright);
    border-bottom: 1px solid var(--border);
    background: rgba(77, 166, 255, 0.04);
  }
  .getting-started .dismiss-btn {
    background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: var(--text-base);
    padding: 4px 8px; border-radius: var(--radius-sm);
  }
  .getting-started .dismiss-btn:hover { color: var(--text); background: var(--accent-dim); }
  .getting-started .dismiss-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .getting-started .gs-steps { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
  .getting-started .gs-step {
    display: flex; align-items: flex-start; gap: var(--space-3);
    padding: 14px 16px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border);
    transition: border-color var(--transition-fast) var(--easing-smooth);
  }
  @media (hover: hover) and (pointer: fine) {
    .getting-started .gs-step:hover { border-color: var(--accent); }
  }
  .getting-started .gs-step.done { opacity: 0.6; }
  .getting-started .gs-step .gs-icon {
    flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: var(--text-md); background: var(--accent-dim); color: var(--accent);
  }
  .getting-started .gs-step.done .gs-icon { background: var(--green-dim); color: var(--green); }
  .getting-started .gs-step .gs-content { flex: 1; }
  .getting-started .gs-step .gs-title {
    font-size: var(--text-base); font-weight: 600; color: var(--text-bright); margin-bottom: 2px;
  }
  .getting-started .gs-step .gs-desc {
    font-size: 12px; color: var(--text-muted); line-height: 1.4;
  }
  .getting-started .gs-step .gs-link {
    display: inline-block; margin-top: 4px; font-size: 12px;
    color: var(--accent); text-decoration: none;
  }
  .getting-started .gs-step .gs-link:hover { text-decoration: underline; }

  /* Polls */
  .poll-new-btn {
    float: right; font-size: var(--text-xs, 11px); background: none;
    border: 1px solid var(--border, #2a2a4a); color: var(--text-muted, #888);
    padding: 2px 8px; border-radius: var(--radius-sm, 4px); cursor: pointer;
  }
  .poll-new-btn:hover { border-color: var(--accent, #60a5fa); color: var(--text-primary, #e0e0e0); }
  .poll-new-btn:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: 2px; }
  .poll-create-form {
    border-top: 1px solid var(--border-subtle, #222); padding: 12px;
  }
  .poll-form-label {
    display: block; font-size: var(--text-xs, 11px); color: var(--text-muted, #888);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; margin-top: 8px;
  }
  .poll-form-label:first-child { margin-top: 0; }
  .poll-input {
    width: 100%; padding: 6px 8px; margin-bottom: 4px;
    border: 1px solid var(--border, #2a2a4a); border-radius: var(--radius-sm, 4px);
    background: var(--bg-secondary, #1a1a2e); color: var(--text-primary, #e0e0e0);
    font-size: var(--text-sm, 13px); box-sizing: border-box;
  }
  .poll-input:focus { border-color: var(--accent, #60a5fa); outline: none; }
  .poll-select {
    font-size: var(--text-xs, 11px); padding: 4px 8px;
    border: 1px solid var(--border, #2a2a4a); border-radius: var(--radius-sm, 4px);
    background: var(--bg-secondary, #1a1a2e); color: var(--text-primary, #e0e0e0);
  }
  .poll-anon-label {
    font-size: var(--text-xs, 11px); color: var(--text-muted, #888);
    display: flex; align-items: center; gap: 4px;
  }
  .poll-form-row { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
  .poll-btn-primary {
    font-size: var(--text-xs, 11px); background: var(--accent, #60a5fa); border: none;
    color: #fff; padding: 4px 12px; border-radius: var(--radius-sm, 4px); cursor: pointer;
  }
  .poll-btn-primary:hover { opacity: 0.9; }
  .poll-btn-primary:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: 2px; }
  .poll-btn-secondary {
    font-size: var(--text-xs, 11px); background: none;
    border: 1px solid var(--border, #2a2a4a); color: var(--text-muted, #888);
    padding: 4px 8px; border-radius: var(--radius-sm, 4px); cursor: pointer;
  }
  .poll-btn-secondary:hover { border-color: var(--accent, #60a5fa); color: var(--text-primary, #e0e0e0); }
  .poll-btn-secondary:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: 2px; }

  /* Poll cards */
  .poll-card {
    background: var(--surface-raised, var(--surface, #1e1e38)); border: 1px solid var(--border, #2a2a4a);
    border-radius: var(--radius-sm, 4px); padding: 12px; margin-bottom: 12px;
  }
  .poll-meta {
    display: flex; align-items: center; gap: 6px; font-size: var(--text-xs, 11px);
    color: var(--text-muted, #888); margin-bottom: 6px;
  }
  .poll-badge-open {
    background: var(--green-dim, rgba(74, 222, 128, 0.12)); color: var(--green, #4ade80);
    padding: 1px 6px; border-radius: var(--radius-sm, 4px); font-size: 10px; font-weight: 500;
  }
  .poll-badge-closed {
    background: var(--border, #2a2a4a); color: var(--text-muted, #888);
    padding: 1px 6px; border-radius: var(--radius-sm, 4px); font-size: 10px; font-weight: 500;
  }
  .poll-question {
    font-size: var(--text-md, 14px); font-weight: var(--font-weight-semibold, 600);
    color: var(--text-bright, #fff); margin-bottom: 8px;
  }
  .poll-option {
    position: relative; margin-bottom: 4px; border: 1px solid var(--border, #2a2a4a);
    border-radius: var(--radius-sm, 4px); min-height: 40px; overflow: hidden; cursor: pointer;
    transition: border-color 0.15s;
  }
  .poll-option:hover { border-color: var(--accent, #60a5fa); }
  .poll-option:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: -2px; }
  .poll-option[aria-checked="true"] { border-color: var(--accent, #60a5fa); background: rgba(96,165,250,0.04); }
  .poll-option-bar {
    position: absolute; top: 0; left: 0; height: 100%;
    background: var(--accent-dim, rgba(96,165,250,0.12)); border-radius: var(--radius-sm, 4px);
    transition: width 0.3s ease;
  }
  .poll-option-content {
    position: relative; display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; font-size: var(--text-sm, 13px); z-index: 1;
  }
  .poll-option-label { display: flex; align-items: center; gap: 8px; }
  .poll-option-check {
    width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border, #2a2a4a);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .poll-option[aria-checked="true"] .poll-option-check {
    border-color: var(--accent, #60a5fa); background: var(--accent, #60a5fa);
  }
  .poll-option[aria-checked="true"] .poll-option-check::after {
    content: '✓'; color: #fff; font-size: 10px; line-height: 1;
  }
  .poll-option-stats {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--text-xs, 11px); color: var(--text-muted, #888);
  }
  .poll-voter-dots { display: flex; gap: 2px; }
  .poll-voter-dot {
    width: 18px; height: 18px; border-radius: 50%; font-size: 9px; font-weight: 600;
    display: flex; align-items: center; justify-content: center; color: #fff;
    text-transform: uppercase;
  }
  .poll-footer {
    display: flex; align-items: center; justify-content: space-between;
    font-size: var(--text-xs, 11px); color: var(--text-muted, #888); margin-top: 8px;
  }

  /* Intensity control */
  .intensity-control {
    display: flex; align-items: center; gap: 8px; padding: 8px 16px;
    background: var(--surface, #1a1a2e); border-bottom: 1px solid var(--border, #2a2a4a);
  }
  .intensity-label { font-size: var(--text-xs, 11px); color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.05em; margin-right: 4px; }
  .intensity-btn {
    font-size: var(--text-sm, 13px); padding: 4px 12px; border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--border, #2a2a4a); background: transparent; color: var(--text-secondary, #aaa);
    cursor: pointer; transition: all 0.15s ease;
  }
  .intensity-btn:hover { border-color: var(--accent, #60a5fa); color: var(--text-primary, #e0e0e0); }
  .intensity-btn:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: 2px; }
  .intensity-btn.intensity-active {
    background: var(--accent, #60a5fa); color: #fff; border-color: var(--accent, #60a5fa);
  }
  .intensity-info { font-size: var(--text-xs, 11px); color: var(--text-muted, #888); margin-left: 8px; }
  .intensity-sep { color: var(--border, #2a2a4a); margin: 0 4px; }
  .pause-toggle-btn {
    font-size: var(--text-sm, 13px); padding: 4px 12px; border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--border, #2a2a4a); background: transparent; color: var(--text-secondary, #aaa);
    cursor: pointer; transition: all 0.15s ease;
  }
  .pause-toggle-btn:hover { border-color: var(--red, #f87171); color: var(--red, #f87171); }
  .pause-toggle-btn:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: 2px; }
  .pause-toggle-btn.paused {
    background: var(--red-dim, rgba(248,113,113,0.12)); color: var(--red, #f87171);
    border-color: var(--red, #f87171);
  }
  .pause-toggle-btn.paused:hover { background: var(--green-dim, rgba(74,222,128,0.12)); color: var(--green, #4ade80); border-color: var(--green, #4ade80); }
</style>
<link rel="stylesheet" href="/dashboard-animations.css">
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="header-logo">⚡ <span>reflectt</span>-node</div>
  </div>
  <div class="header-right">
    <span><span class="status-dot"></span>Running</span>
    <button class="focus-toggle" id="focus-toggle" onclick="toggleFocusMode()" title="Focus Mode: highlight active work, collapse noise">
      <span class="focus-icon">🎯</span> Focus
    </button>
    <span id="release-badge" class="release-badge" title="Deploy status">deploy: checking…</span>
    <span id="build-badge" class="release-badge" title="Build info">build: loading…</span>
    <span id="clock"></span>
  </div>
</div>
<div id="pause-banner" class="pause-banner" style="display:none">
  <span class="pause-icon">⏸️</span>
  <span id="pause-message">Team paused</span>
  <button onclick="resumeFromBanner()" class="pause-resume-btn">Resume</button>
</div>
<div id="intensity-control" class="intensity-control" role="radiogroup" aria-label="Team intensity">
  <span class="intensity-label">Intensity</span>
  <button role="radio" aria-checked="false" class="intensity-btn" data-preset="low" onclick="setIntensity('low')" tabindex="0">🐢 Low</button>
  <button role="radio" aria-checked="true" class="intensity-btn intensity-active" data-preset="normal" onclick="setIntensity('normal')" tabindex="-1">⚡ Normal</button>
  <button role="radio" aria-checked="false" class="intensity-btn" data-preset="high" onclick="setIntensity('high')" tabindex="-1">🔥 High</button>
  <span id="intensity-info" class="intensity-info"></span>
  <span class="intensity-sep">|</span>
  <button id="pause-toggle-btn" class="pause-toggle-btn" onclick="toggleTeamPause()" aria-label="Pause team" tabindex="0">⏸️ Pause</button>
</div>

<div class="agent-strip" id="agent-strip"></div>

<button class="sidebar-toggle" id="sidebar-toggle" onclick="toggleSidebar()" aria-label="Toggle sidebar">☰</button>
<div class="sidebar-overlay" id="sidebar-overlay" onclick="toggleSidebar()"></div>

<div class="app-layout">
<nav class="sidebar" id="sidebar" aria-label="Dashboard navigation">
  <div class="sidebar-nav">
    <button class="sidebar-link active" data-page="overview" onclick="navigateTo('overview')">
      <span class="nav-icon">🧭</span><span class="nav-label">Overview</span>
    </button>
    <button class="sidebar-link" data-page="tasks" onclick="navigateTo('tasks')">
      <span class="nav-icon">📋</span><span class="nav-label">Tasks</span><span class="nav-badge" id="nav-task-count">0</span>
    </button>
    <button class="sidebar-link" data-page="chat" onclick="navigateTo('chat')">
      <span class="nav-icon">💬</span><span class="nav-label">Chat</span>
    </button>
    <button class="sidebar-link" data-page="reviews" onclick="navigateTo('reviews')">
      <span class="nav-icon">👀</span><span class="nav-label">Reviews</span><span class="nav-badge" id="nav-review-count">0</span>
    </button>
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">Insights</div>
    <button class="sidebar-link" data-page="health" onclick="navigateTo('health')">
      <span class="nav-icon">🏥</span><span class="nav-label">Health</span>
    </button>
    <button class="sidebar-link" data-page="outcomes" onclick="navigateTo('outcomes')">
      <span class="nav-icon">🏁</span><span class="nav-label">Outcomes</span>
    </button>
    <button class="sidebar-link" data-page="research" onclick="navigateTo('research')">
      <span class="nav-icon">🔍</span><span class="nav-label">Research</span>
    </button>
    <div class="sidebar-divider"></div>
    <div class="sidebar-section">System</div>
    <button class="sidebar-link" data-page="artifacts" onclick="navigateTo('artifacts')">
      <span class="nav-icon">📚</span><span class="nav-label">Artifacts</span>
    </button>
    <a class="sidebar-link" href="/ui-kit" target="_blank">
      <span class="nav-icon">🎨</span><span class="nav-label">UI Kit</span>
    </a>
    <a class="sidebar-link" href="/health" target="_blank">
      <span class="nav-icon">🩺</span><span class="nav-label">Doctor</span>
    </a>
  </div>
</nav>

<div class="main">
  <!-- ═══ PAGE: Overview ═══ -->
  <div class="page active" id="page-overview">

  <!-- Getting Started panel — hidden when configured -->
  <div class="getting-started" id="getting-started">
    <div class="panel-header">
      🚀 Getting Started
      <button class="dismiss-btn" onclick="dismissGettingStarted()" aria-label="Dismiss Getting Started panel">Dismiss ✕</button>
    </div>
    <div class="gs-steps" id="gs-steps">
      <div class="gs-step" id="gs-preflight">
        <div class="gs-icon">1</div>
        <div class="gs-content">
          <div class="gs-title">Run preflight checks</div>
          <div class="gs-desc">Verify your system is ready — checks connectivity, config, and dependencies.</div>
          <a class="gs-link" href="/health" target="_blank">Open /health →</a>
        </div>
      </div>
      <div class="gs-step" id="gs-connect">
        <div class="gs-icon">2</div>
        <div class="gs-content">
          <div class="gs-title">Connect to your team</div>
          <div class="gs-desc">Bootstrap your host or connect to Reflectt Cloud for team coordination.</div>
          <a class="gs-link" href="/docs" target="_blank">Setup docs →</a>
        </div>
      </div>
      <div class="gs-step" id="gs-task">
        <div class="gs-icon">3</div>
        <div class="gs-content">
          <div class="gs-title">Create your first task</div>
          <div class="gs-desc">Post a task or message — your agents will pick it up automatically.</div>
          <a class="gs-link" href="/docs" target="_blank">API docs →</a>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">🧭 Runtime Truth Card <span class="count" id="truth-count">loading…</span></div>
    <div class="panel-body" id="truth-body"></div>
  </div>

  </div><!-- /page-overview -->

  <!-- ═══ PAGE: Tasks ═══ -->
  <div class="page" id="page-tasks">

  <div class="panel">
    <div class="panel-header">📋 Task Board <span class="count" id="task-count"></span></div>
    <div class="project-tabs" id="project-tabs"></div>
    <div class="kanban" id="kanban"></div>
  </div>

  <div class="panel">
    <div class="panel-header">🔎 Task Search <span class="count" id="search-count"></span></div>
    <div class="panel-body" style="max-height:280px;overflow-y:auto">
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input type="text" id="task-search-input" class="modal-input" placeholder="Search tasks (title, id, assignee)…" autocomplete="off" />
        <button class="modal-copy-btn" onclick="runTaskSearch()">Search</button>
      </div>
      <div id="task-search-results"><div class="empty" style="color:var(--text-muted)">Type a query and press Enter…</div></div>
    </div>
  </div>

  <div class="panel" id="backlog-panel">
    <div class="panel-header">📦 Available Work <span class="count" id="backlog-count"></span></div>
    <div class="panel-body" id="backlog-body" style="max-height:300px;overflow-y:auto"></div>
  </div>

  </div><!-- /page-tasks -->

  <!-- ═══ PAGE: Reviews ═══ -->
  <div class="page" id="page-reviews">

  <div class="panel" id="review-queue-panel">
    <div class="panel-header">👀 Review Queue <span class="count" id="review-queue-count"></span></div>
    <div class="panel-body" id="review-queue-body" style="max-height:350px;overflow-y:auto"></div>
  </div>

  <div class="panel" id="approval-queue-panel">
    <div class="panel-header">🎯 Approval Queue <span class="count" id="approval-queue-count"></span>
      <button id="approval-policy-btn" onclick="toggleRoutingPolicy()" style="float:right;font-size:11px;background:none;border:1px solid var(--border);color:var(--text-muted);padding:2px 8px;border-radius:4px;cursor:pointer">⚙ Policy</button>
    </div>
    <div class="panel-body" id="approval-queue-body" style="max-height:400px;overflow-y:auto"></div>
    <div id="routing-policy-panel" style="display:none;border-top:1px solid var(--border-subtle);padding:12px;max-height:400px;overflow-y:auto"></div>
  </div>

  </div><!-- /page-reviews -->

  <!-- ═══ PAGE: Chat ═══ -->
  <div class="page" id="page-chat">

  <div class="panel">
    <div class="panel-header">💬 Chat <span class="count" id="chat-count"></span></div>
    <div class="channel-tabs" id="channel-tabs"></div>
    <div class="panel-body" id="chat-body"></div>
    <div class="chat-input-bar">
      <select id="chat-channel">
        <option value="general">#general</option>
        <option value="decisions">#decisions</option>
        <option value="shipping">#shipping</option>
        <option value="reviews">#reviews</option>
        <option value="blockers">#blockers</option>
        <option value="problems">#problems</option>
      </select>
      <input type="text" id="chat-input" placeholder="Message as ryan…" autocomplete="off" />
      <button id="chat-send" onclick="sendChat()">Send</button>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">⚡ Activity <span class="count" id="activity-count"></span></div>
    <div class="panel-body" id="activity-body"></div>
  </div>

  <div class="panel">
    <div class="panel-header">💬 Feedback <span class="count" id="feedback-count"></span></div>
    <div class="panel-body" id="feedback-body" style="max-height:350px;overflow-y:auto"></div>
  </div>

  <div class="panel" id="polls-panel">
    <div class="panel-header">🗳️ Team Polls <span class="count" id="polls-count"></span>
      <button onclick="showCreatePollForm()" class="poll-new-btn" aria-label="Create new poll">+ New Poll</button>
    </div>
    <div class="panel-body" id="polls-body" style="max-height:400px;overflow-y:auto"></div>
    <div id="create-poll-form" class="poll-create-form" style="display:none" role="form" aria-label="Create a poll">
      <label for="poll-question" class="poll-form-label">Question</label>
      <input type="text" id="poll-question" class="poll-input" placeholder="What should we do?" aria-required="true" />
      <label class="poll-form-label">Options</label>
      <div id="poll-options-inputs">
        <input type="text" class="poll-option-input poll-input" placeholder="Option 1" aria-label="Poll option 1" />
        <input type="text" class="poll-option-input poll-input" placeholder="Option 2" aria-label="Poll option 2" />
      </div>
      <div class="poll-form-row">
        <button onclick="addPollOption()" class="poll-btn-secondary" aria-label="Add another option">+ Option</button>
        <select id="poll-expiry" class="poll-select" aria-label="Poll expiry">
          <option value="">No expiry</option>
          <option value="60">1 hour</option>
          <option value="240">4 hours</option>
          <option value="1440" selected>24 hours</option>
          <option value="4320">3 days</option>
        </select>
        <label class="poll-anon-label"><input type="checkbox" id="poll-anonymous" /> Anonymous</label>
      </div>
      <div class="poll-form-row">
        <button onclick="submitPoll()" class="poll-btn-primary">Create Poll</button>
        <button onclick="hideCreatePollForm()" class="poll-btn-secondary">Cancel</button>
      </div>
    </div>
  </div>

  </div><!-- /page-chat -->

  <!-- ═══ PAGE: Health ═══ -->
  <div class="page" id="page-health">

  <div class="panel">
    <div class="panel-header">🏥 Team Health <span class="count" id="health-count"></span></div>
    <div class="panel-body" id="health-body"></div>
  </div>

  <div class="panel">
    <div class="panel-header">🛡️ Collaboration Compliance <span class="count" id="compliance-count"></span></div>
    <div class="panel-body" id="compliance-body"></div>
  </div>

  </div><!-- /page-health -->

  <!-- ═══ PAGE: Outcomes ═══ -->
  <div class="page" id="page-outcomes">

  <div class="panel">
    <div class="panel-header">🏁 Outcome Feed <span class="count" id="outcome-count"></span></div>
    <div class="panel-body" id="outcome-body" style="max-height:none;overflow-y:auto"></div>
  </div>

  <div class="panel">
    <div class="panel-header">🧭 Promotion SSOT <span class="count" id="ssot-count"></span></div>
    <div class="panel-body" id="ssot-body"></div>
  </div>

  </div><!-- /page-outcomes -->

  <!-- ═══ PAGE: Research ═══ -->
  <div class="page" id="page-research">

  <div class="panel">
    <div class="panel-header">🔍 Research Intake <span class="count" id="research-count"></span></div>
    <div class="panel-body" id="research-body" style="max-height:none;overflow-y:auto"></div>
  </div>

  </div><!-- /page-research -->

  <!-- ═══ PAGE: Artifacts ═══ -->
  <div class="page" id="page-artifacts">

  <div class="panel" id="shared-artifacts-panel">
    <div class="panel-header">📚 Shared Artifacts <span class="count" id="shared-artifacts-count">loading…</span></div>
    <div class="panel-body" id="shared-artifacts-body" style="max-height:none;overflow-y:auto"></div>
  </div>

  </div><!-- /page-artifacts -->

</div><!-- /.main -->
</div><!-- /.app-layout -->

<script src="/dashboard.js"></script>

<!-- Task Modal -->
<div id="task-modal" class="modal-overlay" onclick="if(event.target===this) closeTaskModal()">
  <div class="modal">
    <div class="modal-header">
      <h2 id="modal-task-title"></h2>
      <button class="modal-close" onclick="closeTaskModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-label">Description</div>
        <div class="modal-value" id="modal-task-desc"></div>
      </div>

      <div class="modal-section">
        <div class="modal-label">Task ID</div>
        <div class="modal-inline-row">
          <div class="modal-value" id="modal-task-id"></div>
          <button class="modal-copy-btn" onclick="copyTaskId()">Copy full ID</button>
        </div>
      </div>
      
      <div class="modal-section">
        <div class="modal-label">Status</div>
        <div class="status-buttons">
          <button class="status-btn" data-status="todo" onclick="updateTaskStatus('todo')">Todo</button>
          <button class="status-btn" data-status="doing" onclick="updateTaskStatus('doing')">Doing</button>
          <button class="status-btn" data-status="blocked" onclick="updateTaskStatus('blocked')">Blocked</button>
          <button class="status-btn" data-status="validating" onclick="updateTaskStatus('validating')">Validating</button>
          <button class="status-btn" data-status="done" onclick="updateTaskStatus('done')">Done</button>
        </div>
      </div>
      
      <div class="modal-section">
        <div class="modal-label">Assignee</div>
        <input type="text" id="modal-task-assignee" class="modal-input" 
               placeholder="Enter agent name (e.g., link, ryan)" 
               onblur="updateTaskAssignee()">
      </div>
      
      <div class="modal-section">
        <div class="modal-label">Priority</div>
        <div class="modal-value" id="modal-task-priority"></div>
      </div>

      <div class="modal-section" id="modal-branch-section" style="display:none">
        <div class="modal-label">Branch</div>
        <div class="modal-value" id="modal-task-branch" style="font-family:monospace;font-size:12px;color:var(--accent)"></div>
      </div>
      
      <div class="modal-section">
        <div class="modal-label">Created</div>
        <div class="modal-value" id="modal-task-created"></div>
      </div>

      <div class="modal-section">
        <div class="modal-label">Blocked by</div>
        <div class="modal-value" id="modal-task-blockers"></div>
      </div>

      <div class="modal-section">
        <div class="modal-label">Artifacts</div>
        <div id="modal-task-artifacts" class="artifact-list"><div class="empty" style="color:var(--text-muted)">No artifacts loaded</div></div>
      </div>

      <!-- PR Review Quality Panel -->
      <div id="pr-review-panel" style="display:none">
        <div style="border-top:1px solid var(--border-subtle);margin-top:16px;padding-top:16px">
          <div id="pr-review-loading" style="color:var(--text-dim);font-size:12px">Loading PR review data…</div>
          <div id="pr-review-content" style="display:none"></div>
        </div>
      </div>
    </div>
  </div>
</div>

</body>
</html>`;
}
