# Rendering, selections, and royal gameplay update

Implemented from main commit `26abcb5` on branch `improve-gameplay-rendering`.
Validation date: 2026-10-04. The previously completed networking implementation
and its production configuration are preserved. No version numbers changed.
These source changes have not been pushed, published, or deployed.

## Rendering and guest consistency

- Authoritative simulation remains fixed at 60 Hz. Active gameplay renders on
  every animation frame using separate previous/current visual snapshots.
  Ball, paddles, moving hazards, boss balls, and the split ball use interpolated
  positions. Collision, score, save, and network logic use simulation positions.
- Subpixel drawing replaces position rounding for moving geometry; the ordinary
  ball and pixel flame have no glow. Drawing no longer consumes gameplay random
  numbers or advances screen-shake duration. Rally, level, pause, and connection
  changes reset interpolation history instead of drawing across discontinuities.
- Guest rendering buffers host snapshots for 100 ms, keeps at most 12 entries,
  and gently adjusts playout speed for arrival variation. It never extrapolates
  or runs guest ball physics. A depleted buffer holds the latest state. Existing
  sequence rejection remains, with additional monotonic simulation-tick checks.
- The apparent missed-collision case was reproduced with timely versus late
  guest movement around paddle contact. Late input cannot retroactively save a
  ball. The guest's solid paddle now shares the ball's host timeline; a restrained
  gold outline at the field edge shows immediate local input. This removes the
  misleading presentation of a predicted paddle as the collision surface.
- Existing guest prediction/reconciliation remains for input. The host
  acknowledges input only after applying it. Axis reversals bypass the normal
  alternating-tick input throttle (still at most one input per simulation tick).
  No rollback, phantom collision, or guest collision authority was added.
- The existing title/hidden-tab idle behavior, paused draw cap of 10 Hz, and
  five-step catch-up cap are retained. High-refresh validation is simulated,
  not a claim of physical testing on every monitor rate.

## Saves, menus, and catalogs

The browser save loader now hydrates music enabled/volume before settings setters
run and suppresses writes during loading. Disabled music, zero volume, intermediate
volume, full volume, repeated slot switching, reload, and old saves are covered.
Existing progress, selected-slot keys, save version, and backup format are retained.
Selections add optional `royalPaddle`, `royalPaddle2`, and `royalArena` fields to the
existing slot object. Native backup validation preserves and bounds those fields.

The retro landing page uses **PLAY ONLINE** as the primary action, followed by
Campaign, Custom Game, and Local Play. Save slots sit in a compact keyboard-accessible
disclosure. Its tagline is:

> Choose your paddle. Choose your arena. Claim royal powerups. Take your crown!

Local Play contains Two Player and the existing native LAN flow. Browser play
keeps its existing room-code service. Native PLAY ONLINE displays the browser URL;
native applications retain their existing LAN transport rather than acquiring a
new internet transport or changing packaging.

The scrollable galleries reuse existing objects and drawing code:

| Catalog | Implementation and restrictions |
| --- | --- |
| Paddles | 42 unique existing profiles: Classic, 16 player, 16 opponent, and 9 adaptive boss profiles. Previews call the actual shape renderer. Player/opponent/boss unlocks follow the existing progression and boss-access rules. |
| Arenas | All 18 campaign definitions plus The Hidden Wall. Thumbnails read the actual hazard definitions. No separate preview-map data exists. Normal maps remain available in local/online Two Player; Custom uses completed maps; The Hidden Wall requires boss access. |
| Hidden Wall matches | Reuses the boss arena's hazard definitions with a normal six-point match goal. The dedicated secret boss fight retains its original health/multiball rules. |
| Local selection | Separate player-one/player-two paddle choices and an arena choice persist per slot. Custom and local pre-match flows open the arena gallery directly. |
| Online selection | Host owns arena and match state. Guest requests only its own paddle before a rally, using the reliable action channel. Both selected profiles and the arena arrive in host snapshots. Invalid IDs, stale requests, and mid-rally requests are ignored. |

Selection state uses the real catalog definitions. Existing campaign automatic
paddle progression remains until the player explicitly saves a paddle choice.
Mouse, keyboard, touch, and gallery gamepad navigation are supported. All nine
existing non-English localization tables include the new interface phrases;
existing arena/paddle names continue through the existing localization system.

## Royal powerups

Pickups rotate deterministically through the three types and use retro gold-rimmed
purple, red, and blue orbs. Only one pickup and one extra ball can exist. Collection
is swept along the authoritative ball movement and credited to its last hitter.

| Powerup | Authoritative behavior | Visual effect |
| --- | --- | --- |
| Royal Split | Creates one extra ball using the existing ball collision code. Either ball scores. If both cross goals during the same tick, the earlier crossing wins. Exactly one point is awarded, then the other ball and rally effects are cleared. | Duplicate is purple and 52% opaque; opacity does not affect physics. |
| Crown Rush | Multiplies the affected ball's speed by 1.3 without stacking. The boost is removed before the next paddle hit's normal speed/bounce calculation. Hazard speed clamps preserve the boost while active. | Four small red/gold pixel trail blocks. |
| Castle Guard | A visible defensive wall behind the earning player's paddle lasts 600 active simulation ticks (10 seconds). Pause freezes its timer. Rally/level resets remove it. | Segmented blue wall with remaining seconds. |

Powerups operate in regular Campaign, Custom, local Two Player, LAN, and browser
online rallies. The separate secret boss fight is deliberately unchanged: it uses
its existing health and boss multiball mechanics, without royal pickups. Selecting
The Hidden Wall for a normal match does allow royal powerups.

## Multiplayer and security

Cloudflare Workers/Durable Objects still provide room-code signaling; Cloudflare
STUN and Metered TURN remain unchanged. Permanent Metered credentials remain
Worker secrets. The signaling backend, migrations, deployed URL, origin policy,
rate limits, dependency lockfile, and transport negotiation were not changed.

Client gameplay messages add:

- `gameplay: 'royal'`, a capability marker without changing numeric versions.
  An updated peer stops a mixed old/new match with a reload message.
- `tick`, `selection: {arena, left, right}`, and bounded `royal` state on host
  snapshots. Royal state carries rally identity, rush flags, the optional second
  ball/pickup, and guard durations.
- A sequenced `selection` request on the existing reliable control channel in
  browser online play (the existing single channel in native LAN). The next
  scheduled host snapshot acknowledges it; requests cannot force extra replies.

The existing 8,192-character receive cap, 64 KiB send-buffer guard, role checks, action
limits, stale-state/input rejection, and host physics remain. New values must
match actual catalog identifiers and finite bounded powerup fields. Guest data
cannot request an arena, score, collision, ball trajectory, guard, or powerup.
Unlocks remain local save progression, not newly authenticated server entitlements.
Both players must load this update before playing together.

## Validation results

| Command / check | Exact result |
| --- | --- |
| `node --test tests/*.mjs` | **127 passed, 0 failed, 0 skipped** (78 existing plus 49 new tests). |
| `python -B -m unittest discover -s tests -p 'test_*.py'` | **22 passed**. |
| `cd signaling && npm test` | **16 passed, 0 failed, 0 skipped**. |
| `cd signaling && WRANGLER_SEND_METRICS=false npm run check` | **Passed**, dry run only; 13.80 KiB / 3.89 KiB gzip, existing bindings retained. |
| `cd signaling && npm run test:gameplay` | **28 browser integration groups passed**; no uncaught page exceptions or application console errors. |
| `cd signaling && npm run test:browser` | **Failed at initial peer connection**, `page.waitForFunction` timeout after 15,000 ms; UI reported relay unavailable. Later checks in this suite were not reached. |
| `node tools/sync-gameplay.mjs --check` | **Passed**; all four embedded copies match shared sources. |
| `git diff --check` and Windows/Linux HTML comparison | **Passed**; identical Windows/Linux HTML. |

The real WebRTC failure is an environment limitation, not a successful transport
test: the browser gathered no usable ICE candidates, the execution environment's
network-interface enumeration returned `uv_interface_addresses` error 1, and its
route table contained no routes. No production TURN credentials were supplied to
this run. The original real-peer suite remains enabled and has not been weakened
or skipped. Rerun it on a host with working WebRTC interfaces; supply its documented
local TURN fixture when checking relay coverage.

The new browser suite loads all four production HTML builds in Chromium 140.
It verifies Campaign/boss startup, Custom, local selection, native LAN setup UI,
all 19 arena initializations, all 42 profile selections, music/selection reload,
native backup fields, keyboard/controller selection, touch layouts at 390×844 and
844×390, and Spanish UI. Touch assertions include preview/label containment so
compressed grid rows cannot silently overlap again.

Two independent browser contexts also exchange production-encoded gameplay
messages through a **test-only JSON bridge**. This checks host arena authority,
different paddle choices, royal state, one-point split resolution, guest physics
prohibition, stale/lost/reordered snapshots, interpolation, and mixed-client refusal.
It does **not** stand in for a WebRTC or live TURN test. Node tests additionally
exercise the actual fixed-step loop at 60/120/144/165/240 Hz across all four builds,
pure interpolation, guard expiry/pause/reset, rush expiry, split scoring, and rapid
guest motion immediately before and after host collision timing.

## Performance and maintenance

No dependencies, framework, runtime polling, or extra gameplay timers were added.
Gallery previews are created only when opened and released when closed. Gamepad
gallery polling uses the existing animation loop. Snapshot history, pickups,
split balls, and trail geometry have explicit small bounds. Ordinary idle title
behavior is preserved. More draws during active high-refresh gameplay are intentional.

Shared source lives in `game/`; run `node tools/sync-gameplay.mjs` after editing it.
The embedded copies keep native packaging self-contained. The browser HTML grows
by approximately 47 KB uncompressed / 14 KB gzip; no image or audio assets were added.
This is a source-size measurement, not a physical-device CPU/battery benchmark.

## Changed files

| Files | Purpose |
| --- | --- |
| `game/royal-gameplay.js` | Interpolation, royal simulation/rendering, validated selection catalogs/messages, galleries. |
| `game/royal-menu.css` | Landing page and responsive gallery layout. |
| `game/royal-localization.js` | New phrases for all nine translated locales. |
| `tools/sync-gameplay.mjs` | Embed/check shared sources in four self-contained builds. |
| `docs/demo/index.html` | Browser game hooks, music-load fix, menus, protocol fields, embedded shared source. |
| `windows/webview-2/index.html`, `Linux/assets/index.html`, `android/app/src/main/assets/index.html` | Equivalent gameplay/rendering/menu hooks, native save-selection compatibility, original platform behavior retained. |
| `docs/demo/online.js` | Connection history reset, guest selection send, applied-input acknowledgement support. |
| `tests/helpers/game-source.mjs`, `tests/helpers/royal-harness.mjs`, `tests/royal-gameplay.mjs` | Production-source extraction and 49 added regression cases. |
| `signaling/test/gameplay-browser.mjs` | New browser UI/gameplay/message validation. |
| `signaling/test/browser.mjs` | Music persistence assertions and updated Local Play navigation in the preserved real-peer suite. |
| `signaling/package.json`, `.github/workflows/tests.yml` | New gameplay browser test command and CI step; dependency/version values unchanged. |
| `README.md`, `signaling/README.md`, `signaling/VALIDATION.md`, `docs/GAMEPLAY-UPDATE.md` | Current behavior, protocol, validation, and historical-record clarification. |

## Required manual acceptance after publishing the client update

1. Load the updated page on home internet and cellular data. Create/join by the
   current room-code flow, confirm direct or Metered relay connection, then repeat
   with the host roles swapped. Keep both tabs foregrounded. This update has not
   been tested over the deployed service inside this environment.
2. Test real 60/120/144/165/240 Hz displays where available. Follow a fast ball,
   moving hazards, both paddles, and the duplicate. Gameplay speed must stay the
   same. Verify guest movement through ordinary cellular jitter and brief loss.
3. Move the guest paddle sharply just before contact. The gold outline should
   respond immediately; the solid paddle should remain consistent with host ball
   outcomes. High RTT still causes genuine late-input misses and buffer underruns
   can still freeze visuals; neither is resolved by invented guest collisions.
4. Choose different unlocked paddles, change the host arena before serving, and
   confirm both screens agree. Browse all 19 previews, confirm Custom/progression
   locks and boss access, and test local player-two selection. Old peers must get
   the reload message rather than silently playing an incompatible match.
5. Collect each orb. Check either split ball can score exactly once, rush ends on
   its next paddle hit, and guard blocks goals for 10 active seconds. Pause/resume,
   score, retry, and change arena while effects are active; confirm cleanup on both
   peers. The dedicated boss fight should keep its original rules.
6. Reload disabled music and several saved volumes, switch slots, resume Campaign,
   and export/import native saves. Check audible output and hardware controls.
7. Run the preserved real-peer suite on a normal development machine, including
   the documented local TURN check. Test native Windows/Linux/Android binaries and
   LAN pairing on actual devices, plus Safari/Firefox/mobile WebViews. This work
   exercised native HTML in Chromium, not packaged native GUIs or physical hardware.

Implementation and available automated checks are complete, but the failed
environment-dependent transport gate and the real-device checks above remain
open acceptance items. No claim of production validation for this new build is made.
