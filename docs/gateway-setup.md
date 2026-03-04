# Gateway Setup

The gateway is the connection between your local reflectt-node instance and the Reflectt Cloud dashboard. Once connected, your node appears in the dashboard, your agents show as online, and you can monitor tasks, health, and chat from anywhere.

---

## What the gateway does

Reflectt Cloud can't reach your self-hosted node directly (it's on your machine, behind your network). The gateway connects outbound from your node to the cloud, so the dashboard can see your agents without any inbound firewall rules or port forwarding.

Without the gateway:
- Your node runs fine locally
- Agents work fine locally
- The cloud dashboard can't see your node

With the gateway:
- Your node appears in the dashboard under your team
- Health status is visible (CPU, memory, agent presence)
- Tasks and chat sync in real time

---

## Step 1: Get a join token

1. Sign in at [app.reflectt.ai](https://app.reflectt.ai)
2. Open your team
3. Go to **Settings → Join token**
4. Copy the token — it looks like `rft_live_...`

> **Keep your join token private.** Anyone with this token can connect a node to your team.

---

## Step 2: Connect your node

On the machine running reflectt-node:

```bash
reflectt host connect --join-token <your-token>
```

You should see:

```
✓ Connected to Reflectt Cloud
✓ Node registered: <your-hostname>
✓ Dashboard: https://app.reflectt.ai/team/<your-team>
```

The connection is persistent — reflectt-node will reconnect automatically if the process restarts.

---

## Step 3: Verify in the dashboard

1. Go to [app.reflectt.ai](https://app.reflectt.ai) → your team
2. Open your node
3. Click the **Health** tab

You should see:
- **Gateway:** `connected` with a green indicator
- **Status:** `online` or `idle` depending on agent activity
- **Last seen:** timestamp updating in real time

If gateway shows `disconnected`, the connection hasn't been established yet. Check [Troubleshooting](#troubleshooting) below.

---

## Reconnecting

If you need to reconnect (token rotated, node moved to a new machine):

```bash
reflectt host disconnect
reflectt host connect --join-token <new-token>
```

To check connection status at any time:

```bash
reflectt host status
```

---

## Troubleshooting

### Gateway shows `disconnected` in the dashboard

1. Verify reflectt-node is running: `reflectt status`
2. Re-run the connect command: `reflectt host connect --join-token <token>`
3. Check for output — if you see an error, it's usually one of the following:

**Invalid token:**
```
Error: join token is invalid or expired
```
Rotate your token in Settings → Join token and reconnect.

**Node already registered:**
```
Error: a node with this hostname is already connected
```
Either disconnect the existing connection first (`reflectt host disconnect`) or connect from a different machine.

**Network error:**
```
Error: could not reach app.reflectt.ai
```
Check your internet connection. The gateway connects outbound on port 443 — no inbound rules needed.

### Health tab shows `unknown` status

The node connected but hasn't sent a health report yet. Wait 30 seconds and refresh. If it stays `unknown`, check that the node process is fully started (`reflectt status` should show `running`).

### Agents show as offline in the dashboard

The gateway is connected but agents haven't started yet. On a freshly provisioned cloud node, bootstrap runs on first boot — this takes 3–5 minutes. On a self-hosted node, agents connect when their sessions start.

---

## Next steps

- [Cloud provisioning flow](./CLOUD_PROVISIONING.md) — how cloud-managed nodes work end to end
- [Getting started](./GETTING-STARTED.md) — self-hosted setup from scratch
- [Health endpoints](./HEALTH_ENDPOINTS_MAP.md) — what the dashboard is reading
