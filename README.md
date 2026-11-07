# Dorcas Match

Mobile-first student discovery, mutual matching, persistent messaging and private/native WebRTC calls. The interface preserves the layered-soil Dorcas design, colourful swipe motion and phone-first navigation. This is an independent project, not a Babcock University service.

## Local development

Use Node.js 22.16+ and npm. Run `npm ci`, copy `.env.example` to `.env.local`, then run `npm run dev`. Open http://localhost:3000. Without DATABASE_URL, development uses a persistent PGlite database outside the source tree. Production refuses this fallback and requires PostgreSQL.

The application has no seeded student profiles and no development OTP bypass. Local verification requires a configured email sender. `scripts/dev-fixtures.ts` creates explicitly fictional local browser fixtures only; it refuses production or any configured DATABASE_URL. Never upload its ignored `.local` output.

For the local synthetic two-browser media check, stop the dev server, run `npx tsx scripts/dev-fixtures.ts`, restart `npm run dev`, then run `node scripts/check-browser.mjs` with Microsoft Edge installed. It uses fictional sessions in ignored files and never accesses physical devices.

Run `npm test`, `npm run typecheck`, and `npm run build` for validation. `npm run db:migrate` applies versioned migrations. Startup also applies migrations before serving requests.

## What is connected

- Exact `@student.babcock.edu.ng` email eligibility, expiring single-use hashed OTPs, rate limits and revocable HttpOnly sessions.
- Adult birth-date checks followed by independent moderator review. Profile submission alone cannot activate an account. Dating is separately opt-in.
- Privacy-aware discovery, reciprocal-like transactions, deduplicated matches and persistent conversations with membership checks and retry-safe message nonces.
- Live room directories and expiring single-use join tickets, capacity enforcement, room isolation, host removals and session/block revocation.
- Quick Match requires both accepts. Private call invitations require an existing conversation and recipient acceptance.
- The original native WebRTC, ICE queue, face effects, audio handling and cleanup. Camera and microphone start off; entry is deliberate. TURN credentials are short-lived when configured.
- Private photo storage adapter, image decoding/re-encoding, metadata removal, moderation and queued deletion. Campus groups, reviewed posts and moderator-managed events.
- Reporting, blocking, moderator queues, audit records and account deletion. Production moderator sign-in requires email OTP plus authenticator TOTP.

## Production configuration

Use one persistent Node service with `npm ci --include=dev && npm run build` and `npm start`. Route HTTP and WebSocket `/signal` to the same instance. Do not add a catch-all Next page that also matches `/signal`: Next's automatic upgrade handler can close that socket. Explicit product routes are intentional. Horizontal scaling requires shared signaling/pub-sub and additional coordination; it is not supported by this beta.

Configure secrets directly in the hosting dashboard, never in source control or chat:

| Variables | Purpose |
| --- | --- |
| DATABASE_URL | PostgreSQL connection URL; use the internal connection in Render's region |
| APP_ORIGIN | Exact HTTPS app origin, without trailing slash |
| AUTH_SECRET | Strong random secret for OTP hashing |
| RESEND_API_KEY, EMAIL_FROM | HTTPS email delivery from a domain you control and have verified |
| S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY | Private S3-compatible storage with path-style access; keep bucket public access disabled |
| TURN_URLS, TURN_SECRET | Comma-separated coturn URLs and matching shared authentication secret |
| ADMIN_EMAILS, ADMIN_TOTP_SECRETS | Explicit moderator allowlist and JSON mapping from email to Base32 authenticator secret, provisioned out of band |

A student's university mailbox is a verification recipient; it does not authorize sending from the university domain. The selected separate Dorcas sender domain has not yet been supplied. No existing unrelated brand's domain is reused. Do not make a student an administrator just to enable sign-in.

`/api/health` checks the database and reports configuration flags for email, storage and TURN. Flags confirm configuration presence, not real provider operation. Test actual delivery, upload/download/deletion and relay-only calls before opening a beta.

`render.staging.yaml` targets a separate staging service and references the isolated staging database. The original `render.yaml` and original main-branch service are retained. Staging has no production student data. The temporary staging database expires in December 2026; migrate or replace it before then.

## Release checks still requiring real infrastructure and people

Use two independently approved test accounts and HTTPS. Verify actual email delivery, photo moderation and private access, reciprocal matching, durable chat after restart, logout/revocation and deletion. Staff the independent age-review and reporting process before admitting students.

For media, use physical devices on the same Wi-Fi and then different Wi-Fi/mobile networks. Verify two-way sound/video, permission denial, device-off entry, turning devices on during a call, reconnection, capacity rejection, host removal, block, leave and rejoin. Confirm a relay-only call using configured TURN and inspect candidate-pair stats. Local synthetic browser media tests do not establish real-device or cross-network reliability. Other participants may record externally and peer-to-peer calls can expose network addresses to participants; the app does not record calls.

See [implementation checkpoints](docs/IMPLEMENTATION.md) for evidence and remaining launch gates.
