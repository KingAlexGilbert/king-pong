# Shared Game Code

Most of King Pong's gameplay, menus and multiplayer code lives here. The browser, Android, Windows and Linux versions share the same rules and arenas, but some older game code and platform features still live inside each platform's HTML file.

## Finding the Code

If you're looking for a feature, these are good places to start:

- **Campaign and opponents:** `campaign-data.js`, `paddle-profiles.js`, `cpu-config.js`, `cpu-tracking.js` and `cpu-tactics.js`.
- **Game rules and bosses:** `royal-gameplay.js`, `royal-rules.js`, `hazard-motion.js`, `boss-integration.mjs`, `boss-tactics.js` and `boss-powerups.js`.
- **Graphics and controls:** `arena-render.js`, `arena-perspective.js`, `touch-input.js`, `gamepad-input.js` and `royal-ui.js`.
- **Online multiplayer:** `online.js`, `online-engine.js`, `online-wire.js`, `matchmaking.js`, `secure-crypto.js` and `secure-transport.js`.
- **Connections and rooms:** `multiplayer-presence.js`, `multiplayer-safety.js`, `approval-pairing.js`, `local-lan.js`, `lan-qr.js` and `multiplayer-rematch.js`.
- **Saves and options:** `save-transfer.js`, `player-preferences.js`, `level-select.js` and the localization files.

These files work together. For example, `cpu-tactics.js` handles decisions while `cpu-config.js` keeps the difficulty settings. The campaign gets harder as you progress, and Custom Game lets you adjust CPU intelligence separately from speed.

The secret Wall boss starts with one ball, adds another during the fight, and reaches three permanent balls when its health falls to three. The boss has its own tactics and Royal Powerups; those mechanics are separate from ordinary CPU matches.

Online matches can use direct WebRTC, a TURN relay or the encrypted WebSocket fallback. The host controls the actual game state. Private rooms use approval and an optional PIN comparison; an accepted guest is not automatically PIN-verified. The newer approval flow needs a compatible Cloudflare Worker, so client and server changes should be released together.

The `*-integration.mjs` files put shared features into the existing game pages. `vendor/` contains the QR libraries for LAN pairing and their license details.

## Making Changes

Edit the shared files here, then run these commands from the repository root:

```sh
node tools/sync-gameplay.mjs
node tools/sync-gameplay.mjs --check
```

Synchronization updates the browser demo and the Android, Windows and Linux game pages. It also updates the browser's online scripts and matchmaking compatibility data. Some older code is copied through `BEGIN SHARED` and `END SHARED` sections. **Don't edit generated sections directly**; the next sync replaces them.

Platform-specific window, battery, save and audio connections may need their own changes. The Cloudflare signaling server is in `signaling/`. Check both the client and server when changing online connections.

After changing gameplay or networking, run:

```sh
node tools/test.mjs fast
node tools/test.mjs standard
```

See [`../tests/README.md`](../tests/README.md) for more test groups and native-platform checks.
