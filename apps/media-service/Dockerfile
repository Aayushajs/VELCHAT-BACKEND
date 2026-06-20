# syntax=docker/dockerfile:1
# Multi-stage build for @velchat/media-service. Context = repo root. Buildah/Kaniko-friendly.
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
WORKDIR /repo/apps/media-service
EXPOSE 3008
USER node
CMD ["node", "dist/main.js"]
