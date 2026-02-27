const BASE = location.origin;
let currentChannel = 'all';
let currentProject = 'all';
let allMessages = [];
let allTasks = [];
let allEvents = [];
let taskById = new Map();
let healthAgentMap = new Map();
let focusModeActive = false;

const TASK_ID_PATTERN = /\b(task-[a-z0-9-]+)\b/gi;

// Delta cursors for lower payload refreshes
let lastTaskSync = 0;
let lastChatSync = 0;
let lastActivitySync = 0;

// Health caching: summary each refresh, detail every 60s
let cachedHealth = null;
let lastHealthDetailSync = 0;
let refreshCount = 0;
let lastReleaseStatusSync = 0;

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
const AGENT_INDEX = new Map(AGENTS.map(a => [a.name, a]));

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

function formatProductiveText(agent) {
  if (!agent || !agent.lastProductiveAt) return 'No recent shipped signal';
  return 'Last shipped signal: ' + ago(agent.lastProductiveAt) + ' ago';
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }
function renderTaskTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  const shown = tags.filter(Boolean).slice(0, 3);
  if (shown.length === 0) return '';
  return shown.map(tag => `<span class="assignee-tag" style="color:var(--purple)">#${esc(String(tag))}</span>`).join(' ');
}

function extractTaskPrLink(task) {
  if (!task || !task.metadata || typeof task.metadata !== 'object') return null;
  const metadata = task.metadata;
  const candidates = [];
  if (typeof metadata.pr_url === 'string') candidates.push(metadata.pr_url);
  if (typeof metadata.pr_link === 'string') candidates.push(metadata.pr_link);
  if (Array.isArray(metadata.artifacts)) {
    metadata.artifacts.forEach(item => { if (typeof item === 'string') candidates.push(item); });
  }
  if (metadata.qa_bundle && typeof metadata.qa_bundle === 'object' && Array.isArray(metadata.qa_bundle.artifact_links)) {
    metadata.qa_bundle.artifact_links.forEach(item => { if (typeof item === 'string') candidates.push(item); });
  }

  const regex = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+(?:[^\s]*)?/i;
  for (const c of candidates) {
    const m = String(c || '').match(regex);
    if (m) return m[0];
  }
  return null;
}

function renderBlockedByLinks(task, options = {}) {
  const ids = Array.isArray(task?.blocked_by) ? task.blocked_by.filter(Boolean) : [];
  if (ids.length === 0) return '';

  const compact = Boolean(options.compact);
  const blockerLinks = ids.slice(0, compact ? 2 : 6).map(blockerId => {
    const blocker = taskById.get(blockerId);
    const label = blocker?.title ? truncate(blocker.title, compact ? 28 : 60) : blockerId;
    return `<button class="assignee-tag" style="cursor:pointer" onclick="event.stopPropagation(); openTaskModal('${esc(blockerId)}')">↳ ${esc(label)}</button>`;
  }).join(' ');

  const extraCount = ids.length - (compact ? 2 : 6);
  const extraText = extraCount > 0 ? ` <span class="assignee-tag">+${extraCount} more</span>` : '';
  return `<div class="task-meta" style="margin-top:6px">⛔ blocker${ids.length > 1 ? 's' : ''}: ${blockerLinks}${extraText}</div>`;
}

function getStatusContractWarnings(task) {
  if (!task || !task.status) return [];
  const warnings = [];
  const eta = task?.metadata?.eta;
  const artifactPath = task?.metadata?.artifact_path;

  if (task.status === 'doing') {
    if (!task.reviewer) warnings.push('doing: missing reviewer');
    if (!eta) warnings.push('doing: missing ETA');
  }

  if (task.status === 'validating') {
    if (!artifactPath) warnings.push('validating: missing artifact_path');
  }

  return warnings;
}

function renderStatusContractWarning(task) {
  const warnings = getStatusContractWarnings(task);
  if (warnings.length === 0) return '';
  return `<div style="margin-top:6px;font-size:11px;color:var(--yellow)">⚠ ${esc(warnings.join(' · '))}</div>`;
}

function renderLaneTransitionMeta(task) {
  const laneState = task?.metadata?.lane_state;
  const last = task?.metadata?.last_transition;
  const actor = typeof last?.actor === 'string' ? last.actor : null;
  const ts = typeof last?.timestamp === 'number' ? last.timestamp : null;
  const type = typeof last?.type === 'string' ? last.type : null;

  if (!laneState && !actor && !ts && !type) return '';

  const parts = [];
  if (laneState) parts.push(`lane:${laneState}`);
  if (type) parts.push(type);
  if (actor) parts.push(`by ${actor}`);
  if (ts) parts.push(ago(ts) + ' ago');

  return `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">🧭 ${esc(parts.join(' · '))}</div>`;
}

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

function renderIdleNudgeSummary(idleNudgeDebug) {
  if (!idleNudgeDebug || !idleNudgeDebug.summary) {
    return '<div class="health-section"><div class="health-section-title">🔕 Idle Nudge Summary</div><div class="empty">No idle-nudge summary available</div></div>';
  }

  const reasonCounts = idleNudgeDebug.summary.reasonCounts || {};
  const suppressedReasons = ['recent-activity-suppressed', 'validating-task-suppressed', 'missing-active-task'];
  const rows = suppressedReasons
    .map(reason => ({ reason, count: Number(reasonCounts[reason] || 0) }))
    .filter(row => row.count > 0);

  const totalSuppressed = rows.reduce((sum, row) => sum + row.count, 0);
  const totalNudged = Number((idleNudgeDebug.summary.decisionCounts || {}).warn || 0) + Number((idleNudgeDebug.summary.decisionCounts || {}).escalate || 0);

  const detail = rows.length > 0
    ? rows.map(row => `<div class="event-row"><span class="event-type">suppressed</span><span class="event-desc">${esc(row.reason)}: ${row.count}</span></div>`).join('')
    : '<div class="empty">No suppressions in latest tick</div>';

  return `<div class="health-section"><div class="health-section-title">🔕 Idle Nudge Summary</div><div class="event-row"><span class="event-type">nudged</span><span class="event-desc">warn/escalate: ${totalNudged}</span></div><div class="event-row"><span class="event-type">suppressed</span><span class="event-desc">total: ${totalSuppressed}</span></div>${detail}</div>`;
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

function healthPriorityRank(agent) {
  if (agent.idleWithActiveTask || agent.displayStatus === 'blocked') return 0;
  if (agent.displayStatus === 'silent' || agent.displayStatus === 'watch' || agent.lowConfidence) return 1;
  return 2;
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
    const taskTitle = agentTasks[a.name];
    const healthRow = healthAgentMap.get(a.name);
    const activeTaskTitle = healthRow?.activeTaskTitle || healthRow?.currentTask || taskTitle || '';
    const activeTaskId = healthRow?.activeTaskId || null;
    const activeTaskPr = healthRow?.activeTaskPrLink || null;

    const isActive = p && p.status && p.status !== 'offline';
    const isWorking = Boolean(activeTaskTitle);
    const statusClass = isWorking ? 'active' : (isActive ? 'idle' : 'offline');
    const badgeClass = isWorking ? 'working' : (isActive ? 'idle' : 'offline');
    const badgeText = isWorking ? 'Working' : (isActive ? 'Idle' : 'Offline');

    const lastSeenText = (p && p.lastUpdate) ? ago(p.lastUpdate) + ' ago' : '';
    const taskText = activeTaskTitle ? truncate(activeTaskTitle, 40) : lastSeenText;
    const prHtml = activeTaskPr
      ? `<a class="agent-pr-link" href="${esc(activeTaskPr)}" target="_blank" rel="noreferrer noopener" onclick="event.stopPropagation()">PR ↗</a>`
      : '';
    const taskIdHtml = activeTaskId ? `<span class="assignee-tag" style="margin-left:4px">${esc(activeTaskId.slice(0, 12))}</span>` : '';

    return `<div class="agent-card ${statusClass}">
      <img src="/avatars/${a.name}.png" alt="${a.emoji}" class="agent-avatar" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
      <span class="agent-emoji" style="display:none;">${a.emoji}</span>
      <div class="agent-info">
        <div class="agent-role">${esc(a.role)}</div>
        <div class="agent-name">${esc(a.name)}</div>
        <div class="agent-status-text">${esc(taskText)} ${taskIdHtml}</div>
        ${prHtml}
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
  renderOutcomeFeed();
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
        const branchDisplay = t.metadata?.branch && t.status === 'doing'
          ? `<div style="margin-top:4px"><span class="assignee-tag" style="font-family:monospace;font-size:10px;color:var(--accent)">🌿 ${esc(t.metadata.branch)}</span></div>`
          : '';
        return `
        <div class="task-card" data-task-id="${t.id}">
          <div class="task-title">${esc(truncate(t.title, 60))}</div>
          <div class="task-meta">
            ${t.priority ? '<span class="priority-badge ' + t.priority + '">' + t.priority + '</span>' : ''}
            ${assigneeDisplay}
            ${(t.commentCount || 0) > 0 ? '<span class="assignee-tag">💬 ' + t.commentCount + '</span>' : ''}
            ${renderTaskTags(t.tags)}
          </div>
          ${branchDisplay}
          ${renderBlockedByLinks(t, { compact: true })}
          ${renderStatusContractWarning(t)}
          ${renderLaneTransitionMeta(t)}
          ${renderQaContract(t)}
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
  const panel = document.getElementById('backlog-panel');
  const body = document.getElementById('backlog-body');
  const count = document.getElementById('backlog-count');
  if (!body || !panel) return;

  const pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const backlog = allTasks
    .filter(t => t.status === 'todo' && !t.assignee)
    .sort((a, b) => {
      const pa = pOrder[a.priority] ?? 9;
      const pb = pOrder[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });

  if (backlog.length === 0) {
    panel.style.display = 'none';
    if (count) count.textContent = '0 items';
    body.innerHTML = '';
    return;
  }

  panel.style.display = '';
  if (count) count.textContent = backlog.length + ' items';

  body.innerHTML = backlog.map(t => {
    const criteriaList = Array.isArray(t.done_criteria) ? t.done_criteria : [];
    const criteriaCount = criteriaList.length;
    const criteriaPreview = criteriaCount > 0 ? esc(truncate(criteriaList[0], 72)) : 'No done criteria listed';

    return `<div class="backlog-item" style="padding:10px 14px;border-bottom:1px solid var(--border-subtle);cursor:pointer" onclick="openTaskModal('${t.id}')">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${t.priority ? '<span class="priority-badge ' + t.priority + '">' + t.priority + '</span>' : ''}
        <span style="color:var(--text-bright);font-size:13px;font-weight:500">${esc(truncate(t.title, 70))}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">
        ${criteriaCount} done criteria${t.reviewer ? ' · reviewer: ' + esc(t.reviewer) : ''}${(t.commentCount || 0) > 0 ? ' · 💬 ' + t.commentCount : ''}
      </div>
      ${Array.isArray(t.tags) && t.tags.length > 0 ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:6px">${renderTaskTags(t.tags)}</div>` : ''}
      ${renderStatusContractWarning(t)}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px">
        <div style="font-size:11px;color:var(--text-dim)">↳ ${criteriaPreview}</div>
        <button onclick="claimBacklogTask('${t.id}', event)" style="background:var(--accent);border:0;border-radius:8px;color:white;font-size:11px;padding:4px 9px;cursor:pointer;white-space:nowrap">Claim</button>
      </div>
    </div>`;
  }).join('');
}

async function claimBacklogTask(taskId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const defaultAgent = localStorage.getItem('reflectt-dashboard-agent') || 'scout';
  const agent = (window.prompt('Claim this task as which agent?', defaultAgent) || '').trim().toLowerCase();
  if (!agent) return;

  localStorage.setItem('reflectt-dashboard-agent', agent);

  try {
    const r = await fetch(`${BASE}/tasks/${taskId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    const d = await r.json();
    if (!d.success) {
      alert(d.error || 'Failed to claim task');
      return;
    }
    await loadTasks(true);
  } catch (err) {
    console.error('Claim failed:', err);
    alert('Failed to claim task');
  }
}

function resolveOutcomeImpact(task) {
  const priority = String(task?.priority || 'P3').toUpperCase();
  const outcome = task?.metadata?.outcome_checkpoint || {};
  const verdict = String(outcome.verdict || '').toUpperCase();

  if (verdict === 'FAIL' || verdict === 'BLOCKED' || priority === 'P0') return 'high';
  if (priority === 'P1' || priority === 'P2') return 'medium';
  return 'low';
}

function taskHasShippedProof(task) {
  const metadata = task?.metadata || {};
  const artifacts = Array.isArray(metadata.artifacts) ? metadata.artifacts : [];
  const qaBundle = metadata.qa_bundle;
  return artifacts.length > 0 || Boolean(metadata.artifact_path) || Boolean(qaBundle);
}

function renderOutcomeFeed() {
  const body = document.getElementById('outcome-body');
  const count = document.getElementById('outcome-count');
  if (!body || !count) return;

  const shippedDone = allTasks
    .filter(task => task.status === 'done' && taskHasShippedProof(task))
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  count.textContent = shippedDone.length + ' shipped';

  if (shippedDone.length === 0) {
    body.innerHTML = '<div class="empty">No shipped outcomes yet</div>';
    return;
  }

  const rollup = { high: 0, medium: 0, low: 0 };
  shippedDone.forEach(task => {
    const impact = resolveOutcomeImpact(task);
    rollup[impact] += 1;
  });

  const itemsHtml = shippedDone.slice(0, 8).map(task => {
    const impact = resolveOutcomeImpact(task);
    const outcome = task?.metadata?.outcome_checkpoint || {};
    const verdict = outcome.verdict ? String(outcome.verdict).toUpperCase() : 'N/A';
    const artifactPath = task?.metadata?.artifact_path;
    const artifactLink = typeof artifactPath === 'string' && artifactPath.startsWith('http')
      ? `<a class="ssot-link" href="${esc(artifactPath)}" target="_blank" rel="noreferrer noopener">artifact</a>`
      : (artifactPath ? `<span>${esc(truncate(String(artifactPath), 42))}</span>` : '<span>no artifact link</span>');

    return `<div class="outcome-item">
      <div class="outcome-item-title">${esc(truncate(task.title || task.id, 78))}</div>
      <div class="outcome-item-meta">
        <span class="outcome-impact-pill ${impact}">${impact}</span>
        <span>${esc(task.priority || 'P3')}</span>
        <span>verdict: ${esc(verdict)}</span>
        <span>by @${esc(task.assignee || 'unknown')}</span>
        <span>${ago(task.updatedAt || task.createdAt || Date.now())} ago</span>
      </div>
      <div class="outcome-item-meta">${artifactLink}</div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="outcome-rollup">
      <div class="outcome-rollup-card high"><div class="label">high impact</div><div class="value">${rollup.high}</div></div>
      <div class="outcome-rollup-card medium"><div class="label">medium impact</div><div class="value">${rollup.medium}</div></div>
      <div class="outcome-rollup-card low"><div class="label">low impact</div><div class="value">${rollup.low}</div></div>
    </div>
    ${itemsHtml}
  `;
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
    const agent = AGENT_INDEX.get(m.from);
    const roleTag = agent ? `<span class="msg-role">${esc(agent.role)}</span>` : '';
    const mentioned = mentionsRyan(m.content);
    const channelTag = m.channel ? '<span class="msg-channel">#' + esc(m.channel) + '</span>' : '';
    const editedTag = m.metadata && m.metadata.editedAt ? '<span class="msg-edited">(edited)</span>' : '';
    return `
    <div class="msg ${mentioned ? 'mentioned' : ''}">
      <div class="msg-header">
        <span class="msg-from">${esc(m.from)}</span>
        ${roleTag}
        ${channelTag}
        <span class="msg-time">${ago(m.timestamp)}</span>
        ${editedTag}
      </div>
      <div class="msg-content">${renderMessageContentWithTaskLinks(m.content)}</div>
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

function getSlaBadge(dueAt, status) {
  if (!dueAt || status === 'answered' || status === 'archived') return '<span class="assignee-tag">no SLA</span>';
  const ms = dueAt - Date.now();
  if (ms <= 0) return '<span class="assignee-tag" style="color:var(--red)">overdue</span>';
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= 24) return `<span class="assignee-tag" style="color:var(--yellow)">${hours}h left</span>`;
  const days = Math.ceil(hours / 24);
  return `<span class="assignee-tag" style="color:var(--green)">${days}d left</span>`;
}

// ---- Research Intake ----
async function loadResearch() {
  try {
    const [reqRes, findingRes] = await Promise.all([
      fetch(BASE + '/research/requests?limit=12'),
      fetch(BASE + '/research/findings?limit=20'),
    ]);

    const reqData = await reqRes.json();
    const findingData = await findingRes.json();

    const requests = reqData.requests || [];
    const findings = findingData.findings || [];
    const findingMap = new Map();
    findings.forEach(f => {
      findingMap.set(f.requestId, (findingMap.get(f.requestId) || 0) + 1);
    });

    const body = document.getElementById('research-body');
    const count = document.getElementById('research-count');
    if (!body || !count) return;

    count.textContent = requests.length + ' requests';

    if (requests.length === 0) {
      body.innerHTML = '<div class="empty">No research requests yet</div>';
      return;
    }

    body.innerHTML = requests.map(r => {
      const q = esc(truncate(r.question || '', 88));
      const findingCount = findingMap.get(r.id) || 0;
      const sla = getSlaBadge(r.dueAt, r.status);
      return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div style="font-size:13px;color:var(--text-bright);font-weight:500">${esc(truncate(r.title || 'Untitled request', 58))}</div>
          ${sla}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${q}</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:5px">
          ${r.category ? '#' + esc(r.category) + ' · ' : ''}${r.owner ? 'owner: ' + esc(r.owner) + ' · ' : ''}status: ${esc(r.status || 'open')} · findings: ${findingCount}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    const body = document.getElementById('research-body');
    if (body) body.innerHTML = '<div class="empty">Failed to load research requests</div>';
  }
}

// ---- Team Health ----
async function loadHealth() {
  try {
    const now = Date.now();
    const shouldRefreshDetail = !cachedHealth || (now - lastHealthDetailSync) > 120000;

    if (shouldRefreshDetail) {
      const [teamRes, agentsRes, idleNudgeRes, workflowRes] = await Promise.all([
        fetch(BASE + '/health/team'),
        fetch(BASE + '/health/agents'),
        fetch(BASE + '/health/idle-nudge/debug'),
        fetch(BASE + '/health/workflow'),
      ]);
      const team = await teamRes.json();
      const agentsSummary = await agentsRes.json();
      const idleNudgeDebug = await idleNudgeRes.json();
      const workflow = await workflowRes.json();
      cachedHealth = { team, agentsSummary, idleNudgeDebug, workflow };
      lastHealthDetailSync = now;
    }

    const health = cachedHealth || { team: { blockers: [], overlaps: [], compliance: null }, agentsSummary: { agents: [] }, idleNudgeDebug: null, workflow: { agents: [] } };

    const team = health.team || { blockers: [], overlaps: [], compliance: null, agents: [] };
    const agentsSummary = health.agentsSummary || { agents: [] };
    const idleNudgeDebug = health.idleNudgeDebug || null;

    healthAgentMap = new Map((team.agents || []).map(a => [String(a.agent || '').toLowerCase(), a]));
    const workflow = health.workflow || { agents: [] };

    const teamAgentsByName = new Map((team.agents || []).map(a => [a.agent, a]));
    const summaryRows = (agentsSummary.agents && agentsSummary.agents.length > 0)
      ? agentsSummary.agents
      : (team.agents || []).map(a => ({
          agent: a.agent,
          state: a.idleWithActiveTask ? 'stuck' : (a.status === 'active' ? 'healthy' : (a.status === 'offline' ? 'offline' : 'idle')),
          last_seen: a.lastSeen,
          heartbeat_age_ms: Math.max(0, a.minutesSinceLastSeen || 0) * 60000,
          active_task: a.currentTask || null,
          last_shipped_at: a.lastProductiveAt || null,
          shipped_age_ms: a.minutesSinceProductive == null ? null : Math.max(0, a.minutesSinceProductive) * 60000,
          stale_reason: a.idleWithActiveTask ? 'active-task-idle-over-60m' : null,
          idle_with_active_task: Boolean(a.idleWithActiveTask),
        }));
    const agents = summaryRows.map(row => {
      const fromTeam = teamAgentsByName.get(row.agent) || {};
      const minutesSinceLastSeen = Math.floor((Number(row.heartbeat_age_ms || 0)) / 60000);
      const mappedStatus = row.state === 'stuck'
        ? 'blocked'
        : (row.state === 'healthy' ? 'active' : (row.state === 'idle' ? 'silent' : 'offline'));
      return {
        agent: row.agent,
        status: mappedStatus,
        lastSeen: Number(row.last_seen || 0),
        minutesSinceLastSeen,
        currentTask: row.active_task || fromTeam.currentTask || null,
        recentBlockers: fromTeam.recentBlockers || [],
        messageCount24h: fromTeam.messageCount24h || 0,
        lastProductiveAt: row.last_shipped_at || row.last_productive_at || null,
        minutesSinceProductive: (row.shipped_age_ms ?? row.productive_age_ms) == null ? null : Math.floor(Number(row.shipped_age_ms ?? row.productive_age_ms) / 60000),
        staleReason: row.stale_reason || null,
        idleWithActiveTask: Boolean(row.idle_with_active_task),
      };
    });
    const blockers = team.blockers || [];
    const overlaps = team.overlaps || [];
    const compliance = team.compliance || null;

    const statusCounts = { active: 0, idle: 0, silent: 0, blocked: 0, offline: 0, watch: 0 };
    let stuckActiveCount = 0;
    const displayAgents = agents.map(a => {
      const derived = deriveHealthSignal(a);
      const displayStatus = a.status === 'silent'
        ? (a.minutesSinceLastSeen >= 120 ? 'blocked' : (a.minutesSinceLastSeen >= 60 ? 'silent' : 'watch'))
        : derived.status;
      statusCounts[displayStatus] = (statusCounts[displayStatus] || 0) + 1;
      if (a.idleWithActiveTask) stuckActiveCount += 1;
      return { ...a, displayStatus, lowConfidence: derived.lowConfidence };
    }).sort((a, b) => {
      const pa = healthPriorityRank(a);
      const pb = healthPriorityRank(b);
      if (pa !== pb) return pa - pb;
      if ((b.minutesSinceLastSeen || 0) !== (a.minutesSinceLastSeen || 0)) {
        return (b.minutesSinceLastSeen || 0) - (a.minutesSinceLastSeen || 0);
      }
      return a.agent.localeCompare(b.agent);
    });

    const healthSummary = `${statusCounts.active} active • ${statusCounts.watch + statusCounts.silent} quiet • ${statusCounts.blocked} blocked • ${stuckActiveCount} stuck`;
    document.getElementById('health-count').textContent = healthSummary;

    const body = document.getElementById('health-body');
    let html = '';

    // Agent Health Grid
    if (displayAgents.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">Agent Status</div><div class="health-grid">';
      html += displayAgents.map(a => {
        const statusText = a.minutesSinceLastSeen < 1 ? 'just now' : ago(a.lastSeen) + ' ago';
        const taskDisplay = a.currentTask ? `<div class="health-task">📋 ${esc(truncate(a.currentTask, 35))}</div>` : '';
        const productiveText = `<div class="health-task">🧾 ${esc(formatProductiveText(a))}</div>`;
        const statusLabel = a.displayStatus === 'blocked'
          ? ' • 🚫 blocked'
          : (a.displayStatus === 'silent' ? ' • ⚠️ quiet' : (a.displayStatus === 'watch' ? ' • 👀 watch' : ''));
        const confidenceLabel = a.lowConfidence ? ' • needs review' : '';
        const stuckLabel = a.idleWithActiveTask ? ' • ⛔ active-task idle>60m' : '';
        const staleReasonLabel = a.staleReason ? ' • ' + a.staleReason : '';
        const hierarchyClass = healthPriorityRank(a) === 0 ? 'health-critical' : (healthPriorityRank(a) === 1 ? 'health-warning' : 'health-info');
        const cardClasses = [
          'health-card',
          hierarchyClass,
          a.lowConfidence ? 'needs-review' : '',
          a.idleWithActiveTask ? 'stuck-active-task' : '',
        ].filter(Boolean).join(' ');
        return `
        <div class="${cardClasses}">
          <div class="health-indicator ${a.idleWithActiveTask ? 'blocked' : a.displayStatus}"></div>
          <div class="health-info">
            <div class="health-name">${esc(a.agent)}</div>
            <div class="health-status">${statusText}${statusLabel}${confidenceLabel}${stuckLabel}${staleReasonLabel}</div>
            ${taskDisplay}
            ${productiveText}
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

    // Unified workflow state (task + shipped + blocker + PR)
    if (Array.isArray(workflow.agents) && workflow.agents.length > 0) {
      html += '<div class="health-section"><div class="health-section-title">🧭 Workflow State</div>';
      html += workflow.agents.slice(0, 8).map(w => {
        const taskText = w.doingTaskId ? esc(truncate(w.doingTaskId, 28)) : 'no active task';
        const taskAge = w.doingTaskAgeMs == null ? 'n/a' : `${Math.floor(Number(w.doingTaskAgeMs) / 60000)}m`;
        const shipped = w.lastShippedAt ? ago(Number(w.lastShippedAt)) + ' ago' : 'none';
        const prState = w.prState || 'none';
        const prText = w.pr ? `<a href="${esc(w.pr)}" target="_blank" rel="noopener">PR</a>` : 'no PR';
        const blocker = w.blockerActive ? '🚫 blocker' : '✅ clear';
        return `<div class="blocker-item">
          <div class="blocker-agent">${esc(w.agent)}</div>
          <div class="blocker-meta">task: ${taskText} (${taskAge}) • shipped: ${esc(shipped)} • ${blocker}</div>
          <div class="blocker-meta">pr: ${prText} (${esc(prState)})${w.artifactPath ? ` • artifact: ${esc(truncate(w.artifactPath, 40))}` : ''}</div>
        </div>`;
      }).join('');
      html += '</div>';
    }

    html += renderIdleNudgeSummary(idleNudgeDebug);
    
    if (agents.length === 0 && blockers.length === 0 && overlaps.length === 0 && !idleNudgeDebug) {
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

async function loadReleaseStatus(force = false) {
  const badge = document.getElementById('release-badge');
  if (!badge) return;

  const now = Date.now();
  if (!force && (now - lastReleaseStatusSync) < 30000) return;

  try {
    const r = await fetch(BASE + '/release/status');
    const status = await r.json();

    const stale = Boolean(status.stale);
    badge.classList.toggle('stale', stale);
    badge.classList.toggle('fresh', !stale);
    badge.textContent = stale ? 'deploy: stale' : 'deploy: in sync';

    const reasons = Array.isArray(status.reasons) ? status.reasons : [];
    const startupCommit = status.startup && status.startup.commit ? status.startup.commit.slice(0, 8) : 'unknown';
    const currentCommit = status.current && status.current.commit ? status.current.commit.slice(0, 8) : 'unknown';
    const reasonText = reasons.length > 0 ? reasons.join('; ') : 'no mismatch detected';
    badge.title = `startup ${startupCommit} • current ${currentCommit} • ${reasonText}`;

    lastReleaseStatusSync = now;
  } catch (err) {
    badge.classList.remove('fresh');
    badge.classList.add('stale');
    badge.textContent = 'deploy: unknown';
    badge.title = 'Failed to load deploy status';
  }
}

async function loadBuildInfo() {
  const badge = document.getElementById('build-badge');
  if (!badge) return;

  try {
    const r = await fetch(BASE + '/health/build');
    const info = await r.json();

    const sha = info.gitShortSha || 'unknown';
    const branch = info.gitBranch || 'unknown';
    const uptime = info.uptime || 0;
    const uptimeStr = uptime < 60 ? `${uptime}s` :
      uptime < 3600 ? `${Math.floor(uptime / 60)}m` :
      `${Math.floor(uptime / 3600)}h${Math.floor((uptime % 3600) / 60)}m`;

    badge.classList.toggle('fresh', branch === 'main');
    badge.classList.toggle('stale', branch !== 'main');
    badge.textContent = `${sha} • ${uptimeStr}`;
    badge.title = `SHA: ${info.gitSha}\nBranch: ${branch}\nCommit: ${info.gitMessage}\nAuthor: ${info.gitAuthor}\nPID: ${info.pid}\nNode: ${info.nodeVersion}\nStarted: ${info.startedAt}`;
  } catch (err) {
    badge.textContent = 'build: error';
    badge.title = 'Failed to load build info';
  }
}

async function loadRuntimeTruthCard() {
  const body = document.getElementById('truth-body');
  const count = document.getElementById('truth-count');
  if (!body || !count) return;

  try {
    const r = await fetch(BASE + '/runtime/truth');
    if (!r.ok) throw new Error('status ' + r.status);
    const truth = await r.json();

    const deployLabel = truth?.deploy?.stale ? 'stale' : 'in sync';
    const cloudLabel = truth?.cloud?.registered
      ? `registered • hb ${truth?.cloud?.heartbeatCount ?? 0}`
      : 'not registered';

    count.textContent = `${truth?.repo?.shortSha || 'unknown'} • ${deployLabel}`;

    body.innerHTML = `
      <div class="truth-grid">
        <div class="truth-item">
          <div class="truth-label">Repo</div>
          <div class="truth-value">${esc(truth?.repo?.name || 'reflectt/reflectt-node')}<br>${esc(truth?.repo?.branch || 'unknown')} • ${esc((truth?.repo?.shortSha || 'unknown'))}</div>
        </div>
        <div class="truth-item">
          <div class="truth-label">Runtime</div>
          <div class="truth-value">PID ${esc(String(truth?.runtime?.pid ?? 'n/a'))} • Node ${esc(truth?.runtime?.nodeVersion || 'n/a')}<br>${esc(String(truth?.runtime?.host || '0.0.0.0'))}:${esc(String(truth?.runtime?.port || 'n/a'))} • up ${esc(String(truth?.runtime?.uptimeSec ?? 0))}s</div>
        </div>
        <div class="truth-item">
          <div class="truth-label">Deploy</div>
          <div class="truth-value">${esc(deployLabel)}<br>startup ${esc((truth?.deploy?.startupCommit || 'unknown').slice(0, 8))} → current ${esc((truth?.deploy?.currentCommit || 'unknown').slice(0, 8))}</div>
        </div>
        <div class="truth-item">
          <div class="truth-label">Cloud</div>
          <div class="truth-value">${esc(cloudLabel)}<br>host ${esc(String(truth?.cloud?.hostId || 'none'))}</div>
        </div>
        <div class="truth-item">
          <div class="truth-label">Paths</div>
          <div class="truth-value">home ${esc(String(truth?.paths?.reflecttHome || 'n/a'))}</div>
        </div>
      </div>
    `;
  } catch (err) {
    count.textContent = 'unavailable';
    body.innerHTML = '<div class="empty">Failed to load runtime truth card</div>';
  }
}

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---- Review Queue Panel ----
const REVIEW_SLA_HOURS = 4; // 4h default SLA for reviews
const REVIEW_SLA_WARNING_HOURS = 2; // warning at 2h

function getReviewSlaState(timeInReviewMs) {
  const hours = timeInReviewMs / (1000 * 60 * 60);
  if (hours >= REVIEW_SLA_HOURS) return 'breach';
  if (hours >= REVIEW_SLA_WARNING_HOURS) return 'warning';
  return 'ok';
}

function getReviewSlaLabel(state) {
  if (state === 'breach') return '⏰ SLA BREACH';
  if (state === 'warning') return '⚠ Near SLA';
  return '✓ On track';
}

function formatDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return totalMin + 'm';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return h + 'h ' + m + 'm';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}

function renderReviewQueue() {
  const panel = document.getElementById('review-queue-panel');
  const body = document.getElementById('review-queue-body');
  const count = document.getElementById('review-queue-count');
  if (!body || !panel) return;

  const now = Date.now();
  const validating = allTasks
    .filter(t => t.status === 'validating')
    .map(t => {
      const enteredAt = t.metadata?.entered_validating_at || t.updatedAt || t.createdAt;
      const timeInReview = now - enteredAt;
      const slaState = getReviewSlaState(timeInReview);
      return { ...t, timeInReview, slaState, enteredAt };
    })
    .sort((a, b) => {
      // Breaches first, then by time descending
      const order = { breach: 0, warning: 1, ok: 2 };
      const diff = (order[a.slaState] || 2) - (order[b.slaState] || 2);
      if (diff !== 0) return diff;
      return b.timeInReview - a.timeInReview;
    });

  if (validating.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  count.textContent = validating.length + ' awaiting review';

  const breachCount = validating.filter(t => t.slaState === 'breach').length;
  const headerExtra = breachCount > 0
    ? ' <span style="color:var(--red);font-size:11px;font-weight:600">' + breachCount + ' breach' + (breachCount > 1 ? 'es' : '') + '</span>'
    : '';
  count.innerHTML = validating.length + ' awaiting review' + headerExtra;

  body.innerHTML = validating.map(t => {
    const reviewer = t.reviewer || '<span style="color:var(--yellow)">unassigned</span>';
    const assignee = t.assignee || '?';
    const priority = t.priority || 'P3';
    const slaLabel = getReviewSlaLabel(t.slaState);
    const duration = formatDuration(t.timeInReview);
    const tags = renderTaskTags(t.tags);

    return '<div class="review-item" onclick="openTaskModal(\'' + esc(t.id) + '\')">'
      + '<div class="review-item-left">'
      + '<div class="review-item-title">' + esc(truncate(t.title, 70)) + '</div>'
      + '<div class="review-item-meta">'
      + '<span>👤 ' + reviewer + '</span>'
      + '<span>⏱ ' + esc(duration) + '</span>'
      + '<span class="assignee-tag">' + esc(priority) + '</span>'
      + '<span>by ' + esc(assignee) + '</span>'
      + (tags ? ' ' + tags : '')
      + '</div>'
      + '</div>'
      + '<div class="review-item-right">'
      + '<span class="sla-badge ' + t.slaState + '">' + slaLabel + '</span>'
      + '</div>'
      + '</div>';
  }).join('');

  bindTaskLinkHandlers(body);

  // SLA breach escalation: post to watchdog if any breach found
  if (breachCount > 0) {
    escalateReviewBreaches(validating.filter(t => t.slaState === 'breach'));
  }
}

let lastReviewEscalationAt = 0;
const REVIEW_ESCALATION_COOLDOWN = 20 * 60 * 1000; // 20m

async function escalateReviewBreaches(breachedTasks) {
  const now = Date.now();
  if (now - lastReviewEscalationAt < REVIEW_ESCALATION_COOLDOWN) return;
  lastReviewEscalationAt = now;

  const lines = breachedTasks.slice(0, 5).map(t => {
    const reviewer = t.reviewer || 'unassigned';
    return '- ' + t.id + ' (' + (t.title || '').slice(0, 50) + ') — reviewer: @' + reviewer + ', waiting ' + formatDuration(t.timeInReview);
  });

  const content = '@kai Review SLA breach detected:\n' + lines.join('\n');

  try {
    await fetch(BASE + '/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'system',
        content,
        channel: 'general',
        timestamp: now
      })
    });
  } catch (err) {
    console.error('Failed to escalate review breach:', err);
  }
}

// ---- Feedback ----
let feedbackData = null;

async function loadFeedback() {
  try {
    const res = await fetch(BASE + '/feedback?status=all&limit=50');
    feedbackData = await res.json();
    renderFeedback();
  } catch (e) {
    const body = document.getElementById('feedback-body');
    if (body) body.innerHTML = '<div class="empty">Failed to load feedback</div>';
  }
}

function renderFeedback() {
  const body = document.getElementById('feedback-body');
  const count = document.getElementById('feedback-count');
  if (!body || !feedbackData) return;

  const items = feedbackData.items || [];
  const newCount = feedbackData.newCount || 0;
  count.textContent = newCount > 0 ? newCount + ' new' : items.length + ' total';

  if (items.length === 0) {
    body.innerHTML = '<div class="empty" style="text-align:center;padding:20px;color:var(--text-dim)">💬 No feedback yet.<br><span style="font-size:11px">Embed the widget to start collecting.</span></div>';
    return;
  }

  body.innerHTML = items.map(function(fb) {
    var catIcon = fb.category === 'bug' ? '🐛' : fb.category === 'feature' ? '✨' : '💬';
    var catClass = fb.category || 'general';
    var domain = '';
    if (fb.url) { try { domain = new URL(fb.url).hostname; } catch(e) {} }
    return '<div class="feedback-card">' +
      '<div class="fb-header">' +
      '<span class="fb-category ' + catClass + '">' + catIcon + ' ' + esc(fb.category) + '</span>' +
      (domain ? '<span class="fb-source"> · ' + esc(domain) + '</span>' : '') +
      '<span class="fb-time">' + ago(fb.createdAt) + '</span>' +
      '</div>' +
      '<div class="fb-message">"' + esc(fb.messagePreview) + '"</div>' +
      '<div class="fb-footer">' +
      (fb.email ? '<span class="fb-email">' + esc(fb.email) + '</span>' : '') +
      (fb.votes > 0 ? '<span class="fb-votes" onclick="voteFeedback(\'' + esc(fb.id) + '\')">▲ ' + fb.votes + '</span>' : '<span class="fb-votes" onclick="voteFeedback(\'' + esc(fb.id) + '\')">▲ 0</span>') +
      '<span class="fb-actions">' +
      (fb.status === 'new' ? '<button onclick="triageFeedback(\'' + esc(fb.id) + '\')">Triage</button>' : '') +
      (fb.status !== 'archived' ? '<button onclick="archiveFeedback(\'' + esc(fb.id) + '\')">Archive</button>' : '<button onclick="unarchiveFeedback(\'' + esc(fb.id) + '\')">Unarchive</button>') +
      '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

async function triageFeedback(id) {
  var notes = prompt('Triage notes (optional):') || '';
  try {
    await fetch(BASE + '/feedback/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'triaged', notes: notes })
    });
    await loadFeedback();
  } catch (e) { console.error('Triage failed:', e); }
}

async function archiveFeedback(id) {
  try {
    await fetch(BASE + '/feedback/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' })
    });
    await loadFeedback();
  } catch (e) { console.error('Archive failed:', e); }
}

async function unarchiveFeedback(id) {
  try {
    await fetch(BASE + '/feedback/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'triaged' })
    });
    await loadFeedback();
  } catch (e) { console.error('Unarchive failed:', e); }
}

async function voteFeedback(id) {
  try {
    await fetch(BASE + '/feedback/' + encodeURIComponent(id) + '/vote', { method: 'POST' });
    await loadFeedback();
  } catch (e) { console.error('Vote failed:', e); }
}

// ---- Approval Queue ----
let approvalQueueData = null;
let routingPolicyVisible = false;
let routingPolicyData = null;
let policyEdits = {};

async function loadApprovalQueue() {
  try {
    const res = await fetch(BASE + '/approval-queue');
    approvalQueueData = await res.json();
    renderApprovalQueue();
  } catch (e) {
    const body = document.getElementById('approval-queue-body');
    if (body) body.innerHTML = '<div class="empty">Failed to load approval queue</div>';
  }
}

function renderApprovalQueue() {
  const body = document.getElementById('approval-queue-body');
  const count = document.getElementById('approval-queue-count');
  if (!body || !approvalQueueData) return;

  const items = approvalQueueData.items || [];
  const highCount = approvalQueueData.highConfidenceCount || 0;
  const needsCount = approvalQueueData.needsReviewCount || 0;
  count.textContent = items.length + ' pending';

  if (items.length === 0) {
    body.innerHTML = '<div class="empty" style="text-align:center;padding:20px;color:var(--text-dim)">✓ Queue is clear — no tasks waiting for approval.</div>';
    return;
  }

  let html = '';

  // Batch approve bar
  if (highCount > 0) {
    html += '<div class="batch-approve-bar">';
    html += '<span>' + highCount + ' high-confidence · ' + needsCount + ' need review</span>';
    html += '<button onclick="batchApproveHighConfidence()">Approve All High-Confidence (' + highCount + ')</button>';
    html += '</div>';
  }

  // High confidence section
  const highItems = items.filter(function(i) { return i.confidenceScore >= 0.85; });
  const lowItems = items.filter(function(i) { return i.confidenceScore < 0.85; });

  if (highItems.length > 0) {
    html += '<div style="padding:6px 12px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">High Confidence (≥ 85%)</div>';
    highItems.forEach(function(item) { html += renderApprovalCard(item, true); });
  }

  if (lowItems.length > 0) {
    html += '<div style="padding:6px 12px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px">Needs Review (&lt; 85%)</div>';
    lowItems.forEach(function(item) { html += renderApprovalCard(item, false); });
  }

  body.innerHTML = html;
}

function renderApprovalCard(item, isHigh) {
  const icon = isHigh ? '✦' : '⚠';
  const pct = Math.round(item.confidenceScore * 100);
  const confClass = isHigh ? 'high' : 'low';
  return '<div class="approval-card">' +
    '<div class="approval-header">' +
    '<span>' + icon + '</span> ' +
    '<span class="approval-title">' + esc(item.title.substring(0, 60)) + '</span>' +
    '<span class="assignee-tag">' + esc(item.priority) + '</span>' +
    '<span class="confidence-score ' + confClass + '">' + pct + '%</span>' +
    '</div>' +
    '<div class="approval-meta">' +
    'Suggested: @' + esc(item.suggestedAgent || '?') + ' — ' + esc(item.confidenceReason || '') +
    '</div>' +
    '<div class="approval-actions">' +
    (isHigh ? '' : '<button class="btn-reject" onclick="rejectApproval(\'' + esc(item.taskId) + '\')">✗ Reject</button>') +
    '<button class="btn-edit" onclick="openTaskModal(\'' + esc(item.taskId) + '\')">Edit</button>' +
    '<button class="btn-approve" onclick="approveTask(\'' + esc(item.taskId) + '\', \'' + esc(item.suggestedAgent || '') + '\')">✓ Approve</button>' +
    '</div>' +
    '</div>';
}

async function approveTask(taskId, agent) {
  try {
    await fetch(BASE + '/approval-queue/' + encodeURIComponent(taskId) + '/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedAgent: agent, reviewedBy: 'dashboard' })
    });
    await loadApprovalQueue();
  } catch (e) { console.error('Approve failed:', e); }
}

async function rejectApproval(taskId) {
  const reason = prompt('Rejection reason (optional):') || '';
  try {
    await fetch(BASE + '/approval-queue/' + encodeURIComponent(taskId) + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason, reviewedBy: 'dashboard' })
    });
    await loadApprovalQueue();
  } catch (e) { console.error('Reject failed:', e); }
}

async function batchApproveHighConfidence() {
  if (!approvalQueueData) return;
  const highItems = (approvalQueueData.items || []).filter(function(i) { return i.confidenceScore >= 0.85; });
  if (highItems.length === 0) return;
  if (!confirm('Approve ' + highItems.length + ' high-confidence tasks? They will be assigned immediately.')) return;

  try {
    await fetch(BASE + '/approval-queue/batch-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskIds: highItems.map(function(i) { return i.taskId; }), reviewedBy: 'dashboard' })
    });
    await loadApprovalQueue();
  } catch (e) { console.error('Batch approve failed:', e); }
}

// ---- Routing Policy Editor ----
function toggleRoutingPolicy() {
  routingPolicyVisible = !routingPolicyVisible;
  const panel = document.getElementById('routing-policy-panel');
  if (!panel) return;
  panel.style.display = routingPolicyVisible ? '' : 'none';
  if (routingPolicyVisible) loadRoutingPolicy();
}

async function loadRoutingPolicy() {
  try {
    const res = await fetch(BASE + '/routing-policy');
    routingPolicyData = await res.json();
    policyEdits = {};
    renderRoutingPolicy();
  } catch (e) {
    const panel = document.getElementById('routing-policy-panel');
    if (panel) panel.innerHTML = '<div class="empty">Failed to load routing policy</div>';
  }
}

function renderRoutingPolicy() {
  const panel = document.getElementById('routing-policy-panel');
  if (!panel || !routingPolicyData) return;

  const agents = routingPolicyData.agents || [];
  let html = '<div style="font-size:12px;font-weight:600;color:var(--text-bright);margin-bottom:8px">Agent Affinity Maps</div>';
  html += '<div style="font-size:10px;color:var(--text-muted);margin-bottom:12px">Edit which task types each agent is preferred for. Confidence scores are calculated from these affinities.</div>';

  agents.forEach(function(agent, idx) {
    const edited = policyEdits[agent.agentId] || agent;
    const tags = edited.affinityTags || [];
    const weight = typeof edited.weight === 'number' ? edited.weight : 0.5;

    html += '<div class="policy-agent-card">';
    html += '<div class="agent-name">@' + esc(agent.agentId) + '</div>';
    html += '<div class="tag-row">';
    tags.forEach(function(tag, ti) {
      html += '<span class="tag-chip">' + esc(tag) + ' <span class="tag-remove" onclick="removePolicyTag(\'' + esc(agent.agentId) + '\',' + ti + ')">×</span></span>';
    });
    html += '<input type="text" placeholder="+ tag" style="font-size:10px;width:60px;background:none;border:1px solid var(--border-subtle);color:var(--text-bright);padding:2px 6px;border-radius:10px" onkeydown="addPolicyTag(event,\'' + esc(agent.agentId) + '\')">';
    html += '</div>';
    html += '<div class="weight-row">';
    html += '<span style="color:var(--text-dim)">Weight:</span>';
    html += '<input type="range" min="0" max="10" value="' + Math.round(weight * 10) + '" oninput="updatePolicyWeight(\'' + esc(agent.agentId) + '\', this.value)">';
    html += '<span class="weight-val">' + weight.toFixed(1) + '</span>';
    html += '</div>';
    html += '</div>';
  });

  // Save bar
  const editCount = Object.keys(policyEdits).length;
  if (editCount > 0) {
    html += '<div class="policy-save-bar">';
    html += '<span style="font-size:10px;color:var(--text-muted)">' + editCount + ' unsaved change' + (editCount !== 1 ? 's' : '') + '</span>';
    html += '<button class="btn-discard" onclick="loadRoutingPolicy()">Discard</button>';
    html += '<button class="btn-save" onclick="saveRoutingPolicy()">Save</button>';
    html += '</div>';
  }

  panel.innerHTML = html;
}

function removePolicyTag(agentId, tagIndex) {
  if (!routingPolicyData) return;
  const agent = routingPolicyData.agents.find(function(a) { return a.agentId === agentId; });
  if (!agent) return;
  const edited = policyEdits[agentId] || JSON.parse(JSON.stringify(agent));
  edited.affinityTags.splice(tagIndex, 1);
  policyEdits[agentId] = edited;
  renderRoutingPolicy();
}

function addPolicyTag(event, agentId) {
  if (event.key !== 'Enter') return;
  const val = event.target.value.trim();
  if (!val) return;
  if (!routingPolicyData) return;
  const agent = routingPolicyData.agents.find(function(a) { return a.agentId === agentId; });
  if (!agent) return;
  const edited = policyEdits[agentId] || JSON.parse(JSON.stringify(agent));
  if (!edited.affinityTags.includes(val)) {
    edited.affinityTags.push(val);
  }
  policyEdits[agentId] = edited;
  event.target.value = '';
  renderRoutingPolicy();
}

function updatePolicyWeight(agentId, sliderVal) {
  if (!routingPolicyData) return;
  const agent = routingPolicyData.agents.find(function(a) { return a.agentId === agentId; });
  if (!agent) return;
  const edited = policyEdits[agentId] || JSON.parse(JSON.stringify(agent));
  edited.weight = Number(sliderVal) / 10;
  policyEdits[agentId] = edited;
  renderRoutingPolicy();
}

async function saveRoutingPolicy() {
  if (!routingPolicyData) return;
  const agents = routingPolicyData.agents.map(function(a) {
    return policyEdits[a.agentId] || a;
  });
  try {
    const res = await fetch(BASE + '/routing-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: agents, updatedBy: 'dashboard' })
    });
    const result = await res.json();
    if (result.success) {
      policyEdits = {};
      await loadRoutingPolicy();
    }
  } catch (e) { console.error('Save policy failed:', e); }
}

// ---- Task Search (Office Suite Spine) ----
async function runTaskSearch() {
  const input = document.getElementById('task-search-input');
  const resultsEl = document.getElementById('task-search-results');
  const countEl = document.getElementById('search-count');
  if (!input || !resultsEl || !countEl) return;

  const q = (input.value || '').trim();
  if (!q) {
    countEl.textContent = '';
    resultsEl.innerHTML = '<div class="empty" style="color:var(--text-muted)">Type a query and press Enter…</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="empty" style="color:var(--text-muted)">Searching…</div>';

  try {
    const res = await fetch(BASE + '/tasks/search?q=' + encodeURIComponent(q) + '&limit=12');
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];

    countEl.textContent = tasks.length + ' result' + (tasks.length === 1 ? '' : 's');

    if (tasks.length === 0) {
      resultsEl.innerHTML = '<div class="empty" style="color:var(--text-muted)">No matches</div>';
      return;
    }

    resultsEl.innerHTML = tasks.map(t => {
      const assignee = t.assignee ? '@' + esc(t.assignee) : '<span style="color:var(--yellow)">unassigned</span>';
      const pri = t.priority ? '<span class="priority-badge ' + esc(t.priority) + '">' + esc(t.priority) + '</span>' : '';
      const title = esc(truncate(t.title || t.id, 80));
      const id = esc(t.id);
      const status = esc(t.status || 'todo');
      return '<div class="backlog-item" style="padding:10px 14px;border-bottom:1px solid var(--border-subtle);cursor:pointer" onclick="openTaskModal(\'' + id + '\')">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        + pri
        + '<span style="color:var(--text-bright);font-size:13px;font-weight:500">' + title + '</span>'
        + '</div>'
        + '<div style="font-size:11px;color:var(--text-muted)">'
        + '<span>' + id + '</span> · <span>' + status + '</span> · <span>' + assignee + '</span>'
        + '</div>'
        + '</div>';
    }).join('');
  } catch (err) {
    countEl.textContent = 'error';
    resultsEl.innerHTML = '<div class="empty" style="color:var(--red)">Search failed</div>';
  }
}

async function refresh() {
  refreshCount += 1;
  const forceFull = refreshCount % 12 === 0; // full sync less often with adaptive polling
  await loadTasks(forceFull);
  renderReviewQueue();
  await Promise.all([loadPresence(), loadChat(forceFull), loadActivity(forceFull), loadResearch(), loadHealth(), loadReleaseStatus(forceFull), loadBuildInfo(), loadRuntimeTruthCard(), loadApprovalQueue(), loadFeedback()]);
  await renderPromotionSSOT();
}

let refreshTimer = null;
let refreshInFlight = false;

// SSE live updates
let eventSource = null;
let sseReconnectTimer = null;
let sseRefreshTimer = null;
let sseBackoffMs = 1500;
const SSE_MAX_BACKOFF_MS = 20000;
const SSE_TOPICS = 'task,message,presence,memory';

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

function queueSseRefresh() {
  if (sseRefreshTimer) return;
  sseRefreshTimer = setTimeout(async () => {
    sseRefreshTimer = null;
    try {
      await refresh();
      startAdaptiveRefresh();
    } catch (err) {
      console.error('SSE refresh failed:', err);
    }
  }, 250);
}

function handleSsePayload(eventType, payload) {
  if (eventType === 'batch' && Array.isArray(payload)) {
    queueSseRefresh();
    return;
  }

  switch (eventType) {
    case 'message_posted':
    case 'task_created':
    case 'task_assigned':
    case 'task_updated':
    case 'presence_updated':
    case 'memory_written':
      queueSseRefresh();
      break;
    default:
      // ignore unknown event types
      break;
  }
}

function connectEventStream() {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (eventSource) return;

  const url = `${BASE}/events?topics=${encodeURIComponent(SSE_TOPICS)}`;
  const es = new EventSource(url);
  eventSource = es;

  const onAnyEvent = (event) => {
    try {
      const payload = event && event.data ? JSON.parse(event.data) : null;
      handleSsePayload(event.type || 'message', payload);
    } catch {
      queueSseRefresh();
    }
  };

  es.onopen = () => {
    sseBackoffMs = 1500;
  };

  es.onerror = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (sseReconnectTimer) return;

    sseReconnectTimer = setTimeout(() => {
      sseReconnectTimer = null;
      connectEventStream();
    }, sseBackoffMs);

    sseBackoffMs = Math.min(SSE_MAX_BACKOFF_MS, Math.floor(sseBackoffMs * 1.8));
  };

  ['message_posted', 'task_created', 'task_assigned', 'task_updated', 'presence_updated', 'memory_written', 'batch']
    .forEach(type => es.addEventListener(type, onAnyEvent));
}

document.addEventListener('visibilitychange', () => {
  startAdaptiveRefresh();
  if (!document.hidden && !eventSource) connectEventStream();
});

window.addEventListener('beforeunload', () => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
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

// --- Artifacts (task modal) ---
let taskArtifactsPreviewCache = new Map(); // taskId -> Map(path -> artifact)

function renderTaskArtifactsLoading() {
  const el = document.getElementById('modal-task-artifacts');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="color:var(--text-muted)">Loading artifacts…</div>';
}

function renderTaskArtifactsEmpty(message) {
  const el = document.getElementById('modal-task-artifacts');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="color:var(--text-muted)">' + esc(message || 'No artifacts attached') + '</div>';
}

function renderTaskArtifactsError(message) {
  const el = document.getElementById('modal-task-artifacts');
  if (!el) return;
  el.innerHTML = '<div class="empty" style="color:var(--red)">' + esc(message || 'Failed to load artifacts') + '</div>';
}

async function fetchTaskArtifacts(taskId, includeMode) {
  const qs = includeMode ? ('?include=' + encodeURIComponent(includeMode)) : '';
  const url = BASE + '/tasks/' + encodeURIComponent(taskId) + '/artifacts' + qs;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  }
  return await res.json();
}

function renderArtifactRow(taskId, a, idx) {
  const path = String(a.path || '');
  const source = String(a.source || '');
  const type = String(a.type || '');
  const accessible = Boolean(a.accessible);

  const pill = '<span class="artifact-pill ' + (accessible ? 'ok' : 'missing') + '">' + (accessible ? 'OK' : 'MISSING') + '</span>';

  const metaParts = [];
  if (type) metaParts.push(type);
  if (source) metaParts.push(source);
  if (!accessible && a.error) metaParts.push(String(a.error));

  const previewElId = 'artifact-preview-' + idx;
  const encTaskId = encodeURIComponent(taskId);
  const encPath = encodeURIComponent(path);

  let actions = '';
  if (accessible) {
    if (type === 'file' && path.startsWith('process/')) {
      actions += '<button class="artifact-btn" onclick="toggleArtifactPreview(\'' + encTaskId + '\',\'' + encPath + '\',\'' + previewElId + '\')">Preview</button>';
    }
    if (type === 'url') {
      const url = String(a.resolvedPath || a.path || '');
      if (url) {
        actions += '<a class="artifact-btn" href="' + esc(url) + '" target="_blank" rel="noreferrer noopener">Open ↗</a>';
      }
    }
  }

  const actionsHtml = actions ? '<div class="artifact-actions">' + actions + '</div>' : '';

  const previewBox = '<pre id="' + esc(previewElId) + '" class="artifact-preview" style="display:none;margin-top:10px;white-space:pre-wrap;word-break:break-word;background:#0f141a;border:1px solid var(--border-subtle);border-radius:10px;padding:10px;font-size:12px;line-height:1.5"></pre>';

  return '<div class="artifact-row">'
    + '<div class="artifact-top">'
    + '<div class="artifact-path">' + esc(path || '(missing path)') + '</div>'
    + pill
    + '</div>'
    + '<div class="artifact-meta">' + esc(metaParts.filter(Boolean).join(' · ') || '—') + '</div>'
    + actionsHtml
    + previewBox
    + '</div>';
}

async function loadTaskArtifacts(taskId) {
  const el = document.getElementById('modal-task-artifacts');
  if (!el) return;

  if (!taskId) {
    renderTaskArtifactsEmpty('Not available');
    return;
  }

  renderTaskArtifactsLoading();
  taskArtifactsPreviewCache.delete(taskId);

  try {
    const data = await fetchTaskArtifacts(taskId);
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];

    if (artifacts.length === 0) {
      renderTaskArtifactsEmpty();
      return;
    }

    el.innerHTML = artifacts.map((a, i) => renderArtifactRow(taskId, a, i)).join('');
  } catch (err) {
    renderTaskArtifactsError('Failed to load artifacts');
  }
}

async function getPreviewMapForTask(taskId) {
  if (taskArtifactsPreviewCache.has(taskId)) return taskArtifactsPreviewCache.get(taskId);

  const data = await fetchTaskArtifacts(taskId, 'preview');
  const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
  const m = new Map();
  artifacts.forEach(a => {
    if (a && a.path) m.set(String(a.path), a);
  });
  taskArtifactsPreviewCache.set(taskId, m);
  return m;
}

async function toggleArtifactPreview(encTaskId, encPath, previewElId) {
  const taskId = decodeURIComponent(encTaskId || '');
  const path = decodeURIComponent(encPath || '');
  const el = document.getElementById(previewElId);
  if (!el) return;

  // toggle
  const isHidden = el.style.display === 'none' || !el.style.display;
  if (!isHidden) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';

  // already loaded
  if (el.dataset.loaded === '1') return;

  el.textContent = 'Loading preview…';

  try {
    const m = await getPreviewMapForTask(taskId);
    const a = m.get(path);

    if (!a || !a.preview) {
      el.textContent = 'Preview not available (only process/* file artifacts are previewable).';
      el.dataset.loaded = '1';
      return;
    }

    const truncated = Boolean(a.previewTruncated);
    el.textContent = String(a.preview) + (truncated ? '\n\n[truncated]' : '');
    el.dataset.loaded = '1';
  } catch (err) {
    el.textContent = 'Failed to load preview';
  }
}

function openTaskModal(taskId) {
  currentTask = allTasks.find(t => t.id === taskId);

  if (!currentTask) {
    setTaskModalInteractivity(false);
    document.getElementById('modal-task-title').textContent = 'Task not found: ' + (taskId || '(missing id)');
    document.getElementById('modal-task-desc').textContent = 'This task ID was referenced in chat but is not present in the current task set. It may be archived, deleted, or not yet synced.';
    document.getElementById('modal-task-id').textContent = taskId || '(missing id)';
    document.getElementById('modal-task-assignee').value = '';
    document.getElementById('modal-task-priority').textContent = '—';
    document.getElementById('modal-task-created').textContent = 'Not available';
    const blockerEl = document.getElementById('modal-task-blockers');
    if (blockerEl) blockerEl.textContent = 'Not available';
    renderTaskArtifactsEmpty('Not available');
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
  document.getElementById('modal-task-id').textContent = currentTask.id || '(missing id)';
  document.getElementById('modal-task-assignee').value = currentTask.assignee || '';
  document.getElementById('modal-task-priority').textContent = currentTask.priority || 'P3';

  // Branch display
  const branchSection = document.getElementById('modal-branch-section');
  const branchEl = document.getElementById('modal-task-branch');
  if (branchSection && branchEl) {
    const branch = currentTask.metadata?.branch;
    if (branch) {
      branchEl.textContent = branch;
      branchSection.style.display = '';
    } else {
      branchSection.style.display = 'none';
    }
  }

  document.getElementById('modal-task-created').textContent = createdText;

  const blockerEl = document.getElementById('modal-task-blockers');
  if (blockerEl) {
    const blockedHtml = renderBlockedByLinks(currentTask) || '<span style="color:var(--text-dim)">None</span>';
    blockerEl.innerHTML = blockedHtml;
  }

  // Set active status button
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === currentTask.status);
  });

  document.getElementById('task-modal').classList.add('show');

  // Load artifacts section
  loadTaskArtifacts(currentTask.id);

  // Load PR review quality panel
  loadPrReviewPanel(currentTask);
}

function formatDuration(sec) {
  if (sec == null) return '';
  if (sec < 60) return sec + 's';
  return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
}

async function loadPrReviewPanel(task) {
  const panel = document.getElementById('pr-review-panel');
  const loading = document.getElementById('pr-review-loading');
  const content = document.getElementById('pr-review-content');
  if (!panel || !loading || !content) return;

  // Check if task might have PR data
  const prUrl = extractTaskPrLink(task);
  const isReviewable = task && (task.status === 'validating' || task.status === 'done' || prUrl);
  if (!isReviewable) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  loading.style.display = '';
  content.style.display = 'none';

  try {
    const res = await fetch(BASE + '/tasks/' + encodeURIComponent(task.id) + '/pr-review');
    const data = await res.json();

    if (!data.available) {
      panel.style.display = 'none';
      return;
    }

    loading.style.display = 'none';
    content.style.display = '';
    content.innerHTML = renderPrReviewPanel(data);
  } catch (e) {
    panel.style.display = 'none';
  }
}

function renderPrReviewPanel(data) {
  const pr = data.pr || {};
  const diff = data.diffScope || {};
  const ci = data.ci || {};
  const alignment = data.doneCriteriaAlignment || {};

  let html = '';

  // PR Header
  html += '<div class="pr-review-header">';
  html += '<div class="pr-title">' + esc(pr.title || 'PR #' + pr.number) + '</div>';
  html += '<div class="pr-meta">';
  html += (pr.state === 'closed' && pr.merged ? '🟣 Merged' : pr.state === 'closed' ? '🔴 Closed' : '🟢 Open');
  html += ' · ' + esc(pr.author || 'unknown');
  if (pr.updatedAt) html += ' · Updated ' + ago(new Date(pr.updatedAt).getTime());
  html += ' · <a href="' + esc(pr.url) + '" target="_blank">View on GitHub ↗</a>';
  html += '</div></div>';

  // Diff Scope
  html += '<div class="pr-review-section">';
  html += '<div class="pr-review-section-title">📊 Diff Scope <span class="risk-badge ' + esc(diff.riskLevel || 'small') + '">' + esc(diff.riskLevel || 'small') + ' change</span></div>';
  html += '<div class="diff-scope-grid">';
  html += '<div class="diff-stat-card"><div class="stat-value">' + (diff.changedFiles || 0) + '</div><div class="stat-label">Files</div></div>';
  html += '<div class="diff-stat-card"><div class="stat-value" style="color:var(--green)">+' + (diff.additions || 0) + '</div><div class="stat-label">Added</div></div>';
  html += '<div class="diff-stat-card"><div class="stat-value" style="color:var(--red)">-' + (diff.deletions || 0) + '</div><div class="stat-label">Deleted</div></div>';
  html += '<div class="diff-stat-card"><div class="stat-value">' + (diff.commits || 0) + '</div><div class="stat-label">Commits</div></div>';
  html += '</div>';

  // Directory breakdown
  if (diff.directories && diff.directories.length > 0) {
    html += '<div style="margin-top:6px">';
    diff.directories.slice(0, 8).forEach(function(d) {
      html += '<div class="dir-row">';
      html += '<span class="dir-name">' + esc(d.dir) + '/</span>';
      html += '<span class="dir-stats">' + d.files + ' file' + (d.files !== 1 ? 's' : '') + '  <span style="color:var(--green)">+' + d.additions + '</span> / <span style="color:var(--red)">-' + d.deletions + '</span></span>';
      html += '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  // CI Checks
  if (ci.total > 0 || (ci.qaBundleChecks && ci.qaBundleChecks.length > 0)) {
    html += '<div class="pr-review-section">';
    const allPass = ci.failed === 0 && ci.total > 0;
    html += '<div class="pr-review-section-title">' + (allPass ? '✅' : '❌') + ' CI Checks (' + ci.passed + '/' + ci.total + ' passed)</div>';

    ci.checks.forEach(function(c) {
      const icon = c.conclusion === 'success' ? '✅' : c.conclusion === 'failure' ? '❌' : c.conclusion === 'skipped' ? '⏭️' : '⏳';
      html += '<div class="ci-check-row">';
      html += '<span class="check-icon">' + icon + '</span>';
      html += '<span class="check-name">' + esc(c.name) + '</span>';
      if (c.durationSec != null) html += '<span class="check-duration">' + formatDuration(c.durationSec) + '</span>';
      if (c.detailsUrl) html += '<a href="' + esc(c.detailsUrl) + '" target="_blank">logs</a>';
      html += '</div>';
    });

    // QA bundle manual checks
    if (ci.qaBundleChecks && ci.qaBundleChecks.length > 0) {
      html += '<div style="margin-top:8px;font-size:11px;color:var(--text-muted);font-weight:600">Manual QA</div>';
      ci.qaBundleChecks.forEach(function(c) {
        html += '<div class="ci-check-row"><span class="check-icon">✓</span><span class="check-name" style="color:var(--text-muted)">' + esc(c) + '</span></div>';
      });
    }

    html += '</div>';
  }

  // Done Criteria Alignment
  if (alignment.criteria && alignment.criteria.length > 0) {
    const summary = alignment.summary || {};
    const coverageIcon = summary.none === 0 ? '✅' : summary.none <= 1 ? '⚠️' : '❌';
    html += '<div class="pr-review-section">';
    html += '<div class="pr-review-section-title">' + coverageIcon + ' Done Criteria (' + (summary.total - summary.none) + '/' + summary.total + ' aligned)</div>';

    alignment.criteria.forEach(function(c, i) {
      const icon = c.confidence === 'high' ? '✅' : c.confidence === 'medium' ? '🟡' : c.confidence === 'low' ? '⚠️' : '❌';
      html += '<div class="criterion-row">';
      html += '<div class="criterion-text"><span>' + icon + '</span> <span>' + esc(c.criterion) + '</span></div>';
      html += '<div class="criterion-evidence">';
      html += '<span class="confidence-badge ' + esc(c.confidence) + '">' + esc(c.confidence) + '</span>';
      if (c.fileMatches && c.fileMatches.length > 0) {
        html += '<div class="evidence-item">Files: ' + c.fileMatches.map(function(f) { return '<code style="font-size:10px">' + esc(f) + '</code>'; }).join(', ') + '</div>';
      }
      if (c.testMatches && c.testMatches.length > 0) {
        html += '<div class="evidence-item">Tests: ' + c.testMatches.map(function(t) { return esc(t); }).join(', ') + '</div>';
      }
      if (c.hasArtifact) {
        html += '<div class="evidence-item">Artifact: present</div>';
      }
      if (c.confidence === 'none') {
        html += '<div class="evidence-item" style="color:var(--red)">⚠ No matching evidence — manual review needed</div>';
      }
      html += '</div></div>';
    });

    html += '<div style="font-size:10px;color:var(--text-dim);margin-top:6px">Confidence: ' + summary.high + ' high, ' + summary.medium + ' medium, ' + summary.low + ' low, ' + summary.none + ' none</div>';
    html += '</div>';
  }

  return html;
}

async function copyTaskId() {
  const taskId = currentTask && currentTask.id ? currentTask.id : document.getElementById('modal-task-id').textContent;
  if (!taskId) return;
  try {
    await navigator.clipboard.writeText(taskId);
  } catch (_e) {
    // Fallback for older browser contexts
    const ta = document.createElement('textarea');
    ta.value = taskId;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
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

// ============ FOCUS MODE ============

function toggleFocusMode() {
  focusModeActive = !focusModeActive;
  document.body.classList.toggle('focus-mode', focusModeActive);
  const btn = document.getElementById('focus-toggle');
  if (btn) btn.classList.toggle('active', focusModeActive);

  // Persist preference
  try { localStorage.setItem('reflectt-focus-mode', focusModeActive ? '1' : '0'); } catch {}

  // Re-render kanban to add/remove QA contract details
  renderKanban();

  // Toggle collapsed panels — allow click to temporarily expand
  document.querySelectorAll('.panel.focus-collapse').forEach(panel => {
    if (!panel.dataset.focusClickBound) {
      panel.addEventListener('click', () => {
        if (!focusModeActive) return;
        panel.classList.toggle('focus-expanded');
        if (panel.classList.contains('focus-expanded')) {
          panel.style.opacity = '1';
          panel.querySelectorAll('.panel-body, .channel-tabs, .chat-input-bar, .project-tabs, .kanban').forEach(el => {
            el.style.display = '';
          });
        } else {
          panel.style.opacity = '';
          // CSS will re-hide via focus-collapse rules
        }
      });
      panel.dataset.focusClickBound = 'true';
    }
    // Reset expanded state when toggling focus mode
    panel.classList.remove('focus-expanded');
    panel.style.opacity = '';
  });
}

function renderQaContract(task) {
  if (!focusModeActive) return '';
  const meta = task.metadata || {};
  const reviewer = task.reviewer || null;
  const eta = meta.eta || null;
  const hasArtifact = !!(meta.artifact_path || (Array.isArray(meta.artifacts) && meta.artifacts.length > 0));
  const prUrl = extractTaskPrLink(task);

  return `<div class="qa-contract">
    <div class="qa-row">
      <span class="qa-label">Owner</span>
      <span class="qa-value">${task.assignee ? esc(task.assignee) : '<span class="missing">unassigned</span>'}</span>
    </div>
    <div class="qa-row">
      <span class="qa-label">Reviewer</span>
      <span class="qa-value${!reviewer ? ' missing' : ''}">${reviewer ? esc(reviewer) : 'none'}</span>
    </div>
    <div class="qa-row">
      <span class="qa-label">ETA</span>
      <span class="qa-value${!eta ? ' missing' : ''}">${eta ? esc(String(eta)) : 'not set'}</span>
    </div>
    <div class="qa-row">
      <span class="qa-label">Artifact</span>
      <span class="qa-value${hasArtifact ? ' has-artifact' : ' missing'}">${hasArtifact ? (prUrl ? '<a href="' + esc(prUrl) + '" target="_blank" style="color:var(--green)">PR ↗</a>' : '✓ present') : 'none'}</span>
    </div>
  </div>`;
}

// Restore focus mode from localStorage
(function restoreFocusMode() {
  try {
    if (localStorage.getItem('reflectt-focus-mode') === '1') {
      focusModeActive = true;
      document.body.classList.add('focus-mode');
      const btn = document.getElementById('focus-toggle');
      if (btn) btn.classList.add('active');
    }
  } catch {}
})();

// ── Getting Started panel ──────────────────────────────────
async function checkGettingStarted() {
  const panel = document.getElementById('getting-started');
  if (!panel) return;

  // Respect manual dismiss
  try {
    if (localStorage.getItem('reflectt-gs-dismissed') === '1') {
      panel.classList.add('hidden');
      return;
    }
  } catch {}

  // Check system state to auto-hide and mark steps done
  try {
    const res = await fetch(BASE + '/health');
    if (!res.ok) return;
    const health = await res.json();

    const hasHeartbeat = health.uptime_seconds > 0;
    const hasTasks = (health.tasks?.total || 0) > 0;
    const hasMessages = (health.chat?.total || 0) > 0;

    // Step 1: preflight — done if server is healthy
    const step1 = document.getElementById('gs-preflight');
    if (step1 && hasHeartbeat) {
      step1.classList.add('done');
      step1.querySelector('.gs-icon').textContent = '✓';
    }

    // Step 2: connect — check if cloud/host is enrolled
    const step2 = document.getElementById('gs-connect');
    try {
      const hostRes = await fetch(BASE + '/hosts');
      if (hostRes.ok) {
        const hostData = await hostRes.json();
        const hosts = hostData.hosts || hostData || [];
        if (Array.isArray(hosts) && hosts.length > 0) {
          if (step2) {
            step2.classList.add('done');
            step2.querySelector('.gs-icon').textContent = '✓';
          }
        }
      }
    } catch {}

    // Step 3: first task/message — done if any exist
    const step3 = document.getElementById('gs-task');
    if (step3 && (hasTasks || hasMessages)) {
      step3.classList.add('done');
      step3.querySelector('.gs-icon').textContent = '✓';
    }

    // Auto-hide if all steps done
    const allDone = panel.querySelectorAll('.gs-step.done').length === 3;
    if (allDone) {
      panel.classList.add('hidden');
    }
  } catch {}
}

function dismissGettingStarted() {
  const panel = document.getElementById('getting-started');
  if (panel) panel.classList.add('hidden');
  try { localStorage.setItem('reflectt-gs-dismissed', '1'); } catch {}
}

updateClock();
setInterval(updateClock, 30000);
checkGettingStarted();
refresh();
connectEventStream();
startAdaptiveRefresh();