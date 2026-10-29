# King Pong Website and Browser Game

This folder contains the website served through GitHub Pages and the playable browser version of King Pong.

- `index.html` is the website.
- `demo/index.html` runs the game in a browser.
- `demo/online.js` and related online scripts are generated from shared source.
- `images/` and `audio/` hold files used by the website or game.

The browser game uses the same shared code as the Android, Windows and Linux versions. Make gameplay changes in [`../game/`](../game/README.md), then run:

```sh
node tools/sync-gameplay.mjs
node tools/sync-gameplay.mjs --check
```

Don't edit generated shared sections in `demo/index.html` or the generated online scripts directly. They will be replaced next time the sync tool runs.

## Online Play

The browser game uses a separate Cloudflare Worker for room setup, matchmaking and connection support. Its source and configuration are in `../signaling/`. Browser connection settings come from `game/online-config.js`.

A static copy of this folder can show the game, but public online matchmaking also needs a working signaling service. Don't put private TURN credentials or other secrets in website files.

## Testing Changes

Test the site and demo in a browser after changing their layout or links. For shared game changes, use the tests in [`../tests/`](../tests/README.md), and confirm that browser saves still work as expected.
