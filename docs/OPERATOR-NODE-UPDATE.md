# Node Version Check & Update Guide

## How to Check Node Version

### From the API (any agent or operator)
```bash
curl -s http://<host>:4445/health | python3 -m json.tool
```
Look for `"version"` in the response.

Or use the dedicated version endpoint:
```bash
curl -s http://<host>:4445/version
```

### From the Host Machine (SSH or console)
```bash
# Check the installed package version
npm list -g reflectt-node

# Or check from the node's working directory
cat ~/.reflectt/node-packages/reflectt-node/package.json | grep '"version"'
```

### From the Fly.io Dashboard
1. Go to your app on [fly.io](https://fly.io)
2. Select the VM → **Monitoring** tab
3. Check logs for startup messages showing version

---

## How to Update a Managed Host

Managed hosts run reflectt-node inside a Fly.io VM. Updates are deployed by replacing the Docker image.

### Option 1: Via Fly CLI (recommended for production hosts)

```bash
# Install flyctl if you don't have it
brew install flyctl

# Login to Fly.io
flyctl auth login

# List your apps to find the host VM
flyctl apps list

# Deploy the latest reflectt-node image to a specific app
flyctl deploy --app <app-name> -i ghcr.io/reflectt/reflectt-node:latest

# Verify the update
flyctl ssh issue --app <app-name> "curl -s http://127.0.0.1:4445/health"
```

### Option 2: Via the Cloud Dashboard

1. Go to [app.reflectt.ai](https://app.reflectt.ai) → **Hosts**
2. Find your managed host
3. Click **Restart** — this pulls the latest image and restarts the node

> Note: A restart alone doesn't guarantee a new image is pulled unless the image tag is updated. For guaranteed updates, use `flyctl deploy`.

### Option 3: Via the reflectt-node CLI (Mac Daddy / local hosts)

```bash
# Pull the latest npm package
npm update -g reflectt-node

# Restart the LaunchAgent (macOS)
launchctl kickstart -k gui/$(id -u)/com.reflectt.node

# Or restart the systemd service (Linux)
sudo systemctl restart reflectt-node
```

### Option 4: Via Docker (if running in Docker)

```bash
# Pull the latest image
docker pull ghcr.io/reflectt/reflectt-node:latest

# Restart the container
docker restart <container-name>

# Verify
docker exec <container-name> curl -s http://127.0.0.1:4445/health | grep version
```

---

## Version Numbering

reflectt-node uses semantic versioning (`MAJOR.MINOR.PATCH`):

- **MAJOR** — Breaking changes to the API or config format
- **MINOR** — New features, backward compatible
- **PATCH** — Bug fixes, backward compatible

Current stable: **v0.1.x**

---

## Checking What Version a Host Is Running

```bash
# Quick check via health endpoint
curl -s http://<host>:4445/health | grep version

# Full health response with all details
curl -s http://<host>:4445/health | python3 -m json.tool
```

Example response:
```json
{
  "status": "ok",
  "version": "0.1.33",
  "commit": "19febc8",
  "uptime_seconds": 3600,
  ...
}
```

---

## Rollback Procedure

If an update causes issues:

### Fly.io
```bash
# List recent releases
flyctl releases --app <app-name>

# Rollback to previous release
flyctl rollback --app <app-name>
```

### NPM / Local
```bash
# Install a specific version
npm install -g reflectt-node@0.1.32

# Restart
launchctl kickstart -k gui/$(id -u)/com.reflectt.node
```

---

## Image Registry

reflectt-node Docker images are published to:
- **GitHub Container Registry**: `ghcr.io/reflectt/reflectt-node:latest`
- **Docker Hub** (backup): `reflectt/reflectt-node:latest`

---

## Common Issues

### Host shows old version after restart
The LaunchAgent may be loading a cached version. Force a fresh start:
```bash
launchctl bootout gui/$(id -u)/com.reflectt.node
launchctl load gui/$(id -u)/com.reflectt.node
```

### Docker image not updating
```bash
docker pull ghcr.io/reflectt/reflectt-node:latest --quiet
docker stop <container>
docker rm <container>
docker run -d --name reflectt-node \
  -p 4445:4445 \
  -v ~/.reflectt:/root/.reflectt \
  ghcr.io/reflectt/reflectt-node:latest
```
