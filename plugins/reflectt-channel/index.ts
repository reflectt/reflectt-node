/**
 * reflectt-channel — OpenClaw channel plugin
 * 
 * Connects to reflectt-node SSE. When a message @mentions an agent,
 * it routes through OpenClaw's inbound pipeline. Agent responses are
 * POSTed back to reflectt-node automatically.
 */
import type { OpenClawPluginApi, ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:4445";

const WATCHED_AGENTS = ["kai", "link", "pixel", "echo", "harmony", "rhythm", "sage", "scout", "spark"] as const;
const WATCHED_SET = new Set<string>(WATCHED_AGENTS);
const IDLE_NUDGE_WINDOW_MS = 15 * 60 * 1000; // 15m
const WATCHDOG_INTERVAL_MS = 60 * 1000; // 1m
const ESCALATION_COOLDOWN_MS = 20 * 60 * 1000;

// SSE reconnect config
const SSE_INITIAL_RETRY_MS = 1000;      // start at 1s
const SSE_MAX_RETRY_MS = 30_000;        // cap at 30s
const SSE_SOCKET_TIMEOUT_MS = 30_000;   // detect dead TCP after 30s silence
const SSE_HEALTH_INTERVAL_MS = 15_000;  // health-check ping every 15s

const lastUpdateByAgent = new Map<string, number>();
const lastEscalationAt = new Map<string, number>();
const hasActiveTaskByAgent = new Map<string, { value: boolean; checkedAt: number }>();
const TASK_CACHE_TTL_MS = 2 * 60 * 1000;

// --- Config helpers ---

interface ReflecttAccount {
  accountId: string;
  url: string;
  enabled: boolean;
  configured: boolean;
}

function purgeSessionIndexEntry(agentId: string, sessionKey: string, ctx: any): boolean {
  try {
    const storePath = path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions", "sessions.json");
    if (!fs.existsSync(storePath)) return false;

    const raw = fs.readFileSync(storePath, "utf8");
    const data = JSON.parse(raw || "{}");
    const keyExact = sessionKey;
    const keyLower = sessionKey.toLowerCase();

    if (!Object.prototype.hasOwnProperty.call(data, keyExact) && !Object.prototype.hasOwnProperty.call(data, keyLower)) {
      return false;
    }

    delete data[keyExact];
    delete data[keyLower];
    fs.writeFileSync(storePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    ctx.log?.warn(`[reflectt] Purged stale session index entry for ${sessionKey} at ${storePath}`);
    return true;
  } catch (err) {
    ctx.log?.error(`[reflectt] Failed to purge session entry for ${sessionKey}: ${err}`);
    return false;
  }
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null, log?: any): ReflecttAccount {
  // Support both config paths:
  //   1. channels.reflectt.url (canonical — per OpenClaw channel plugin convention)
  //   2. plugins.entries.reflectt-channel.config.url (fallback — general plugin convention)
  // channels.reflectt takes precedence.
  const ch = (cfg as any)?.channels?.reflectt ?? {};
  const pluginCfg = (cfg as any)?.plugins?.entries?.["reflectt-channel"]?.config ?? {};

  const hasChannelConfig = !!ch.url;
  const hasPluginConfig = !!pluginCfg.url;
  const url = ch.url || pluginCfg.url || DEFAULT_URL;
  const enabled = ch.enabled !== undefined ? ch.enabled !== false
    : pluginCfg.enabled !== undefined ? pluginCfg.enabled !== false
    : true;
  const configured = hasChannelConfig || hasPluginConfig;

  if (!configured) {
    log?.warn(
      `[reflectt] No explicit URL configured — using default ${DEFAULT_URL}. ` +
      `To configure, set one of:\n` +
      `  1. channels.reflectt.url in ~/.openclaw/openclaw.json (recommended)\n` +
      `  2. plugins.entries.reflectt-channel.config.url in ~/.openclaw/openclaw.json\n` +
      `  Or run: openclaw config set channels.reflectt.url "http://your-node:4445"`
    );
  } else if (hasChannelConfig && hasPluginConfig && ch.url !== pluginCfg.url) {
    log?.warn(
      `[reflectt] Config found in both channels.reflectt.url (${ch.url}) and ` +
      `plugins.entries.reflectt-channel.config.url (${pluginCfg.url}). ` +
      `Using channels.reflectt.url (takes precedence).`
    );
  }

  return {
    accountId: accountId || DEFAULT_ACCOUNT_ID,
    url,
    enabled,
    configured,
  };
}

// --- HTTP helpers ---

function postMessage(url: string, from: string, channel: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from, channel, content });
    const parsed = new URL(`${url}/chat/messages`);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => { res.resume(); resolve(); });
    req.on("error", reject);
    req.end(body);
  });
}

function normalizeSenderId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase().replace(/^@+/, "");
  return id.length > 0 ? id : null;
}

function markAgentActivity(from: unknown, channel: unknown, timestamp: unknown) {
  if (channel !== "general") return;
  const id = normalizeSenderId(from);
  if (!id || !WATCHED_SET.has(id)) return;
  const ts =
    typeof timestamp === "number" && Number.isFinite(timestamp)
      ? timestamp
      : typeof timestamp === "string" && Number.isFinite(Number(timestamp))
        ? Number(timestamp)
        : Date.now();
  const cur = lastUpdateByAgent.get(id) ?? 0;
  if (ts > cur) lastUpdateByAgent.set(id, ts);
}

function shouldEscalate(key: string, now: number): boolean {
  const last = lastEscalationAt.get(key) ?? 0;
  if (now - last < ESCALATION_COOLDOWN_MS) return false;
  lastEscalationAt.set(key, now);
  return true;
}

async function fetchRecentMessages(url: string): Promise<Array<Record<string, unknown>>> {
  const endpoints = ["/chat/messages?limit=500", "/chat/messages", "/messages"];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${url}${endpoint}`);
      if (!response.ok) continue;
      const data = await response.json();
      const messages = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { messages?: unknown[] }).messages)
          ? (data as { messages: unknown[] }).messages
          : [];
      return messages.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object");
    } catch {
      // best effort
    }
  }
  return [];
}

async function seedAgentActivity(url: string, log?: any) {
  const now = Date.now();
  for (const agent of WATCHED_AGENTS) {
    lastUpdateByAgent.set(agent, now);
  }

  const messages = await fetchRecentMessages(url);
  for (const msg of messages) {
    markAgentActivity(msg.from, msg.channel, msg.timestamp);
  }

  log?.info?.(`[reflectt][watchdog] seeded activity from ${messages.length} recent message(s)`);
}

async function hasActiveTask(url: string, agent: string, now = Date.now()): Promise<boolean> {
  const cached = hasActiveTaskByAgent.get(agent);
  if (cached && now - cached.checkedAt < TASK_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const response = await fetch(`${url}/tasks/next?agent=${encodeURIComponent(agent)}`);
    if (!response.ok) {
      hasActiveTaskByAgent.set(agent, { value: true, checkedAt: now });
      return true;
    }

    const data = await response.json() as { task?: unknown };
    const value = Boolean(data?.task);
    hasActiveTaskByAgent.set(agent, { value, checkedAt: now });
    return value;
  } catch {
    // fail-open so task API hiccups do not suppress legitimate nudges
    hasActiveTaskByAgent.set(agent, { value: true, checkedAt: now });
    return true;
  }
}

// --- Dedup ---
const seen = new Set<string>();
function dedup(id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 500) { const f = seen.values().next().value; if (f) seen.delete(f); }
  return true;
}

// --- Runtime dispatch telemetry ---
const dispatchCountByMessageId = new Map<string, number>();
function incrementDispatchCount(messageId: string): number {
  const next = (dispatchCountByMessageId.get(messageId) ?? 0) + 1;
  dispatchCountByMessageId.set(messageId, next);
  if (dispatchCountByMessageId.size > 1000) {
    const oldest = dispatchCountByMessageId.keys().next().value;
    if (oldest) dispatchCountByMessageId.delete(oldest);
  }
  return next;
}

// --- SSE connection ---

let sseRequest: http.ClientRequest | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let pluginRuntime: any = null;
let currentRetryMs = SSE_INITIAL_RETRY_MS;
let lastSSEDataAt = 0;
let sseConnected = false;

function destroySSE(ctx: any, reason: string) {
  if (sseRequest) {
    ctx.log?.info(`[reflectt] Destroying SSE connection: ${reason}`);
    try { sseRequest.destroy(); } catch {}
    sseRequest = null;
  }
  sseConnected = false;
}

function connectSSE(url: string, account: ReflecttAccount, ctx: any) {
  if (stopped) return;

  // Clean up any lingering connection
  if (sseRequest) {
    destroySSE(ctx, "new connection attempt");
  }

  ctx.log?.info(`[reflectt] Connecting SSE: ${url}/events/subscribe (retry backoff: ${currentRetryMs}ms)`);

  const req = http.get(`${url}/events/subscribe`, (res) => {
    if (res.statusCode !== 200) {
      ctx.log?.error(`[reflectt] SSE status ${res.statusCode}`);
      res.resume();
      sseRequest = null;
      scheduleReconnect(url, account, ctx);
      return;
    }

    // Connection succeeded — reset backoff
    currentRetryMs = SSE_INITIAL_RETRY_MS;
    sseConnected = true;
    lastSSEDataAt = Date.now();
    ctx.log?.info("[reflectt] SSE connected ✓");

    // Re-seed agent activity after reconnect
    seedAgentActivity(url, ctx.log).catch((err) => {
      ctx.log?.warn?.(`[reflectt] post-reconnect seed failed: ${err}`);
    });

    // NOTE: No socket timeout here — SSE streams are idle by nature.
    // Staleness is detected by the periodic health-check pinger instead.

    let buffer = "";
    res.setEncoding("utf8");

    res.on("data", (chunk: string) => {
      lastSSEDataAt = Date.now();
      buffer += chunk;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";

      for (const frame of frames) {
        if (!frame.trim()) continue;
        let eventType = "", eventData = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) eventData = line.slice(6);
        }
        if (eventType === "message_posted" && eventData) {
          handleInbound(eventData, url, account, ctx);
        } else if (eventType === "batch" && eventData) {
          try {
            const events = JSON.parse(eventData);
            for (const evt of events) {
              if (evt.type === "message_posted" && evt.data) {
                handleInbound(JSON.stringify(evt.data), url, account, ctx);
              }
            }
          } catch (e) {
            ctx.log?.error(`[reflectt] batch parse error: ${e}`);
          }
        }
      }
    });

    res.on("end", () => {
      ctx.log?.warn("[reflectt] SSE stream ended by server");
      sseRequest = null;
      sseConnected = false;
      scheduleReconnect(url, account, ctx);
    });
    res.on("error", (err) => {
      ctx.log?.error(`[reflectt] SSE response error: ${err.message}`);
      sseRequest = null;
      sseConnected = false;
      scheduleReconnect(url, account, ctx);
    });
  });

  req.on("error", (err) => {
    ctx.log?.error(`[reflectt] SSE connect error: ${err.message}`);
    sseRequest = null;
    sseConnected = false;
    scheduleReconnect(url, account, ctx);
  });

  sseRequest = req;
}

function scheduleReconnect(url: string, account: ReflecttAccount, ctx: any) {
  if (stopped || reconnectTimer) return;

  // Exponential backoff with jitter
  const jitter = Math.random() * currentRetryMs * 0.3;
  const delay = Math.min(currentRetryMs + jitter, SSE_MAX_RETRY_MS);
  ctx.log?.info(`[reflectt] Reconnecting in ${Math.round(delay)}ms`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSSE(url, account, ctx);
  }, delay);

  // Increase backoff for next attempt
  currentRetryMs = Math.min(currentRetryMs * 2, SSE_MAX_RETRY_MS);
}

/**
 * Periodic health-check: ping /health to detect server availability
 * even when the SSE socket hasn't timed out yet. If the server is up
 * but we're not connected, force a reconnect.
 */
function startHealthCheck(url: string, account: ReflecttAccount, ctx: any) {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(async () => {
    if (stopped) return;

    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        // Server is alive
        if (!sseConnected && !reconnectTimer) {
          ctx.log?.warn("[reflectt] Health OK but SSE not connected — forcing reconnect");
          currentRetryMs = SSE_INITIAL_RETRY_MS; // reset backoff since server is up
          connectSSE(url, account, ctx);
        }
      }
    } catch {
      // Server unreachable — SSE reconnect loop will handle it
      if (sseConnected) {
        ctx.log?.warn("[reflectt] Health check failed while SSE appears connected — destroying stale connection");
        destroySSE(ctx, "health check failed");
        scheduleReconnect(url, account, ctx);
      }
    }
  }, SSE_HEALTH_INTERVAL_MS);
}

function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

function startWatchdog(url: string, ctx: any) {
  if (watchdogTimer) return;

  watchdogTimer = setInterval(async () => {
    const now = Date.now();
    for (const agent of WATCHED_AGENTS) {
      const lastUpdateAt = lastUpdateByAgent.get(agent) ?? now;
      if (now - lastUpdateAt <= IDLE_NUDGE_WINDOW_MS) continue;

      const activeTask = await hasActiveTask(url, agent, now);
      if (!activeTask) {
        ctx.log?.info?.(`[reflectt][watchdog] idle nudge suppressed for @${agent}: no active task`);
        continue;
      }

      const key = `idle:${agent}`;
      if (!shouldEscalate(key, now)) continue;

      const content = `@${agent} idle nudge: no update in #general for 15m+. Post shipped / blocker / next+ETA now.`;
      try {
        await postMessage(url, "watchdog", "general", content);
        ctx.log?.info?.(`[reflectt][watchdog] idle nudge fired for @${agent} (last=${lastUpdateAt})`);
      } catch (err) {
        ctx.log?.warn?.(`[reflectt][watchdog] idle nudge failed for @${agent}: ${err}`);
      }
    }
  }, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function handleInbound(data: string, url: string, account: ReflecttAccount, ctx: any) {
  try {
    const msg = JSON.parse(data);
    const content: string = msg.content || "";
    const msgId: string = msg.id || "";
    const from: string = msg.from || "unknown";
    const channel: string = msg.channel || "general";

    // Re-enabled by operator request: system/watchdog messages should be dispatch-eligible.
    // Keep activity tracking consistent for all senders.
    markAgentActivity(from, channel, msg.timestamp);

    if (!msgId) return;
    if (!dedup(msgId)) {
      ctx.log?.debug(`[reflectt][dispatch-telemetry] duplicate inbound ignored message_id=${msgId}`);
      return;
    }

    // Extract @mentions
    const mentions: string[] = [];
    const regex = /@(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) mentions.push(match[1].toLowerCase());
    if (mentions.length === 0) return;

    // Build agent ID map
    const cfg = pluginRuntime?.config?.loadConfig?.() ?? {};
    const agentList: Array<{ id: string; identity?: { name?: string } }> = cfg?.agents?.list || [];
    const agentIds = new Set<string>();
    const agentNameToId = new Map<string, string>();
    for (const a of agentList) {
      agentIds.add(a.id);
      agentNameToId.set(a.id, a.id);
      if (a.identity?.name) {
        const name = a.identity.name.toLowerCase();
        agentIds.add(name);
        agentNameToId.set(name, a.id);
      }
    }

    // Determine sender's agent ID (if message is from an agent)
    const senderAgentId = agentNameToId.get(from.toLowerCase());

    // Find mentioned agent
    ctx.log?.debug(`[reflectt] Processing mentions: ${mentions.join(", ")}`);
    let matchedMentions = 0;
    let skippedSelfMentions = 0;
    let unmatchedMentions = 0;
    const dispatchedTargets: string[] = [];
    const dispatchedSet = new Set<string>();

    for (const mention of mentions) {
      let agentId: string | undefined;
      for (const a of agentList) {
        if (a.id === mention) { agentId = a.id; break; }
        if (a.identity?.name?.toLowerCase() === mention) { agentId = a.id; break; }
      }
      if (!agentId && mention === "kai") agentId = "main";
      if (!agentId) {
        unmatchedMentions += 1;
        ctx.log?.debug(`[reflectt] Mention @${mention} did not match any agent`);
        continue;
      }

      // Skip routing to yourself (avoid self-loops)
      if (senderAgentId && agentId === senderAgentId) {
        skippedSelfMentions += 1;
        ctx.log?.debug(`[reflectt] Skipping self-mention: @${agentId}`);
        continue;
      }

      if (dispatchedSet.has(agentId)) {
        ctx.log?.debug(`[reflectt] Skipping duplicate mention target: @${agentId}`);
        continue;
      }

      matchedMentions += 1;
      dispatchedSet.add(agentId);
      ctx.log?.info(`[reflectt] ${from} → @${agentId}: ${content.slice(0, 60)}...`);

      // Build inbound message context
      const runtime = pluginRuntime;
      if (!runtime?.channel?.reply) continue;

      // All reflectt rooms share one session per agent (peer: null).
      // Room identity is preserved in OriginatingTo so replies route correctly.
      const sessionKey = `agent:${agentId}:reflectt:main`;
      
      // Create message context
      const msgContext = {
        Body: content,
        BodyForAgent: content,
        CommandBody: content,
        BodyForCommands: content,
        From: `reflectt:${channel}`,
        To: channel,
        SessionKey: sessionKey,
        AccountId: account.accountId,
        MessageSid: msgId,
        ChatType: "group",
        ConversationLabel: `reflectt-node #${channel}`,
        SenderName: from,
        SenderId: from,
        Timestamp: msg.timestamp || Date.now(),
        Provider: "reflectt",
        Surface: "reflectt",
        OriginatingChannel: "reflectt" as const,
        OriginatingTo: channel,
        WasMentioned: true,
        CommandAuthorized: false,
      };

      // Finalize context
      const finalizedCtx = runtime.channel.reply.finalizeInboundContext(msgContext);

      // Guard against stale/unsafe session path metadata leaking from prior context.
      // OpenClaw now enforces that any session file path must be under the agent sessions dir.
      const safeCtx: any = { ...finalizedCtx };
      delete safeCtx.SessionFilePath;
      delete safeCtx.sessionFilePath;
      delete safeCtx.SessionPath;
      delete safeCtx.sessionPath;
      delete safeCtx.TranscriptPath;
      delete safeCtx.transcriptPath;
      delete safeCtx.SessionFile;
      delete safeCtx.sessionFile;

      // Create reply dispatcher
      const agentName = agentId === "main" ? "kai" : agentId;
      const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
        deliver: async (payload: any) => {
          const text = payload.text || payload.content || "";
          if (text) {
            ctx.log?.info(`[reflectt] Reply → ${channel}: ${text.slice(0, 60)}...`);
            await postMessage(url, agentName!, channel, text);
          }
        },
        onError: (err: unknown) => {
          ctx.log?.error(`[reflectt] Dispatch error: ${err}`);
        },
      });

      // Dispatch reply using OpenClaw's pipeline
      const dispatchCount = incrementDispatchCount(msgId);
      dispatchedTargets.push(agentId);
      ctx.log?.info(
        `[reflectt][dispatch-telemetry] message_id=${msgId} dispatch_count=${dispatchCount} target=${agentId} mentions_total=${mentions.length}`,
      );

      runtime.channel.reply.dispatchReplyFromConfig({
        ctx: safeCtx,
        cfg,
        dispatcher: dispatcher.dispatcher,
        replyOptions: dispatcher.replyOptions,
      }).catch((err: unknown) => {
        const errText = String(err ?? "");
        if (errText.includes("Session file path must be within sessions directory")) {
          const healed = purgeSessionIndexEntry(agentId!, sessionKey, ctx);
          if (healed) {
            ctx.log?.warn(`[reflectt] Retrying dispatch after purging stale session entry: ${sessionKey}`);
            runtime.channel.reply.dispatchReplyFromConfig({
              ctx: safeCtx,
              cfg,
              dispatcher: dispatcher.dispatcher,
              replyOptions: dispatcher.replyOptions,
            }).catch((retryErr: unknown) => {
              ctx.log?.error(`[reflectt] dispatch retry failed: ${retryErr}`);
            });
            return;
          }
        }
        ctx.log?.error(`[reflectt] dispatchReplyFromConfig error: ${err}`);
      });
    }

    ctx.log?.info(
      `[reflectt][dispatch-telemetry] summary message_id=${msgId} mentions_total=${mentions.length} matched=${matchedMentions} unmatched=${unmatchedMentions} skipped_self=${skippedSelfMentions} dispatched=${dispatchedTargets.length} targets=${dispatchedTargets.join(",") || "none"}`,
    );
  } catch (err) {
    ctx.log?.error(`[reflectt] Parse error: ${err}`);
  }
}

// --- Channel Plugin ---

const reflecttPlugin: ChannelPlugin<ReflecttAccount> = {
  id: "reflectt",
  meta: {
    id: "reflectt",
    label: "Reflectt",
    selectionLabel: "Reflectt (Local)",
    docsPath: "/channels/reflectt",
    docsLabel: "reflectt",
    blurb: "Real-time agent collaboration via reflectt-node",
    order: 110,
  },
  capabilities: {
    chatTypes: ["group"],
    media: false,
  },
  reload: { configPrefixes: ["channels.reflectt"] },

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId, pluginRuntime?.logger),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: "Reflectt",
      enabled: account.enabled,
      configured: account.configured,
    }),
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId }) => {
      const cfg = pluginRuntime?.config?.loadConfig?.() ?? {};
      const account = resolveAccount(cfg, accountId);
      // Determine agent name for "from" field
      const agentName = "kai"; // TODO: resolve from session context
      await postMessage(account.url, agentName, "general", text ?? "");
      return { channel: "reflectt" as const, to, messageId: `rn-${Date.now()}` };
    },
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.enabled) return;

      stopped = false;

      // Validate connectivity and show actionable error if server unreachable
      try {
        const healthRes = await fetch(`${account.url}/health`, { signal: AbortSignal.timeout(5000) });
        if (!healthRes.ok) {
          ctx.log?.warn(`[reflectt] Server at ${account.url} returned ${healthRes.status}. Will retry via SSE reconnect.`);
        } else {
          ctx.log?.info(`[reflectt] Server at ${account.url} is healthy ✓`);
        }
      } catch {
        ctx.log?.error(
          `[reflectt] Cannot reach reflectt-node at ${account.url}. ` +
          `Make sure reflectt-node is running, then set the URL in your OpenClaw config:\n` +
          `  Option 1 (recommended): channels.reflectt.url = "${account.url}"\n` +
          `  Option 2: plugins.entries.reflectt-channel.config.url = "${account.url}"\n` +
          `Will keep retrying via SSE reconnect.`
        );
      }

      ctx.setStatus({
        accountId: account.accountId,
        name: "Reflectt",
        enabled: true,
        configured: true,
      });

      seedAgentActivity(account.url, ctx.log).catch((err) => {
        ctx.log?.warn?.(`[reflectt][watchdog] seed failed: ${err}`);
      });
      startWatchdog(account.url, ctx);
      startHealthCheck(account.url, account, ctx);
      connectSSE(account.url, account, ctx);

      return {
        stop: () => {
          stopped = true;
          stopWatchdog();
          stopHealthCheck();
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
          destroySSE(ctx, "plugin stopped");
          ctx.log?.info("[reflectt] Stopped");
        },
      };
    },
  },
};

// --- Plugin entry ---

const plugin = {
  id: "reflectt-channel",
  name: "Reflectt Channel",
  description: "Real-time agent collaboration via reflectt-node SSE",

  register(api: OpenClawPluginApi) {
    pluginRuntime = api.runtime;
    api.logger.info("[reflectt] Registering channel plugin");
    api.registerChannel({ plugin: reflecttPlugin });
  },
};

export default plugin;
