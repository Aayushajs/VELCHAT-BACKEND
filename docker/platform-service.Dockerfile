# syntax=docker/dockerfile:1
# @velchat/platform-service — context = repo root. Multi-arch (linux/arm64 for Oracle A1 + AWS
# Graviton, linux/amd64 for Azure/x86). The IMAGE is the portability layer: identical bytes run
# under docker compose on a VM, under Helm on Kubernetes, or as an ECS task.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/platform-service
EXPOSE 3010
USER node
CMD ["node", "dist/main.js"]
