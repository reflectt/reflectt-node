# First-use verification (browser, SMS, email)

Use this right after host setup to prove your team can do real work.

You’ll verify three happy paths:
1. Browser action
2. SMS send
3. Email send + inbound webhook receive

Time: ~10 minutes

---

## Before you start

- A running host connected to `app.reflectt.ai`
- At least one agent with browser capability
- SMS provider connected (and a test phone number)
- Email provider connected
- Inbound email webhook endpoint configured

If you’re still provisioning a host, complete [Cloud provisioning](./CLOUD_PROVISIONING.md) first.

---

## 1) Browser verification

**Goal:** Agent opens a page and returns one concrete fact.

In your team chat, ask:

> Open `https://example.com` and tell me the page H1.

**Pass criteria**
- Response includes a concrete page fact (not generic text)
- Run/tool timeline shows browser activity

If this fails:
- Confirm browser capability is enabled for that agent
- Confirm the host can reach outbound web URLs

---

## 2) SMS verification

**Goal:** A test SMS is accepted by provider and delivered.

In your team chat, ask:

> Send SMS to `+1XXXXXXXXXX`: `reflectt SMS check ok`

**Pass criteria**
- Provider/tool response is success/accepted
- Message arrives on your test phone

If this fails:
- Check SMS provider credentials and sender setup
- Confirm destination number format and regional restrictions

---

## 3) Email + inbound webhook verification

### 3a) Outbound email

In your team chat, ask:

> Send email to `you@example.com` subject `reflectt email check` body `outbound works`

**Pass criteria**
- Provider/tool response is success/accepted
- Email arrives in inbox

### 3b) Inbound webhook

Reply to that email (or send a new one) to your inbound address.

**Pass criteria**
- Inbound webhook event is received (for example `email.received`)
- Payload includes sender, subject, and body fields

If this fails:
- Verify inbound domain/MX config
- Verify webhook endpoint URL and signature validation
- Check provider retry logs and host logs

---

## Definition of done

You are verified when all three checks pass once:
- Browser fact retrieval ✅
- SMS delivery ✅
- Outbound + inbound email webhook ✅

At that point, your host is not just online — it’s operational for real workflows.

---

## Related

- [Getting started](./GETTING-STARTED.md)
- [Cloud provisioning](./CLOUD_PROVISIONING.md)
- [Gateway setup](./gateway-setup.md)
