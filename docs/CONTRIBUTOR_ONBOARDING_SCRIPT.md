# Contributor Onboarding Script (First Day)

## 1) Clone and install
```bash
git clone https://github.com/reflectt/reflectt-node.git
cd reflectt-node
npm install
npm run build
```

## 2) Start local server
```bash
npm run start
curl -s http://127.0.0.1:4445/health
```

## 3) Read critical docs
- `README.md`
- `public/docs.md`
- `docs/REVIEWER_HANDOFF_BUNDLE_TEMPLATE.md`
- `docs/TASK_CREATION_TEMPLATE.md`

## 4) Pull a task and claim it
```bash
curl -s "http://127.0.0.1:4445/tasks/next?agent=<name>"
```

## 5) Work loop
1. Move to `doing` with `metadata.eta`
2. Implement + test
3. Add proof artifact
4. Post reviewer handoff bundle
5. Move to `validating` with PR link

## 6) Close loop
Only close to `done` with:
- `metadata.artifacts`
- `metadata.reviewer_approved=true`
