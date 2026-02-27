# [Apple layer] Zero-config host enroll + preflight + one-click fix — PRD

**Task:** task-1772166987141-1zac2qbir  
**Owner:** Scout  
**Reviewer:** Kai  
**Goal:** turn “Apple layer” from a framing into an executable wedge: *a single guided flow that takes a fresh Mac host from unknown → enrolled → preflight green, with fix-it buttons for common failures.*

## 0) One-line definition
**Apple layer = the Mac-side runtime + permissions + connectivity required for Reflectt/OpenClaw to reliably capture context and perform actions on Apple OS without manual debugging.**

## 1) User story + success metric
### Primary user story
As a new operator installing Reflectt/OpenClaw on macOS, I want **one place** that tells me what’s broken (auth, permissions, services, network) and lets me fix it quickly so I can get to “green” and start using the product.

### Success metrics (what “works” means)
- **Time-to-green:** median < **5 minutes** from install → “All checks PASS”.
- **Support load:** reduce “it doesn’t work on Mac” setup pings by **>50%**.
- **Reliability:** once green, **>95%** of sessions keep Apple checks green across 24h (no silent permission regressions).

## 2) Non-goals (for this wedge)
- Full iOS device capture / on-device agents.
- Building complete macOS automation coverage (we just need preflight + fixes).
- Shipping a perfect UI — we need a *functional* guided flow.

## 3) UX flow (opinionated)
### Entry point
In the host dashboard (reflectt-node UI), show a top-level card:
- **“Apple layer”** badge with state: `GREEN | YELLOW | RED`.
- CTA:
  - If not enrolled: **Enroll host**
  - If enrolled but failing: **Run preflight**
  - If failing checks: **Fix issues**

### Flow A — “Zero-config enroll” (first-run)
1) User clicks **Enroll host**
2) System generates an enroll token and shows **one** primary action:
   - **“Open enrollment link”** (opens browser) + QR (optional)
3) Enrollment completes → UI shows:
   - host name
   - workspace
   - last sync timestamp
   - “Run preflight” button

**Notes:**
- Use a **device-code/magic-link** pattern so there is no copy/paste of long tokens.
- If cloud is unavailable, show an offline mode note, but keep preflight usable.

### Flow B — Preflight
User clicks **Run preflight** → checklist renders with:
- Check name
- Status (`PASS | WARN | FAIL`)
- Why it matters (1 sentence)
- **Fix** button (if actionable)
- “View details” for logs/commands

### Flow C — One-click fixes
Fix button triggers one of:
- Run a local command (with confirmation) e.g. start gateway, restart service
- Open the correct macOS System Settings pane
- Show exact instructions when automation isn’t possible

## 4) Preflight checks (v1 list)
Each check has: `id`, `severity`, `detect`, `fix`.

### C1 — Gateway daemon running
- **id:** `gateway_running`
- **severity:** FAIL
- **detect:** `openclaw gateway status` OR internal /health endpoint indicates gateway OK
- **fix:** button runs `openclaw gateway start`

### C2 — reflectt-node reachable locally
- **id:** `node_http_reachable`
- **severity:** FAIL
- **detect:** GET `http://127.0.0.1:4445/health` succeeds
- **fix:** button opens “Troubleshoot” (and offers restart command)

### C3 — macOS Accessibility permission granted (if automation features enabled)
- **id:** `tcc_accessibility`
- **severity:** WARN → FAIL if the user enabled Apple automation features
- **detect:** attempt a no-op accessibility API call OR documented TCC probe
- **fix:** open System Settings → Privacy & Security → Accessibility

### C4 — Screen Recording permission granted (for screen context)
- **id:** `tcc_screen_recording`
- **severity:** WARN (or FAIL if user turned on screen capture)
- **detect:** attempt to start screen capture and catch the permission error
- **fix:** open System Settings → Privacy & Security → Screen Recording

### C5 — Full Disk Access (only if needed for targeted integrations)
- **id:** `tcc_full_disk`
- **severity:** WARN
- **detect:** attempt to access known protected locations and check error
- **fix:** open System Settings → Privacy & Security → Full Disk Access

### C6 — Notifications permission (for local notifications)
- **id:** `notifications_allowed`
- **severity:** WARN
- **detect:** send local notification and validate delivered/registered
- **fix:** open System Settings → Notifications → allow

### C7 — Network egress (cloud reachability)
- **id:** `cloud_reachable`
- **severity:** WARN
- **detect:** ping cloud base URL / heartbeat endpoint
- **fix:** show guidance (proxy/VPN) + “Retry”

### C8 — Enrollment/auth state
- **id:** `host_enrolled`
- **severity:** FAIL
- **detect:** local config has hostId + cloud confirms
- **fix:** “Enroll host”

## 5) Implementation sketch (so eng can build it)
### Data model
- `AppleLayerStatus` computed from preflight results.
- `PreflightResult[]` shape:
  - `id`, `title`, `severity`, `status`, `details`, `fixKind`, `fixPayload`

### Existing building blocks (already in repo)
- **Enrollment / host registry:** `POST /provisioning/provision`, `GET /provisioning/status` (see `docs/architecture/host-provisioning.md`)
- **BYOH preflight:** `GET|POST /preflight` (see `src/preflight.ts`) — currently checks node version, port, cloud reachability, credential format/validation.
- **Onboarding diagnostics:** `GET /health/team/doctor` (see `src/team-doctor.ts`) — gateway/model/auth/bootstrap sanity.

### Minimal additions for “Apple layer” v1 (to avoid rebuilding enrollment)
**Preferred: extend existing surfaces**
- Extend `runPreflight()` (and the `/preflight` endpoint) with an `apple/*` category on macOS:
  - Accessibility permission
  - Screen Recording permission
  - Notifications allowed (optional)
  - Gateway running (or “OpenClaw reachable”) when automation is enabled
- Add fix-it actions as *guided recovery* (often: open the exact System Settings pane + instructions; sometimes: run a safe local command like starting the gateway).

**Fallback: separate namespace only if needed**
- `POST /apple/preflight`
- `POST /apple/fix` body `{ id }`

### Guardrails
- Fix actions that run commands must:
  - prompt confirmation
  - log command + output
  - never exfiltrate secrets

## 6) Acceptance criteria (ship gates)
### Enroll (happy path)
- From a fresh host, user can click **Enroll host**, complete browser auth, and return to a UI that shows **Enrolled** within 30s.

### Preflight checks
- Clicking **Run preflight** returns results in < 2s for local checks (< 5s if includes cloud check).
- At least checks C1/C2/C8 exist and are accurate.

### One-click fix
- If gateway is stopped, clicking **Fix** starts it and the next preflight shows C1 PASS.
- If a macOS permission is missing, clicking **Fix** opens the *exact* System Settings pane and the UI explains what toggle to enable.

### Demo-ready
- A 3-minute walkthrough (below) can be performed on a clean machine and ends with “Apple layer: GREEN”.

## 7) 3-minute demo script (operator-readable)
1) Open reflectt-node dashboard → show **Apple layer: RED** and missing enrollment.
2) Click **Enroll host** → click **Open enrollment link** → complete auth.
3) Back in dashboard → Apple layer now shows enrolled, still yellow/red.
4) Click **Run preflight** → point out:
   - Gateway stopped (FAIL)
   - Screen recording missing (WARN)
5) Click **Fix gateway** → rerun preflight → gateway PASS.
6) Click **Fix Screen Recording** → System Settings opens to correct pane → (optionally enable) → rerun preflight.
7) End state: **Apple layer: GREEN** + “Last preflight: just now”.

## 8) Open questions (need Kai/Ryan decision)
1) What exactly counts as “Apple layer” for v1? (screen + accessibility + notifications + auth seems enough)
2) Do we gate any product features behind GREEN, or just warn?
3) Where does the enroll flow live (cloud vs local)? My suggestion: local generates URL, cloud owns auth.
