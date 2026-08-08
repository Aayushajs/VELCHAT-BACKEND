# syntax=docker/dockerfile:1
# Multi-stage build for @velchat/realtime-gateway. Context = repo root. Buildah/Kaniko-friendly.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
# Build ONLY this service + its workspace deps (not all 28 packages incl. the RN app) — far
# lighter/faster, so a free-tier build doesn't OOM/timeout. tsc resolving every import proves
# the dep set is complete, so nothing needed is skipped.
RUN pnpm --filter "...@velchat/realtime-gateway" build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/realtime-gateway
EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]
