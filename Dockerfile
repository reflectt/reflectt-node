# syntax=docker/dockerfile:1.7

# reflectt-node Docker image
# - Multi-stage build (TypeScript -> dist)
# - Uses Debian slim for better-sqlite3 compatibility

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps (includes devDeps for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source + runtime assets
COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY defaults ./defaults
COPY templates ./templates
COPY config ./config
COPY data ./data

# Compile TypeScript
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Persist all state under /reflectt (maps to REFLECTT_HOME)
ENV REFLECTT_HOME=/reflectt

# git is used for build metadata (/health/build, release diff endpoints)
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

# App output + runtime assets
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/defaults ./defaults
COPY --from=build /app/templates ./templates
COPY --from=build /app/config ./config
COPY --from=build /app/data ./data

# Volume for SQLite + inbox + templates in REFLECTT_HOME
RUN mkdir -p /reflectt \
  && chown -R node:node /reflectt

USER node
VOLUME ["/reflectt"]

EXPOSE 4445

CMD ["node", "dist/index.js"]
