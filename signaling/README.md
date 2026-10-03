# King Pong internet multiplayer

The browser flow is **Online Multiplayer → Create Room → share five characters → Join Room → play**.
Both players use the same GitHub Pages game URL. There are no player accounts.

This implementation is not deployed by the source changes alone. Complete the
Cloudflare and Metered configuration below, set the public signaling URL, and
publish the browser files. Permanent Metered credentials belong only in Worker
secrets, never in GitHub, browser code, `.env` or `.dev.vars` files.

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

## Services and components

- One Worker, `king-pong-signaling`.
- One SQLite Durable Object namespace bound as `ROOMS`, class `PongRoom`.
  Its instances are keyed by random five-character room code. The alphabet has
  32 characters, excluding `I`, `O`, `0`, and `1` (33,554,432 possible codes).
- One rate-limit binding, `ROOM_LIMITER`, for 20 room/setup requests/minute/IP per
  Cloudflare location. Choose an unused `namespace_id` if `702601` is already
  used in your account.
- One additional SQLite Durable Object namespace, `TURN_CREDENTIALS`, class
  `MeteredTurn`. A single instance caches expiring Metered credentials and rotates
  them with Durable Object alarms. It contains no player or game state.
- A Metered TURN free account/app; no Cloudflare Realtime TURN subscription.

No KV, D1, game server, user database, analytics, matchmaking, chat, or tracking.
The SQLite binding supports Durable Object state/alarms; there is no application
SQL schema or game-state database. WebSockets use Cloudflare's hibernation API.
The original `v1` room migration is preserved; `v2` adds only the credential cache.

The Worker accepts `GET /v1/create` and `GET /v1/join/XXXXX` WebSocket upgrades
only from configured origins. A room atomically admits one host and one guest.
It forwards bounded SDP and ICE messages only to the other player. Signaling
has per-socket message limits and accepts the correct SDP role only.

## Account setup and secrets

1. In Cloudflare, enable Workers for your account and choose a `workers.dev`
   subdomain when prompted. SQLite Durable Objects can be used on the Workers
   Free plan, subject to its quotas. Check your account's current usage limits.
2. Sign up for [Metered TURN](https://www.metered.ca/stun-turn) or
   [Open Relay](https://www.metered.ca/tools/openrelay/) using the free,
   no-credit-card option. Choose your app/workspace, then open **Developers →
   Reveal** to obtain its **Secret Key**. Use the application Secret Key, not a
   credential's API Key and not a Realtime Messaging key. Do not create a
   permanent TURN username/password for the browser.
3. Note the app name from `https://YOUR-APP.metered.live`. Leave billing,
   paid upgrades and automatic top-ups disabled. Metered's main TURN page
   currently advertises a 500 MB/month free trial with REST API access; Open
   Relay separately advertises 20 GB/month. Check the actual allowance shown
   for your account rather than assuming either quota. This code uses the free
   `standard` region and only the create-credential and single-credential APIs;
   it does not require Projects or the paid-plan credential-listing API.
4. Install Node.js 24 and use a terminal in this repository.

| Setting | Location | Value to supply |
| --- | --- | --- |
| `METERED_APP_NAME` | Worker secret | Just `YOUR-APP` from `https://YOUR-APP.metered.live`, without the scheme, dots, domain suffix or path; this identifier is not sensitive but is kept in server configuration |
| `METERED_SECRET_KEY` | Worker secret | The selected Metered app's **Developers → Secret Key**, used by the backend to create expiring credentials |
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
npx wrangler secret put METERED_APP_NAME
npx wrangler secret put METERED_SECRET_KEY
```

The two `secret put` commands prompt for values; paste them at the prompts.
Do not place values in shell command arguments, source files, issue comments,
or client configuration. `secret put` deploys the secret change to the Worker.
Wrangler creates the Durable Object namespaces and applies the migrations from
`wrangler.jsonc`; no manual database creation is needed. If upgrading the prior
Cloudflare TURN deployment, keep its `v1` migration and deploy the included `v2`.
After switching, remove the obsolete secrets if you previously configured them:

```sh
npx wrangler secret delete TURN_KEY_ID
npx wrangler secret delete TURN_API_TOKEN
```

Before publishing online play, initialize the credential cache using your real
Worker URL (replace the placeholder):

```sh
curl "https://king-pong-signaling.YOUR-SUBDOMAIN.workers.dev/v1/turn/ready"
```

On Windows PowerShell, use `curl.exe` for that command. The first response is
normally HTTP 503 with `{"ready":false}`: one expiring credential has been
created and is waiting to propagate. **Wait at least two minutes**, then run the
same command again. Publish only after it returns HTTP 200 with `{"ready":true}`.
The endpoint never returns keys or ICE credentials. It also starts the daily
alarm schedule, which continues without players visiting the game. No Cron
Trigger or manual daily credential rotation is required.

If readiness stays false, check the app name, Secret Key, free TURN plan and
available credential slots in Metered. After a provider error, retry is delayed
15 minutes to avoid repeated credential creation; leave the Worker running and
check again after that interval. Do not delete current rotating credentials:
their normal expiry provides cleanup without interrupting active games.

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

The first attempt still uses `stun:stun.cloudflare.com:3478`. If the direct
connection fails or has not opened both DataChannels after 8 seconds, the room
reads a prepared Metered credential from the cache and sends the same temporary
ICE server array to its two players. The next attempt uses
`iceTransportPolicy:'relay'`. All returned TURN UDP/TCP/TLS alternatives are
retained, except browser-blocked port 53; Metered STUN entries are discarded so
Cloudflare remains the direct-discovery STUN provider.

The cache creates credentials with `expiryInSeconds: 172800` (48 hours), rotates
every 24 hours and waits **at least 120 seconds after creation completes** before
fetching/publishing the new credential's ICE array. The previous credential
continues serving new rooms during propagation or a provider outage. Old
credentials expire at Metered; they are never deleted early at rotation or room
exit. Every credential issued to a new room must have more than 2 hours and 5
minutes left, covering the maximum match and a safety margin. No new credential
is created when a player clicks Create/Join or requests relay fallback.

Only the application Secret Key is permanent. It is read from Worker secrets
and used on server-to-server requests to the validated Metered app hostname;
redirects are not followed. Expiring credential keys/ICE arrays live in the
singleton Durable Object, not room storage or application logs. Metered's
credential-scoped API Key stays server-side too; browsers receive only the
temporary username/password and TURN URLs. Reusing one rotating credential
across rooms avoids per-player creation and free-plan credential-cap pressure.
No provider SDK or additional npm dependency is required.

If the cache is uninitialized, too close to expiry, or cannot supply credentials,
players get the existing friendly relay-unavailable message. Direct connections
remain independent of Metered. A quota exhaustion or revocation at Metered can
still prevent relays even when the cache is ready. WebRTC traffic remains
encrypted through TURN; the Worker never receives gameplay packets.

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

Cloudflare and Metered can observe transport metadata needed for their services.
Direct WebRTC exposes network addresses to the other peer. Short room codes are
invitations, not passwords. Origin checks and rate limits reduce abuse but do
not authenticate players or prevent distributed abuse of the free relay quota.
Expiring relay credentials are shared across rooms for up to 48 hours; someone
who obtains one may reuse it until expiry. Do not enable paid overages/top-ups if
you want to remain on the no-payment setup.

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
publishing. This local setup can test direct connections without Metered secrets.
For real Metered relay testing, use a deployed Worker with its two Worker
secrets and a ready credential cache. Do not copy the real app Secret Key into
local files. The automated suite uses fake provider keys only.

The automated browser test can also use a TURN server supplied by the tester:
set `KING_PONG_TEST_TURN_URL`, `KING_PONG_TEST_TURN_USERNAME` and
`KING_PONG_TEST_TURN_PASSWORD` in the test environment, then run
`npm run test:browser`. It deliberately gives the first attempt no usable ICE
candidates and asserts that the selected candidate on the retry is `relay`.
Only the test Worker substitutes that server for Metered's ICE response and
advances the propagation timestamp. Separate clock-driven tests verify the full
120-second delay, daily overlap, expiry margin, provider errors, concurrency and
restart behavior. Wrangler deploys the production entrypoint, which has no test
controls. No test relay or diagnostic switch is included in the public game.

## Two genuinely different networks: final acceptance test

1. Publish the Worker/secrets, complete the readiness check, and publish Pages.
   Hard-reload the public game on
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
be described as contest-ready until the public URLs, real Metered TURN
credentials, mobile behavior and two-network test above have passed.

Relevant platform documentation:
- [Durable Object WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Metered credential rotation and propagation](https://www.metered.ca/docs/turnserver-guides/rotating-turn-credentials/)
- [Create expiring Metered credentials](https://www.metered.ca/docs/turn-rest-api/post-create-credential/)
- [Retrieve the ICE array](https://www.metered.ca/docs/turn-rest-api/get-credential/)
- [Metered free-plan region](https://www.metered.ca/docs/turnserver-guides/turnserver-regions/)
- [Metered plans](https://www.metered.ca/stun-turn) and [Open Relay](https://www.metered.ca/tools/openrelay/)
- [Rate limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Durable Objects plans and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
