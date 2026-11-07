# Integration checkpoints

## M0 baseline

Checkout: upstream `432eb307c7f308bbc4d9aa6e6bd122d700b99fad`, isolated branch `codex/dorcas-backend-integration`. No existing user changes were present. Current regression suite contains **10** tests, all passed before editing (the specification's older 12-test count is not current). Typecheck was not established at that moment because dependency installation was still in progress.

The existing media pipeline, face effects, signal queue, ICE buffering, audio playback and leave cleanup are preserved in `components/VideoRoom.tsx`. Anonymous signaling is retained only as an explicit local/test sandbox; production requires authenticated room tickets.

## Architecture

Persistent custom Next.js + WebSocket server; parameterized PostgreSQL queries and versioned SQL migrations. Explicit transaction boundaries are used instead of an ORM so lock order and security predicates are reviewable. PostgreSQL is mandatory in production. Development and integration tests can use PGlite's PostgreSQL engine; this is never an automatic production fallback.

Email uses an HTTPS Resend adapter. OTPs are HMAC hashes, sessions are random token hashes, and all protected operations validate active status. Age eligibility is held for independent moderator review after an adult birth-date check; submission alone never activates a student. A lawful, proportionate review process and staffed moderation remain operational launch prerequisites.

No production readiness claim follows from local tests. Real mailbox delivery, production persistence, reachable TURN and cross-network physical-device media tests are separate release gates.

## Current implementation and validation (7 November 2026)

M1-M4 backend and UI paths are implemented: verified-email adapter, onboarding/review, profile privacy, private-photo adapter, reciprocal matches, persistent messages, Quick Match, room tickets and scoped authenticated signaling. M5 includes moderated campus circles/posts/events; later stories, ranking and engagement experiments are excluded. These are implementation checkpoints, not completed public-launch approvals.

Validation: 21 automated tests passed, including the original 10 regression tests. TypeScript and optimized Next.js build passed. The DB tests use PGlite's PostgreSQL engine, not a live Render PostgreSQL connection. Browser checks confirmed that one Quick Match acceptance waits, both accepts create private membership, and a message persisted to the second account. Room entry with both devices off made zero getUserMedia calls.

A repeatable two-browser check (`node scripts/check-browser.mjs`, with Edge installed and local fictional fixtures) confirmed both peers connected and received audio RTP plus decoded video at a 390x844 viewport. Leave closed peer connections. It caught and fixed a one-way media regression: the answering peer must attach tracks to the offer's transceivers rather than creating unused extra transceivers. Synthetic media never accesses physical cameras or microphones. Screenshots are local ignored artifacts under output/playwright.

Routing correction: explicit product routes intentionally leave /signal unmatched by the Next router. A catch-all page caused Next's automatic WebSocket upgrade handler to close signaling connections. Local browser entry and two-way synthetic media now pass through the actual custom Next server.

## Isolated staging and remaining gates

The feature branch preserves the original main-branch service and original render.yaml. An isolated free staging database was created in the approved Sano workspace: dorcas-integration-staging-db (`dpg-dbn5spnf3r2c73fq5n4g-a`). Provider expiry is 6 December 2026 23:10:30 UTC (7 December 00:10:30 Lagos). It must be replaced or migrated before expiry. The staging Blueprint references this existing database, generates AUTH_SECRET and derives APP_ORIGIN from the web service URL. Auto-sync is disabled for reviewed deployment.

Still unverified: live PostgreSQL migrations/concurrency/restart persistence, actual email delivery, private object uploads/download/deletion, real moderator second-factor provisioning, TURN relay-only media and physical devices across networks. No verification emails were sent and no real student accounts were provisioned. The supplied student address is an eligible recipient, not an owned sender domain. User chose a separate Dorcas sending domain; the unrelated verified HRTG domain is not used.

Before admitting students: configure provider secrets in the hosting dashboard, supply a verified sender domain, provision moderators out of band, staff eligibility/report review, review Terms/Privacy/retention and complete real-device/network release checks. The existing Sites URL remains a frontend demo until a connected deployment is approved and verified.

The extended mobile browser check also passed silent room entry followed by enabling microphone and camera during the established call: both peers then received media in both directions. This verifies transceiver reuse after device-off admission. This remains synthetic localhost evidence.
