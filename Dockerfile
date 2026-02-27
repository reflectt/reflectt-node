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
COPY src/ src/

RUN npm run build

# ── Runtime stage ──
FROM node:22-slim

WORKDIR /app

# Runtime dependency for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ dist/

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
