# Status Feature: Scaling & Performance Guide

To achieve Meta-level performance (WhatsApp/Instagram Stories) for the Status feature, we must design the system to handle heavy read-write asymmetric loads. A status is written once by the author but read by hundreds (or thousands) of viewers. 

This guide outlines the performance improvements required over a basic CRUD implementation.

## 1. Social Graph Caching (Reachability)

**The Problem:** Task 2 implemented a fail-closed `HttpSocialGraphResolver` which makes an HTTP request to `identity-service` to check if a viewer is in the author's contact list and not blocked. Making this call synchronously on every status load will cause a massive latency bottleneck.

**The Solution:**
- Cache the user's social graph locally in `feature-status` using **Redis / Valkey**.
- When `identity-service` registers a new contact or a block action, it publishes an event via Kafka.
- `feature-status` consumes this event and updates its local Valkey cache.
- The `SocialGraphResolver` should first check Valkey. If missing, it makes the HTTP call and populates the cache.

## 2. High-Volume Writes: Views & Reactions

**The Problem:** Storing views (`status_views`) and reactions (`status_reactions`) directly in Postgres in real-time will cause database locking and write-throttling during viral statuses (e.g., thousands of views per minute).

**The Solution (Redis Buffering):**
- When a user views a status, the API records the view in Valkey (e.g., adding to a Set `status:views:{status_id}`).
- Return a success response to the client immediately (Optimistic UI).
- A background worker (cron or queue) periodically flushes these views from Valkey to Postgres using bulk `INSERT ... ON CONFLICT DO NOTHING`.
- The same buffering mechanism applies to reactions.

## 3. Real-Time Fan-Out (Typing & Presence)

When an author posts a status, we do not want to blast a notification to their entire contact list.
- Use the **Presence Service (§B8)** logic: Fan-out events only to `subscribers:{user}` (users who currently have the app open and are actively watching this user's presence/feed).
- WhatsApp does not push silent statuses to offline devices immediately. They sync the status feed when the app is opened via a `/status/sync` endpoint.

## 4. Cursor-Based Pagination

- Never return an unbounded list of viewers.
- The viewer list API (`GET /status/:status_id/viewers`) must use cursor-based pagination (e.g., `?cursor=last_view_id&limit=50`).
- Similarly, the user's Status Feed should be paginated, prioritizing recent statuses and active contacts.
