# syntax=docker/dockerfile:1
# Multi-stage build for @velchat/realtime-gateway. Context = repo root. Buildah/Kaniko-friendly.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm -r build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/realtime-gateway
EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]
