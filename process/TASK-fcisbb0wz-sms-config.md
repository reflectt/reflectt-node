# TASK-fcisbb0wz — SMS/iMessage direct path

## Task
`task-1774840625244-fcisbb0wz`

## Done Criteria

1. **"Exact current messaging/channel configuration is documented from the real runtime"**
2. **"A working direct-phone path is restored OR the exact missing configuration gap is documented with the concrete fix path"**
3. **"Kai can send a direct acknowledgement through the restored path"**

## Current State: Configuration Gap Documented

### What exists
- SMS relay route: `POST /api/hosts/:hostId/relay/sms` → `handleSendSms` → `sendSms()` in `sms/twilio-client.ts`
- Twilio credentials are read from env vars: `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
- The code path is complete and correct

### What's missing (the gap)
```
TWILIO_ACCOUNT_SID   — NOT set in Fly secrets for reflectt-browser-api
TWILIO_AUTH_TOKEN    — NOT set in Fly secrets for reflectt-browser-api
```

Confirmed by: `flyctl secrets list -a reflectt-browser-api | grep TWILIO` → empty

### Code that requires these
`apps/api/src/sms/twilio-client.ts`:
```typescript
function getCredentials() {
  _accountSid = process.env.TWILIO_ACCOUNT_SID || null
  _authToken = process.env.TWILIO_AUTH_TOKEN || null
  if (!_accountSid || !_authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required')
  }
}
```

Any call to `POST /api/hosts/:hostId/relay/sms` will throw before making the Twilio API call.

## Fix Path

Someone with Twilio console access (Kai/Ryan) needs to:

1. Get the `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` from Twilio console
2. Run:
   ```
   flyctl secrets set TWILIO_ACCOUNT_SID=<value> TWILIO_AUTH_TOKEN=<value> -a reflectt-browser-api
   ```
3. Redeploy `reflectt-browser-api` (automatically triggered after secret set)

## Verification
After secrets are set, test with:
```
curl -X POST "https://api.reflectt.ai/api/hosts/<hostId>/relay/sms" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "body": "test"}'
```

Expected: Twilio API success response with `messageSid`
Current (without secrets): `500 Internal Server Error` — "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required"

## Note
This is a runtime configuration gap, not a code issue. The SMS relay code is correct.
