# King Pong internet multiplayer

The browser flow is **Online Multiplayer → Create Room → share five characters → Join Room → play**.
Both players use the same GitHub Pages game URL. There are no player accounts.

This implementation is not deployed by the source changes alone. Complete the
Cloudflare configuration below, set the public signaling URL, and publish the
browser files. No permanent TURN credentials belong in GitHub or browser code.

## What was reused

Audit base: `0f766d37052f08d601342bba844afd2c46298850`.

| Existing implementation | Upgrade |
| --- | --- |
| Browser game: `docs/demo/index.html`; `docs/index.html` embeds it | Same game and public URLs |
| `RTCPeerConnection({iceServers:[]})`; host creates `pong-lan-input-v1`, guest receives `ondatachannel` | Same WebRTC gameplay channel, with automatic signaling |
| Manual base64 JSON offer/answer, room tag, SDP with gathered ICE; waits up to 1.8 seconds before copying | WebSocket offers/answers and trickled ICE; no connection text UI |
| Host runs ball physics, paddle collisions, hazards, scoring, levels, pause and game state | Host still runs all of these; Cloudflare runs no simulation |
| Guest sends `{v,type:'input',room,seq,axis,targetY}` about 30 times/second | Reuses input messages and the existing absolute target supported by touch controls |
| Host sends `{v,type:'state',room,seq,...}` about 20 times/second from the 60 Hz simulation | Same snapshots, plus `inputSeq` to reconcile the guest paddle |
| `state` includes both paddles/scores, ball, hazards, level/campaign, pause/countdown, serve/end flags and text | Same fields and application logic |
| Guest sends `action` (`serve`, `pause`, `retry`) through the same unordered channel | Same actions use an additional ordered, reliable WebRTC channel |
| Unordered gameplay channel, `maxRetransmits:1`, increasing sequence rejection, 64 KiB send-buffer guard, stale input stops after 1.2 seconds | Preserved; local guest paddle responds immediately and reconciles accepted host position |
| Guest applies snapshots; no rollback, clock-offset estimation, interpolation or lag compensation | Ball remains snapshot-driven; physics not redesigned |
| Disconnect flags clear; no ICE restart, room service or resume protocol; a disconnected guest could fall into local simulation | Freeze the match, clean up connections, show a readable error; a transient ICE interruption has an 8-second recovery window |
| Four copied HTML implementations with substantially the same LAN code, not one imported module; Windows/Linux HTML identical | Browser changes only. Native LAN code and all platform versions unchanged |

The browser's unused guest-paddle movement branch is now called. Input remains
bounded by the playfield; the host applies it and owns all collision results.
The guest keeps movement performed since the acknowledged input instead of
snapping back to an old snapshot. This reduces control delay, not internet RTT.

## Cloudflare components

- One Worker, `king-pong-signaling`.
- One SQLite Durable Object namespace bound as `ROOMS`, class `PongRoom`.
  Its instances are keyed by random five-character room code. The alphabet has
  32 characters, excluding `I`, `O`, `0`, and `1` (33,554,432 possible codes).
- One rate-limit binding, `ROOM_LIMITER`, for 20 room requests/minute/IP per
  Cloudflare location. Choose an unused `namespace_id` if `702601` is already
  used in your account.
- A Cloudflare Realtime TURN key, created manually in your account.

No KV, D1, game server, user database, analytics, matchmaking, chat, or tracking.
The SQLite binding supports Durable Object state/alarms; there is no application
SQL schema or game-state database. WebSockets use Cloudflare's hibernation API.

The Worker accepts `GET /v1/create` and `GET /v1/join/XXXXX` WebSocket upgrades
only from configured origins. A room atomically admits one host and one guest.
It forwards bounded SDP and ICE messages only to the other player. Signaling
has per-socket message limits and accepts the correct SDP role only.

## Account setup and secrets

1. In Cloudflare, enable Workers for your account and choose a `workers.dev`
   subdomain when prompted. SQLite Durable Objects can be used on the Workers
   Free plan, subject to its quotas. Check your account's current usage limits.
2. Open Cloudflare **Realtime / TURN**, create a TURN key, and retain its key ID
   and the API token authorized to generate credentials for that key. Use the
   TURN key's token, not a Global API Key.
3. Review TURN pricing and your account's billing/usage settings before making
   the game public. TURN traffic can incur charges; a free static host does not
   make every relay connection free.
4. Install Node.js 24 and use a terminal in this repository.

| Setting | Location | Value to supply |
| --- | --- | --- |
| `TURN_KEY_ID` | Worker secret | Your Realtime TURN key ID |
| `TURN_API_TOKEN` | Worker secret | Token authorized to generate credentials for that key |
| `ALLOWED_ORIGINS` | `signaling/wrangler.jsonc` → `vars` | Already `https://kingalexgilbert.github.io`; comma-separated exact origins if adding another host; no URL paths |
| `KING_PONG_SIGNALING_URL` | `docs/demo/online-config.js` | Public HTTPS Worker URL printed by deployment |

No Cloudflare deployment/account token is required in the browser. Wrangler's
interactive login is for the developer deploying the Worker, not for players.
If your login has multiple accounts, select the intended account or set the
non-secret `account_id` in `wrangler.jsonc`.

## Exact deployment commands

From the repository root:

```sh
cd signaling
npm ci
npm test
npm run check
npx wrangler login
npm run deploy
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

The two `secret put` commands prompt for values; paste them at the prompts.
Do not place values in shell command arguments, source files, issue comments,
or client configuration. `secret put` deploys the secret change to the Worker.
Wrangler creates the Durable Object namespace and applies its `v1` migration
from `wrangler.jsonc`; no manual database creation is needed.

Edit `docs/demo/online-config.js` to use the exact URL deployment printed:

```js
window.KING_PONG_SIGNALING_URL = 'https://king-pong-signaling.YOUR-SUBDOMAIN.workers.dev';
```

`YOUR-SUBDOMAIN` is a placeholder, not a usable deployment. This file remains
empty in the delivered code because your account's Worker URL is not known.
Single-player/local modes continue to work while online play is unconfigured.

After reviewing the changes, publish them through your normal GitHub process.
For example, from the repository root on your working branch:

```sh
git add .gitignore .github/workflows/tests.yml README.md docs/demo/index.html docs/demo/online-config.js docs/demo/online-localization.js docs/demo/online.js signaling tests/online-networking.mjs
git commit -m "Add browser room-code internet multiplayer"
git push -u origin HEAD
```

If this is a feature branch, merge it into the branch GitHub Pages publishes.
The patch does not push, merge, or change your GitHub account settings itself.

### GitHub Pages configuration

If the site already publishes **`main` / `/docs`**, no setting change is needed.
Otherwise use **Repository → Settings → Pages → Build and deployment → Deploy
from a branch → `main` → `/docs` → Save**. Keep your existing custom domain if
one is configured, and add its exact HTTPS origin to `ALLOWED_ORIGINS`.

Publish the entire `docs` folder, including the three new JavaScript files.
There is no frontend build command, npm install, framework or bundler.

- Existing landing page: `https://kingalexgilbert.github.io/king-pong/`
- Direct game (simplest link to send): `https://kingalexgilbert.github.io/king-pong/demo/`

No Pages environment variables or Pages secrets are needed. TURN secrets live
only on the Worker. The included CI job tests/builds locally; it does not deploy.

## STUN, TURN and room lifetime

The first attempt uses `stun:stun.cloudflare.com:3478`. If the direct connection
fails or has not opened both DataChannels after 8 seconds, the room requests
TURN credentials once for each player. The Worker calls Cloudflare's credential
API with a 7,500-second TTL. Only temporary credentials are returned to the two
room sockets. The next attempt uses `iceTransportPolicy:'relay'` and Cloudflare's
returned UDP/TCP/TLS relay URLs; browser-blocked port 53 is removed.

Permanent credentials never reach the browser. SDP, ICE and TURN credentials
are not written to room storage or application logs. WebRTC DataChannel traffic
remains encrypted through TURN; the Worker never receives gameplay packets.

- Waiting room: 10 minutes maximum.
- Negotiation: client timeout 45 seconds; server lease 60 seconds after guest joins.
- Playing room: 2 hours maximum, measured from guest admission.
- Clean departure: closes both room sessions and deletes room data.
- Abrupt network loss: client heartbeat and WebRTC failure handling stop the
  session; server lease cleanup detects abandoned sockets within about 135
  seconds. Hibernating sockets answer 20-second `ping`/`pong` messages without
  waking the Durable Object.
- Refresh/reload, returning to the title screen, or leaving the game ends the
  room. Create/join a new room to play again; no saved online session or host migration.

Cloudflare can observe transport metadata needed to provide signaling/TURN.
Direct WebRTC exposes network addresses to the other peer. Short room codes are
invitations, not passwords. Origin checks and rate limits reduce abuse but do
not authenticate players or impose a hard spending cap against distributed abuse.

## Local tests

From the repository root:

```sh
node --test tests/*.mjs
python -B -m unittest discover -s tests -p 'test_*.py'
cd signaling
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
```

On Linux CI, use `npx playwright install --with-deps chromium` if browser system
libraries are missing. The browser test starts its own local static server and
Worker, temporarily supplies a local signaling URL, and uses two independent
Chromium contexts. It never changes the deployed configuration or requires
Cloudflare secrets.

For an interactive local check, from `signaling`:

```sh
npx wrangler dev --var ALLOWED_ORIGINS:http://localhost:8000
```

In another terminal from the repository root:

```sh
python -m http.server 8000 --directory docs
```

Temporarily point `online-config.js` at `http://127.0.0.1:8787`, visit
`http://localhost:8000/demo/`, and restore the production HTTPS URL before
publishing. To test real Cloudflare TURN locally, create an ignored
`signaling/.dev.vars` with the same two secret names; never commit its contents.

The automated browser test can also use a TURN server supplied by the tester:
set `KING_PONG_TEST_TURN_URL`, `KING_PONG_TEST_TURN_USERNAME` and
`KING_PONG_TEST_TURN_PASSWORD` in the test environment, then run
`npm run test:browser`. It deliberately gives the first attempt no usable ICE
candidates and asserts that the selected candidate on the retry is `relay`.
Only the test Worker substitutes that server for the Cloudflare credential API.
No test relay or diagnostic switch is included in the public game.

## Two genuinely different networks: final acceptance test

1. Publish the Worker/secrets and Pages files. Hard-reload the public game on
   both devices to clear any cached old scripts.
2. Device A: desktop/laptop on home Wi-Fi. Device B: phone with **Wi-Fi turned
   off**, using cellular data. Two tabs or two devices on the same Wi-Fi do not
   prove internet connectivity.
3. On A choose Online Multiplayer → Create Room. Send the five-character code
   and the direct public game URL to B. On B choose Join Room, enter the code,
   and Join. Neither player should see SDP, ICE or a browser alert.
4. Confirm both connect. Host is left paddle; guest is right. Either can use
   W/S or arrows; touch/controller input follows the existing controls. Serve
   with Space or the existing on-screen controls. Keep the host tab visible.
5. Play several rallies, pause/resume, retry, and compare scores/level changes.
   Check rapid guest paddle reversals. At least one test should use a mobile
   browser rather than only desktop Chromium.
6. Try an invalid code, a valid-looking absent code and a third device joining
   the full room. Close the guest, then repeat with the host closing. Try a new
   room immediately afterward. Check disabling/re-enabling connectivity.
7. Prove the **deployed** relay path too. On a Chromium desktop, open
   `chrome://webrtc-internals` before the game; on Firefox use `about:webrtc`.
   While the host is waiting and before the guest joins, a developer can run
   this temporary console snippet on **both** game pages to force the initial
   attempt to have no usable candidates:

   ```js
   {
     const NativePeer = window.RTCPeerConnection;
     window.RTCPeerConnection = class extends NativePeer {
       constructor(config) {
         super(config.iceTransportPolicy === 'all'
           ? { iceServers: [], iceTransportPolicy: 'relay' }
           : config);
       }
     };
   }
   ```

   Join normally. Expect the relay message after about 8 seconds, then a
   connection. Confirm the selected ICE candidate is `relay` in browser
   diagnostics and actually play a match. Reload afterward to remove the
   temporary test override. If testing on a phone without a console, use a
   second laptop on that phone's cellular hotspot (separate from A's Wi-Fi).
   Also try a restrictive school/work network when available to exercise the
   provider's TCP/TLS alternatives, which a UDP-only local relay cannot prove.
8. Return to the title screen and verify campaign/local two-player play, save
   selection, language, controls and audio on the final published build.

## Validation and remaining limits

See [VALIDATION.md](VALIDATION.md) for the recorded checks and exact scope.

This is ready for deployment and real-network acceptance testing. It should not
be described as contest-ready until the public URLs, real Cloudflare TURN
credentials, mobile behavior and two-network test above have passed.

Relevant platform documentation:
- [Durable Object WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Temporary TURN credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [TURN service and pricing](https://developers.cloudflare.com/realtime/turn/)
- [Rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Durable Objects plans and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
