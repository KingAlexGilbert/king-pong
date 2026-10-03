# Validation and change inventory

Validated on 2026-10-03 against repository base
`0f766d37052f08d601342bba844afd2c46298850`.

The implementation is complete locally. It has **not** been pushed to GitHub or
deployed to Cloudflare. `docs/demo/online-config.js` intentionally has an empty
signaling URL until the account owner deploys the Worker. No Cloudflare account
resources, TURN keys, secrets or GitHub Pages settings were created or changed
by this work. Follow [README.md](README.md) to deploy and perform acceptance testing.

## Recorded checks

| Check | Result and scope |
| --- | --- |
| Existing and new Node tests | **78 passed**: 71 existing tests plus 7 online client/protocol tests |
| Existing Python tests | **22 passed** |
| Signaling tests | **8 passed**: Workers runtime integration plus an alarm/lease fixture using the production Durable Object class |
| Worker deployment dry run | Passed; Wrangler accepted the bundle, SQLite Durable Object migration and rate-limit binding |
| Dependency audit | `npm audit --omit=optional`: **0 vulnerabilities** reported; no production npm dependencies |
| Two independent Chromium 140 contexts, direct WebRTC | Create Room → five-character code → Join Room → both DataChannels open, real game state and input exchanged |
| Two independent Chromium contexts, forced fallback | Initial attempt deliberately has no usable candidates; automatic retry connects through a real local TURN server; `getStats()` confirms a selected `relay` candidate |
| Latency/loss check on both connection paths | Gameplay messages delayed 90 ms each direction, with periodic 220 ms delivery, out-of-order delivery and every 13th packet dropped (~8%); guest paddle responds locally and converges within 2 game-coordinate units after movement stops |
| Actions and authority | Guest serve/pause reach host over the reliable channel; host score snapshots reach guest; stale state and input sequence numbers are rejected |
| Browser failures | Invalid code, full room, guest departure, host returning to title, immediate new-room creation, and stopped/frozen disconnected match checked; no uncaught page errors or browser dialogs |
| Signaling failures | Wrong origin, invalid/absent code, simultaneous guests, third player, malformed/oversized messages, wrong SDP role, rate limiting, unavailable TURN credentials, stale ICE and room cleanup checked |
| Client lifecycle fixtures | Opening/negotiation timeout, early ICE before SDP, one relay retry, cancellation, raw-error suppression, both-channel readiness and transient ICE disconnect/recovery checked |
| Other browser features | Campaign ball motion, campaign progress and selected-slot persistence after reload, local two-player controls, music toggle/volume control and Spanish room/error UI checked |
| Localization | All new networking phrases have entries for the nine existing non-English languages; existing language tables retained |
| Small-screen UI | Join form inspected with Chromium touch emulation at 390×844 and 844×390; room input and Join button fit both viewports |
| Diff review | `git diff --check` passed; native platform files, version numbers, audio assets, campaign definitions and save serialization unchanged |

The browser latency check delays DataChannel sends in the test only. It is not a
WAN benchmark and does not model every congestion or radio-loss pattern. The
TURN test uses a local UDP relay and a test substitute for Cloudflare's
credential endpoint. Neither substitute ships in the game or production Worker.
The service tests verify the real credential request shape, secret confinement,
temporary-credential forwarding and filtering of browser-blocked port 53.

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
| `signaling/wrangler.jsonc` | Worker, `ROOMS` SQLite Durable Object migration, origin allowlist and `ROOM_LIMITER` binding; application observability disabled |
| `signaling/src/worker.js` | Atomic two-player ephemeral rooms, bounded role-checked signaling, short codes, rate limits, server-side temporary TURN credentials, leases and cleanup |
| `signaling/test/rooms.test.mjs` | Room admission, protocol, credential/error, cleanup and rate-limit tests |
| `signaling/test/browser.mjs` | Real browser room flow, optional real TURN path, delayed/lossy game traffic, disconnect and existing-feature smoke tests |
| `signaling/README.md` | Architecture audit, account setup, secrets, exact deployment/Pages steps and two-network acceptance procedure |
| `signaling/VALIDATION.md` | This test record, file inventory, limitations and readiness assessment |
| `tests/online-networking.mjs` | Client lifecycle, negotiation/fallback, localization coverage and sequence-order tests |

## Remaining limits and contest readiness

- **Deployment is still required.** Create the Cloudflare TURN key, configure the
  two Worker secrets, deploy, set the public Worker URL and publish the Pages
  files. Only then will the public Create/Join flow work.
- **Real internet acceptance is still required.** Test home Wi-Fi against
  cellular data, and force the deployed Cloudflare relay path. Local browser
  tests do not prove Cloudflare account permissions, provider availability,
  restrictive-network TCP/TLS TURN, DNS, billing configuration or public Pages
  deployment.
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
  spending cap or protection against distributed relay abuse. No account system
  was added.
- The pre-existing browser music-preference reload issue above remains.

**Assessment:** ready to deploy and perform final acceptance testing, **not yet
ready to certify for contest submission**. The source implementation and local
tests are complete; public deployment, genuine two-network play and the deployed
TURN/mobile checks remain the submission gate.
