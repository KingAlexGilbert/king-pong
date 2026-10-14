# Matchmaking and signaling

Choose **Play Online → Two Player → Find Match** to join the shared browser/Android/Windows/Linux queue. Viewing this menu only watches availability; it does not register a player as waiting. Searches stay active while connected, including when an opponent arrives several minutes later. Cancel Search, leaving the mode, closing the app, or backgrounding a waiting app removes the search. After a connection failure, press Find Match to try again. There are no CPU substitutes or estimated wait times.

**Create Room** and **Join Room** keep private five-character codes by default. Enabling **Host approval required** creates a six-character room with host Accept/Reject and Kick controls. **LAN Play → Two Player** keeps the existing native offline LAN workflow; the browser also provides manual invitation/answer exchange. **Local Play** opens same-device two-player setup directly.

## Arenas and rules

Any Arena is the default. The server chooses the arena before either player connects:

- Same preference: that arena.
- Different preferences: a fair coin flip between the two.
- One Any Arena: the other player's preference.
- Both Any Arena: an unbiased random choice from the 18 campaign arenas.

The secret boss is excluded. Automatic matches use the existing **Classic Match — First to 10** preset. Both clients lock the assignment and reject conflicting host settings. Private rooms retain their selectable rules and arenas; the previous rule preset returns after an automatic match ends.

## Infrastructure

The existing Worker gains one SQLite-backed `MatchmakingQueue` Durable Object named `shared`. It pairs waiting sockets atomically and reserves a `PongRoom` using separate, random role tokens. Waiting, connecting, and watching are distinct states; only waiting players contribute to availability. The existing host-authoritative WebRTC transport, direct STUN attempt, and Metered TURN fallback carry the match.

The queue uses hibernating WebSockets and automatic 20-second ping/pong heartbeats. A 75-second lease and 30-second cleanup alarm remove abandoned sockets (within about 105 seconds without a close event). A connection reservation expires after 60 seconds. Queue entries live in socket attachments, survive hibernation, and require no per-heartbeat database writes. An empty queue deletes its alarm and temporary storage. Connected peers leave the matchmaking queue after both report ready; the existing room lifecycle then owns cleanup.

Limits include 256 queue sockets, eight sockets per temporary IP hash, 20 application messages per socket per 10 seconds, and the existing Worker admission rate limit. No accounts, profiles, analytics, or persistent queue history are added. The IP hash is retained only with the temporary socket attachment; it is a rate-limit key, not an anonymity guarantee. Role tokens and complete assigned settings are disclosed only to the paired clients. Reserved rooms cannot be joined through the public private-code namespace.

Packaged games retain their original `file://` page and save origin. A small HTTPS iframe at `/v1/native-bridge` forwards signaling over a dedicated MessageChannel. Its CSP admits only file ancestors, it accepts only its opaque-origin parent, and paths/messages are restricted. WebRTC and the game remain in the local page. Signaling continues to reject the `null` origin. Each native wrapper permits only this exact bridge URL; other remote navigation remains blocked.

## Build and deployment

1. From the repository root, run `node tools/sync-gameplay.mjs`. This updates the four HTML builds, browser online files, embedded native transport, optimized icon data, and the generated server compatibility contract.
2. Run `node tools/sync-gameplay.mjs --check` and `node --test tests/*.mjs`.
3. In `signaling/`, run `npm ci`, `npm test`, and `npm run check`. The last command is a deployment dry run.
4. When ready to release, deploy the Worker using the existing Cloudflare account with `npm run deploy`. Keep migrations v1/v2; the new v3 migration adds only `MatchmakingQueue` as a SQLite class. Do not recreate the existing room or TURN bindings, rotate secrets, or add billing information.
5. Release the synchronized browser files and rebuild the native apps with their existing build commands. Deploy the Worker before distributing the updated clients.

`game/online-config.js` holds the public Worker URL. If using another Worker hostname, also update the exact `/v1/native-bridge` URL allowed by `Program.cs`, `MainActivity.java`, and `Linux/src/king-pong.py`, then synchronize and rebuild. Add browser hosting origins to `ALLOWED_ORIGINS`; never add `null` or a wildcard. Existing Metered secrets remain Worker-side and unchanged.

`tools/sync-online.mjs` derives eligible arenas from the existing `CAMPAIGNS` definitions and checks they match in every build. Its fingerprint includes those definitions, rule presets, and `game/matchmaking-version.json`. Increment that compatibility revision when changing gameplay/protocol behavior incompatibly, then regenerate and deploy both sides. Do not edit `matchmaking-contract.js` or embedded copies directly. Old automatic-match clients receive an explicit update/reload error. Existing release version numbers are unchanged.

## Validation

- `npm test`: queue concurrency, fairness, cancellation, leases, room/token security, private rooms, and TURN credential/fallback tests.
- `npm run test:matchmaking`: real browser-to-packaged-HTML matches in both roles for Windows, Linux, and Android. Requires a test environment that exposes working WebRTC ICE candidates.
- `npm run test:matchmaking-ui`: explicit signaling-only mode for restricted environments. Tests real queue WebSockets, file-origin bridge traffic, SDP exchange, cleanup and immutable settings; it does **not** establish or validate a gameplay data channel.
- `npm run test:powerup-ui`: desktop/mobile title tiles, icon rendering, effective mute controls, translations, and real offline Web Audio samples.
- `npm run test:serve`: production canvas rendering at 60/120/144/165/240 Hz with regular/irregular timing, initial and repeated score serves, early collisions, Crown Rush, and LAN/online snapshot replay. Presentation times and packet delivery are controlled; this does not validate physical displays or a real network connection.
- `KING_PONG_TEST_ARTIFACTS=/absolute/output/path npm run compare:serve`: captures production-canvas PNG sequences and motion traces for the original 20%/one-second smoothstep, 40%/0.4-second linear, and 50%/0.3-second smoothstep curves. Curve overrides exist only in the test page.
- Existing `test:browser`, `test:gameplay`, `test:ui`, and `test:engineering` remain available. The private-room browser test supports its existing `KING_PONG_TEST_TURN_*` variables for a real forced-relay test.

Loading a native HTML file in Chromium validates shared page code and the bridge, not the actual Android WebView, Windows WebView2, or Linux WebKitGTK wrapper. Before releasing rebuilt applications, test online/private/LAN entry, bridge admission, background cleanup, network changes, audio/autoplay, and save persistence on those platforms. Real public-internet and TURN connections still require network-capable testing and the existing provider configuration.

## Four-player private rooms and LAN

Choose **Play Online → Up to Four Players**. Choose Free-for-All (3/5/10 lives) or Two versus Two (5/10/20 points), powerups, bot difficulty, and your paddle before connecting. The Hidden Wall variation requires the host’s existing campaign unlock. The square arena uses the same layout for all four participants; opposite sides are teammates in 2v2. Every participant can optionally see their own paddle on the left.

Create a room, share its six-character code, and approve requests if that option is enabled. Guests press **Ready**. The host presses **Start waiting** to arm the match. Four ready humans start immediately. With **Fill empty slots with bots after 3 minutes** enabled, empty positions become bots only after that timer and only if every human guest explicitly agrees and is ready. Settings changes cancel readiness and the timer. There is no new public four-player matchmaking queue; existing two-player matchmaking is unchanged.

**LAN Play → Up to Four Players** uses the same host-authoritative game with manual WebRTC invitations and no signaling server, STUN, TURN, scanning, or additional permissions. The host creates one invitation per guest; the guest creates an answer; the host accepts the answer. Invitations expire after five minutes and cannot be accepted twice. The text is connection information to exchange with the intended player, not a public room code. A same-device practice option accepts one keyboard player and additional controllers, filling unused positions with explicitly labelled bots.

The host can pause, resume with a three-second countdown, rematch, or kick. Guests can request a pause. A transient connection interruption pauses the match; all interrupted links must recover before host resume. A permanent departure or kick ends that match safely for everyone, instead of silently replacing a human with a bot. Returning to setup creates a fresh session.

## Protocol and security additions

`party-room.js` delegates six-character rooms through the existing `PongRoom` class and `ROOMS` binding. There are no new migrations, bindings, provider accounts, billing changes, or secrets. The private-room namespace is separate from classic rooms and matchmaking. Deploy the updated Worker before publishing new clients; preserve migrations v1/v2/v3 and all existing secrets and settings.

A host-centred star reuses `KingPongRoom` independently for each guest: direct ICE first, existing eight-second relay fallback, existing 45-second negotiation timeout, and an eight-second interruption recovery window. Working active connections are not switched. Manual LAN uses the same browser transport with an empty ICE-server list. There was no separate native TCP/UDP transport to migrate: the existing native LAN mechanism was already manual WebRTC.

Four-player data uses a separate `k4` version-1 protocol, full compact snapshots at 20 Hz during play (4 Hz paused), bounded intent input, and reliable control/init messages. The simulation remains 60 Hz. Initial state is acknowledged by every guest before the countdown advances, with bounded bootstrap retries. Snapshots include a match token, generation, authoritative tick/epoch, event sequence, and per-peer input acknowledgement; each snapshot independently restores state after loss. Guests interpolate snapshots and predict only their own paddle. The host alone runs ball/obstacle collisions, powerups and scoring. No client slot number in a gameplay packet can override its connection’s assigned slot.

Classic `kp` version-1 packets and legacy JSON remain supported. An optional `inputIntent: 1` hello capability lets updated peers send movement intent while retaining the same compact tuple format. Networked paddle movement is bounded by the existing movement speed, including touch and combined keyboard/controller input. Older peers keep their position-input path; the updated host still bounds movement. Updated action packets carry sequence numbers; older clients retain their original action rate gate.

Input replay, non-finite/out-of-bounds values, unexpected packet shapes, unauthorized state/score messages and floods are dropped. Token buckets allow bursts and recover after stalls; network loss alone does not cause a cheat ban. Server admission, pending approval, host-only moderation, capacity and start conditions are enforced in the Durable Object. A kicked/rejected client’s random session token is blocked for that room’s remaining lifetime. Clearing session storage or changing clients can evade that block; it is deliberately not a permanent identity or global ban. The host itself is trusted, as in the original architecture. Campaign unlocks remain local-save progression, not an account-backed entitlement service.

**Show connection type** is optional and off by default. It reads the selected ICE candidate pair from `getStats()`, with a conservative nominated-pair fallback. Relay candidates report TURN; reflexive candidates report direct internet; selected private-address host pairs report direct local. Redacted/mDNS or ambiguous evidence reports Unknown. Private-address evidence cannot distinguish a physical LAN from a VPN’s private routed network. No candidate addresses are displayed, logged or sent to analytics. This classification never initiates a transport change.

Additional checks: `node --test tests/four-*.mjs`, `npm run test:four`, `npm run test:four-network`, and the private-room tests included in `npm test`. The four-player network browser suite runs real Worker/WebSocket signaling and production game/channel code with controlled data delivery; it does not measure ICE/TURN connectivity. Actual LAN-isolated, cross-network, mobile/native, high-refresh hardware and TURN-required scenarios still need device testing.
