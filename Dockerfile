# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Reflectt AI
#
# Canonical Dockerfile for reflectt-node
# Usage: docker build -t reflectt-node . && docker run -p 4445:4445 reflectt-node

# ── Build stage ──
FROM node:22-slim AS build

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY tools/ tools/
COPY src/ src/

RUN npm run build

# ── Runtime stage ──
FROM node:22-slim

WORKDIR /app

# Runtime dependencies
# - libsqlite3-0: better-sqlite3
# - fonts-noto: Chromium font rendering
# - gstreamer1.0-libav gstreamer1.0-plugins-* : audio/video codecs for Stagehand
# - libnss3: Chromium SSL
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    fonts-noto \
    gstreamer1.0-libav \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh) — agents use it to create PRs, manage issues
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx -y playwright install chromium --with-deps && \
    rm -rf /root/.cache/ms-playwright/artifact* /root/.cache/ms-playwright/*.zip

# Set Playwright browser path for stagehand
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV CHROME_PATH=/ms-playwright/chromium-1208/chrome-linux/chrome

# Install Playwright's Chromium browser (used by @browserbasehq/stagehand for local browser automation).
# Pin PLAYWRIGHT_BROWSERS_PATH to a fixed location so the install path and runtime executablePath() agree
# regardless of the HOME env at runtime (Fly sets HOME differently from the Docker build context).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium --with-deps

COPY --from=build /app/dist/ dist/
# Copy pre-baked commit.txt for version reporting (run npm run build locally first)
COPY commit.txt* ./

# Runtime assets (dashboard UI, role defaults, CLI templates)
COPY public/ public/
COPY defaults/ defaults/
COPY templates/ templates/

# Default data directory inside container
ENV REFLECTT_HOME=/data
ENV NODE_ENV=production
ENV PORT=4445
ENV HOST=0.0.0.0

EXPOSE 4445

# Health check against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4445/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
