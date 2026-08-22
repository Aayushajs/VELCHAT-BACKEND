---
'@velchat/event-bus': major
---

Fix three data-loss defects in the Redis Streams event bus, and cut its idle cost.

The bus is the delivery guarantee for fan-out, notifications and search indexing. None of these
paths had a test, which is why all three survived:

- **Idempotency was marked BEFORE the handler ran.** A process killed mid-handling recorded the
  event as processed, so the redelivery skipped it. Now marked only after the handler succeeds, with
  a read-only `wasProcessed` check first.
- **No pending-entry recovery.** An entry delivered but never acknowledged — the crash-before-XACK
  case — stayed in the pending list forever and nobody processed it again. An `XAUTOCLAIM` sweep now
  reclaims entries idle for 60s. Already-processed entries are simply acknowledged rather than
  re-run, so recovery does not become a duplicate push notification.
- **A handler error went straight to the DLQ on the FIRST failure.** One transient Mongo blip
  permanently diverted a message fan-out. Now retried three times with backoff before the DLQ; an
  unparseable payload still goes straight out, since retrying it can never succeed.

Also: **one reader per consumer GROUP instead of per subscription.** 23 subscriptions each held their
own connection and their own blocking read, costing roughly 397,000 commands/day at idle. Reads are
now multiplexed across a group's topics, the default block is 30s, and `close()` waits for its loops
to finish instead of detaching them mid-handler.
