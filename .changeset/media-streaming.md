---
'@velchat/storage': minor
'@velchat/media-service': minor
---

Memory-safe streaming media upload: putObjectStream on the storage port + S3/Cloudinary adapters,
and PUT /media/uploads/:id/stream that streams source → storage without buffering the whole file
(size-capped + hashed on the fly). No new dependency.
