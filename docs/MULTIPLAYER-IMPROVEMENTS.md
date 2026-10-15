# King Pong — Multiplayer implementation report

Implementation based on `8930c42` (`main`, merge of the two-player cleanup). The starting checkout was clean. Recent commits, removed perspective code, canonical synchronization, native wrappers, save format, signaling and baseline tests were reviewed before modification. Baseline: 388 JavaScript tests and 25 signaling tests passed.

The requested changes are implemented in the working tree and accompanying patch. **The updated Worker must be deployed before releasing these clients.** No deployment, push, secret change or account configuration was performed. Real WebRTC connectivity could not be verified in this execution environment; the distinction between real signaling, controlled gameplay channels and physical-device testing is detailed below.

## Approval and moderation

The original approval failure was a verified deployment mismatch. A valid WebSocket request to the configured live Worker at `/v1/party/create/2/1/<temporary-session-UUID>` upgraded successfully, then returned `{"type":"error","code":"invalid_code"}`. The live `/v1/native-bridge` route allowlist also omitted party paths. The repository already contained both the party routes and the updated native bridge. Previously, unchecked approval used `/v1/create`, while checked approval selected the newer party route. This was not a room-code generation defect.

New players now default to approval enabled. Explicit true/false choices are saved in the existing save slot and restored when reopening setup or restarting. Missing/invalid local values use sensible defaults; saved false is not mistaken for missing data.

Both new approval modes now use `/v1/party/create/2/{0|1}/<session-token>` and six-character room codes. The same existing `PongRoom`/`PartyRoom` moderation path enforces admission, approval, rejection and kick. Legacy five-character join codes remain recognized, but both clients need the current private setup handshake; incompatible clients fail safely with the reload message. A stale server produces an explicit server-out-of-date message, never a silent downgrade to an unapproved room.

Join requests use the existing large, keyboard-accessible confirmation dialog with Accept/Reject. The host sees **Kick Player** immediately after **Menu** in the arena bar; guests, matchmaking, LAN and solo/local contexts do not. A confirmation pauses play; cancellation leaves the match safely paused with Resume available. The Match Menu control is retained. Confirmation during setup withdraws host readiness and cancels a running countdown.

Kicks use the existing server command. A bounded acknowledgement wait prevents early WebRTC close/error events from tearing down the host room during removal. The guest receives the removal reason; the host retains the room code and can admit a replacement. The server clears the departed peer's started state and keeps its blocked-session list. At the bounded list limit, new admissions fail closed.

The existing sessionStorage token is cached in memory so repeated attempts cannot silently mint new tokens when storage is denied or changes during the running page. It is not placed in local save slots or backups. Blocking identifies a room/session, not a person: a fresh browser profile/device or cleared storage after a reload cannot be correlated without introducing identity tracking. No account, fingerprinting or extra service was added.

## Preference audit and save compatibility

All applicable game settings use the existing localStorage/save-slot mechanism; no competing persistence store was introduced. Existing version-2 slots and version-1 backup envelopes remain compatible. Import validates optional new fields, preserves progress and all three slots, and retains the existing transactional recovery behavior. Loading preferences does not write over a slot. Only explicit local choices save preferences; remote rules and matchmaking assignments remain transient.

| Setting / preference | Scope and behavior |
| --- | --- |
| Music enabled and volume | Existing per-slot persistence retained; zero volume remains valid. |
| Sound Effects and Mute All | Existing per-slot persistence retained; mute does not overwrite underlying music/SFX choices. |
| CPU intelligence and maximum movement | Existing per-slot persistence retained. |
| Campaign/custom paddle and arena selections | Existing per-slot fields and unlock checks retained. |
| Multiplayer own/second paddle | New separate per-slot preferences; all multiplayer cosmetics remain available without changing campaign unlocks. |
| Quick / Classic / Win by Two / Endless | Explicit local choices now persist per slot; Classic is the missing-value default. Guest and queue overrides never save. |
| Private Royal Powerups | New per-slot preference, default On. Offline LAN, same-device and automatic matchmaking keep their established powerup rules. |
| Host Approval | New per-slot preference, default On; explicit Off survives restart, reopening, import/export and slot changes. |
| Show connection type | New per-slot preference, default Off; addresses/credentials/stats are not saved. |
| Goal/course information visibility | New per-slot preference, default visible; starting Campaign no longer resets it. |
| Selected save slot | Existing application-wide remembered slot retained. |
| Language | There is no in-game language selector to persist. Existing automatic browser/OS language selection is retained; all nine translation tables plus English remain supported. |
| Controls | Keyboard, touch/pen and controllers are detected dynamically. There are no configurable bindings, sensitivity or inversion settings in this implementation. |
| Reduced motion / display scaling | Existing OS/browser reduced-motion and viewport/DPR behavior retained; no independent game setting exists. |
| Portrait prompt, fullscreen, open menus, pause/readiness | Temporary UI/session state; not converted into permanent preferences. Portrait dismissal remains scoped to the current play session. |
| Scores, connections, room codes, authentication/match tokens | Temporary match state; never added to save preferences or exports. |

All four HTML builds were tested with real browser reloads, slot changes, import/export and temporary online overrides. Their existing browser/WebView storage origins and native save pickers are unchanged. Persistence cannot be guaranteed if a browser/OS denies, clears or discards application storage; this patch preserves the existing safe in-memory behavior and does not add another storage service. Actual native application restarts were not exercised.

## Private arena entry and synchronized start

Private rooms reuse `online-match-flow.js`, the existing reliable control channel and host countdown. After admission, both clients automatically leave setup and enter the arena while negotiating. The guest receives the host's selected arena, both paddles, rule preset and powerup flag. It acknowledges the exact configuration only after an authoritative initial snapshot is available. The host waits for that acknowledgement and the hello exchange before exposing Ready.

Both players must confirm. Private readiness can be undone before countdown; delayed withdrawal also cancels an unsafe countdown. Stale/duplicate status messages are rejected, selections cannot alter an acknowledged ready configuration, and the guest never starts merely because its local timer elapsed. The host's existing 3/2/1/GO messages release gameplay. Connecting/readiness/countdown cancel cleanly on exit or disconnect. Replacement guests get a fresh handshake and cleared rally effects. Existing pause/resume and rematch mechanics remain in place.

The private overlay displays arena, preset and Royal Powerups On/Off. Underlying pause/serve overlays are suppressed during setup, preventing duplicate countdown or PAUSED text. Automatic matchmaking retains Classic, its chosen arena, powerups On and its existing single-confirmation behavior.

## Menus, rendering and Royal Powerups

Mode setup Back buttons, the Match Menu Back button and browser LAN Back button now share the Online Play top placement and styling. Desktop, portrait and landscape layouts were tested. Short landscape layouts use compact choice cards so the new top row does not clip the Change affordances. Existing navigation destinations, safe-area reservations and responsive canvas scaling remain intact.

**Royal Powerups already worked online.** The original `royalActive`, host update/collision/collection functions, `packRoyalState`/`applyRoyalState`, interpolation and compact wire handling already synchronized Royal Split, Crown Rush and Castle Guard. That simulation was preserved. The new private-room toggle uses the existing reliable rule message plus initial configuration acknowledgement. It is locked once initialization/readiness or active gameplay begins; a guest cannot change host rules. Disabled games neither spawn nor award effects. Disabling at a permitted setup point clears old rally effects.

The powerup flag is not added to every compact snapshot. Snapshots retain their original preset/revision tuple; the reliable rule/configuration messages carry the boolean. Existing host simulation, effect lifetimes, collisions, scores, 20 Hz state cadence and optimized rendering remain unchanged.

The rendering defect was draw order: Royal effects were painted before the score digits. The canonical draw function now paints scores first, then Royal effects once, preserving sprites, glow, ripple and pickup geometry. No extra canvas or rendering pass was added.

## Local player on the left

History inspection found `twoPlayerRelativeView` / `twoPlayerViewRotated` in commit `416f9b8`, coupled to `four-view.js` and `four-integration.mjs`. Commit `dd1c841` removed them during four-player cleanup; the final baseline no longer contained the transformation. The old two-player option defaulted off and used a 180-degree rotation, including vertical inversion. Restoring that entire integration would conflict with the requested horizontal-only perspective and reintroduce removed functionality.

The implementation reuses the old presentation boundary concept, with a small two-player-only horizontal reflection: `translate(W, 0)` followed by `scale(-1, 1)` for a connected guest. Online private rooms, automatic matchmaking and device-per-player LAN share the existing side assignment predicate. Hosts and same-device/solo modes retain their normal view.

Background, moving hazards, paddles, primary/Split balls, rush trails, pickup/ripple effects, shields and the prediction marker use the same reflected world frame. Scores swap sides without reflecting glyphs; shield duration text and result messages remain readable and correctly associated with the players. Ball sprite sizing uses absolute scale magnitudes so the negative X transform does not shrink the glow/core.

World X/Y, authoritative scoring, collision detection, snapshots, interpolation and network packets do not change. Vertical keyboard/controller and touch/pen drag controls still operate on the assigned world paddle; only its screen position changes. Mouse retains its existing menu behavior (it was not a mouse-motion paddle control). No additional gameplay state is transmitted and no four-player code is restored.

## Validation actually performed

Commands below run from the root unless marked `signaling/`. Counts refer to tests/groups/runs as emitted by each suite, not interchangeable assertions.

| Check | Result |
| --- | --- |
| `node --test tests/*.mjs` | **405 passed**, 0 failed. Baseline 388; new coverage includes preferences/import validation, disabled effects, ready/configuration ordering, moderation races and stable temporary tokens. |
| `python -B -m unittest discover -s tests -p 'test_*.py'` | **22 passed**; native Linux adapter tests. |
| `signaling/`: `npm test` | **28 passed**, including real Miniflare WebSocket approval on/off, accept/reject/kick, unauthorized admission and same-session reconnect blocking. |
| `signaling/`: `npm run check` | Worker dry run passed; existing bindings and migrations unchanged. |
| `node tools/sync-gameplay.mjs --check`; `git diff --check` | Passed. Generated builds synchronized, without whitespace errors. |
| `test:preferences` | **9 groups passed**: four builds' restart/slot/backup/override tests, four builds' Canvas/perspective/input tests, responsive Back positioning. |
| `test:private-rooms-controlled` | **5 lifecycle groups passed** using multiple actual browser contexts and real Worker/WebSockets, with explicitly controlled RTC channels. Includes host settings/paddles/arena, rejection/kick/rejoin, retained-room replacement, countdown cancellation, layout and powerup synchronization. |
| `test:online-flow` | **17 groups passed**, including both roles across Browser/Windows/Linux/Android HTML, lost hello, ready/countdown, cancellation and late callbacks, controller/touch confirmation. Controlled channels. |
| `test:matchmaking-ui` | **7 groups passed** with real queue WebSockets, file-origin native bridge, SDP exchange and settings recovery. Explicit signaling-only mode; no gameplay data channel. |
| `test:gameplay` | **33 groups passed**. |
| `test:ui` | **43 groups passed**, including all nine translated phone layouts, save pickers/round trips, navigation and responsive controls. |
| `test:engineering` | **34 groups passed** with normal invocation. |
| `test:serve` | **48 groups / 480 controlled runs passed**, including LAN/online replay and regular/irregular timing at 60/120/144/165/240 Hz. |
| `test:network` | Four latency/loss/jitter/recovery scenarios passed. Measured host traffic about 4.5–5.0 KB/s at 20.1 messages/s in these fixtures; guest about 0.17–0.28 KB/s. |
| `test:ripple` | **192 rendered A/B runs passed**. |
| `test:appearance` | **408 browser checks passed**. |
| `test:powerup-ui` | **8 groups passed**. |
| `test:browser`, `test:private-rooms`, `test:matchmaking` | **Did not pass in this environment.** Real RTC connection waits timed out; the matchmaking diagnostic reported zero ICE candidates and no configured test TURN relay was available. These remain strict tests in CI; no real-channel assertion was replaced by a fallback. |

Actual Canvas regression checks cover mirrored interpolation at 60, 120, 144, 165 and 240 Hz, vertical keyboard/controller/touch movement, score/goal authority, world-state immutability, hazards/effects transforms, side reassignment and disconnected/solo isolation. Visual review covered the large approval dialog, guest ready/configuration overlay, host Kick placement at desktop/portrait/landscape sizes, and landscape Back/choice layout.

An optional `KING_PONG_TEST_ARTIFACTS` run of the existing engineering suite failed in its pre-existing sprite-export path (`royalPickupSprite(...).toDataURL`, where the sprite is an Image). The normal suite passed all 34 groups; that unrelated optional exporter was not changed. Existing assertions were retained; fixtures that formerly assigned unsaved rule variables or expected session-only paddle choices were updated to use the real saved-setting behavior and still assert campaign/other-setting isolation.

Not verified: physical Android/Windows/Linux wrapper execution, native-device restarts, real LAN/public-internet/forced-TURN gameplay, actual display refresh hardware or a production Worker rollout. Chromium loading platform HTML exercises shared code, not those native runtimes. Controlled timestamp tests establish rendering/physics consistency, not physical-panel smoothness.

## Deployment and patch use

Deploy the complete Worker first using the existing account/configuration:

```sh
node tools/sync-gameplay.mjs --check
cd signaling
npm ci
npm test
npm run check
npm run deploy
```

`signaling/wrangler.jsonc` keeps `ROOMS`/`PongRoom`, `TURN_CREDENTIALS`/`MeteredTurn`, `MATCHMAKING`/`MatchmakingQueue`, migrations v1/v2/v3, the origin allowlist and existing Metered secrets. There is **no new migration or service** for this work. Do not deploy just HTML: the party endpoints and `/v1/native-bridge` must come from this same Worker bundle. Then release the synchronized browser files, rebuild the packaged apps using existing build instructions, and reload both peers. Run the strict real-WebRTC suites and on-device private/LAN checks in a network-capable environment before release.

The accompanying patch includes source, generated builds, regression tests, CI entries and documentation. It is based on `8930c42` and can be reviewed/applied to that clean base with:

```sh
git apply --check KingPong-Multiplayer-Improvements.patch
git apply KingPong-Multiplayer-Improvements.patch
node tools/sync-gameplay.mjs --check
```

## Modified file groups

| Files | Purpose |
| --- | --- |
| `game/player-preferences.js`, `game/save-transfer.js`, `game/ui-integration.mjs` | Slot defaults, explicit autosave, restore and backward-compatible backup validation. |
| `game/online.js`, `game/network-common.js`, `game/multiplayer-safety.js` | Managed-room creation, stable ephemeral identity, approval dialog, Kick confirmation and retained host lifecycle. |
| `game/online-match-flow.js`, `game/royal-rules.js`, `game/matchmaking.js`, `game/online-engine.js`, `game/polish-integration.mjs` | Private initialization/ready/countdown, saved host powerups and reliable rules with unchanged compact snapshots. |
| `game/arena-perspective.js`, `game/arena-render.js`, `game/presentation-integration.mjs`, `game/royal-gameplay.js` | Horizontal presentation, upright UI, score/effect layering and separate multiplayer cosmetics. |
| `game/royal-ui.js`, `game/royal-menu.css`, `game/online-localization.js` | Shared Back layout, responsive moderation controls and all translated new strings. |
| `signaling/src/party-room.js` | Reusable host room after departure and bounded blocking that fails closed. |
| `tools/sync-gameplay.mjs`, four platform `index.html` files, `docs/demo/online.js`, `docs/demo/online-localization.js` | Canonical generation and synchronized platform assets; native wrapper implementations preserved. |
| `tests/multiplayer-preferences.mjs`, save/network tests and test harnesses | New unit regressions and existing fixture compatibility. |
| `signaling/test/preferences-browser.mjs`, `private-room-browser.mjs`, room/browser/matchmaking/UI tests, `signaling/package.json`, `.github/workflows/tests.yml` | New browser/Worker regressions, updated saved-setting fixtures and CI commands; real transport tests retained. |
| `game/README.md`, `signaling/README.md`, this report | Architecture boundary, deployment requirements, evidence and verification limits. |

No release-version bump, dependency upgrade, native wrapper change, collision redesign, new infrastructure, telemetry or credentials are part of this patch.
