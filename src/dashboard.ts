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
  :root {
    --bg: #0a0e14;
    --surface: #141920;
    --surface-raised: #1a2028;
    --border: #252d38;
    --border-subtle: #1e2530;
    --text: #d4dae3;
    --text-bright: #eef1f5;
    --text-muted: #6b7a8d;
    --accent: #4da6ff;
    --accent-dim: rgba(77, 166, 255, 0.12);
    --green: #3fb950;
    --green-dim: rgba(63, 185, 80, 0.12);
    --yellow: #d4a017;
    --yellow-dim: rgba(212, 160, 23, 0.12);
    --red: #f85149;
    --red-dim: rgba(248, 81, 73, 0.12);
    --purple: #b48eff;
    --orange: #e08a20;
    --orange-dim: rgba(224, 138, 32, 0.12);
    --radius: 10px;
    --radius-sm: 6px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.55;
    font-size: 14px;
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 28px;
    background: linear-gradient(180deg, #0f141a 0%, var(--bg) 100%);
    border-bottom: 1px solid var(--border-subtle);
  }
  .header-left { display: flex; align-items: center; gap: 10px; }
  .header-logo { font-size: 18px; font-weight: 700; color: var(--text-bright); letter-spacing: -0.3px; }
  .header-logo span { color: var(--accent); }
  .header-right { display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--text-muted); }
  .release-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 999px;
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
    display: flex; gap: 10px; padding: 16px 28px; overflow-x: auto;
    border-bottom: 1px solid var(--border-subtle); background: var(--surface);
  }
  .agent-card {
    flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
    padding: 10px 16px; background: var(--surface-raised); border: 1px solid var(--border);
    border-radius: var(--radius); min-width: 200px; transition: border-color 0.2s;
  }
  .agent-card.active { border-left: 3px solid var(--green); }
  .agent-card.idle { opacity: 0.6; }
  .agent-card.offline { opacity: 0.35; }
  .agent-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
  .agent-emoji { font-size: 22px; line-height: 1; }
  .agent-info { flex: 1; min-width: 0; }
  .agent-name { font-size: 13px; font-weight: 600; color: var(--text-bright); }
  .agent-role { font-size: 10px; color: var(--purple); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .agent-status-text { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agent-pr-link {
    display: inline-flex;
    margin-top: 3px;
    font-size: 10px;
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
  .agent-badge { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
  .agent-badge.working { background: var(--green-dim); color: var(--green); }
  .agent-badge.idle { background: var(--border); color: var(--text-muted); }
  .agent-badge.offline { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  .main { padding: 24px 28px; display: flex; flex-direction: column; gap: 24px; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .panel-header {
    padding: 14px 18px; font-size: 15px; font-weight: 600; color: var(--text-bright);
    border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;
  }
  .panel-header .count { font-size: 12px; color: var(--text-muted); font-weight: 400; }
  .panel-body { padding: 14px 18px; max-height: 450px; overflow-y: auto; }
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
    font-size: 10px;
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
    padding: 8px 16px; font-size: 13px; font-weight: 500; border: none; background: transparent;
    color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent;
    transition: all 0.15s; margin-bottom: -1px;
  }
  .project-tab:hover { color: var(--text); }
  .project-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .kanban { display: flex; gap: 12px; padding: 16px 18px; overflow-x: auto; min-height: 180px; }
  .kanban-col { flex: 1; min-width: 160px; }
  .kanban-col-header {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600;
    color: var(--text-muted); margin-bottom: 10px; padding-bottom: 8px;
    border-bottom: 2px solid var(--border); display: flex; justify-content: space-between; align-items: center;
  }
  .kanban-col-header .cnt { font-weight: 400; font-size: 11px; background: var(--border); padding: 1px 7px; border-radius: 8px; }
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
  .modal-header h2 { font-size: 16px; font-weight: 600; color: var(--text-bright); margin: 0; }
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
  .artifact-meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .artifact-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .artifact-btn {
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .artifact-btn:hover { border-color: var(--accent); color: var(--accent); }
  .artifact-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.2px;
    border: 1px solid var(--border);
    color: var(--text-muted);
    background: var(--surface-raised);
    flex-shrink: 0;
  }
  .artifact-pill.ok { border-color: var(--green); color: #9de6a8; background: var(--green-dim); }
  .artifact-pill.missing { border-color: var(--red); color: #ff9a94; background: var(--red-dim); }
  .modal-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--text-muted); font-weight: 600; margin-bottom: 8px;
  }
  .modal-value { font-size: 14px; color: var(--text); line-height: 1.5; }
  .modal-inline-row { display: flex; align-items: center; gap: 10px; }
  .modal-copy-btn {
    border: 1px solid var(--border-subtle); background: transparent; color: var(--text-muted);
    border-radius: 6px; font-size: 11px; padding: 4px 8px; cursor: pointer;
  }
  .modal-copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .modal-select, .modal-input {
    width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 12px; font-size: 14px; outline: none;
  }
  .modal-select:focus, .modal-input:focus { border-color: var(--accent); }
  .status-buttons {
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .status-btn {
    padding: 6px 14px; font-size: 12px; font-weight: 600; border-radius: var(--radius-sm);
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
    cursor: pointer; transition: all 0.15s;
  }
  .status-btn:hover { border-color: var(--accent); color: var(--accent); }
  .status-btn.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
  .modal-btn {
    padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: var(--radius-sm);
    border: none; cursor: pointer; transition: opacity 0.15s;
  }
  .modal-btn-primary {
    background: var(--accent); color: #fff;
  }
  .modal-btn-primary:hover { opacity: 0.85; }
  .modal-btn-secondary {
    background: var(--border); color: var(--text);
  }
  .modal-btn-secondary:hover { background: var(--text-muted); }
  .task-title { font-size: 13px; font-weight: 500; color: var(--text-bright); margin-bottom: 6px; line-height: 1.4; }
  .task-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .priority-badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; }
  .priority-badge.P0 { background: var(--red-dim); color: var(--red); }
  .priority-badge.P1 { background: var(--orange-dim); color: var(--orange); }
  .priority-badge.P2 { background: var(--yellow-dim); color: var(--yellow); }
  .priority-badge.P3 { background: var(--border); color: var(--text-muted); }
  .assignee-tag { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
  .assignee-tag .role-small { font-size: 9px; color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .done-toggle { font-size: 12px; color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 4px 0; }
  .done-toggle:hover { color: var(--text); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }
  .channel-tabs { display: flex; gap: 2px; padding: 8px 18px 0; overflow-x: auto; }
  .channel-tab {
    padding: 6px 12px; font-size: 12px; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    cursor: pointer; background: transparent; border: none; color: var(--text-muted); font-weight: 500; transition: all 0.15s;
  }
  .channel-tab:hover { background: var(--surface-raised); color: var(--text); }
  .channel-tab.active { background: var(--surface-raised); color: var(--accent); }
  .channel-tab .meta { font-size: 10px; color: var(--text-muted); margin-left: 6px; }
  .channel-tab .mention-dot {
    display: inline-block; width: 7px; height: 7px; border-radius: 50%;
    background: var(--accent); margin-left: 6px; box-shadow: 0 0 8px rgba(77, 166, 255, 0.6);
  }
  .msg { padding: 7px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
  .msg:last-child { border-bottom: none; }
  .msg-header { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 3px; }
  .msg-from { font-weight: 600; color: var(--accent); font-size: 13px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  .msg-role { font-size: 10px; color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .msg-channel { font-size: 11px; color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 1px 6px; border-radius: 3px; }
  .msg-time { font-size: 11px; color: var(--text-muted); margin-left: auto; white-space: nowrap; }
  .msg-edited { font-size: 10px; color: var(--text-muted); opacity: 0.8; }
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
    padding: 8px 10px; font-size: 11px; line-height: 1.4; white-space: nowrap; pointer-events: none;
    box-shadow: 0 4px 12px rgba(0,0,0,.3); color: var(--text);
  }
  .task-id-link:hover .task-preview-tooltip, .task-id-link:focus .task-preview-tooltip { display: block; }
  .task-preview-tooltip .tp-title { font-weight: 600; color: var(--text); }
  .task-preview-tooltip .tp-meta { color: var(--text-muted); font-size: 10px; margin-top: 2px; }
  .task-id-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
  .msg-content.collapsed { max-height: 80px; overflow: hidden; position: relative; cursor: pointer; }
  .msg-content.collapsed::after {
    content: '▼ click to expand'; display: block; position: absolute; bottom: 0; left: 0; right: 0;
    background: linear-gradient(transparent, var(--surface) 60%); padding-top: 30px; text-align: center;
    font-size: 11px; color: var(--accent); font-style: italic;
  }
  .msg-content.expanded { max-height: none; cursor: pointer; }
  .msg.mentioned {
    border-left: 2px solid var(--accent);
    padding-left: 8px;
    background: linear-gradient(90deg, rgba(77, 166, 255, 0.08), transparent 65%);
  }
  .event-row { padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12px; display: flex; align-items: center; gap: 8px; }
  .event-row:last-child { border-bottom: none; }
  .event-type { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: var(--border); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0; }
  .event-agent { color: var(--accent); font-weight: 600; flex-shrink: 0; }
  .event-desc { color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-time { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
  .empty { color: var(--text-muted); font-style: italic; font-size: 13px; padding: 24px 0; text-align: center; }
  .ssot-meta {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    margin-bottom: 8px; padding: 8px 10px; border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm); background: var(--surface-raised); font-size: 12px;
  }
  .ssot-meta-text { color: var(--text-muted); }
  .ssot-state-badge {
    font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px;
    border: 1px solid transparent; text-transform: uppercase; letter-spacing: 0.2px;
  }
  .ssot-state-badge.fresh { color: var(--green); border-color: var(--green); background: var(--green-dim); }
  .ssot-state-badge.warn { color: var(--yellow); border-color: var(--yellow); background: var(--yellow-dim); }
  .ssot-state-badge.stale { color: var(--red); border-color: var(--red); background: var(--red-dim); }
  .ssot-state-badge.unknown { color: var(--text-muted); border-color: var(--text-muted); background: var(--border); }
  .ssot-list { display: grid; gap: 8px; }
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
  .ssot-missing { font-size: 11px; color: var(--yellow); border: 1px solid var(--yellow); border-radius: 10px; padding: 2px 6px; }
  /* Chat input */
  .chat-input-bar {
    display: flex; gap: 8px; padding: 12px 18px;
    border-top: 1px solid var(--border); background: var(--surface-raised);
  }
  .chat-input-bar select {
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; min-width: 120px;
  }
  .chat-input-bar input {
    flex: 1; background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 8px 12px; font-size: 13px; outline: none;
  }
  .chat-input-bar input:focus { border-color: var(--accent); }
  .chat-input-bar input::placeholder { color: var(--text-muted); }
  .chat-input-bar button {
    background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sm);
    padding: 8px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.15s;
  }
  .chat-input-bar button:hover { opacity: 0.85; }
  .chat-input-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  
  /* Team Health Widget */
  .health-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 20px; }
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
  .health-name { font-size: 13px; font-weight: 600; color: var(--text-bright); }
  .health-status { font-size: 11px; color: var(--text-muted); }
  .health-task { font-size: 11px; color: var(--purple); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .health-section { margin-bottom: 16px; }
  .health-section:last-child { margin-bottom: 0; }
  .health-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
  .blocker-item {
    background: var(--red-dim); border-left: 3px solid var(--red); padding: 8px 10px;
    border-radius: var(--radius-sm); margin-bottom: 6px; font-size: 12px;
  }
  .blocker-item:last-child { margin-bottom: 0; }
  .blocker-agent { font-weight: 600; color: var(--red); }
  .blocker-text { color: var(--text); margin-top: 3px; line-height: 1.4; }
  .blocker-meta { font-size: 10px; color: var(--text-muted); margin-top: 3px; }
  .overlap-item {
    background: var(--yellow-dim); border-left: 3px solid var(--yellow); padding: 8px 10px;
    border-radius: var(--radius-sm); margin-bottom: 6px; font-size: 12px;
  }
  .overlap-item:last-child { margin-bottom: 0; }
  .overlap-agents { font-weight: 600; color: var(--yellow); }
  .overlap-topic { color: var(--text); margin-top: 3px; }

  /* Collaboration Compliance */
  .compliance-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
  .sla-chip {
    border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 12px;
    display: flex; justify-content: space-between; gap: 8px; background: var(--bg);
  }
  .sla-chip.ok { border-color: rgba(63,185,80,.4); background: rgba(63,185,80,.08); }
  .sla-chip.warning { border-color: rgba(212,160,23,.45); background: rgba(212,160,23,.1); }
  .sla-chip.violation, .sla-chip.escalated { border-color: rgba(248,81,73,.5); background: rgba(248,81,73,.12); }
  .compliance-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  .compliance-table th, .compliance-table td { text-align: left; padding: 8px; font-size: 12px; border-bottom: 1px solid var(--border-subtle); }
  .compliance-table th { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  .state-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: .3px; }
  .state-pill.ok { color: var(--green); background: var(--green-dim); }
  .state-pill.warning { color: var(--yellow); background: var(--yellow-dim); }
  .state-pill.violation, .state-pill.escalated { color: var(--red); background: var(--red-dim); }
  .copy-template-btn {
    background: var(--surface-raised); color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 5px 8px; font-size: 11px; cursor: pointer;
  }
  .copy-template-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* Review Queue Panel */
  .review-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 12px; border-bottom: 1px solid var(--border-subtle);
    font-size: 13px; transition: background 0.15s;
  }
  .review-item:last-child { border-bottom: none; }
  .review-item:hover { background: var(--surface-raised); cursor: pointer; }
  .review-item-left { flex: 1; min-width: 0; }
  .review-item-title { color: var(--text-bright); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .review-item-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; }
  .review-item-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .sla-badge {
    display: inline-flex; align-items: center; padding: 3px 8px;
    border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.2px;
  }
  .sla-badge.ok { color: var(--green); background: var(--green-dim); border: 1px solid rgba(63,185,80,.3); }
  .sla-badge.warning { color: var(--yellow); background: var(--yellow-dim); border: 1px solid rgba(212,160,23,.3); }
  .sla-badge.breach { color: var(--red); background: var(--red-dim); border: 1px solid rgba(248,81,73,.3); animation: sla-pulse 2s ease-in-out infinite; }
  @keyframes sla-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
  .review-empty { text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px; }

  /* Outcome Feed */
  .outcome-rollup {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }
  .outcome-rollup-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    padding: 8px 10px;
  }
  .outcome-rollup-card .label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .outcome-rollup-card .value {
    margin-top: 2px;
    font-size: 18px;
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
    font-size: 13px;
    font-weight: 600;
    color: var(--text-bright);
  }
  .outcome-item-meta {
    margin-top: 3px;
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .outcome-impact-pill {
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 10px;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; font-size: 11px; color: var(--text-muted);
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
      gap: 12px;
      flex-wrap: wrap;
    }
    .header-right {
      width: 100%;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      flex-wrap: wrap;
    }
    .agent-strip { gap: 8px; }
    .agent-card { min-width: 170px; padding: 8px 10px; border-radius: 12px; }
    .main { padding-top: 20px; padding-bottom: 20px; gap: 20px; }
    .panel { border-radius: 12px; }
    .panel-header { padding: 12px 16px; font-size: 14px; }
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
    .task-card { margin-bottom: 12px; border-radius: 8px; }
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
    .health-grid { grid-template-columns: 1fr; gap: 8px; }
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
    .msg-header { gap: 4px; }
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
    .two-col { gap: 16px; }
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
    .header-right { gap: 12px; }
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
  button:hover, .button:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  button:active, .button:active {
    transform: translateY(0);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
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
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    transition: outline-offset var(--transition-fast) var(--easing-smooth);
  }
  :focus-visible:not(:active) {
    outline-offset: 4px;
  }

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
    padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
    cursor: pointer; border: 1px solid var(--border); background: var(--surface-raised);
    color: var(--text-muted); transition: all var(--transition-base) var(--easing-smooth);
    user-select: none;
  }
  .focus-toggle:hover { border-color: var(--accent); color: var(--text); }
  .focus-toggle.active {
    background: var(--accent-dim); border-color: var(--accent); color: var(--accent);
  }
  .focus-toggle .focus-icon { font-size: 14px; }

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
    font-size: 11px; line-height: 1.5;
  }
  .qa-contract .qa-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .qa-contract .qa-row + .qa-row { margin-top: 3px; }
  .qa-contract .qa-label { color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px; }
  .qa-contract .qa-value { color: var(--text-bright); font-weight: 500; }
  .qa-contract .qa-value.missing { color: var(--yellow); font-style: italic; }
  .qa-contract .qa-value.has-artifact { color: var(--green); }

  /* Feedback Cards */
  .feedback-card {
    padding: 10px 12px; border-bottom: 1px solid var(--border-subtle);
  }
  .feedback-card:last-child { border-bottom: none; }
  .feedback-card .fb-header {
    display: flex; align-items: center; gap: 6px; font-size: 11px;
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
    display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 10px;
  }
  .feedback-card .fb-email { color: var(--text-dim); }
  .feedback-card .fb-votes { color: var(--text-muted); cursor: pointer; }
  .feedback-card .fb-votes:hover { color: var(--accent); }
  .feedback-card .fb-actions { margin-left: auto; display: flex; gap: 4px; }
  .feedback-card .fb-actions button {
    font-size: 10px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
    border: 1px solid var(--border-subtle); background: none; color: var(--text-muted);
  }
  .feedback-card .fb-actions button:hover { background: var(--surface-raised); color: var(--text-bright); }

  /* Approval Queue */
  .approval-card {
    padding: 10px 12px; margin-bottom: 6px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
  }
  .approval-card .approval-header {
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
  }
  .approval-card .approval-title { font-size: 12px; font-weight: 600; color: var(--text-bright); flex: 1; }
  .approval-card .approval-meta {
    font-size: 10px; color: var(--text-muted); margin-top: 4px;
  }
  .approval-card .approval-actions {
    display: flex; gap: 4px; margin-top: 8px; justify-content: flex-end;
  }
  .approval-card .approval-actions button {
    font-size: 10px; padding: 3px 10px; border-radius: 4px; cursor: pointer; border: none;
  }
  .approval-card .btn-approve { background: var(--green); color: #fff; }
  .approval-card .btn-reject { background: var(--red); color: #fff; }
  .approval-card .btn-edit { background: none; border: 1px solid var(--border) !important; color: var(--text-muted); }
  .approval-card .confidence-score {
    font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 8px;
  }
  .approval-card .confidence-score.high { background: rgba(76,175,80,0.15); color: var(--green); }
  .approval-card .confidence-score.low { background: rgba(255,193,7,0.15); color: var(--yellow); }
  .batch-approve-bar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: var(--surface); border-bottom: 1px solid var(--border-subtle);
    font-size: 11px; color: var(--text-muted);
  }
  .batch-approve-bar button {
    font-size: 11px; padding: 4px 12px; border-radius: 4px; border: none;
    background: var(--green); color: #fff; cursor: pointer; font-weight: 600;
  }
  .batch-approve-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
  /* Routing Policy Editor */
  .policy-agent-card {
    padding: 10px 12px; margin-bottom: 8px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
  }
  .policy-agent-card .agent-name { font-size: 13px; font-weight: 600; color: var(--text-bright); }
  .policy-agent-card .tag-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .policy-agent-card .tag-chip {
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 10px; padding: 2px 8px; border-radius: 10px;
    background: var(--surface); border: 1px solid var(--border-subtle); color: var(--text-muted);
  }
  .policy-agent-card .tag-chip .tag-remove {
    cursor: pointer; color: var(--red); font-size: 11px; margin-left: 2px;
  }
  .policy-agent-card .weight-row {
    display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 11px;
  }
  .policy-agent-card .weight-row input[type="range"] { flex: 1; }
  .policy-agent-card .weight-row .weight-val { font-weight: 600; color: var(--text-bright); min-width: 28px; }
  .policy-save-bar {
    display: flex; justify-content: flex-end; align-items: center; gap: 8px;
    padding: 8px 0; margin-top: 8px; border-top: 1px solid var(--border-subtle);
  }
  .policy-save-bar button { font-size: 11px; padding: 4px 12px; border-radius: 4px; border: none; cursor: pointer; }
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
  .pr-review-header .pr-title { font-size: 13px; font-weight: 600; color: var(--text-bright); }
  .pr-review-header .pr-meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .pr-review-header a { color: var(--accent); text-decoration: none; }
  .pr-review-header a:hover { text-decoration: underline; }
  .diff-scope-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px;
    margin-bottom: 8px;
  }
  .diff-stat-card {
    padding: 8px 10px; background: var(--surface-raised); border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle); text-align: center;
  }
  .diff-stat-card .stat-value { font-size: 16px; font-weight: 700; color: var(--text-bright); }
  .diff-stat-card .stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
  .risk-badge {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600;
  }
  .risk-badge.small { background: rgba(76,175,80,0.15); color: var(--green); }
  .risk-badge.medium { background: rgba(255,193,7,0.15); color: var(--yellow); }
  .risk-badge.large { background: rgba(244,67,54,0.15); color: var(--red); }
  .dir-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 3px 0; font-size: 11px; border-bottom: 1px solid var(--border-subtle);
  }
  .dir-row:last-child { border-bottom: none; }
  .dir-name { color: var(--text-bright); font-family: monospace; font-size: 11px; }
  .dir-stats { color: var(--text-muted); font-size: 10px; }
  .ci-check-row {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 0; font-size: 11px;
  }
  .ci-check-row .check-icon { font-size: 13px; flex-shrink: 0; }
  .ci-check-row .check-name { color: var(--text-bright); flex: 1; }
  .ci-check-row .check-duration { color: var(--text-dim); font-size: 10px; }
  .ci-check-row a { color: var(--accent); text-decoration: none; font-size: 10px; }
  .criterion-row {
    padding: 6px 8px; margin-bottom: 4px; border-radius: var(--radius-sm);
    background: var(--surface-raised); border: 1px solid var(--border-subtle);
  }
  .criterion-row .criterion-text { font-size: 12px; color: var(--text-bright); margin-bottom: 4px; display: flex; align-items: flex-start; gap: 6px; }
  .criterion-row .criterion-evidence { font-size: 10px; color: var(--text-muted); padding-left: 20px; }
  .criterion-row .criterion-evidence .evidence-item { margin-top: 2px; }
  .confidence-badge {
    display: inline-block; padding: 1px 6px; border-radius: 8px;
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
    font-size: 11px; color: var(--text-muted); font-weight: 400; font-style: italic;
  }
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

<div class="agent-strip" id="agent-strip"></div>

<div class="main">
  <div class="panel">
    <div class="panel-header">🧭 Runtime Truth Card <span class="count" id="truth-count">loading…</span></div>
    <div class="panel-body" id="truth-body"></div>
  </div>

  <div class="panel focus-collapse" id="shared-artifacts-panel">
    <div class="panel-header">📚 Shared Artifacts <span class="count" id="shared-artifacts-count">loading…</span></div>
    <div class="panel-body" id="shared-artifacts-body" style="max-height:260px;overflow-y:auto"></div>
  </div>

  <div class="panel">
    <div class="panel-header">📋 Task Board <span class="count" id="task-count"></span></div>
    <div class="project-tabs" id="project-tabs"></div>
    <div class="kanban" id="kanban"></div>
  </div>

  <div class="panel focus-collapse">
    <div class="panel-header">🔎 Task Search <span class="count" id="search-count"></span></div>
    <div class="panel-body" style="max-height:280px;overflow-y:auto">
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input type="text" id="task-search-input" class="modal-input" placeholder="Search tasks (title, id, assignee)…" autocomplete="off" />
        <button class="modal-copy-btn" onclick="runTaskSearch()">Search</button>
      </div>
      <div id="task-search-results"><div class="empty" style="color:var(--text-muted)">Type a query and press Enter…</div></div>
    </div>
  </div>

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

  <div class="panel" id="backlog-panel">
    <div class="panel-header">📦 Available Work <span class="count" id="backlog-count"></span></div>
    <div class="panel-body" id="backlog-body" style="max-height:300px;overflow-y:auto"></div>
  </div>

  <div class="panel focus-collapse">
    <div class="panel-header">💬 Feedback <span class="count" id="feedback-count"></span></div>
    <div class="panel-body" id="feedback-body" style="max-height:350px;overflow-y:auto"></div>
  </div>

  <div class="panel">
    <div class="panel-header">🔍 Research Intake <span class="count" id="research-count"></span></div>
    <div class="panel-body" id="research-body" style="max-height:260px;overflow-y:auto"></div>
  </div>

  <div class="panel focus-collapse">
    <div class="panel-header">🏁 Outcome Feed <span class="count" id="outcome-count"></span></div>
    <div class="panel-body" id="outcome-body" style="max-height:320px;overflow-y:auto"></div>
  </div>

  <div class="panel">
    <div class="panel-header">🏥 Team Health <span class="count" id="health-count"></span></div>
    <div class="panel-body" id="health-body"></div>
  </div>

  <div class="panel focus-collapse">
    <div class="panel-header">🛡️ Collaboration Compliance <span class="count" id="compliance-count"></span></div>
    <div class="panel-body" id="compliance-body"></div>
  </div>

  <div class="panel focus-collapse">
    <div class="panel-header">🧭 Promotion SSOT <span class="count" id="ssot-count"></span></div>
    <div class="panel-body" id="ssot-body"></div>
  </div>

  <div class="two-col">
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
  </div>
</div>

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
