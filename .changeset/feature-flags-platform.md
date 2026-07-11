---
'@velchat/automation-service': minor
'@velchat/shared-types': minor
'@velchat/api-gateway': patch
---

Feature Flag & Remote-Config platform (docs/FEATURE-FLAGS.md), MongoDB-only, hosted in
automation-service: flags/remote-config/experiments, %/country/platform/version/role rollout, user
overrides, segments, dependencies, kill switch, scheduled enable/disable, emergency rollback,
versioning + audit, global maintenance mode + announcement, Valkey-cached pure evaluation engine, and
the featureflag.changed event. Gateway routes /feature-flags to automation-service.
