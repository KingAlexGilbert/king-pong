# King Pong UI/UX review

Based on `main` commit `d8e3161` (the merged royal gameplay update). All changes are
local and uncommitted. Nothing was pushed, published, deployed, tagged, or released.

The interface now has three clear views: the arena during play, a pre-match setup
card, and an on-demand match menu. King Pong keeps its monospace typography, dark
background, pixel geometry, arena colors, and gold/purple highlights.

| Area | Result |
| --- | --- |
| Active match | The arena, original score/health rendering, a compact mode/arena/goal header, context-sensitive serve/pause controls, and a small input hint. Clock and battery remain unobtrusive; native battery behavior is unchanged. |
| Match menu | M or the existing menu control opens a retro dialog. Restart, title navigation, goal visibility, music toggle/volume, mode switching, paddle/arena access, and detailed help remain available. Opening the menu during a rally uses the existing pause request, including host authority online. Resume retains the existing countdown. |
| Pre-match setup | Numbered Player 1, Player 2 (only local Two Player), and arena cards reuse the existing renderers. Custom Game has one player paddle and CPU settings. Start Match stays visible while the setup content scrolls on short screens. Choices disappear when play begins. |
| Online setup | Create Room, Join Room, room code, waiting, connecting, connected, and failure messages occupy one central card. A guest sees its own paddle and no arena selector. Room/connection controls remain available from the in-match menu. Retry uses the existing Create/Join flow. |
| Removed from the permanent play view | Mode-button rows, audio sliders, restart/title/goal buttons, paddle/arena selectors, Custom CPU controls, full powerup explanations, the large keyboard panel, networking setup controls, and the redundant canvas goal/course box. The compact header preserves goal information. |

**Multiplayer access and progression.** All 42 existing profiles use their existing
normal paddle geometry and are selectable in Local Two Player and browser online
play (also native LAN). Local players choose separately; an online host and guest
choose their own paddles. These choices are held only in session memory and are
cleared when changing save slots. They never write a paddle unlock or Campaign
progress, and do not replace the saved single-player paddle preference. Existing
saved paddle preferences remain readable and survive backups. Returning to
Campaign or the title paddle gallery restores the original progression checks.
All 18 ordinary multiplayer arenas remain accessible; the nineteenth Secret Boss
arena retains its existing boss-access requirement. Custom and Campaign arena
unlock rules remain unchanged.

Guest selection messages still contain only their own paddle choice, the existing
sequence/room/protocol fields, and the existing gameplay marker. Invalid/stale or
mid-rally requests remain rejected. Host arena, score, ball, collisions, guards,
and powerups remain authoritative. No signaling, STUN, TURN, credential, rate-limit,
WebRTC, physics, scoring, powerup-balance, or save-format implementation was replaced.
`docs/demo/online.js`, production configuration, the signaling backend, and the
package lockfile are unchanged.

**Mode highlighting.** A shared UI state calculation owns active classes and
`aria-pressed` for the mode menu. Online setup is distinguished from local Two
Player even before a peer connects; an old open-panel flag can no longer highlight
Online in another mode. Campaign is identified in the header, with exactly its
current Training/Ricochet/Chaos chapter active in the mode menu. Custom, local,
online, and Secret Boss each have their own exclusive active state. Title screens
have no active gameplay mode button. Checks cover switching, serving, restarting,
title/save-slot transitions, online exit, and gallery returns. Choosing local play
from the title also closes an existing native LAN session.

**Title polish.** PLAY ONLINE has one centered gold border and a four-second soft
glow; the offset shadow rectangle is gone. The purple Secret Boss action remains
secondary, below the Campaign/Custom/Local row. The unchanged tagline uses stronger
uppercase monospace text and two complete phrase groups: one line on wide displays,
two balanced lines on phones. Save slots retain their disclosure. Both title
animations stop under reduced-motion preferences.

**Mobile and accessibility.** Scrollable, viewport-bounded dialogs and galleries,
large touch controls, safe-area spacing, and separate setup content/actions keep
important controls accessible. The existing touch coordinate mapping and gameplay
bindings remain. Menus now support visible keyboard focus, Enter/Space activation,
Tab containment, focus restoration, and controller navigation. Native form fields
keep their keyboard behavior. Gamepad Start still pauses/resumes; Select opens the
menu; A activates focused setup/gallery/menu actions. During play the original
paddle, serve, retry, and pause bindings remain. All nine existing translated
locales include the new UI and orientation phrases.

Android now declares `sensorLandscape` instead of a single fixed landscape direction,
allowing either landscape side. The existing orientation/screen-size configuration
handling preserves the WebView instead of rebuilding the Activity. This is native
configuration, with no JavaScript Android orientation loop. See the
[Android Activity reference](https://developer.android.com/guide/topics/manifest/activity-element).

The browser makes at most one best-effort fullscreen/landscape-lock attempt per
visit from the title, only on a phone and with active user interaction. Unsupported
APIs, rejected permissions, and fullscreen refusal are caught. Portrait gameplay
shows a retro rotate prompt with Continue in portrait, Menu, and Title actions.
It disappears in landscape, and dismissal suppresses repeat prompts for that
visit. Returning to the title releases a lock owned by the game. Rotation updates
presentation without resetting the match, save, or connection. Orientation is
irrelevant to the desktop native builds. Browser support remains conditional; see
the [Screen Orientation specification](https://www.w3.org/TR/screen-orientation/).

**Validation results**

| Command | Result |
| --- | --- |
| `node tools/sync-gameplay.mjs` | Passed; four embedded builds regenerated from shared sources. |
| `node tools/sync-gameplay.mjs --check` | Passed. |
| `node --test tests/*.mjs` | 141 passed, 0 failed, 0 skipped. |
| `python -B -m unittest discover -s tests -p 'test_*.py'` | 22 passed. |
| `cd signaling && npm test` | 16 passed, 0 failed, 0 skipped. |
| `cd signaling && npm run test:gameplay` | 28 browser integration groups passed. |
| `cd signaling && npm run test:ui` | 19 UI browser integration groups passed. |
| `cd signaling && npm run test:browser` | Failed at initial real-peer connection: 15,000 ms timeout; relay unavailable. Later real-peer assertions were not reached. |
| `git diff --check` | Passed. |

The real-peer failure is an environment limitation, not a transport pass: Node's
network-interface enumeration returns `uv_interface_addresses` error 1, the route
table is empty, and no usable TURN test fixture was supplied. The real WebRTC suite
is unchanged and was neither weakened nor skipped. The deterministic peer-message
fixtures test protocol/UI behavior, not live transport connectivity.

Production HTML was rendered in Chromium for all four builds. Screenshots and
layout assertions cover title/save slots, Campaign/Training/Ricochet/Chaos, Custom,
Local Two Player, online setup, Secret Boss, both galleries, join/create/error/
waiting/connecting/connected states, pause/menu/help/settings, active play, and
royal effects. Desktop checks include 1280×800, 1920×1080, 2560×1440 and 1024×600;
phone checks include 390×844, 844×390 and 360×640, rotation while running, and all nine
translated phone layouts. Keyboard, controller, touch drag, gallery focus, native
input fields, reduced motion, and orientation refusal/dismissal are exercised.
Visual review caught and corrected the Boss toolbar transition, unlocked title
button ordering, and short-screen setup action clipping.

**Changed files**

| Files | Purpose |
| --- | --- |
| `game/royal-ui.js` (new) | Contextual shell, setup/menu state, exclusive highlighting, focus/controller behavior, orientation fallback. |
| `game/ui-integration.mjs` (new), `tools/sync-gameplay.mjs` | Reproducible integration hooks and shared embedding/checking for the existing platform shells. |
| `game/royal-gameplay.js` | Session-only multiplayer paddle selection, existing gallery integration, title ordering. Royal physics/rendering functions are unchanged. |
| `game/royal-menu.css`, `game/royal-localization.js` | Responsive visual design, title styling, setup/menu/gallery layout, translated phrases. |
| `docs/demo/index.html`, `windows/webview-2/index.html`, `Linux/assets/index.html`, `android/app/src/main/assets/index.html` | Generated shared UI and common integration hooks; platform behavior stays self-contained. |
| `android/app/src/main/AndroidManifest.xml` | Both landscape directions through native configuration. |
| `tests/ui-regressions.mjs` (new), `tests/helpers/royal-harness.mjs`, `tests/misc-consistency.mjs` | Four-platform access/authority/progression checks, integration invariants, orientation handling, accessible-field expectations. |
| `signaling/test/ui-browser.mjs` (new), `signaling/test/gameplay-browser.mjs` | Production UI/viewport/input tests and existing tests adapted to explicit setup and session-only choices; legacy backup fields remain covered. |
| `signaling/package.json`, `.github/workflows/tests.yml` | UI test command and CI step; dependency versions unchanged. |
| `README.md`, `docs/UI-UX-REDESIGN.md` | Current UI usage, behavior, validation, and review notes. |

The 14 added Node cases supplement the original 127. The original 28 gameplay
browser groups remain, with 19 UI groups added. There are no new production
libraries, image assets, gameplay timers, version numbers, or packaging changes.

**Remaining physical-device checks**

- Rerun `npm run test:browser` on a machine with usable WebRTC interfaces. Test
  home internet versus cellular, both host roles, and the real Metered fallback.
- Install native Android and verify sensor landscape, either grip direction,
  navigation/system bars, suspend/resume, and native LAN. Verify packaged
  Windows/Linux input, audio, battery and window resizing.
- Check mobile Safari, Firefox, actual Android browsers/WebViews, hardware
  controllers, and notched/foldable devices. Browser orientation permission and
  native device policies cannot be established by Chromium emulation.

No native installers/APKs were rebuilt, and no production service was contacted
for deployment. The source is ready for local review; live-network and physical
acceptance remain open.
