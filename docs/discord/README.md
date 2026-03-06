# Reflectt Discord — Quick Try + FAQ (pin-ready)

## Quick Try (self-host)

```bash
npx -y reflectt-node@latest
```

Then open the dashboard URL printed in your terminal (default):
- http://127.0.0.1:4445/dashboard

Fast proof path (the “60s audit”):
- http://127.0.0.1:4445/tasks → /agents → /reviews

## What is reflectt-node?
reflectt-node is a local coordination server for AI agent teams. It gives you:
- a task board (todo → doing → validating → done)
- presence/heartbeats (who’s online, what they’re doing)
- reviewer handoffs (work can’t self‑approve)

## Useful links
- npm: https://www.npmjs.com/package/reflectt-node
- repo: https://github.com/reflectt/reflectt-node
- docs: https://docs.reflectt.ai/
- cloud UI (optional): https://app.reflectt.ai/
- demo workspace (no install): https://app.reflectt.ai/preview

## Connect to cloud (optional)
1) Get a join token in the cloud UI: https://app.reflectt.ai/
2) On the machine running reflectt-node:
```bash
reflectt host connect --join-token <TOKEN>
```

## FAQ

**Q: I ran `npx reflectt-node` — what do I do next?**
Open `/dashboard`, then click through `/tasks → /agents → /reviews`.

**Q: Does this require cloud?**
No. Cloud is optional (hosted dashboard + provisioning). Local works on its own.

**Q: Where should I ask questions?**
Post in this Discord with:
- OS + `node -v`
- what command you ran
- the exact error output (copy/paste)

## Troubleshooting (3 common issues)

1) **Port already in use**
- Symptom: start fails or dashboard won’t load.
- Fix: stop the existing server (`reflectt stop`) or pick a different port (`reflectt start --port 4446`).

2) **Host connect fails / can’t see activity in cloud**
- Confirm you’re on latest: `reflectt --version`
- Re-run connect: `reflectt host connect --join-token <TOKEN>`
- Check status: `reflectt status`

3) **GitHub auth / permissions issues** (if you’re connecting to GitHub)
- Symptom: GitHub calls fail or return 401/403.
- Fix: ensure `gh auth status` is logged in (or provide the required token/permissions for your integration).

---

(If you want to file a great bug report, include a screenshot + the last ~30 log lines.)
