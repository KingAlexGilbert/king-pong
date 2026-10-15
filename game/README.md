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
flow between private rooms and matchmaking; private rooms additionally acknowledge the host
configuration and first snapshot.

`arena-render.js` owns the canonical draw function, installed by `presentation-integration.mjs`.
`arena-perspective.js` reflects world drawing horizontally for a connected right-side player,
while keeping scores and text upright. Physics, input Y, interpolation and wire coordinates stay
unchanged. Royal effects draw once after the scores. These modules contain no four-player code.

Run `node tools/sync-gameplay.mjs`, then `node tools/sync-gameplay.mjs --check` and
`node --test tests/*.mjs` after updating canonical sources.
