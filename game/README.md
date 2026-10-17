# Shared game source

The `game/` directory contains the shared gameplay, interface, networking and localization sources.
`tools/sync-gameplay.mjs` synchronizes them into the browser, Android, Windows and Linux HTML builds.

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

`local-lan.js` connects native LAN bridges to the same WebRTC gameplay channel, with
manual pairing retained. `pairing.js` optionally gates private/LAN gameplay behind a
connection-bound PIN comparison. Native protocol and pairing details live under `native/`.
`boss-audio.js` loads a separately hosted, optional recording with native cache adapters;
the Ogg asset stays under `docs/audio/` and is never included in generated native HTML.

`arena-render.js` owns the canonical draw function, installed by `presentation-integration.mjs`.
`arena-perspective.js` reflects world drawing horizontally for a connected right-side player,
while keeping scores and text upright. Physics, input Y, interpolation and wire coordinates stay
unchanged. Royal effects draw once after the scores. These modules contain no four-player code.

Run `node tools/sync-gameplay.mjs`, then `node tools/sync-gameplay.mjs --check` and
`node --test tests/*.mjs` after updating canonical sources.
