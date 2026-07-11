# @velchat/storage

## 0.2.0

### Minor Changes

- 2b1d811: Memory-safe streaming media upload: putObjectStream on the storage port + S3/Cloudinary adapters,
  and PUT /media/uploads/:id/stream that streams source → storage without buffering the whole file
  (size-capped + hashed on the fly). No new dependency.

### Patch Changes

- Updated dependencies [0ec403d]
- Updated dependencies [bb29628]
  - @velchat/common@0.3.0
  - @velchat/config@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies [676071e]
  - @velchat/common@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [d9578ad]
- Updated dependencies [c3d39ff]
  - @velchat/common@0.2.0
  - @velchat/config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @velchat/config@0.1.1
  - @velchat/common@0.1.1
