# Shared game source


## Four-player sources

- `four-core.js`: independent, deterministic square-arena simulation, FFA/2v2 rules, bots, powerups, snapshot validation and perspective geometry. Classic rectangular simulation stays in the existing shell functions.
- `four-view.js`, `four.css`, `four-localization.js`: responsive arena/setup, fixed-step presentation, input transformation, labels and translations.
- `four-network.js`: host authority, guest prediction/interpolation, lobby controls, readiness/bot consent and recovery.
- `party-client.js`: multiplexed private-room signaling and independent existing WebRTC connections; manual LAN invitation/answer transport.
- `network-common.js`, `multiplayer-safety.js`: selected-route classification, bounded input admission, classic private-room moderation and LAN entry.
- `four-integration.mjs`: narrow hooks into legacy rendering and the animation loop. `tools/sync-gameplay.mjs` embeds these canonical sources in all four platform pages. Run it after editing shared source, followed by `--check`.

See `signaling/README.md` for private-room routes, compatibility, deployment and the limits of controlled browser tests.
