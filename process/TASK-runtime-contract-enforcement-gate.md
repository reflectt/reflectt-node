# Runtime Contract Enforcement Gate

**Task:** task-1771446513303-ig2eitzmd
**Spec reference:** task-1771439871143-69qdp4vfy (Product/package framing spec: Layer 1 node vs Layer 2 cloud)
**Contract:** reflectt-node = required, free, local runtime. reflectt-cloud = optional, paid, control plane.

---

## Surface Audit

### 1. `/onboard` (onboard-client.tsx)

| Line | Current copy | Violation | Fix |
|------|-------------|-----------|-----|
| 229 | "Welcome to Reflectt Cloud" | Cloud-first framing; user is setting up **node**, not cloud | → "Welcome to Reflectt" or "Set up your local runtime" |
| 232 | "Set up your agent in 2–5 minutes" | OK (agent-centric, not cloud-specific) | No change |
| 282 | "OpenClaw is the agent runtime that connects to Reflectt Cloud" | Implies cloud is the destination; node is primary | → "OpenClaw is the local agent runtime. It runs your agents on your machine. Connect to Reflectt Cloud later for remote management." |
| 393 | "Your agent is ready. You can now chat with your team, monitor tasks, and run commands from your overview." | OK — describes cloud features after successful connection | Minor: add "Your node is running." before the sentence |

**Verdict:** 2 violations (lines 229, 282), 1 minor improvement (393)

### 2. `/help` (help/page.tsx)

| Line | Current copy | Violation | Fix |
|------|-------------|-----------|-----|
| 21 | mailto subject "Bug Report — Reflectt Cloud" | Assumes user issue is cloud-related; could be node | → "Bug Report — Reflectt" (covers both) |
| 27 | mailto subject "Feature Request — Reflectt Cloud" | Same | → "Feature Request — Reflectt" |
| 39 | mailto subject "General Inquiry — Reflectt Cloud" | Same | → "General Inquiry — Reflectt" |
| 59 | mailto subject "URGENT — Reflectt Cloud" | Same | → "URGENT — Reflectt" |

**Verdict:** 4 violations (all mailto subjects force cloud context)

### 3. `/settings` (settings-client.tsx)

| Line | Current copy | Violation | Fix |
|------|-------------|-----------|-----|
| 527 | "Perfect for trying out Reflectt Cloud" | Cloud-only framing for free tier; node is the free product | → "Perfect for getting started with reflectt-node" |
| 557 | "For teams running AI agents in production" | OK — describes Pro tier accurately | No change |
| 681 | mailto subject "Support Request — Reflectt Cloud" | Cloud-only; support covers node too | → "Support Request — Reflectt" |
| 705 | mailto subject "Bug Report — Reflectt Cloud" | Same as help page | → "Bug Report — Reflectt" |
| 711 | mailto subject "Feature Request — Reflectt Cloud" | Same | → "Feature Request — Reflectt" |

**Verdict:** 4 violations (1 plan description, 3 mailto subjects)

### 4. `/auth` (auth/page.tsx)

| Line | Current copy | Violation | Fix |
|------|-------------|-----------|-----|
| 178 | "Welcome to Reflectt Cloud" | Cloud-first; should indicate this is the cloud dashboard sign-in while node is the core product | → "Sign in to Reflectt Cloud" (acceptable: this IS the cloud sign-in page) OR add subtext: "Your agents run locally on reflectt-node. This dashboard gives you remote access." |
| 181 | "You'll set up your team, connect your agents, and see everything from one dashboard." | OK — describes cloud purpose accurately | No change |
| 201 | "Sign up" | OK — standard auth action | No change |
| 38 | "Connect your agents" / "Install reflectt-node on your machine and enroll it as a host." | ✅ Good — correct node-first language | No change |

**Verdict:** 1 borderline (line 178 — acceptable if subtext added), otherwise clean

### 5. `/hosts/connect` (hosts-client.tsx)

| Line | Current copy | Violation | Fix |
|------|-------------|-----------|-----|
| 473 | "Showing demo data — connect a host to see real status. Get started →" | OK — node-centric ("connect a host") | No change |
| 550 | "has no hosts yet. Generate a join token above to get started." | OK — correct framing | No change |
| 160 | "Host is converged with cloud state." | OK — technical status, accurate | No change |

**Verdict:** Clean — hosts page already uses correct node-first language ✅

---

## Enforcement Gate Rules

### MUST (blocking — no cloud-only wording ships without node contract context)

1. **Title/heading on any page that says "Reflectt Cloud" must either:**
   - Be on a page that is explicitly cloud-specific (auth, billing), OR
   - Include adjacent context that node is the primary runtime

2. **Email subjects must use "Reflectt" not "Reflectt Cloud"** unless the issue is explicitly cloud-specific

3. **Free tier description must reference reflectt-node** — the free product IS the node, not a cloud trial

4. **Onboarding first screen must lead with node install** — ✅ already does this

5. **No page may describe cloud as "running" or "hosting" agents** — agents run on the node

### SHOULD (recommended)

1. Add "Your agents run locally on reflectt-node" context to auth page
2. Add node health/status indicator on dashboard (reinforces node = runtime)
3. Welcome wizard references are clean — maintain

---

## Summary of Required Changes

| File | Changes needed |
|------|---------------|
| `onboard-client.tsx` | Fix heading (229), fix runtime description (282), improve success copy (393) |
| `help/page.tsx` | Fix 4 mailto subjects |
| `settings-client.tsx` | Fix free tier description (527), fix 3 mailto subjects |
| `auth/page.tsx` | Add node-context subtext to heading (178) — borderline, optional |
| `hosts-client.tsx` | None — already compliant ✅ |

**Total violations found:** 11 (10 required fixes + 1 optional)
**Pages compliant:** hosts/connect, welcome wizard
**Pages non-compliant:** onboard, help, settings (+ auth borderline)

---

## Spec Cross-References

- Kai framing spec (task-1771439871143-69qdp4vfy): "Layer 1: reflectt-node (free, open source, local runtime)" / "Layer 2: reflectt-cloud (optional, paid, control plane)"
- DON'T list: "You need cloud to use reflectt" / "Sign up to get started" / "reflectt" alone when meaning one specific product
- DO list: "reflectt-node runs your agents locally" / "Cloud connects to your node" / "Your node works independently — cloud is optional"
