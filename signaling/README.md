# Online Multiplayer Signaling

This folder contains the Cloudflare Worker used by King Pong's online multiplayer. It helps players find opponents, join rooms and set up connections. The game itself runs on the players' devices, not on Cloudflare.

## Finding the Code

- `src/worker.js` handles incoming connections, room codes and the main room service.
- `src/matchmaking.js` pairs players who choose **Find Match**.
- `src/matchmaking-contract.js` defines the matchmaking rules shared with the game.
- `src/party-room.js` handles private rooms and their members.
- `src/secure-relay.js` handles the encrypted WebSocket fallback when a direct connection isn't available.
- `src/metered-turn.js` manages temporary Metered TURN credentials for relayed WebRTC connections.
- `src/native-bridge.js` lets the packaged desktop and Android games reach signaling without opening the service to arbitrary websites.
- `test/` contains server tests, multiplayer browser tests and network benchmarks.

`wrangler.jsonc` holds the Worker settings, including its Cloudflare room and matchmaking bindings. Cloudflare calls these room services *Durable Objects*; they keep each room's or queue's state together.

## How Online Play Connects

Players contact the Worker to create or join a room. Matchmaking can pair strangers automatically, while private rooms let friends connect using a code.

Once paired, the game tries to connect the players directly using WebRTC. If that doesn't work, it can try a Metered TURN relay, then an encrypted WebSocket connection through the Worker. The host still controls the match's physics and scores. Cloudflare handles connections and forwarding, not the gameplay.

Keep the Worker and game client compatible when changing room messages, matchmaking rules or connection behavior.

## Running and Deploying

You'll need Node.js, a Cloudflare account and the dependencies in this folder. From the repository root:

```sh
cd signaling
npm ci
npm run dev
```

This starts a local Worker for development. Before deploying, check `wrangler.jsonc`, especially `ALLOWED_ORIGINS`, which lists the websites allowed to connect.

For the optional Metered TURN fallback, configure the Worker secrets with Wrangler:

```sh
npx wrangler secret put METERED_APP_NAME
npx wrangler secret put METERED_SECRET_KEY
```

Enter the values from your Metered account when prompted. Keep keys and credentials out of the repository and browser files.

To check and deploy the Worker:

```sh
npm run check
npm run deploy
```

The public Worker address used by the game is set in [`../game/online-config.js`](../game/online-config.js). If you change it, synchronize the shared game files from the repository root with `node tools/sync-gameplay.mjs`. Browser deployment is explained in [`../docs/README.md`](../docs/README.md).

## Testing

Run the Worker unit tests from `signaling/`:

```sh
npm test
npm run check
```

For wider gameplay and multiplayer coverage, run `node tools/test.mjs standard` from the repository root. Some browser tests need Playwright Chromium, and real WebRTC/TURN connections still need testing on working devices and networks. See [`../tests/README.md`](../tests/README.md) for the test groups and setup.
