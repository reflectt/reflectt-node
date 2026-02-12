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
  .modal-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
    color: var(--text-muted); font-weight: 600; margin-bottom: 8px;
  }
  .modal-value { font-size: 14px; color: var(--text); line-height: 1.5; }
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
  .msg { padding: 8px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; }
  .msg:last-child { border-bottom: none; }
  .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .msg-from { font-weight: 600; color: var(--accent); font-size: 13px; }
  .msg-role { font-size: 10px; color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 2px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; }
  .msg-channel { font-size: 11px; color: var(--purple); background: rgba(180, 142, 255, 0.08); padding: 1px 6px; border-radius: 3px; }
  .msg-time { font-size: 11px; color: var(--text-muted); margin-left: auto; }
  .msg-content { color: var(--text); font-size: 13px; line-height: 1.5; word-break: break-word; white-space: pre-wrap; }
  .msg-content.collapsed { max-height: 80px; overflow: hidden; position: relative; cursor: pointer; }
  .msg-content.collapsed::after {
    content: '▼ click to expand'; display: block; position: absolute; bottom: 0; left: 0; right: 0;
    background: linear-gradient(transparent, var(--surface) 60%); padding-top: 30px; text-align: center;
    font-size: 11px; color: var(--accent); font-style: italic;
  }
  .msg-content.expanded { max-height: none; cursor: pointer; }
  .event-row { padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12px; display: flex; align-items: center; gap: 8px; }
  .event-row:last-child { border-bottom: none; }
  .event-type { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; background: var(--border); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0; }
  .event-agent { color: var(--accent); font-weight: 600; flex-shrink: 0; }
  .event-desc { color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .event-time { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
  .empty { color: var(--text-muted); font-style: italic; font-size: 13px; padding: 24px 0; text-align: center; }
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
  .health-indicator {
    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    box-shadow: 0 0 8px currentColor;
  }
  .health-indicator.active { background: var(--green); color: var(--green); }
  .health-indicator.idle { background: var(--yellow); color: var(--yellow); }
  .health-indicator.silent { background: var(--orange); color: var(--orange); }
  .health-indicator.blocked, .health-indicator.offline { background: var(--red); color: var(--red); }
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
    <span id="clock"></span>
  </div>
</div>

<div class="agent-strip" id="agent-strip"></div>

<div class="main">
  <div class="panel">
    <div class="panel-header">📋 Task Board <span class="count" id="task-count"></span></div>
    <div class="project-tabs" id="project-tabs"></div>
    <div class="kanban" id="kanban"></div>
  </div>

  <div class="panel">
    <div class="panel-header">🏥 Team Health <span class="count" id="health-count"></span></div>
    <div class="panel-body" id="health-body"></div>
  </div>

  <div class="two-col">
    <div class="panel">
      <div class="panel-header">💬 Chat <span class="count" id="chat-count"></span></div>
      <div class="channel-tabs" id="channel-tabs"></div>
      <div class="panel-body" id="chat-body"></div>
      <div class="chat-input-bar">
        <select id="chat-channel">
          <option value="general">#general</option>
          <option value="problems-and-ideas">#problems</option>
          <option value="shipping">#shipping</option>
          <option value="decisions">#decisions</option>
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

<script>
const BASE = location.origin;
let currentChannel = 'all';
let currentProject = 'all';
let allMessages = [];
let allTasks = [];
let allEvents = [];

// Delta cursors for lower payload refreshes
let lastTaskSync = 0;
let lastChatSync = 0;
let lastActivitySync = 0;

// Health caching: summary each refresh, detail every 60s
let cachedHealth = null;
let lastHealthDetailSync = 0;
let refreshCount = 0;

const AGENTS = [
  { name: 'ryan', emoji: '👤', role: 'Founder' },
  { name: 'kai', emoji: '🤖', role: 'Lead' },
  { name: 'link', emoji: '🔗', role: 'Builder' },
  { name: 'sage', emoji: '🧠', role: 'Strategy' },
  { name: 'rhythm', emoji: '🥁', role: 'Ops' },
  { name: 'pixel', emoji: '🎨', role: 'Design' },
  { name: 'echo', emoji: '📝', role: 'Content' },
  { name: 'scout', emoji: '🔍', role: 'Research' },
  { name: 'harmony', emoji: '🫶', role: 'Health' },
  { name: 'spark', emoji: '🚀', role: 'Growth' },
];

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }

function classifyProject(task) {
  const text = ((task.title || '') + ' ' + (task.description || '')).toLowerCase();
  if (/dashboard|reflectt-node|api|mcp|sse|persistence|event|server|cli|node/.test(text)) return 'reflectt-node';
  if (/foragents|getting.?started|skills|directory|agents\\.dev/.test(text)) return 'forAgents.dev';
  if (/heartbeat|health|roles|team|ops|cleanup|agent.?roles|monitoring|deploy/.test(text)) return 'Team Ops';
  return 'Other';
}

// ---- Presence ----
async function loadPresence() {
  let presenceMap = {};
  try {
    const r = await fetch(BASE + '/presence');
    const d = await r.json();
    const list = d.presences || {};
    if (Array.isArray(list)) list.forEach(p => { presenceMap[p.agent] = p; });
    else Object.entries(list).forEach(([k, p]) => { presenceMap[k] = p; });
  } catch (e) {}

  const agentTasks = {};
  allTasks.filter(t => t.status === 'doing').forEach(t => {
    if (t.assignee) agentTasks[t.assignee] = t.title;
  });

  const strip = document.getElementById('agent-strip');
  strip.innerHTML = AGENTS.map(a => {
    const p = presenceMap[a.name];
    const task = agentTasks[a.name];
    const isActive = p && p.status && p.status !== 'offline';
    const statusClass = task ? 'active' : (isActive ? 'idle' : 'offline');
    const badgeClass = task ? 'working' : (isActive ? 'idle' : 'offline');
    const badgeText = task ? 'Working' : (isActive ? 'Idle' : 'Offline');
    const statusText = task ? truncate(task, 28) : (p && p.lastUpdate ? ago(p.lastUpdate) + ' ago' : '');
    return \`<div class="agent-card \${statusClass}">
      <img src="/avatars/\${a.name}.png" alt="\${a.emoji}" class="agent-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
      <span class="agent-emoji" style="display:none;">\${a.emoji}</span>
      <div class="agent-info">
        <div class="agent-role">\${esc(a.role)}</div>
        <div class="agent-name">\${esc(a.name)}</div>
        <div class="agent-status-text">\${esc(statusText)}</div>
      </div>
      <span class="agent-badge \${badgeClass}">\${badgeText}</span>
    </div>\`;
  }).join('');
}

// ---- Tasks ----
async function loadTasks(forceFull = false) {
  try {
    const useDelta = !forceFull && lastTaskSync > 0;
    const qs = new URLSearchParams();
    qs.set('limit', '80');
    if (useDelta) qs.set('updatedSince', String(lastTaskSync));

    const r = await fetch(BASE + '/tasks?' + qs.toString());
    const d = await r.json();
    const incoming = d.tasks || [];

    if (useDelta && incoming.length === 0) {
      return;
    }

    if (useDelta) {
      const byId = new Map(allTasks.map(t => [t.id, t]));
      incoming.forEach(t => byId.set(t.id, t));
      allTasks = Array.from(byId.values());
    } else {
      allTasks = incoming;
    }

    const maxUpdated = incoming.reduce((max, t) => Math.max(max, t.updatedAt || 0), 0);
    if (maxUpdated > 0) lastTaskSync = Math.max(lastTaskSync, maxUpdated);
  } catch (e) {
    if (!allTasks.length) allTasks = [];
  }
  renderProjectTabs();
  renderKanban();
  document.getElementById('task-count').textContent = allTasks.length + ' tasks';
}

function renderProjectTabs() {
  const projects = ['All', 'reflectt-node', 'forAgents.dev', 'Team Ops', 'Other'];
  const icons = { 'All': '📋', 'reflectt-node': '🔧', 'forAgents.dev': '🌐', 'Team Ops': '🏢', 'Other': '📦' };
  const tabs = document.getElementById('project-tabs');
  tabs.innerHTML = projects.map(p => {
    const key = p === 'All' ? 'all' : p;
    return \`<button class="project-tab \${currentProject === key ? 'active' : ''}" onclick="switchProject('\${key}')">\${icons[p] || ''} \${p}</button>\`;
  }).join('');
}
function switchProject(p) { currentProject = p; renderProjectTabs(); renderKanban(); }

function renderKanban() {
  const filtered = currentProject === 'all' ? allTasks : allTasks.filter(t => classifyProject(t) === currentProject);
  const cols = ['todo', 'doing', 'blocked', 'validating', 'done'];
  const grouped = {}; cols.forEach(c => grouped[c] = []);
  filtered.forEach(t => { const s = t.status || 'todo'; if (grouped[s]) grouped[s].push(t); else grouped['todo'].push(t); });
  const pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  cols.forEach(c => grouped[c].sort((a, b) => (pOrder[a.priority] ?? 9) - (pOrder[b.priority] ?? 9)));

  const kanban = document.getElementById('kanban');
  kanban.innerHTML = cols.map(col => {
    const items = grouped[col];
    const isDone = col === 'done';
    const shown = isDone ? items.slice(0, 3) : items;
    const cards = shown.length === 0
      ? '<div class="empty">—</div>'
      : shown.map(t => {
        const assigneeAgent = t.assignee ? AGENTS.find(a => a.name === t.assignee) : null;
        const assigneeDisplay = t.assignee 
          ? \`<span class="assignee-tag">👤 \${esc(t.assignee)}\${assigneeAgent ? ' <span class="role-small">' + esc(assigneeAgent.role) + '</span>' : ''}</span>\`
          : '<span class="assignee-tag" style="color:var(--yellow)">unassigned</span>';
        return \`
        <div class="task-card" data-task-id="\${t.id}">
          <div class="task-title">\${esc(truncate(t.title, 60))}</div>
          <div class="task-meta">
            \${t.priority ? '<span class="priority-badge ' + t.priority + '">' + t.priority + '</span>' : ''}
            \${assigneeDisplay}
          </div>
        </div>\`;
      }).join('');
    const extra = isDone && items.length > 3
      ? \`<button class="done-toggle" onclick="this.parentElement.querySelectorAll('.task-card.hidden').forEach(c=>c.classList.remove('hidden'));this.remove()">+ \${items.length - 3} more</button>\` : '';
    return \`<div class="kanban-col" data-status="\${col}">
      <div class="kanban-col-header">\${col} <span class="cnt">\${items.length}</span></div>
      \${cards}\${extra}
    </div>\`;
  }).join('');
  
  // Add click/touch handlers for task cards (mobile-friendly)
  setTimeout(() => {
    document.querySelectorAll('.task-card').forEach(card => {
      const taskId = card.getAttribute('data-task-id');
      if (taskId) {
        card.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTaskModal(taskId);
        });
      }
    });
  }, 0);
}

// ---- Chat ----
async function loadChat(forceFull = false) {
  try {
    const qs = new URLSearchParams();
    qs.set('limit', '80');
    if (!forceFull && lastChatSync > 0) qs.set('since', String(lastChatSync));

    const r = await fetch(BASE + '/chat/messages?' + qs.toString());
    const d = await r.json();
    const incoming = d.messages || [];

    if (!forceFull && lastChatSync > 0 && incoming.length === 0) {
      return;
    }

    if (!forceFull && lastChatSync > 0) {
      const byId = new Map(allMessages.map(m => [m.id, m]));
      incoming.forEach(m => byId.set(m.id, m));
      allMessages = Array.from(byId.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 200);
    } else {
      allMessages = incoming.sort((a, b) => b.timestamp - a.timestamp);
    }

    const maxTs = incoming.reduce((max, m) => Math.max(max, m.timestamp || 0), 0);
    if (maxTs > 0) lastChatSync = Math.max(lastChatSync, maxTs);
  } catch (e) {
    if (!allMessages.length) allMessages = [];
  }
  const channels = new Set(['all']);
  allMessages.forEach(m => { if (m.channel) channels.add(m.channel); });
  const tabs = document.getElementById('channel-tabs');
  tabs.innerHTML = Array.from(channels).map(ch =>
    \`<button class="channel-tab \${ch === currentChannel ? 'active' : ''}" onclick="switchChannel('\${ch}')">\${ch === 'all' ? '🌐 all' : '#' + esc(ch)}</button>\`
  ).join('');
  renderChat();
}
function switchChannel(ch) {
  currentChannel = ch;
  document.querySelectorAll('.channel-tab').forEach(t => {
    const label = t.textContent.replace('#', '').replace('🌐 ', '');
    t.classList.toggle('active', label === ch);
  });
  renderChat();
}
function renderChat() {
  const filtered = currentChannel === 'all' ? allMessages : allMessages.filter(m => m.channel === currentChannel);
  const shown = filtered.slice(0, 40);
  document.getElementById('chat-count').textContent = filtered.length + ' messages';
  const body = document.getElementById('chat-body');
  if (shown.length === 0) { body.innerHTML = '<div class="empty">No messages</div>'; return; }
  body.innerHTML = shown.map(m => {
    const long = m.content && m.content.length > 200;
    const agent = AGENTS.find(a => a.name === m.from);
    const roleTag = agent ? \`<span class="msg-role">\${esc(agent.role)}</span>\` : '';
    return \`
    <div class="msg">
      <div class="msg-header">
        <span class="msg-from">\${esc(m.from)}</span>
        \${roleTag}
        \${m.channel ? '<span class="msg-channel">#' + esc(m.channel) + '</span>' : ''}
        <span class="msg-time">\${ago(m.timestamp)}</span>
      </div>
      <div class="msg-content \${long ? 'collapsed' : ''}" onclick="this.classList.toggle('collapsed');this.classList.toggle('expanded')">\${esc(m.content)}</div>
    </div>\`;
  }).join('');
}

// ---- Send chat message ----
async function sendChat() {
  const input = document.getElementById('chat-input');
  const channel = document.getElementById('chat-channel').value;
  const btn = document.getElementById('chat-send');
  const content = input.value.trim();
  if (!content) return;

  btn.disabled = true;
  try {
    await fetch(BASE + '/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'ryan', content, channel }),
    });
    input.value = '';
    await loadChat(true);
  } catch (e) { console.error('Send error:', e); }
  btn.disabled = false;
  input.focus();
}

// Enter key sends
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
});

// ---- Activity ----
async function loadActivity(forceFull = false) {
  try {
    const qs = new URLSearchParams();
    qs.set('limit', '25');
    if (!forceFull && lastActivitySync > 0) qs.set('since', String(lastActivitySync));

    const r = await fetch(BASE + '/activity?' + qs.toString());
    const d = await r.json();
    const incoming = d.events || [];

    if (!forceFull && lastActivitySync > 0 && incoming.length === 0) {
      return;
    }

    if (!forceFull && lastActivitySync > 0) {
      const seen = new Set(allEvents.map(e => e.id));
      const merged = [...incoming.filter(e => !seen.has(e.id)), ...allEvents];
      allEvents = merged.sort((a, b) => b.timestamp - a.timestamp).slice(0, 120);
    } else {
      allEvents = incoming;
    }

    const maxTs = incoming.reduce((max, e) => Math.max(max, e.timestamp || 0), 0);
    if (maxTs > 0) lastActivitySync = Math.max(lastActivitySync, maxTs);

    document.getElementById('activity-count').textContent = allEvents.length + ' events';
    const body = document.getElementById('activity-body');
    if (allEvents.length === 0) { body.innerHTML = '<div class="empty">No recent activity</div>'; return; }
    body.innerHTML = allEvents.slice(0, 20).map(e => \`
      <div class="event-row">
        <span class="event-type">\${esc(e.type || 'event')}</span>
        \${e.agent ? '<span class="event-agent">' + esc(e.agent) + '</span>' : ''}
        <span class="event-desc">\${esc(truncate(e.summary || e.description || '', 60))}</span>
        <span class="event-time">\${ago(e.timestamp)}</span>
      </div>\`).join('');
  } catch (e) {}
}

// ---- Team Health ----
async function loadHealth() {
  try {
    const now = Date.now();
    const shouldRefreshDetail = !cachedHealth || (now - lastHealthDetailSync) > 120000;

    if (shouldRefreshDetail) {
      const r = await fetch(BASE + '/health/team');
      cachedHealth = await r.json();
      lastHealthDetailSync = now;
    }

    const health = cachedHealth || { agents: [], blockers: [], overlaps: [] };

    const statusCounts = { active: 0, idle: 0, silent: 0, blocked: 0, offline: 0 };
    (health.agents || []).forEach(a => statusCounts[a.status]++);

    const healthSummary = \`\${statusCounts.active} active • \${statusCounts.silent} silent • \${statusCounts.blocked} blocked\`;
    document.getElementById('health-count').textContent = healthSummary;

    const body = document.getElementById('health-body');
    const agents = health.agents || [];
    const blockers = health.blockers || [];
    const overlaps = health.overlaps || [];
    
    let html = '';
    
    // Agent Health Grid
    if (agents.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">Agent Status</div><div class="health-grid">';
      html += agents.map(a => {
        const statusText = a.minutesSinceLastSeen < 1 ? 'just now' : ago(a.lastSeen) + ' ago';
        const taskDisplay = a.currentTask ? \`<div class="health-task">📋 \${esc(truncate(a.currentTask, 35))}</div>\` : '';
        return \`
        <div class="health-card">
          <div class="health-indicator \${a.status}"></div>
          <div class="health-info">
            <div class="health-name">\${esc(a.agent)}</div>
            <div class="health-status">\${statusText}\${a.status === 'blocked' ? ' • 🚫 blocked' : ''}</div>
            \${taskDisplay}
          </div>
        </div>\`;
      }).join('');
      html += '</div></div>';
    }
    
    // Blockers
    if (blockers.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">🚫 Active Blockers</div>';
      html += blockers.slice(0, 5).map(b => \`
        <div class="blocker-item">
          <div class="blocker-agent">\${esc(b.agent)}</div>
          <div class="blocker-text">\${esc(b.blocker)}</div>
          <div class="blocker-meta">Mentioned \${b.mentionCount}x • Last: \${ago(b.lastMentioned)}</div>
        </div>\`).join('');
      html += '</div>';
    }
    
    // Overlaps
    if (overlaps.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">⚠️ Overlapping Work</div>';
      html += overlaps.slice(0, 3).map(o => \`
        <div class="overlap-item">
          <div class="overlap-agents">\${o.agents.join(', ')}</div>
          <div class="overlap-topic">\${esc(o.topic)} (\${o.confidence} confidence)</div>
        </div>\`).join('');
      html += '</div>';
    }
    
    if (agents.length === 0 && blockers.length === 0 && overlaps.length === 0) {
      html = '<div class="empty">No health data available</div>';
    }
    
    body.innerHTML = html;
  } catch (e) {
    console.error('Health load error:', e);
    document.getElementById('health-body').innerHTML = '<div class="empty">Failed to load health data</div>';
  }
}

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function refresh() {
  refreshCount += 1;
  const forceFull = refreshCount % 12 === 0; // full sync less often with adaptive polling
  await loadTasks(forceFull);
  await Promise.all([loadPresence(), loadChat(forceFull), loadActivity(forceFull), loadHealth()]);
}

let refreshTimer = null;
let refreshInFlight = false;

function getRefreshIntervalMs() {
  if (document.hidden) return 60000; // background tabs poll lightly
  const recentActivityMs = Date.now() - Math.max(lastChatSync || 0, lastActivitySync || 0, lastTaskSync || 0);
  if (recentActivityMs < 2 * 60 * 1000) return 20000; // active team chatter
  return 30000; // normal foreground cadence
}

async function scheduleNextRefresh() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await refresh();
  } finally {
    refreshInFlight = false;
    refreshTimer = setTimeout(scheduleNextRefresh, getRefreshIntervalMs());
  }
}

function startAdaptiveRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(scheduleNextRefresh, getRefreshIntervalMs());
}

document.addEventListener('visibilitychange', () => {
  startAdaptiveRefresh();
});

// ---- Task Modal ----
let currentTask = null;

function openTaskModal(taskId) {
  currentTask = allTasks.find(t => t.id === taskId);
  if (!currentTask) return;
  
  const creatorAgent = AGENTS.find(a => a.name === currentTask.createdBy);
  const createdText = creatorAgent 
    ? \`\${currentTask.createdBy} (\${creatorAgent.role}) • \${ago(currentTask.createdAt)}\`
    : \`\${currentTask.createdBy} • \${ago(currentTask.createdAt)}\`;
  
  document.getElementById('modal-task-title').textContent = currentTask.title;
  document.getElementById('modal-task-desc').textContent = currentTask.description || '(no description)';
  document.getElementById('modal-task-assignee').value = currentTask.assignee || '';
  document.getElementById('modal-task-priority').textContent = currentTask.priority || 'P3';
  document.getElementById('modal-task-created').textContent = createdText;
  
  // Set active status button
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === currentTask.status);
  });
  
  document.getElementById('task-modal').classList.add('show');
}

function closeTaskModal() {
  document.getElementById('task-modal').classList.remove('show');
  currentTask = null;
}

async function updateTaskStatus(status) {
  if (!currentTask) return;
  try {
    const r = await fetch(\`\${BASE}/tasks/\${currentTask.id}\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (r.ok) {
      await loadTasks();
      closeTaskModal();
    }
  } catch (e) {
    console.error('Failed to update task status:', e);
  }
}

async function updateTaskAssignee() {
  if (!currentTask) return;
  const assignee = document.getElementById('modal-task-assignee').value.trim() || undefined;
  try {
    const r = await fetch(\`\${BASE}/tasks/\${currentTask.id}\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee })
    });
    if (r.ok) {
      await loadTasks();
      currentTask.assignee = assignee;
    }
  } catch (e) {
    console.error('Failed to update task assignee:', e);
  }
}

updateClock();
setInterval(updateClock, 30000);
refresh();
startAdaptiveRefresh();
</script>

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
      
      <div class="modal-section">
        <div class="modal-label">Created</div>
        <div class="modal-value" id="modal-task-created"></div>
      </div>
    </div>
  </div>
</div>

</body>
</html>`;
}
