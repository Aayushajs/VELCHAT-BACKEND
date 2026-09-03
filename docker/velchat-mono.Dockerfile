# syntax=docker/dockerfile:1
# @velchat/velchat-mono — context = repo root. Every feature group in ONE process.
#
# This is the image the 1 GB free-tier targets run (Azure B1S, §deploy/azure). It is not a
# different application: it mounts the same FeatureGroup values the six services mount, through
# the same assembler in @velchat/composition, so wiring order and behaviour are identical. Only
# the process count differs, and moving to six is a SPLIT_PROFILE change, not a rebuild.
#
# Multi-arch: linux/amd64 (Azure B1S x86) + linux/arm64 (Azure B2pts v2, Oracle A1, AWS Graviton).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Reproducible: the lockfile is authoritative. An out-of-date lockfile must fail the build rather
# than silently resolve different versions — we sign these images and publish an SBOM for them,
# and both are meaningless if the dependency graph can drift at build time.
RUN pnpm install --frozen-lockfile
# turbo, not `pnpm -r build`: turbo.json declares dependsOn ^build, so libraries build before the
# packages that import them. `pnpm -r` got the order wrong on a clean tree and failed on the first
# cross-library import, which never showed up locally because dist/ was already populated.
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
WORKDIR /repo/apps/velchat-mono
EXPOSE 3000
# Every service serves /health unauthenticated (the gateway's keep-warm loop relies on it), so it
# doubles as the container probe. Compose and Kubernetes both read this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "dist/main.js"]
