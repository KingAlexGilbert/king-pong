# Validation and change inventory

Validated on 2026-10-03 against repository base
`0f766d37052f08d601342bba844afd2c46298850`.

The implementation is complete locally. It has **not** been pushed to GitHub or
deployed to Cloudflare. `docs/demo/online-config.js` intentionally has an empty
signaling URL until the account owner deploys the Worker. No Cloudflare account
resources, Metered accounts/keys, secrets or GitHub Pages settings were created or changed
by this work. Follow [README.md](README.md) to deploy and perform acceptance testing.

## Recorded checks

| Check | Result and scope |
| --- | --- |
| Existing and new Node tests | **78 passed**: 71 existing tests plus 7 online client/protocol tests |
| Existing Python tests | **22 passed** |
| Signaling tests | **16 passed**: the original 8 room/protocol cases retained, plus 8 Metered credential lifecycle cases |
| Worker deployment dry run | Passed; Wrangler accepted both SQLite Durable Object bindings/migrations and the rate-limit binding; bundle 13.80 KiB / 3.89 KiB gzip |
| Dependency audit | Earlier `npm audit --omit=optional`: **0 vulnerabilities** reported; this conversion adds no dependencies and changes neither package file |
| Two independent Chromium 140 contexts, direct WebRTC | Create Room → five-character code → Join Room → both DataChannels open, real game state and input exchanged |
| Two independent Chromium contexts, forced fallback | Initial attempt deliberately has no usable candidates; automatic retry uses the Metered credential cache and connects through a real local TURN server; `getStats()` confirms a selected `relay` candidate |
| Latency/loss check on both connection paths | Gameplay messages delayed 90 ms each direction, with periodic 220 ms delivery, out-of-order delivery and every 13th packet dropped (~8%); guest paddle responds locally and converges within 2 game-coordinate units after movement stops |
| Actions and authority | Guest serve/pause reach host over the reliable channel; host score snapshots reach guest; stale state and input sequence numbers are rejected |
| Browser failures | Invalid code, full room, guest departure, host returning to title, immediate new-room creation, and stopped/frozen disconnected match checked; no uncaught page errors or browser dialogs |
| Signaling failures | Wrong origin, invalid/absent code, simultaneous guests, third player, malformed/oversized messages, wrong SDP role, rate limiting, unavailable TURN credentials, stale ICE and room cleanup checked |
| Client lifecycle fixtures | Opening/negotiation timeout, early ICE before SDP, one relay retry, cancellation, raw-error suppression, both-channel readiness and transient ICE disconnect/recovery checked |
| Metered credential lifecycle | 48-hour expiry, daily overlapping rotation, the full 120-second propagation delay, concurrent initialization, state restoration, provider errors/backoff, malformed/non-expiring responses, and the full-match expiry margin checked |
| Secret confinement | Only the fixed Metered hostname receives the app Secret Key; redirects are not followed; public readiness exposes only a boolean; neither room messages nor stored rotation state contain the permanent key; internal cache/test controls are inaccessible through public routes |
| Other browser features | Campaign ball motion, campaign progress and selected-slot persistence after reload, local two-player controls, music toggle/volume control and Spanish room/error UI checked |
| Localization | All new networking phrases have entries for the nine existing non-English languages; existing language tables retained |
| Small-screen UI | Join form inspected with Chromium touch emulation at 390×844 and 844×390; room input and Join button fit both viewports |
| Diff review | `git diff --check` passed; native platform files, version numbers, audio assets, campaign definitions and save serialization unchanged |

The browser latency check delays DataChannel sends in the test only. It is not a
WAN benchmark and does not model every congestion or radio-loss pattern. The
TURN test uses a local UDP relay and test substitutes for Metered's credential
and ICE endpoints. A test-only entrypoint advances the stored propagation
timestamp; separate clock-driven tests enforce the entire delay. Neither
substitute ships in the game or production Worker. The service tests verify the
documented Metered request shapes, free-plan `standard` region, secret confinement,
temporary-credential forwarding and filtering of browser-blocked port 53.

## Scope of the Metered conversion

The completed multiplayer implementation was reviewed before this change.
Cloudflare room signaling, `stun:stun.cloudflare.com:3478`, both WebRTC channels,
game messages, paddle reconciliation, all browser/native files and all existing
root tests were retained. No version or npm dependency changed. Only these nine
files were changed or added relative to that completed implementation:

| File | Metered-specific change |
| --- | --- |
| `signaling/src/worker.js` | Reads cached expiring ICE credentials instead of minting Cloudflare credentials per player; adds a rate-limited, boolean-only readiness/setup endpoint |
| `signaling/src/metered-turn.js` | New singleton credential cache with Metered create/get APIs, propagation gating, overlapping rotation, expiry checks and alarm-based retries |
| `signaling/wrangler.jsonc` | Adds `TURN_CREDENTIALS` / `MeteredTurn` and migration `v2`, preserving the existing room migration |
| `signaling/test/rooms.test.mjs` | Updates provider fixtures and verifies cached delivery, secret confinement, readiness and inaccessible internal routes while retaining room/error cases |
| `signaling/test/metered-turn.test.mjs` | Adds eight credential lifecycle and security tests |
| `signaling/test/worker-fixture.mjs` | Test-only cache reset/propagation controls, excluded from the deployment entrypoint |
| `signaling/test/browser.mjs` | Routes the existing direct/real-relay browser tests through the Metered fixture/cache |
| `signaling/README.md` | Replaces Cloudflare TURN setup with Metered secrets, initialization, rotation, free-plan guidance and updated acceptance tests |
| `signaling/VALIDATION.md` | Records the conversion, preserved scope, updated results and remaining live-service checks |

## Existing issue confirmed against the original browser game

The original browser build resets music preferences while loading a save slot.
In separate clean Chromium contexts, both the unmodified base HTML and this
implementation changed volume `0.37` / music disabled back to `0.75` / music
enabled after reload. `loadSaveSlot()` invokes settings setters that save the
current defaults before saved music settings are restored. The relevant music
and save-loading functions are unchanged by this upgrade.

Music controls work during the session, and campaign progress/slot selection
persist in the browser test. This inherited music-preference issue was left
outside the networking change. The result is **not** a claim that every existing
save preference or audible output was exhaustively tested.

## Every changed or added file

| File | Change |
| --- | --- |
| `.github/workflows/tests.yml` | Adds a Node 24 job for Worker tests, deployment dry run and real Chromium peer integration; no deployment or credentials in CI |
| `.gitignore` | Excludes signaling dependencies, Wrangler local state and local secret/environment files |
| `README.md` | Links browser room-code multiplayer to the deployment guide; explains native LAN pairing remains unchanged |
| `docs/demo/index.html` | Replaces manual SDP controls with room controls; loads the new scripts; retains the game protocol and host physics; adds acknowledged input sequence, responsive guest movement, reliable action routing and disconnect guards |
| `docs/demo/online-config.js` | One public signaling URL setting; no secrets |
| `docs/demo/online-localization.js` | Adds room UI, connection status and safe error translations using the existing localization system |
| `docs/demo/online.js` | WebSocket signaling, queued SDP/ICE, direct/relay negotiation, deadlines, heartbeat, cleanup, game/UI adapter and guest-paddle reconciliation |
| `signaling/package.json` | Pinned development-only Wrangler, Miniflare and Playwright tools and commands |
| `signaling/package-lock.json` | Reproducible development dependency versions |
| `signaling/wrangler.jsonc` | Worker, `ROOMS` and `TURN_CREDENTIALS` SQLite Durable Object migrations, origin allowlist and `ROOM_LIMITER` binding; application observability disabled |
| `signaling/src/worker.js` | Atomic two-player ephemeral rooms, bounded role-checked signaling, short codes, rate limits, cached temporary TURN delivery, leases, cleanup and readiness endpoint |
| `signaling/src/metered-turn.js` | Server-side Metered credential creation, propagation delay, cache, daily rotation, safe expiry margin and retry alarms |
| `signaling/test/rooms.test.mjs` | Room admission, protocol, credential/error, cleanup and rate-limit tests |
| `signaling/test/metered-turn.test.mjs` | Credential lifecycle, provider-error and security tests |
| `signaling/test/worker-fixture.mjs` | Local-test-only propagation/reset controls |
| `signaling/test/browser.mjs` | Real browser room flow, optional real TURN path, delayed/lossy game traffic, disconnect and existing-feature smoke tests |
| `signaling/README.md` | Architecture audit, account setup, secrets, exact deployment/Pages steps and two-network acceptance procedure |
| `signaling/VALIDATION.md` | This test record, file inventory, limitations and readiness assessment |
| `tests/online-networking.mjs` | Client lifecycle, negotiation/fallback, localization coverage and sequence-order tests |

## Remaining limits and contest readiness

- **Deployment is still required.** Create/select the Metered free app, configure
  `METERED_APP_NAME` and `METERED_SECRET_KEY` as Worker secrets, deploy, complete
  the readiness check after at least two minutes, set the public Worker URL and
  publish the Pages files. Only then will the public Create/Join flow work.
- **Real internet acceptance is still required.** Test home Wi-Fi against
  cellular data, and force the deployed Metered relay path. No real Metered
  account key was supplied or used here. Local browser tests do not prove
  Cloudflare/Metered account permissions, provider availability, restrictive-network
  TCP/TLS TURN, DNS, free-plan quota or public Pages deployment.
- **Browser coverage is Chromium.** Phone viewport emulation is not physical
  Android/iOS testing. Safari/Firefox, hardware controllers, audible audio and
  native Windows/Linux/Android GUI builds were not exercised here. Native source
  and existing platform test suites were preserved.
- The host still has the latency advantage. The guest ball remains driven by
  the existing 20 Hz host snapshots; no ball prediction, interpolation, rollback
  or lag-compensated collisions were added. High RTT can be visible even though
  the guest paddle responds immediately.
- Keep the host page visible. Existing browser focus-loss behavior pauses the
  host; a sleeping device or a throttled/backgrounded mobile tab can end the
  session. Very brief ICE interruptions may recover within 8 seconds, leaving
  the game paused for deliberate resume. There is no reload/rejoin continuation,
  host migration or reliable recovery after a network change that needs new ICE.
- Waiting rooms expire after 10 minutes and sessions after 2 hours. Clean exits
  delete room data immediately; abrupt departures can take about 135 seconds
  for server lease cleanup. Deleted room codes may eventually be reused.
- Five-character codes provide convenient invitations, not authentication.
  Rate limits and origin restrictions reduce casual abuse; they are not a hard
  quota cap or protection against distributed relay abuse. No player account system
  was added.
- Metered's free allowance and active-credential limits still apply. A cached
  credential being ready does not prove that Metered currently permits relay
  allocations. Credentials are shared across rooms until expiry (up to 48 hours);
  rotation limits their lifetime but does not prevent reuse by a player who
  obtains one. No permanent Metered Secret Key is sent to a player.
- The pre-existing browser music-preference reload issue above remains.

**Assessment:** ready to deploy and perform final acceptance testing, **not yet
ready to certify for contest submission**. The source implementation and local
tests are complete; public deployment, genuine two-network play and the deployed
TURN/mobile checks remain the submission gate.
