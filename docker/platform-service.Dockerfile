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
# No corepack/pnpm here: the entrypoint is plain `node`, so nothing at runtime needs a package
# manager. Removing npm also removes its bundled tar, which carries CVE-2026-59873 (a gzip-bomb
# DoS) in the version shipped with this base image — a real CRITICAL that failed the release scan,
# in code this image never executes.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/platform-service
EXPOSE 3010
USER node
CMD ["node", "dist/main.js"]
