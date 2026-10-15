# Matchmaking and signaling

Choose **Play Online → Find Match** to join the shared browser/Android/Windows/Linux queue. Viewing this menu only watches availability; it does not register a player as waiting. Searches stay active while connected, including when an opponent arrives several minutes later. Cancel Search, leaving the mode, closing the app, or backgrounding a waiting app removes the search. After a connection failure, press Find Match to try again. There are no CPU substitutes or estimated wait times.

**Create Room** and **Join Room** still use private five-character room codes. Native **Local Play → LAN Two Player** keeps the existing offline LAN workflow.

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
