# King Pong gameplay, audio, rules and retro polish

Based on current `main` commit `125fb2c` (the completed UI redesign). The earlier
worktree was preserved; this pass lives in the `polish/gameplay-audio-rules`
worktree branch. All changes remain local and uncommitted. No version, dependency,
installer, package format, deployment, tag, release, or remote branch was changed.

## Gameplay and prediction

- **Royal Split:** the duplicate starts at exactly 70% of the spawning ball's
  current speed. The primary retains its original speed calculation. The duplicate
  remains a scoring ball, and the existing earliest-crossing/one-point-per-rally
  resolution and cleanup remain. Its paddle acceleration, speed limits, minimum
  horizontal speed, and hazard-trap recovery retain the 0.7 scale. Existing moving
  hazards and Crown Rush can still modify velocity intentionally; ordinary
  normalization cannot reset the duplicate to the primary's speed limits.
- **Pickup collection:** swept collection radius increased from 14 to 24 game
  units. The visible 16-unit orb is unchanged. A ball still needs a last hitter,
  and passing outside the radius does not collect it.
- **Pickup placement:** a deterministic sequence varies candidates by arena,
  rally, spawn index and tick. Spawns stay at least 112 units from either goal
  edge and 32 units inside the visible top/bottom bounds. Candidates are checked
  against static geometry and a half-second sweep of moving hazards. At most 64
  candidates are tried; a fully obstructed region safely misses that spawn.
  Existing spawn timing, lifetime, type rotation, and one-pickup bound remain.
  Only the local simulation/host generates positions. The guest renders the host's
  transmitted position; invalid coordinates, types and lifetimes are rejected.
- **Guest feedback:** a small, 30%-opacity lavender pixel cursor replaces the
  bright gold full-height outline. It follows input immediately at the edge of
  the arena. The solid paddle still uses the host-confirmed ball timeline.
  Prediction, acknowledgement, reconciliation, collisions and ball authority
  were not replaced or relaxed.

## Audio and saves

The Audio section contains **Mute All**, **Music**, **Sound Effects**, and the
existing **Music volume** slider. Every audible producer uses shared music/SFX
gain buses under a master gain. Master mute silences only King Pong. Existing
tones stop immediately; pending score jingles from an old audio/slot state cannot
start later. Linux's existing WebKit audio keep-alive is retained and stops while
muted.

Music and SFX preferences are independent. For example, Music ON / SFX OFF →
Mute All ON → Mute All OFF restores Music ON / SFX OFF. Music volume and the N
shortcut continue working. Muting does not overwrite either preference.

The optional per-slot fields `muteAll` and `soundEffectsEnabled` use the existing
save version 2. Missing fields default to false and true respectively. Loading
an old slot does not eagerly rewrite its stored data. Preferences survive reloads
and slot changes. Native backup export/import includes and validates both fields
under the existing backup version 1; older backups without them still import.
Browser saves remain local, with the same platform-specific backup availability
as before. Multiplayer rules and paddle access never alter Campaign progression.

## Match presets and authority

| Preset | Exact completion condition |
| --- | --- |
| Quick Match | First player to reach 5 points. |
| Classic Match — default | First player to reach 10 points. |
| Win by Two | At least 10 points and a lead of at least 2; 10–9 continues, 11–9 ends. |
| Endless | No automatic match completion. Scores continue until exit/restart. |

One shared selection appears in Local Two Player setup. Online and native LAN
hosts choose; guests see a read-only summary. Changes are permitted only before
the first serve of a fresh match. Restart retains the selected preset and permits
a new setup choice. Rules are session state, not save progression. Campaign,
Custom and Secret Boss keep their existing completion rules. The existing
serve-between-points, pause and restart controls remain.

The active rule appears compactly in the header and between-point prompt. Match
completion now says MATCH OVER. Longer scores fit within each player's half;
network scores are validated as nonnegative safe integers instead of being capped
at 99. At JavaScript's maximum exact integer (9,007,199,254,740,991), increments
saturate safely without ending Endless or overflowing.

Rule changes use a small `rules` message over the existing reliable control
channel; authoritative snapshots also carry the preset and revision. Preset IDs
are allowlisted, revisions are bounded integers, and older/conflicting revisions
or stale/invalid snapshots are rejected before applying state. Revisions reset
per connection. Guests cannot issue host rule changes, scores, completion,
pickup positions, arenas, collisions, guards, or trajectories.

The existing compatibility check now also requires the `matchRules: "presets"`
capability. Both players must reload the updated build; an older royal client is
stopped with the existing reload message. Release and signaling version numbers
are unchanged. Cloudflare signaling/STUN, Metered TURN, credentials, relay policy,
rate limits and WebRTC transport code are unchanged.

## Retro UI and usability

The focused arena/setup/menu structure stays. Near-black surfaces, crisp gold
edges, restrained purple accents and small hover/focus glows restore the arcade
appearance without new animation loops, assets, or rendering dependencies.

Campaign is now the parent mode, with Training, Ricochet and Chaos visibly nested
as chapters. One top-level mode and, when relevant, one Campaign chapter have
active state. Existing chapter locks and progress checks remain.

Help is divided into Keyboard, Controller, Mobile / Touch, and Royal Powerups,
using short key/action rows. The current input method gets a subtle accent while
all methods stay available. Settings has Audio and Display sections using real
existing options. Paddle/arena cards remain whole-card buttons using the original
renderers, with explicit CHANGE labels and pointer, touch and keyboard/controller
feedback. Rules occupy setup only. Short landscape screens keep Start Match
fixed while setup content scrolls; preview labels remain fully visible.

The prior focus trap/restoration, controller navigation, keyboard shortcuts,
touch mapping, multiplayer catalog access, orientation behavior, safe-area
spacing and reduced-motion support remain. New phrases and structured labels
are translated into all nine existing locales. Native Android's sensor landscape
configuration and browser best-effort orientation/fallback are unchanged.

## Validation

| Command | Result |
| --- | --- |
| `node tools/sync-gameplay.mjs` | Passed; regenerated Browser, Windows, Linux, Android. |
| `node tools/sync-gameplay.mjs --check` | Passed. |
| `node --test tests/*.mjs` | 171 passed, 0 failed, 0 skipped. |
| `python -B -m unittest discover -s tests -p 'test_*.py'` | 22 passed. |
| `cd signaling && npm test` | 16 passed, 0 failed, 0 skipped. |
| `cd signaling && npm run test:gameplay` | 28 browser integration groups passed. |
| `cd signaling && npm run test:ui` | 24 UI browser integration groups passed; no page exceptions. |
| `cd signaling && npm run test:browser` | Failed at initial real-peer connection after 15,000 ms; relay unavailable. Later assertions were not reached. |
| `git diff --check` | Passed. |

The real-peer suite is unchanged and was run, not skipped or replaced. This
environment returns `uv_interface_addresses` error 1 when enumerating network
interfaces, has an empty route table, and provides no usable relay test fixture.
The passing peer-message tests exercise production authority and UI behavior;
they are not a substitute for live WebRTC connectivity.

Thirty Node regressions were added, covering split speed/contacts/scoring,
pickup radius/safety/variety/authority, all four rule conditions, forged and stale
rule state, score bounds, audio routing/mute/persistence/legacy backups, prediction
purity, and localization. Existing test fixtures now load the shared audio/rule
modules and carry valid current protocol fields. The existing assertions remain;
Campaign active-state assertions now distinguish the parent mode and its chapter.
Native backup fixtures include differing mute/SFX preferences.

Five UI integration groups supplement the previous 19. Production HTML for all
four builds covers settings/reloads, structured help, nested Campaign selection,
rule selection with keyboard/controller/touch, host/guest rules, Win by Two,
Endless scores beyond 99, and the prediction cursor. Existing title/save/gallery/
mode/rotation/powerup/connection-state checks remain. Screenshots were reviewed at
1280×800, 1920×1080, 2560×1440, 1024×600, 390×844, 844×390 and 360×640, including
translated phone settings/help and reduced motion.

## Changed files

| Files | Purpose |
| --- | --- |
| `game/royal-gameplay.js` | Split scaling, safe varied pickups, guest cursor, capability check. |
| `game/royal-rules.js` — new | Presets, scoring, authoritative rule state, long-score rendering. |
| `game/royal-audio.js` — new | Central audio routing, mute/SFX controls, pending-sound cancellation. |
| `game/royal-ui.js`, `game/royal-menu.css`, `game/royal-localization.js` | Setup rules, Campaign hierarchy, structured settings/help, retro presentation, translations. |
| `game/polish-integration.mjs` — new, `game/ui-integration.mjs`, `tools/sync-gameplay.mjs` | Reproducible shared hooks into existing platform functions. |
| `docs/demo/index.html`, `windows/webview-2/index.html`, `Linux/assets/index.html`, `android/app/src/main/assets/index.html` | Generated self-contained builds. |
| `tests/polish-regressions.mjs`, `tests/helpers/audio-harness.mjs` — new | New production-code regressions and observable audio graph harness. |
| `tests/helpers/royal-harness.mjs`, `tests/royal-gameplay.mjs`, `tests/online-networking.mjs`, `tests/save-transfer.mjs`, `tests/misc-consistency.mjs` | Existing harness/protocol/backup expectations updated for the requested additions. |
| `signaling/test/ui-browser.mjs` | Expanded production UI, rule authority and audio checks. |
| `README.md`, `docs/GAMEPLAY-POLISH.md` | Usage and review notes. |

## Physical acceptance still needed

- Two real devices using normal browsers: direct WebRTC and Metered fallback,
  both host roles, rule selection/restarts, longer matches and packet loss.
- Listen to music/SFX/master mute on Android WebView, Windows WebView2 and Linux
  WebKitGTK; verify suspend/resume, reloads and native backup transfers on devices.
- Check Safari/Firefox, hardware controllers, real touch/rotation, and platform
  display scaling. Chromium emulation cannot establish native audio output or
  orientation permission behavior.
- Playtest the 70% split speed and 24-unit pickup radius for subjective balance.

No APKs/installers were built and no production service was deployed. The local
review archive includes the complete source, a patch against `125fb2c`, production
UI screenshots, exact validation logs, and application instructions.
