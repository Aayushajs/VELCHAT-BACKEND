# Status Feature: Media Delivery (Cloudinary)

This document outlines the media delivery strategy for the Status/Stories feature, heavily leveraging **Cloudinary** to match the performance of Meta products (WhatsApp, Instagram) without building a complex in-house CDN and transcoding pipeline.

## 1. Cloudinary Integration Overview

Instead of passing media through our Node.js `content-service` and storing it in a basic S3 bucket, we will use Cloudinary as our primary Media Delivery Network.

### Advantages for Status Feature:
- **Instant Video Transcoding:** Cloudinary handles HLS/DASH video streaming automatically. Video statuses will play instantly on low bandwidth.
- **Edge Caching (CDN):** Cloudinary is backed by Fastly/Akamai, ensuring images and videos are cached at the edge close to the viewer.
- **Auto Optimization:** By using `f_auto,q_auto`, media is automatically served in the best format (WebP/AVIF) and quality for the user's device.

## 2. Upload Workflow (Presigned approach)

To prevent backend bottlenecks, clients will upload directly to Cloudinary:

1. **Client Request:** The client asks the `content-service` for an upload signature.
2. **Signature Generation:** The backend uses the Cloudinary Secret to generate a signature (valid for a short window, e.g., 5 mins) and returns it.
3. **Direct Upload:** The client uploads the file directly to the Cloudinary API using the signature.
4. **Webhook/Save:** Cloudinary returns the `public_id` to the client. The client then hits our `POST /status` API with the `public_id` and status metadata (audience, text, etc.).

*Note: For E2EE personal statuses, the client must encrypt the media locally, upload the raw ciphertext binary to Cloudinary (as a raw file), and the viewers will decrypt it on their device.*

## 3. Transformation & Delivery

When fetching the viewer's feed, the backend will return the Cloudinary `public_id`. The client is responsible for constructing the URL with appropriate transformations.

- **Image Status:** `https://res.cloudinary.com/<cloud_name>/image/upload/c_fill,w_1080,h_1920,f_auto,q_auto/<public_id>`
- **Video Status:** Stream via HLS/DASH using Cloudinary's video player, optimizing for mobile vertical formats.

## 4. Lifecycle & Deletion

Statuses have a 24-hour TTL.
- When a status expires in Postgres (or via our cleanup cron/worker), we must trigger the Cloudinary API to `destroy` the asset to save storage costs.
- Archived statuses (if opted-in by the author) will remain in Cloudinary but will be removed from the active status feed.
