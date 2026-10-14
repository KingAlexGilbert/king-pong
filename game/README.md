# Shared game source

The `game/` directory contains the shared gameplay, interface, networking and localization sources.
`tools/sync-gameplay.mjs` synchronizes them into the browser, Android, Windows and Linux HTML builds.

Two-player online room negotiation lives in `online.js`, with compact message handling in
`online-wire.js` and `online-engine.js`. `network-common.js` supplies conservative connection-route
classification and bounded input validation. `multiplayer-safety.js` adds two-player private-room
moderation and manual offline LAN offer/answer exchange; it does not require an internet service.

Run `node tools/sync-gameplay.mjs`, then `node tools/sync-gameplay.mjs --check` and
`node --test tests/*.mjs` after updating canonical sources.
