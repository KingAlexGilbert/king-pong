# Shared game source

The `game/` directory contains the shared gameplay, interface, networking and localization sources.
`tools/sync-gameplay.mjs` synchronizes them into the browser, Android, Windows and Linux HTML builds.

The remaining identical engine sections have explicit canonical sources:

| Source | Responsibility |
| --- | --- |
| `paddle-profiles.js` | Original player, CPU and boss paddle definitions |
| `campaign-data.js` | Campaigns, arenas, hazards and boss encounter data |
| `cpu-config.js` | Existing campaign, Custom Game and boss difficulty values |
| `paddle-geometry.js` | Paddle profiles, contact geometry and bounce calculations |
| `cpu-tracking.js` | CPU errors, prediction, hazard forecasts and movement |
| `hazard-motion.js` | Existing hazard motion update |
| `rally-ramp.js` | Existing serve acceleration ramp |
| `gamepad-input.js` | Equivalent gameplay controller polling |
| `touch-input.js` | Equivalent gameplay touch positioning and handlers |

These are plain script sections, not runtime modules. `tools/shared-sections.mjs`
inserts each one between its named `BEGIN SHARED` / `END SHARED` markers at the
original initialization point in every shell. Missing, reversed or duplicate
markers fail synchronization. Edit the canonical source, then run the existing
sync command; do not hand-edit generated section contents. Sync keeps platform
line endings and avoids rewriting unchanged outputs. The online compatibility
hash reads canonical campaign data in the same sync invocation.

Native bridges, save adapters, audio lifecycle, viewport/fullscreen integration
and platform bootstrap remain in their respective shells. Collision and frame
loop sections with platform-specific side effects remain in place. Generated
copies are required for offline/native packaging; they are verified outputs,
not independently maintained implementations.

Two-player online room negotiation lives in `online.js`, with compact message handling in
`online-wire.js` and `online-engine.js`. `network-common.js` supplies conservative connection-route
classification and bounded input validation. `multiplayer-safety.js` adds two-player private-room
moderation and manual offline LAN offer/answer exchange; it does not require an internet service.

`player-preferences.js` stores explicit choices in the existing version-2 save slots. Shared
match state remains separate, so received host settings and automatic matchmaking overrides
cannot overwrite local preferences. `online-match-flow.js` shares the reliable ready/countdown
flow between private rooms and matchmaking. Both acknowledge the authoritative
configuration and first snapshot before Ready. Public matches use mutual powerup consent
without changing the shared matchmaking queue; private rooms use the host preference.

`multiplayer-serve.js` owns the two-second countdown after a two-player point. The host
advances its remaining active time and releases the existing serve; snapshots carry the
remaining time for guest rendering. The optional compact-wire field is negotiated in the
existing hello exchange. Pauses and transport recovery suspend the clock. Initial Ready
and single-player serving are unchanged.

`level-select.js` reuses campaign encounters and arena previews, with unlocks read from the
active save slot. Its replay context is transient: earlier encounters cannot award progress
again, while completing the current frontier uses the existing campaign progression rules.
Replays return to the gallery; the secret boss keeps its separate, gated title entry.

`local-lan.js` connects native LAN bridges to the same WebRTC gameplay channel, with
manual pairing retained. `lan-qr.js` transfers existing invitations locally, using the
small bundled implementations documented under `vendor/`. Manual WebRTC pairing needs
both an offer QR and an answer QR; camera access starts only after choosing Scan.
`pairing.js` retains the optional, connection-bound PIN comparison for offline LAN.

`approval-pairing.js` supplies the online private-room Host Approval PIN before any
WebRTC negotiation. Its versioned `sas1` commit/reveal exchange uses ephemeral P-256
ECDH and transcript-bound HKDF; an HMAC binds the approved exchange to the later SDP.
Comparing PINs is optional, and accepting alone does not assert verified identity.
Pending guests can exchange only verification frames through `signaling/src/party-room.js`.
Publish compatible client and Worker versions together: an approval-enabled new client
fails closed against an older Worker instead of silently skipping verification. No part
of this online exchange is used by fully offline LAN or public matchmaking.

`boss-audio.js` loads a separately hosted, optional recording with native cache adapters;
the Ogg asset stays under `docs/audio/` and is never included in generated native HTML.

`arena-render.js` owns the canonical draw function, installed by `presentation-integration.mjs`.
`arena-perspective.js` reflects world drawing horizontally for a connected right-side player,
while keeping scores and text upright. Physics, input Y, interpolation and wire coordinates stay
unchanged. Royal effects draw once after the scores. These modules contain no four-player code.

Run `node tools/sync-gameplay.mjs`, then `node tools/sync-gameplay.mjs --check` and
`node --test tests/*.mjs` after updating canonical sources.
Run `npm run test:level-select` in `signaling/` for campaign replay, save-slot, localization
and audio-layout checks in all four HTML builds. The private-room, matchmaking and offline
LAN browser suites also exercise automatic serving on connected peers.
See `tests/README.md` for fast, standard and complete release commands, native
prerequisites and the distinction between controlled channels and real routes.
