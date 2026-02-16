# Cloud Integration Endpoints

Endpoints for managing the reflectt-node ↔ Reflectt Cloud connection.

## GET /cloud/status

Returns current cloud connection status.

```json
{
  "configured": true,
  "registered": true,
  "hostId": "host_abc123",
  "running": true,
  "heartbeatCount": 42,
  "lastHeartbeat": 1771214950823,
  "lastTaskSync": 1771214960000,
  "errors": 0
}
```

- `configured` — true if cloud env vars or persisted credentials exist
- `registered` — true if the host has a cloud host ID
- `running` — true if heartbeat/sync loops are active

## POST /cloud/reload

Hot-reloads cloud configuration from `~/.reflectt/config.json` without restarting the server. Used by `reflectt host connect` after enrollment to apply new credentials to the running process.

**Request:** No body required.

**Response (success):**
```json
{
  "success": true,
  "message": "Cloud integration reloaded from config.json",
  "status": { "configured": true, "registered": true, "..." }
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "No cloud enrollment found in config.json"
}
```

**Flow:**
1. Reads `~/.reflectt/config.json` from disk
2. Updates `REFLECTT_HOST_*` env vars from the `cloud` section
3. Stops existing heartbeat/sync timers
4. Restarts cloud integration with new config

This avoids a full server restart after `reflectt host connect`, solving the dogfood issue where `/cloud/status` showed `registered: false` on the running process after CLI enrollment.
