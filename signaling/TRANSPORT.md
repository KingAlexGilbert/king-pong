# King Pong networking implementation report

Reviewed against `d390388cdf65aefc6fe5ee62b60a98c5d82f2a54` (2026-10-18); validation completed 2026-10-19.

This patch adds encrypted WebSocket gameplay as the last online transport, fixes application-level ICE selection and recovery problems, and keeps the existing game protocol and host authority. No production deployment, push, billing change, new provider, or Cloudflare binding was performed.

The workspace checkout started clean. Recent networking, approval, QR, mobile-layout and host-disconnect commits were reviewed before editing; the earlier handoff patches were already included in this base. Baseline results were 443 JavaScript tests and 31 Worker tests passing.

## 1. WebRTC findings

| Finding | Evidence and change |
| --- | --- |
| An eight-second STUN-only attempt could be replaced while ICE was still checking. The replacement used `iceTransportPolicy: 'relay'`. | The original `KingPongRoom` timer, `relay()` and server `start` handlers enforce this sequence. Once replaced, a later viable direct candidate was forbidden. Upgraded peers now gather STUN and the existing Metered TURN candidates in one `all` checklist. The legacy compatibility path also uses `all` for its second attempt. |
| Existing sessions had no ICE-restart recovery. | A failed established connection waited for departure or closed; it did not restart ICE. The new adapter restarts ICE on the existing peer/channels when possible, freezes gameplay during recovery, then permits WebSockets if recovery fails. |
| Early candidate queuing was already present. | The baseline serializes signaling, queues candidates before `setRemoteDescription`, and flushes them afterward. No missing baseline candidate queue was found. That behavior is retained and tested for both IPv4 and IPv6. |
| The earlier selected-ICE/slow-DTLS fix was already present. | The baseline cancels the direct timer when ICE becomes connected/completed. This patch does not claim that earlier fix as new work. The new path retains a bounded DTLS grace period. |
| Restart generations need stronger isolation. | New messages carry a session UUID and transport epoch. Candidate `usernameFragment` is preserved, old local ufrags are filtered, and ambiguous old end-of-candidates events are not forwarded during description replacement. Descriptions precede locally queued candidates. |
| Browser RTC API failures could otherwise bypass fallback. | Description installation, candidate application, configuration and offer failures now enter RTC recovery. Encryption/proof failures still terminate the session. |

There was no IPv4-only filter in the baseline. Cloudflare STUN is retained; no IPv6 connectivity is assumed, and mDNS/privacy protections are not disabled by the application. Browser tests no longer disable mDNS masking. The existing Metered credential rotation, propagation delay, lifetime checks and configured TURN URL filtering remain unchanged.

**The exact cause of the user's real-network failures is not proven here.** Local Chromium exposed no usable ICE path during the normal browser runs, and those runs completed through WebSockets. There was no live Metered credential or local TURN server available for an actual TURN data-channel test. Automated candidate handling and simulated connected channels cannot establish that a particular NAT, IPv6 route, firewall or STUN service is reachable. Symmetric NAT, blocked UDP, client isolation and restrictive firewalls can legitimately require relaying.

## 2. Connection selection and recovery

Private clients advertise transport support with `/sas2`; matchmaking claims use `/secure1`. Both peers must support the new protocol. Mixed versions retain compatible legacy WebRTC; they never receive an unsupported gameplay relay. Five-character legacy room joining remains available. Old Workers must be updated before shipping the new clients.

The new connection sequence is:

1. Complete room admission and, when enabled, the existing pre-approval PIN exchange and host approval.
2. Confirm fresh encrypted-session keys. Key exchange overlaps a bounded lookup of the existing TURN credential cache.
3. Let browser ICE select among direct IPv4/IPv6, TURN UDP and other configured TURN paths in one checklist with `iceTransportPolicy: 'all'`. Browser ICE owns candidate priority/nomination; the application does not force a relay or run separate IPv4/IPv6/UDP/TCP trials.
4. A connected pair starts immediately. The initial watchdog is 20 seconds, not a minimum wait. Connected/completed ICE with unopened channels gets at most 12 more seconds for DTLS. A disconnected established peer gets three seconds to recover before requesting an ICE restart. A restart has a 12-second watchdog, with the same selected-ICE grace.
5. After an unsuccessful restart, coordinate WebSocket activation. Unavailable RTC APIs can reach this step immediately after key confirmation. At most three restarts are permitted per session. TURN cache lookup is retried on restart and bounded to 1.5 seconds per lookup; a cache error does not prevent direct ICE or encrypted WebSockets.

For every new epoch, both peers send ready, both acknowledge prepare, and only then does the room activate gameplay. A transient old RTC `connected` event cannot activate a replacement epoch. A usable RTC connection sends no gameplay through Cloudflare. WebSocket fallback is sticky for the current pairing; there is no automatic upgrade back to RTC.

Session keys, packet sequence spaces, logical control IDs, match identity and scores survive an RTC restart or RTC-to-WebSocket transition. Ready/countdown timers stop during recovery. An interrupted in-progress rally stays paused for a safe player-controlled resume; recovery does not award points or restart the match. A closed room WebSocket ends that membership: rejoining is a new admission with fresh keys. Retained private hosts can admit replacement guests using the same room code.

## 3. WebSocket implementation and performance

`KingPongSecureTransport` exposes the same data/control interface that existing `onlineLanSend` and `handleLanMessage` consume. Compact state/input packets, validation, snapshot sequences, prediction, interpolation and host-owned physics/scoring remain in their existing modules. Both RTC and WebSocket gameplay use the encrypted envelope, keeping authentication and deduplication identical during a transition. RTC still uses an unordered low-retransmit data channel and a reliable ordered control channel.

The relay is an isolated channel on the already admitted room WebSocket, **not the public matchmaking queue socket**. This avoids another upgrade, membership token or reconnect race. `SecureRoomTransport` routes only to the other approved socket in that room/session. The relay does not decrypt packets, interpret scores or simulate gameplay. Its fast path uses bounded socket-attachment metadata and does not write gameplay or ciphertext to Durable Object storage.

Backpressure safeguards:

- Preserve the existing 20 Hz regular host snapshots, 30 Hz input retries and 250 ms acknowledged-idle input lease. Immediate changed-input sends remain available; pointer movement can approach the 60 Hz simulation rate.
- Keep one newest unsent data packet; discard it if it is over 250 ms old. Do not replay accumulated positions after a stall.
- Stop pumping above 32 KiB of socket/channel buffering. A sustained eight-second blockage ends the connection safely. The native MessageChannel bridge reports both queued bytes and actual WebSocket buffering.
- Prioritize control acknowledgements and controls over data. Retain at most 32 unacknowledged controls and 64 KiB of control text. Retries use the same logical command ID but fresh encryption counters. Ordered delivery and deduplication prevent duplicate serve, pause and configuration actions. Unacknowledged controls time out after 12 seconds of active transport.
- Bound receiver work to 64 queued decryptions. Server forwarding has 12 data slots plus four reserved control/ack slots, with 48/64 KiB data/total limits. Receiver credits release this window; dropped control packets are retried end to end. The server has no backlog of obsolete snapshots to drain.

TCP head-of-line blocking still exists for bytes already sent. Coalescing and bounded queues reduce the resulting latency; they cannot make WebSockets behave like unreliable UDP.

## 4. Privacy, verification and authorization

Production clients accept HTTPS signaling URLs and use WSS. Plain HTTP/WS is permitted only for localhost development. Gameplay encryption uses browser Web Crypto: ephemeral ECDH P-256, HKDF-SHA-256, independent directional AES-256-GCM keys, and HMAC-SHA-256 key confirmation. Private and symmetric keys are non-extractable, session-specific and never saved; ephemeral public keys are exchanged for agreement.

The transcript binds the room, session UUID, host/guest roles, both ephemeral public keys and random nonces. Authenticated frame metadata binds the direction, epoch, lane and encryption counter. Separate directional keys and monotonically increasing counters prevent nonce reuse across transport changes. Receivers reject replay; a bounded RTC reordering window permits delayed datagrams. Closed sessions clear key references, and replacement guests get a new UUID and key exchange.

The existing commit/reveal PIN exchange runs over signaling before approval, independently of RTC. Its full-strength HMAC key authenticates the subsequent transport public keys. Both players see the short PIN before the host accepts. Comparing it over a trusted separate channel is optional, and rejecting the request remains available. Encryption/proof failure never enables plaintext gameplay.

**Encryption is not automatic identity authentication.** Without comparing the PIN, including public matchmaking and approval-disabled rooms, the design does not claim protection against an active signaling intermediary substituting keys. A matching externally compared PIN authenticates that temporary pairing, not a long-term identity. It is a short authentication string, with finite guessing strength. This is a new application handshake using standard cryptographic primitives; regression tests are not a formal cryptographic audit. A compromised game client or script-delivery origin can read its own plaintext.

Cloudflare still sees connection metadata, packet sizes/timing and ordinary signaling; WebRTC peers and infrastructure still process the addresses required by ICE. No new analytics, identities, device names or persistent cryptographic identifiers are added. The existing optional connection indicator derives only Direct IPv4/IPv6, TURN UDP/TCP/TLS where exposed, WebSocket, or Unknown from browser statistics. Failure uses the existing connection-error UI. It neither displays nor persists addresses, candidate IDs, raw SDP or raw stats. Redacted/mDNS addresses and unavailable relay-hop protocols remain Unknown.

Server admission retains origin restrictions, anonymous six-character codes, private host approval, public role tokens, two approved participants, bounded pending requests, kick/rejection blocking and existing room leases. Unauthorized, malformed, oversized and replayed current-session relay frames are rejected. Stale generations cannot forward; a bounded retired-session marker prevents already-buffered pre-kick packets from destroying a retained host room. Malformed pending-guest frames remove that guest, not the host.

Each sender is limited to 180 encrypted frames and 512,000 ciphertext characters per second; frames are at most 23,000 base64 characters and plaintext at most 16 KiB. A separate 220-message/550,000-character budget includes credits and invalid/stale traffic. Signaling has its own bounded budget. These limits complement admission limits; they are not a guarantee against distributed quota exhaustion. Existing 75-second leases, cleanup alarms and two-hour session caps remain in place.

## 5. Resource considerations

Cloudflare's published Free limits are 100,000 Durable Object requests/day and 13,000 GB-s/day. Incoming WebSocket messages use a 20:1 request-billing ratio; outgoing messages are not charged as requests. Connections and alarms add requests. Free-limit exhaustion fails operations, with daily reset at 00:00 UTC. These are shared account limits, not a separate allowance for this relay. [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), checked 2026-10-19.

From the implemented packet rates, estimate about 70–120 incoming messages/second per active relayed match, including coalesced credits and occasional control ACKs: roughly 12,600–21,600 billed requests/hour, or about 4.6–7.9 aggregate match-hours/day before other usage. This is an estimate, not a production measurement. Hibernation avoids idle duration; active-play duration must still be budgeted. At a conservative continuously active 128 MB allocation, one room-hour is about 461 GB-s. Lifecycle storage and alarms also consume the existing SQLite allowances.

Direct matches use no gameplay relay bandwidth. TURN-selected matches continue using Metered. Gathering TURN alongside direct candidates can create allocations even when direct wins; it avoids the former forced-relay transition but does not guarantee lower usage on every network. JSON/base64 envelopes and authenticated encryption add bytes compared with the original compact plaintext packets; AES-GCM is also applied over RTC for consistent session authentication. WebSocket gameplay consumes Cloudflare capacity instead of Metered gameplay bandwidth. No paid plan, Realtime product, card requirement or automatic upgrade is added.

## 6. Test results and coverage

Commands below are exact runnable test commands; execution used bounded shell timeouts and redirected logs where helpful. Browser tests use real Chromium/Firefox WebSockets and local Miniflare/workerd. Local transport is WS on loopback; production WSS/TLS and public-network routing were not exercised.

| Working directory | Command | Result |
| --- | --- | --- |
| Repository root | `node --test tests/*.mjs` | 458 passed, 0 failed; includes 15 new encryption/transport tests. |
| Repository root | `python -m unittest discover -s tests -p 'test_*.py'` | 37 passed, 0 failed. |
| `signaling` | `npm test` | 39 passed, 0 failed; includes eight new real Durable Object relay tests. |
| `signaling` | `npm run test:browser` | Existing browser-peer lifecycle, input/loss/jitter, control, scoring, replacement, localization and save regression passed. Actual selected transport: WebSocket after normal RTC attempts. |
| `signaling` | `node test/private-room-browser.mjs --websocket-fallback --transport-faults` | Private lifecycle plus real WS delay/jitter, buffering, command retries/deduplication and rejection of guest-authored scoring passed. |
| `signaling` | `node test/private-room-browser.mjs --controlled-channels --transport-recovery` | Controlled RTC failure/restart failure to real encrypted WS; match/scores preserved and pause not duplicated; private lifecycle passed. This does not validate real ICE. |
| `signaling` | `node test/private-room-browser.mjs --fallback-disconnect` | Actual room socket closes during fallback agreement; no gameplay/points, friendly error and retained host room. |
| `signaling` | `MOZ_DISABLE_CONTENT_SANDBOX=1 node test/private-room-browser.mjs --websocket-fallback --firefox` | Firefox private WS lifecycle passed. The environment flag is a container-launch workaround only, not a game/browser setting shipped by the patch. |
| `signaling` | `node test/private-room-browser.mjs --websocket-fallback --public-powerups` | All four host/guest powerup preference combinations passed in the shared public queue. |
| `signaling` | `npm run test:matchmaking` | Seven groups passed; six browser-to-native-file-page pairings, both roles for all three native HTML builds. Each attempted RTC, then selected WS. |
| `signaling` | `node test/matchmaking-browser.mjs --websocket-fallback` | The same seven groups passed with RTC deliberately unavailable, exercising the real file-origin bridge and encrypted gameplay. |
| `signaling` | `npm run test:gameplay` | 33 browser integration groups passed: all four assets, authority, Royal Powerups, controls, saves, localization and layout. |
| `signaling` | `npm run test:engineering` | 34 groups passed: all four assets, render/physics timing, interpolation, audio, desktop/mobile positioning and canvas regressions. |
| Repository root | `node tools/sync-gameplay.mjs` then `node tools/sync-gameplay.mjs --check` | Generated browser and three native assets synchronized and checked. |
| Repository root | `git diff --check` | Passed. |
| `signaling` | `WRANGLER_SEND_METRICS=false npm run check` | Worker deployment dry run passed using existing bindings. No deployment occurred. |

Coverage against the requested network scenarios:

| Scenario | Verification boundary |
| --- | --- |
| Direct succeeds, no WS gameplay | Client and DO readiness/activation tests with controlled RTC; real direct path unverified. |
| IPv6 available; IPv6 absent/IPv4 retained | Both candidate families queued/applied and forwarded with ufrag; coarse stats fixtures; real routes unverified. |
| Direct fails, TURN succeeds | Existing Metered credential/fallback tests, all-policy configuration, TURN diagnostic fixtures and usable-RTC activation tests. Live TURN success unverified. |
| All RTC paths fail, WS succeeds | Real browser/Worker private and public matches, including normal RTC attempts in this environment. |
| WS cannot activate | Real socket closure during fallback agreement; opening-timeout, unavailable crypto and closed-socket unit tests. |
| Lag, jitter, buffering, disconnect | Browser delayed/jittered WS, backpressure, 12+4 server window, data expiry, reliable retry and departure tests. |
| Approval or PIN rejection | Real preconnection matching PINs, rejection and rejoin block; key/proof tampering and approval-binding tests. |
| Cross-room injection | Actual DO sockets cannot forward another room/session's ciphertext. |
| Guest replacement | Fresh session/key generation; retained private code; delayed retired packets discarded. |
| Different requested transports | No prepare/activate until both match; client rejects inconsistent activation. |
| Malformed/replayed/unauthorized traffic | Crypto tampering/replay, pending-guest isolation, size/rate limits and DO membership tests. |
| Transport transition without duplicate events | Controlled RTC-to-real-WS browser recovery plus encrypted logical-control deduplication across epochs. |

During development, tests exposed retained-room handling of late TCP packets, a transient-state recovery race, and old test assumptions about physical data-channel objects and 15-second setup deadlines. These were corrected and rerun. Browser cache eviction caused a later launch failure; `npx playwright install chromium firefox` restored the test binaries. Initial Firefox container launches needed the environment workaround shown above. Final results are distinguished from these earlier failed attempts in the supplied logs.

No successful real-world NAT, live TURN, IPv6 Internet path, hardened-browser configuration, physical-device LAN, or native WebView-wrapper run is claimed. The native page tests cover Windows/Linux/Android HTML and their file bridge in Chromium, not WebView2/WebKitGTK/Android WebView binaries. Offline discovery/QR/manual pairing code was not routed through the relay and remains covered by the existing source/JavaScript/Python regressions. Native installers/APKs were not built or signed.

## 7. Changed files

- `game/secure-crypto.js`, `game/secure-transport.js`: session encryption, unified adapter, connection agreement, ICE restart, buffering and command deduplication.
- `game/online.js`, `game/online-match-flow.js`: capability routes, admission integration, lifecycle cleanup, peer updates and recovery/countdown safety.
- `game/network-common.js`, `game/multiplayer-safety.js`, `game/online-localization.js`: private coarse transport diagnostics in the existing optional indicator, with all nine UI languages.
- `game/signaling-socket.js`, `signaling/src/native-bridge.js`: bounded buffering and new protocol routes in the existing packaged-file bridge.
- `signaling/src/secure-relay.js`, `party-room.js`, `worker.js`: approved room relay, epoch agreement, validation, resource limits, legacy compatibility and retained-room cleanup.
- `tools/sync-online.mjs`: include the new canonical networking modules. Generated copies: `docs/demo/{index.html,online.js,online-localization.js}`, `windows/webview-2/index.html`, `Linux/assets/index.html`, and `android/app/src/main/assets/index.html`.
- New tests: `tests/secure-transport.mjs`, `signaling/test/secure-relay.test.mjs`. Existing online, room, matchmaking and browser tests extended for the adapter and fallback. `signaling/README.md` and this report document operation and release requirements.

Gameplay physics, scoring authority, offline LAN, QR pairing, save schemas, app version metadata and native wrapper source were not redesigned.

## 8. Apply and deploy

Apply the supplied patch to this base (or review conflicts against a newer checkout):

```sh
git apply --check KingPong-Secure-Networking.patch
git apply KingPong-Secure-Networking.patch
node tools/sync-gameplay.mjs --check
node --test tests/*.mjs
python -m unittest discover -s tests -p 'test_*.py'
cd signaling
npm ci
npm test
WRANGLER_SEND_METRICS=false npm run check
```

Preserve unrelated local edits; a failed apply check should be resolved by reviewing the diff, not resetting the working tree. The handoff patch includes newly added files and synchronized platform assets.

After review and when you choose to release, run `npm run deploy` from `signaling`, using the existing Cloudflare account. **Deploy the complete Worker and native bridge before publishing the updated browser files or rebuilt native clients.** Keep `wrangler.jsonc`, existing v1/v2/v3 migrations, `ROOMS`, `TURN_CREDENTIALS`, `MATCHMAKING`, `ROOM_LIMITER`, `ALLOWED_ORIGINS` and the existing Metered secrets. No new environment variable, secret, storage class, migration or billing setting is required.

Keep the existing HTTPS Worker URL and exact native bridge allowlists. Do not permit wildcard or `null` signaling origins. Continue the existing Metered readiness/rotation workflow. Release refreshed browser assets and rebuild Windows/Linux/Android packages using the repository's existing commands; generated HTML is not a rebuilt installer. Existing sessions spanning a Worker release may disconnect and should rejoin.

## 9. Remaining limitations

TURN remains necessary on some NAT/firewall combinations; TLS TURN can help where UDP is blocked if the existing Metered URLs and network permit it. The browser's ICE priority is not an absolute guarantee that a late direct candidate replaces an already selected relay. WebSocket fallback can also fail when Cloudflare/WSS is blocked, quotas are exhausted, crypto is unavailable, verification fails, a peer leaves or an endpoint is too slow.

WebSocket sessions do not silently reconnect an old cryptographic generation, and do not automatically upgrade back to RTC. Legacy peers have no WS fallback. No app can recover gameplay when every usable network path or the signaling service itself is unavailable. Real network and native-wrapper release checks remain outstanding.

Primary references: [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/), [WebRTC specification](https://www.w3.org/TR/webrtc/), [Web Crypto](https://www.w3.org/TR/WebCryptoAPI/), and the Cloudflare pricing page linked above. Timing, quota estimates and implementation limits in this report describe this patch, not measured Internet latency or guaranteed service capacity.
