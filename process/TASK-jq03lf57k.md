# TASK-jq03lf57k — Android: register FCM push token with cloud on login

**Task:** task-1773593826375-jq03lf57k  
**Assignee:** kotlin  
**PR:** https://github.com/reflectt/reflectt-android/pull/39  

## Done

FCM token registration implemented in `ReflecttFirebaseMessagingService.onNewToken()` and login flow.
Token POSTed to `POST /api/devices/register` with `{ platform: 'android', token }` on first delivery and every login.
