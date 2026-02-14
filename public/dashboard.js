const BASE = location.origin;
let currentChannel = 'all';
let currentProject = 'all';
let allMessages = [];
let allTasks = [];
let allEvents = [];
let taskById = new Map();

const TASK_ID_PATTERN = /\b(task-[a-z0-9-]+)\b/gi;

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

const SSOT_LINKS = [
  { label: 'Promotion Evidence Index', url: 'https://github.com/reflectt/reflectt-node/blob/main/docs/TASK_LINKIFY_PROMOTION_EVIDENCE_INDEX.md' },
  { label: 'Promotion Day Quickstart', url: 'https://github.com/reflectt/reflectt-node/blob/main/docs/TASK_LINKIFY_PROMOTION_DAY_QUICKSTART.md' },
  { label: 'Live Promotion Checklist', url: 'https://github.com/reflectt/reflectt-node/blob/main/docs/TASK_LINKIFY_LIVE_PROMOTION_CHECKLIST_FINAL.md' },
  { label: 'Required-Check Runbook', url: 'https://github.com/reflectt/reflectt-node/blob/main/docs/TASK_LINKIFY_REQUIRED_CHECK_RUNBOOK.md' },
  { label: 'Promotion Run-Window + Comms', url: 'https://github.com/reflectt/reflectt-node/blob/main/docs/TASK_LINKIFY_PROMOTION_RUN_WINDOW_AND_COMMS.md' },
  { label: 'Promotion-Day Smoke Script', url: 'https://github.com/reflectt/reflectt-node/blob/main/tools/task-linkify-promotion-smoke.sh' },
  { label: 'Rollback Drill Notes (pending)', url: null },
];

const SSOT_INDEX_RAW_URL = 'https://raw.githubusercontent.com/reflectt/reflectt-node/main/docs/TASK_LINKIFY_PROMOTION_EVIDENCE_INDEX.md';
let ssotMetaCache = { fetchedAt: 0, lastVerifiedUtc: null };
const SSOT_META_CACHE_MS = 5 * 60 * 1000;

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }
function mentionsRyan(message) { return /@ryan\b/i.test(message || ''); }

function resolveSSOTState(lastVerifiedUtc) {
  if (!lastVerifiedUtc) return { state: 'unknown', label: 'unknown', text: 'verification timestamp unavailable' };
  const ts = Date.parse(lastVerifiedUtc);
  if (!Number.isFinite(ts)) return { state: 'unknown', label: 'unknown', text: 'verification timestamp unavailable' };

  const ageMs = Date.now() - ts;
  const dayMs = 24 * 60 * 60 * 1000;
  if (ageMs <= dayMs) return { state: 'fresh', label: 'fresh', text: 'last verified ' + ago(ts) + ' ago' };
  if (ageMs <= 3 * dayMs) return { state: 'warn', label: 'review soon', text: 'last verified ' + ago(ts) + ' ago' };
  return { state: 'stale', label: 'stale evidence', text: 'last verified ' + ago(ts) + ' ago' };
}

async function fetchSSOTMeta() {
  const now = Date.now();
  if (now - ssotMetaCache.fetchedAt < SSOT_META_CACHE_MS) return ssotMetaCache;

  try {
    const response = await fetch(SSOT_INDEX_RAW_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('status ' + response.status);
    const text = await response.text();
    const match = text.match(/^-\s*last_verified_utc:\s*(.+)$/m);
    ssotMetaCache = {
      fetchedAt: now,
      lastVerifiedUtc: match ? match[1].trim() : null,
    };
  } catch {
    ssotMetaCache = {
      fetchedAt: now,
      lastVerifiedUtc: null,
    };
  }

  return ssotMetaCache;
}

async function renderPromotionSSOT() {
  const body = document.getElementById('ssot-body');
  const count = document.getElementById('ssot-count');
  if (!body || !count) return;

  const available = SSOT_LINKS.filter(item => Boolean(item.url));
  count.textContent = available.length + '/' + SSOT_LINKS.length + ' links';

  const meta = await fetchSSOTMeta();
  const state = resolveSSOTState(meta.lastVerifiedUtc);

  const metaHtml = '<div class="ssot-meta">'
    + '<span class="ssot-meta-text">' + esc(state.text) + '</span>'
    + '<span class="ssot-state-badge ' + state.state + '" aria-label="verification state ' + esc(state.label) + '">' + esc(state.label) + '</span>'
    + '</div>';

  body.innerHTML = metaHtml + '<div class="ssot-list">' + SSOT_LINKS.map(item => {
    const missing = !item.url;
    const action = missing
      ? '<span class="ssot-missing" aria-label="missing target">missing</span>'
      : '<a class="ssot-link" href="' + esc(item.url) + '" target="_blank" rel="noreferrer noopener" aria-label="Open ' + esc(item.label) + '">Open</a>';
    return '<div class="ssot-item"><span class="ssot-item-label">' + esc(item.label) + '</span>' + action + '</div>';
  }).join('') + '</div>';
}

function isTaskTokenInsideUrl(text, start, end) {
  let segStart = start;
  while (segStart > 0 && !/\s/.test(text[segStart - 1])) segStart -= 1;
  let segEnd = end;
  while (segEnd < text.length && !/\s/.test(text[segEnd])) segEnd += 1;
  const tokenSegment = text.slice(segStart, segEnd);
  return /^(https?:\/\/|www\.)/i.test(tokenSegment);
}

function isTaskTokenLinkable(text, start, end) {
  const leftOk = start === 0 || /[^A-Za-z0-9_]/.test(text[start - 1]);
  const rightOk = end >= text.length || /[^A-Za-z0-9_]/.test(text[end]);
  if (!leftOk || !rightOk) return false;
  if (isTaskTokenInsideUrl(text, start, end)) return false;
  return true;
}

function renderMessageContentWithTaskLinks(content) {
  const text = typeof content === 'string' ? content : '';
  if (!text) return '';

  let html = '';
  let cursor = 0;
  TASK_ID_PATTERN.lastIndex = 0;

  let match;
  while ((match = TASK_ID_PATTERN.exec(text)) !== null) {
    const taskId = match[1];
    const start = match.index;
    const end = start + taskId.length;

    html += esc(text.slice(cursor, start));

    if (isTaskTokenLinkable(text, start, end)) {
      const task = taskById.get(taskId);
      const linkText = task ? (task.title + ' (' + taskId + ')') : taskId;
      const tooltip = task
        ? '<span class="task-preview-tooltip"><span class="tp-title">' + esc(task.title) + '</span><span class="tp-meta">' + esc(task.status || '?') + ' · ' + esc(task.assignee || '?') + '</span></span>'
        : '<span class="task-preview-tooltip"><span class="tp-title">' + esc(taskId) + '</span><span class="tp-meta">task not found</span></span>';
      html += '<a href="#" class="task-id-link" data-task-id="' + esc(taskId) + '" style="position:relative">' + esc(linkText) + tooltip + '</a>';
    } else {
      html += esc(taskId);
    }

    cursor = end;
  }

  html += esc(text.slice(cursor));
  return html;
}

function toggleMessageContent(el) {
  if (!el || el.dataset.collapsible !== 'true') return;
  el.classList.toggle('collapsed');
  el.classList.toggle('expanded');
}

function bindTaskLinkHandlers(el) {
  if (!el || el.dataset.taskLinkBound === 'true') return;

  el.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('.task-id-link') : null;
    if (link) {
      event.preventDefault();
      event.stopPropagation();
      openTaskModal(link.dataset.taskId || '');
    }
  });

  el.addEventListener('keydown', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('.task-id-link') : null;
    if (!link) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTaskModal(link.dataset.taskId || '');
    }
  });

  el.dataset.taskLinkBound = 'true';
}

function initChatInteractions() {
  const body = document.getElementById('chat-body');
  if (!body || body.dataset.taskLinkBound === 'true') return;

  body.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('.task-id-link') : null;
    if (link) {
      event.preventDefault();
      event.stopPropagation();
      openTaskModal(link.dataset.taskId || '');
      return;
    }

    const contentEl = event.target && event.target.closest ? event.target.closest('.msg-content') : null;
    if (contentEl) toggleMessageContent(contentEl);
  });

  body.addEventListener('keydown', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('.task-id-link') : null;
    if (!link) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTaskModal(link.dataset.taskId || '');
    }
  });

  body.dataset.taskLinkBound = 'true';
}

function initComplianceInteractions() {
  bindTaskLinkHandlers(document.getElementById('compliance-body'));
}

function complianceState(value, threshold) {
  if (value > threshold) return 'violation';
  if (value >= Math.max(0, threshold - 10)) return 'warning';
  return 'ok';
}

function statusTemplateFor(agent, taskId) {
  const mentions = agent === 'pixel'
    ? '@kai @link'
    : agent === 'link'
      ? '@kai @pixel'
      : agent === 'kai'
        ? '@link @pixel'
        : '@kai @pixel';
  return [
    mentions,
    'Task: ' + (taskId || '<task-id>'),
    '1) Shipped: <artifact/commit/file>',
    '2) Blocker: <none or explicit blocker>',
    '3) Next: <next deliverable + ETA>',
  ].join('\n');
}

async function copyStatusTemplate(agent, taskId) {
  const text = statusTemplateFor(agent, taskId);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function renderCompliance(compliance) {
  const body = document.getElementById('compliance-body');
  const count = document.getElementById('compliance-count');

  if (!compliance) {
    count.textContent = 'no data';
    body.innerHTML = '<div class="empty">No compliance data available</div>';
    return;
  }

  const s = compliance.summary || {};
  const chips = [
    { label: 'Working updates <= 45m', value: s.workerWorstAgeMin || 0, threshold: s.workerCadenceMaxMin || 45 },
    { label: 'Lead watchdog <= 60m', value: s.leadAgeMin || 0, threshold: s.leadCadenceMaxMin || 60 },
    { label: 'Blocked unresolved > 20m', value: s.oldestBlockerMin || 0, threshold: s.blockedEscalationMin || 20 },
    { label: 'Trio silence <= 60m', value: s.trioSilenceMin || 0, threshold: s.trioSilenceMaxMin || 60 },
  ];

  const agents = compliance.agents || [];
  const incidents = compliance.incidents || [];
  count.textContent = incidents.length + ' incident' + (incidents.length === 1 ? '' : 's');

  const chipsHtml = chips.map(c => {
    const state = complianceState(c.value, c.threshold);
    return '<div class="sla-chip ' + state + '"><span>' + esc(c.label) + '</span><strong>' + c.value + 'm</strong></div>';
  }).join('');

  const rows = agents.map(a => {
    const taskValue = a.taskId || '';
    const taskCell = taskValue ? renderMessageContentWithTaskLinks(taskValue) : '—';
    return '<tr>' +
      '<td>' + esc(a.agent) + '</td>' +
      '<td>' + taskCell + '</td>' +
      '<td>' + a.lastValidStatusAgeMin + 'm</td>' +
      '<td>' + a.expectedCadenceMin + 'm</td>' +
      '<td><span class="state-pill ' + a.state + ' compliance-state-' + a.state + '">' + esc(a.state) + '</span></td>' +
      '<td><button class="copy-template-btn" data-agent="' + esc(a.agent) + '" data-task="' + esc(taskValue) + '" onclick="copyStatusTemplate(this.dataset.agent, this.dataset.task)">Copy template</button></td>' +
      '</tr>';
  }).join('');

  const incidentsHtml = incidents.length > 0
    ? incidents.map(i => '<div class="incident-item"><div class="incident-type">' + esc(i.type) + '</div><div>@' + esc(i.agent) + ' • ' + esc(i.taskId || 'no-task') + ' • ' + i.minutesOver + 'm over • escalate ' + esc((i.escalateTo || []).map(function(a){ return '@' + a; }).join(' ')) + '</div></div>').join('')
    : '<div class="empty">No active compliance incidents</div>';

  const linkRow = agents.find(function(a){ return a.agent === 'link'; });
  const linkTemplate = statusTemplateFor('link', (linkRow && linkRow.taskId) || '<task-id>');

  body.innerHTML =
    '<div class="compliance-summary">' + chipsHtml + '</div>' +
    '<table class="compliance-table">' +
      '<thead><tr><th>Agent</th><th>Task</th><th>Last status age</th><th>Cadence</th><th>State</th><th>Action</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" class="empty">No agent compliance data</td></tr>') + '</tbody>' +
    '</table>' +
    '<div class="health-section-title">Incident Queue</div>' +
    incidentsHtml +
    '<div class="health-section-title" style="margin-top:10px;">Status Template</div>' +
    '<div class="template-box">' + esc(linkTemplate) + '</div>';
}

function deriveHealthSignal(agent) {
  if (agent.status !== 'blocked') return { status: agent.status, lowConfidence: false };

  const blockers = agent.recentBlockers || [];
  if (blockers.length === 0) return { status: 'blocked', lowConfidence: false };

  const likelyNoise = blockers.some(b => /no blockers?|unblocked|not blocked|blocked-state|blocker tracking|false.?alarm|status update|dashboard/i.test(b));
  if (likelyNoise || blockers.length === 1) {
    return { status: agent.minutesSinceLastSeen >= 60 ? 'silent' : 'watch', lowConfidence: true };
  }

  return { status: 'blocked', lowConfidence: false };
}

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
    return `<div class="agent-card ${statusClass}">
      <img src="/avatars/${a.name}.png" alt="${a.emoji}" class="agent-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
      <span class="agent-emoji" style="display:none;">${a.emoji}</span>
      <div class="agent-info">
        <div class="agent-role">${esc(a.role)}</div>
        <div class="agent-name">${esc(a.name)}</div>
        <div class="agent-status-text">${esc(statusText)}</div>
      </div>
      <span class="agent-badge ${badgeClass}">${badgeText}</span>
    </div>`;
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

  taskById = new Map();
  allTasks.forEach(task => {
    if (task && task.id) taskById.set(task.id, task);
  });

  renderProjectTabs();
  renderKanban();
  renderBacklog();
  document.getElementById('task-count').textContent = allTasks.length + ' tasks';
}

function renderProjectTabs() {
  const projects = ['All', 'reflectt-node', 'forAgents.dev', 'Team Ops', 'Other'];
  const icons = { 'All': '📋', 'reflectt-node': '🔧', 'forAgents.dev': '🌐', 'Team Ops': '🏢', 'Other': '📦' };
  const tabs = document.getElementById('project-tabs');
  tabs.innerHTML = projects.map(p => {
    const key = p === 'All' ? 'all' : p;
    return `<button class="project-tab ${currentProject === key ? 'active' : ''}" onclick="switchProject('${key}')">${icons[p] || ''} ${p}</button>`;
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
          ? `<span class="assignee-tag">👤 ${esc(t.assignee)}${assigneeAgent ? ' <span class="role-small">' + esc(assigneeAgent.role) + '</span>' : ''}</span>`
          : '<span class="assignee-tag" style="color:var(--yellow)">unassigned</span>';
        return `
        <div class="task-card" data-task-id="${t.id}">
          <div class="task-title">${esc(truncate(t.title, 60))}</div>
          <div class="task-meta">
            ${t.priority ? '<span class="priority-badge ' + t.priority + '">' + t.priority + '</span>' : ''}
            ${assigneeDisplay}
          </div>
        </div>`;
      }).join('');
    const extra = isDone && items.length > 3
      ? `<button class="done-toggle" onclick="this.parentElement.querySelectorAll('.task-card.hidden').forEach(c=>c.classList.remove('hidden'));this.remove()">+ ${items.length - 3} more</button>` : '';
    return `<div class="kanban-col" data-status="${col}">
      <div class="kanban-col-header">${col} <span class="cnt">${items.length}</span></div>
      ${cards}${extra}
    </div>`;
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

// ---- Backlog (Available Work) ----
function renderBacklog() {
  const body = document.getElementById('backlog-body');
  const count = document.getElementById('backlog-count');
  if (!body) return;

  const pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const backlog = allTasks
    .filter(t => t.status === 'todo' && !t.assignee)
    .sort((a, b) => {
      const pa = pOrder[a.priority] ?? 9;
      const pb = pOrder[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });

  if (count) count.textContent = backlog.length + ' items';

  if (backlog.length === 0) {
    body.innerHTML = '<div style="color:var(--text-muted);padding:12px;font-size:13px">No unassigned tasks — all work is claimed ✅</div>';
    return;
  }

  body.innerHTML = backlog.map(t => {
    const criteria = (t.done_criteria || []).length;
    return `<div class="backlog-item" style="padding:10px 14px;border-bottom:1px solid var(--border-subtle);cursor:pointer" onclick="openTaskModal('${t.id}')">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${t.priority ? '<span class="priority-badge ' + t.priority + '">' + t.priority + '</span>' : ''}
        <span style="color:var(--text-bright);font-size:13px;font-weight:500">${esc(truncate(t.title, 70))}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        ${criteria > 0 ? criteria + ' done criteria' : ''}
        ${t.reviewer ? ' · reviewer: ' + esc(t.reviewer) : ''}
      </div>
    </div>`;
  }).join('');
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

  const channelStats = new Map();
  allMessages.forEach(m => {
    const ch = m.channel || 'general';
    if (!channelStats.has(ch)) channelStats.set(ch, { total: 0, mentions: 0 });
    const stats = channelStats.get(ch);
    stats.total += 1;
    if (mentionsRyan(m.content)) stats.mentions += 1;
  });

  const tabs = document.getElementById('channel-tabs');
  tabs.innerHTML = Array.from(channels).map(ch => {
    const stats = ch === 'all'
      ? { total: allMessages.length, mentions: allMessages.filter(m => mentionsRyan(m.content)).length }
      : (channelStats.get(ch) || { total: 0, mentions: 0 });
    const label = ch === 'all' ? '🌐 all' : '#' + esc(ch);
    const countMeta = `<span class="meta">${stats.total}</span>`;
    const mentionDot = (stats.mentions > 0 && ch !== 'all') ? '<span class="mention-dot" title="mentions"></span>' : '';
    return `<button class="channel-tab ${ch === currentChannel ? 'active' : ''}" data-channel="${esc(ch)}" onclick="switchChannel('${ch}')">${label}${countMeta}${mentionDot}</button>`;
  }).join('');
  renderChat();
}
function switchChannel(ch) {
  currentChannel = ch;
  const sendChannel = document.getElementById('chat-channel');
  if (sendChannel && ch !== 'all' && Array.from(sendChannel.options).some(o => o.value === ch)) {
    sendChannel.value = ch;
  }
  document.querySelectorAll('.channel-tab').forEach(t => {
    const normalized = t.getAttribute('data-channel') || '';
    t.classList.toggle('active', normalized === ch);
  });
  renderChat();
}
function renderChat() {
  const filtered = currentChannel === 'all' ? allMessages : allMessages.filter(m => m.channel === currentChannel);
  const shown = filtered.slice(0, 40);
  document.getElementById('chat-count').textContent = filtered.length + ' messages';
  const body = document.getElementById('chat-body');
  initChatInteractions();
  if (shown.length === 0) { body.innerHTML = '<div class="empty">No messages</div>'; return; }
  body.innerHTML = shown.map(m => {
    const long = m.content && m.content.length > 200;
    const agent = AGENTS.find(a => a.name === m.from);
    const roleTag = agent ? `<span class="msg-role">${esc(agent.role)}</span>` : '';
    const mentioned = mentionsRyan(m.content);
    return `
    <div class="msg ${mentioned ? 'mentioned' : ''}">
      <div class="msg-header">
        <span class="msg-from">${esc(m.from)}</span>
        ${roleTag}
        ${m.channel ? '<span class="msg-channel">#' + esc(m.channel) + '</span>' : ''}
        <span class="msg-time">${ago(m.timestamp)}</span>
      </div>
      <div class="msg-content ${long ? 'collapsed' : ''}" data-collapsible="${long ? 'true' : 'false'}">${renderMessageContentWithTaskLinks(m.content)}</div>
    </div>`;
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

// Enter key sends + quick channel switching
function rotateChannel(direction) {
  const tabs = Array.from(document.querySelectorAll('.channel-tab'));
  if (!tabs.length) return;
  const channels = tabs.map(t => t.getAttribute('data-channel') || '').filter(Boolean);
  const currentIndex = Math.max(0, channels.indexOf(currentChannel));
  const nextIndex = (currentIndex + direction + channels.length) % channels.length;
  switchChannel(channels[nextIndex]);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); rotateChannel(1); }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); rotateChannel(-1); }
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
    body.innerHTML = allEvents.slice(0, 20).map(e => `
      <div class="event-row">
        <span class="event-type">${esc(e.type || 'event')}</span>
        ${e.agent ? '<span class="event-agent">' + esc(e.agent) + '</span>' : ''}
        <span class="event-desc">${esc(truncate(e.summary || e.description || '', 60))}</span>
        <span class="event-time">${ago(e.timestamp)}</span>
      </div>`).join('');
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

    const health = cachedHealth || { agents: [], blockers: [], overlaps: [], compliance: null };

    const agents = health.agents || [];
    const blockers = health.blockers || [];
    const overlaps = health.overlaps || [];
    const compliance = health.compliance || null;

    const statusCounts = { active: 0, idle: 0, silent: 0, blocked: 0, offline: 0, watch: 0 };
    const displayAgents = agents.map(a => {
      const derived = deriveHealthSignal(a);
      const displayStatus = a.status === 'silent'
        ? (a.minutesSinceLastSeen >= 120 ? 'blocked' : (a.minutesSinceLastSeen >= 60 ? 'silent' : 'watch'))
        : derived.status;
      statusCounts[displayStatus] = (statusCounts[displayStatus] || 0) + 1;
      return { ...a, displayStatus, lowConfidence: derived.lowConfidence };
    });

    const healthSummary = `${statusCounts.active} active • ${statusCounts.watch + statusCounts.silent} quiet • ${statusCounts.blocked} blocked`;
    document.getElementById('health-count').textContent = healthSummary;

    const body = document.getElementById('health-body');
    let html = '';

    // Agent Health Grid
    if (displayAgents.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">Agent Status</div><div class="health-grid">';
      html += displayAgents.map(a => {
        const statusText = a.minutesSinceLastSeen < 1 ? 'just now' : ago(a.lastSeen) + ' ago';
        const taskDisplay = a.currentTask ? `<div class="health-task">📋 ${esc(truncate(a.currentTask, 35))}</div>` : '';
        const statusLabel = a.displayStatus === 'blocked'
          ? ' • 🚫 blocked'
          : (a.displayStatus === 'silent' ? ' • ⚠️ quiet' : (a.displayStatus === 'watch' ? ' • 👀 watch' : ''));
        const confidenceLabel = a.lowConfidence ? ' • needs review' : '';
        return `
        <div class="health-card ${a.lowConfidence ? 'needs-review' : ''}">
          <div class="health-indicator ${a.displayStatus}"></div>
          <div class="health-info">
            <div class="health-name">${esc(a.agent)}</div>
            <div class="health-status">${statusText}${statusLabel}${confidenceLabel}</div>
            ${taskDisplay}
          </div>
        </div>`;
      }).join('');
      html += '</div></div>';
    }

    // Blockers
    if (blockers.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">🚫 Active Blockers</div>';
      html += blockers.slice(0, 5).map(b => `
        <div class="blocker-item">
          <div class="blocker-agent">${esc(b.agent)}</div>
          <div class="blocker-text">${esc(b.blocker)}</div>
          <div class="blocker-meta">Mentioned ${b.mentionCount}x • Last: ${ago(b.lastMentioned)}</div>
        </div>`).join('');
      html += '</div>';
    }
    
    // Overlaps
    if (overlaps.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">⚠️ Overlapping Work</div>';
      html += overlaps.slice(0, 3).map(o => `
        <div class="overlap-item">
          <div class="overlap-agents">${o.agents.join(', ')}</div>
          <div class="overlap-topic">${esc(o.topic)} (${o.confidence} confidence)</div>
        </div>`).join('');
      html += '</div>';
    }
    
    if (agents.length === 0 && blockers.length === 0 && overlaps.length === 0) {
      html = '<div class="empty">No health data available</div>';
    }
    
    body.innerHTML = html;
    renderCompliance(compliance);
    initComplianceInteractions();
  } catch (e) {
    console.error('Health load error:', e);
    document.getElementById('health-body').innerHTML = '<div class="empty">Failed to load health data</div>';
    document.getElementById('compliance-body').innerHTML = '<div class="empty">Failed to load compliance data</div>';
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
  await renderPromotionSSOT();
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

function setTaskModalInteractivity(enabled) {
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.disabled = !enabled;
  });
  const assigneeInput = document.getElementById('modal-task-assignee');
  if (assigneeInput) assigneeInput.disabled = !enabled;
}

function openTaskModal(taskId) {
  currentTask = allTasks.find(t => t.id === taskId);

  if (!currentTask) {
    setTaskModalInteractivity(false);
    document.getElementById('modal-task-title').textContent = 'Task not found: ' + (taskId || '(missing id)');
    document.getElementById('modal-task-desc').textContent = 'This task ID was referenced in chat but is not present in the current task set. It may be archived, deleted, or not yet synced.';
    document.getElementById('modal-task-assignee').value = '';
    document.getElementById('modal-task-priority').textContent = '—';
    document.getElementById('modal-task-created').textContent = 'Not available';
    document.querySelectorAll('.status-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('task-modal').classList.add('show');
    return;
  }

  setTaskModalInteractivity(true);
  const creatorAgent = AGENTS.find(a => a.name === currentTask.createdBy);
  const createdText = creatorAgent 
    ? `${currentTask.createdBy} (${creatorAgent.role}) • ${ago(currentTask.createdAt)}`
    : `${currentTask.createdBy} • ${ago(currentTask.createdAt)}`;

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
  setTaskModalInteractivity(true);
}

async function updateTaskStatus(status) {
  if (!currentTask) return;
  try {
    const r = await fetch(`${BASE}/tasks/${currentTask.id}`, {
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
    const r = await fetch(`${BASE}/tasks/${currentTask.id}`, {
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