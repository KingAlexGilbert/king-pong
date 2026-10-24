# Matchmaking and signaling

Choose **Play Online → Find Match** to join the shared browser/Android/Windows/Linux queue. Viewing this menu only watches availability; it does not register a player as waiting. Searches stay active while connected, including when an opponent arrives several minutes later. Cancel Search, leaving the mode, closing the app, or backgrounding a waiting app removes the search. After a connection failure, press Find Match to try again. There are no CPU substitutes or estimated wait times.

**Create Room** now uses six-character private room codes with Host Approval enabled by default. The approval choice is saved in the selected save slot. Both approval modes use the existing moderated room endpoint, so kicks and rejections block that browser/app session from rejoining the same room. Joining older five-character rooms is still recognized. Native **Local Play → LAN Two Player** keeps the existing offline LAN workflow.

After admission, private peers enter the arena automatically. The guest acknowledges the host's arena, paddles, rule preset and Royal Powerups setting after receiving an initial snapshot; both players then confirm Ready before the synchronized countdown. The host can undo readiness and can confirm **Kick Player** beside **Menu**. A kick releases the guest while retaining the host's room code. The private Royal Powerups preference is saved; automatic matchmaking, offline LAN and same-device matches retain their established powerup rules.

## Arenas and rules

Any Arena is the default. The server chooses the arena before either player connects:

- Same preference: that arena.
- Different preferences: a fair coin flip between the two.
- One Any Arena: the other player's preference.
- Both Any Arena: an unbiased random choice from the 18 campaign arenas.

The secret boss is excluded. Automatic matches use the existing **Classic Match — First to 10** preset. Both clients lock the assignment and reject conflicting host settings. Private rooms retain their selectable rules and arenas; the previous rule preset returns after an automatic match ends.

## Infrastructure

The existing Worker uses one SQLite-backed `MatchmakingQueue` Durable Object named `shared`. It pairs waiting sockets atomically and reserves a `PongRoom` using separate, random role tokens. Waiting, connecting, and watching are distinct states; only waiting players contribute to availability. Upgraded peers use one WebRTC ICE checklist with Cloudflare STUN and the existing Metered TURN configuration. After unsuccessful WebRTC recovery, the admitted room sockets can carry end-to-end encrypted gameplay. The shared queue never carries gameplay. See [the transport report](TRANSPORT.md) for root-cause findings, protocol/security details, limits and test results.

The queue uses hibernating WebSockets and automatic 20-second ping/pong heartbeats. A 75-second lease and 30-second cleanup alarm remove abandoned sockets (within about 105 seconds without a close event). A connection reservation expires after 60 seconds. Queue entries live in socket attachments, survive hibernation, and require no per-heartbeat database writes. An empty queue deletes its alarm and temporary storage. Connected peers leave the matchmaking queue after both report ready; the existing room lifecycle then owns cleanup.

Limits include 256 queue sockets, eight sockets per temporary IP hash, 20 application messages per socket per 10 seconds, and the existing Worker admission rate limit. No accounts, profiles, analytics, or persistent queue history are added. The IP hash is retained only with the temporary socket attachment; it is a rate-limit key, not an anonymity guarantee. Role tokens and complete assigned settings are disclosed only to the paired clients. Reserved rooms cannot be joined through the public private-code namespace.

Packaged games retain their original `file://` page and save origin. A small HTTPS iframe at `/v1/native-bridge` forwards signaling and opaque encrypted fallback frames over a bounded MessageChannel. Its CSP admits only file ancestors, it accepts only its opaque-origin parent, and paths/messages are restricted. Encryption keys, WebRTC and the game remain in the local page. Signaling continues to reject the `null` origin. Each native wrapper permits only this exact bridge URL; other remote navigation remains blocked.

## Build and deployment

1. From the repository root, run `node tools/sync-gameplay.mjs`. This updates the four HTML builds, browser online files, embedded native transport, optimized icon data, and the generated server compatibility contract.
2. Run `node tools/sync-gameplay.mjs --check` and `node --test tests/*.mjs`.
3. In `signaling/`, run `npm ci`, `npm test`, and `npm run check`. The last command is a deployment dry run.
4. When ready to release, deploy the Worker using the existing Cloudflare account with `npm run deploy`. Keep existing migrations v1/v2/v3 and all existing bindings/secrets. The private-room and encrypted-relay updates add no migration, Durable Object class or service: `PartyRoom` and `SecureRoomTransport` run inside `PongRoom` through the existing `ROOMS` binding.
5. Release the synchronized browser files and rebuild the native apps with their existing build commands. Deploy the Worker before distributing the updated clients.

`game/online-config.js` holds the public Worker URL. If using another Worker hostname, also update the exact `/v1/native-bridge` URL allowed by `Program.cs`, `MainActivity.java`, and `Linux/src/king-pong.py`, then synchronize and rebuild. Add browser hosting origins to `ALLOWED_ORIGINS`; never add `null` or a wildcard. Existing Metered secrets remain Worker-side and unchanged.

### Required private-room Worker update

Current clients advertise `/sas2` private-room and `/secure1` matchmaking transport support. Deploy the full current Worker/native bridge first. When only one client supports encrypted fallback, the room uses compatible legacy WebRTC. It never sends WebSocket gameplay to an old client or skips host approval to work around an old Worker. An old Worker may return a safe incompatibility/update error for these new routes.

An earlier deployment check found that the Worker accepted the WebSocket upgrade for a valid `/v1/party/create/2/1/<session UUID>` request but replied `invalid_code`. Its served `/v1/native-bridge` also omitted the party paths, although both implementations already existed in this repository. That deployment mismatch explained why approval-enabled creation failed while the old unchecked UI used the legacy `/v1/create` route. Do not work around it by silently disabling approval.

Deploy this complete Worker bundle **before** releasing these clients (both new room modes now require party endpoints):

```sh
cd signaling
npm ci
npm test
npm run check
npm run deploy
```

Use the existing Cloudflare account and `wrangler.jsonc`. Deploying only the game HTML is insufficient; `/v1/native-bridge` must come from the same updated Worker. Then verify create/join with approval both on and off, approval/rejection, kick/rejoin blocking and retained host rooms in two current clients. Refresh browser clients and rebuild packaged applications from the synchronized files. Production deployment and physical-device testing are separate release steps; they are not performed by the test commands above.

Room membership uses the existing temporary session token (sessionStorage, with an in-memory fallback when unavailable). Tokens, room details and connection state are excluded from save backups. Blocking covers that room/session, not a person who clears browser state or uses another device; identity tracking or accounts are deliberately not introduced. When the bounded block list is full, new joins fail closed rather than bypassing earlier blocks.

`tools/sync-online.mjs` derives eligible arenas from the existing `CAMPAIGNS` definitions and checks they match in every build. Its fingerprint includes those definitions, rule presets, and `game/matchmaking-version.json`. Increment that compatibility revision when changing gameplay/protocol behavior incompatibly, then regenerate and deploy both sides. Do not edit `matchmaking-contract.js` or embedded copies directly. Old automatic-match clients receive an explicit update/reload error. Existing release version numbers are unchanged.

## Validation

Direct IPv4/IPv6 and the existing Metered TURN configuration share one ICE
checklist. After unsuccessful WebRTC recovery, peers agree on encrypted
WebSockets. There is no additional provider attempt or extended admission
deadline. Worker bindings, migrations and the existing `METERED_APP_NAME` and
`METERED_SECRET_KEY` configuration are unchanged.

Validated gameplay frames and credits use the synchronous, storage-free relay
path. Admission, approval, kicks, key confirmation, transport transitions and
cleanup retain their concurrency gates. The credential cache keeps its separate
single-flight rotation, bounded API requests and 15-minute Metered usage checks;
confirmed quota exhaustion withholds new credentials until renewal, without
interrupting healthy connections. Unknown usage is never treated as confirmed
exhaustion. See [TRANSPORT.md](TRANSPORT.md) for encryption and recovery details.

- `npm test`: queue concurrency, fairness, cancellation, leases, room/token security, private rooms, and TURN credential/fallback tests.
- `npm run test:private-rooms`: real Worker/WebSocket admission, normal WebRTC attempts with production fallback, approval on/off, rejection/kick, reconnect restrictions, settings, readiness, layout and powerups.
- `node test/private-room-browser.mjs --websocket-fallback --transport-faults`: deliberately unavailable RTC; real encrypted browser WebSockets with delay/jitter/backpressure and reliable-command retries.
- `node test/private-room-browser.mjs --controlled-channels --transport-recovery`: controlled RTC failure/restart failure to real encrypted WS, preserving match identity and deduplicating controls.
- `node test/relay-benchmark.mjs [source-directory] [seconds=8] [warmup=2]`: local workerd and real TCP WebSocket throughput, forwarding/control latency, event-loop delay and bounded slow receivers; requires Node 24. Warm-up is excluded, sampling does not pace sending, and throughput uses observed elapsed time. Synthetic ciphertext-shaped frames exercise relay validation and flow control; encryption/admission and Cloudflare production CPU are not measured.
- `node test/relay-benchmark-pairs.mjs BEFORE_SOURCE OUTPUT_DIR [pairs=6] [seconds=8] [warmup=2]`: repeat both source versions in fresh processes, alternating before/after order. Keep other intensive work stopped; compare all runs in `OUTPUT_DIR/runs.json`, including stalls and skipped generation slots, rather than selecting the fastest run. Missing runtime resource measurements are `null`, not zero.
- `node test/private-room-browser.mjs --fallback-disconnect`: actual socket closure during fallback agreement, safe error and retained private host.
- `node test/private-room-browser.mjs --websocket-fallback --firefox`: Firefox fallback lifecycle; add `--public-powerups` to test all public powerup preference combinations instead of the private lifecycle.
- `npm run test:private-rooms-controlled`: the same two-browser lifecycle with an explicitly controlled RTC channel transport; real Worker/WebSocket moderation still runs. This does not validate ICE/TURN.
- `npm run test:preferences`: all four HTML builds, saved preferences across reload/slots/import/export, temporary host/matchmaking settings, Canvas perspective, vertical inputs, goals, rendering order, refresh-rate interpolation and responsive Back controls.
- `npm run test:matchmaking`: real browser-to-packaged-HTML matches in both roles for Windows, Linux, and Android. Reports the selected transport; an unavailable real ICE path can use the production WebSocket fallback.
- `node test/matchmaking-browser.mjs --websocket-fallback`: the same file-origin bridge and gameplay checks with RTC deliberately unavailable.
- `npm run test:matchmaking-ui`: explicit signaling-only mode for restricted environments. Tests real queue WebSockets, file-origin bridge traffic, SDP exchange, cleanup and immutable settings; it does **not** establish or validate a gameplay data channel.
- `npm run test:powerup-ui`: desktop/mobile title tiles, icon rendering, effective mute controls, translations, and real offline Web Audio samples.
- `npm run test:serve`: production canvas rendering at 60/120/144/165/240 Hz with regular/irregular timing, initial and repeated score serves, early collisions, Crown Rush, and LAN/online snapshot replay. Presentation times and packet delivery are controlled; this does not validate physical displays or a real network connection.
- `KING_PONG_TEST_ARTIFACTS=/absolute/output/path npm run compare:serve`: captures production-canvas PNG sequences and motion traces for the original 20%/one-second smoothstep, 40%/0.4-second linear, and 50%/0.3-second smoothstep curves. Curve overrides exist only in the test page.
- Existing `test:browser`, `test:gameplay`, `test:ui`, and `test:engineering` remain available. The private-room browser test supports its existing `KING_PONG_TEST_TURN_*` variables for a real forced-relay test.

Loading a native HTML file in Chromium validates shared page code and the bridge, not the actual Android WebView, Windows WebView2, or Linux WebKitGTK wrapper. Before releasing rebuilt applications, test online/private/LAN entry, bridge admission, background cleanup, network changes, audio/autoplay, and save persistence on those platforms. Real public-internet and TURN connections still require network-capable testing and the existing provider configuration.

Python discovery runs portable tests on every OS and explicitly skips the nine
Linux LAN networking cases elsewhere. The platform-selection tests reject
premature `fcntl` imports and ensure failures on supported platforms remain
errors. The Windows-only test compiles the production C# LAN core with .NET
Framework when available. The optional Java core test uses
`KING_PONG_JAVA_LAN_CLASSPATH`; missing native environments are reported as skips,
not passes. CI retains both Windows and Linux discovery. These core tests do not
substitute for physical-device or native WebView integration tests.

## Aggregate regression checks

From the repository root, `node tools/test.mjs standard` runs core checks and
every standard browser gate; `node tools/test.mjs release` adds the extended
release scenarios. Existing targeted npm scripts remain available. See
`../tests/README.md` for suite selection, timing reports and native/network
prerequisites.
