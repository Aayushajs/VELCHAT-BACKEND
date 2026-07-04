# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets) — the versioning
system for this pnpm/Turborepo monorepo. It versions **only the packages that actually changed**.

## Add a changeset (do this in the PR that makes a change)

```bash
pnpm changeset
```

Pick the affected package(s) and the bump for each:

- **patch** — a `fix:` (bug fix, no API change)
- **minor** — a `feat:` (new, backward-compatible feature)
- **major** — a breaking change (`feat!:` / `BREAKING CHANGE:`)

Write a one-line summary — it becomes the CHANGELOG entry. Commit the generated
`.changeset/*.md` file with your change.

## How a release happens (automated)

On push to `main`, the **release** GitHub Action:

1. If unreleased changesets exist → opens a **"Version Packages"** PR that bumps the affected
   packages' versions, updates their `CHANGELOG.md`, and updates internal workspace dependents
   (patch). Untouched packages are **not** bumped.
2. When that PR is merged → the action creates **git tags** (`<pkg>@<version>`) and **GitHub
   Releases**. No npm publish (all packages are `private`).

You never edit versions or changelogs by hand.
