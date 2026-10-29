# Development Tools

This folder has the scripts used to keep King Pong's different versions in sync, run tests and measure performance. Run them from the repository root.

## Keeping the Game in Sync

Shared game code lives in [`../game/`](../game/README.md). After changing it, run:

```sh
node tools/sync-gameplay.mjs
node tools/sync-gameplay.mjs --check
```

The first command updates the browser, Android, Windows and Linux game pages. The second checks that those files are current without changing them.

`shared-sections.mjs` handles shared pieces of the older HTML engine. `sync-online.mjs` puts the online code into the browser demo and platform pages and updates the matchmaking compatibility data. These are used by `sync-gameplay.mjs`; you normally don't run them separately.

## Tests

`test.mjs` runs the test groups defined in `test-suites.mjs`. For example:

```sh
node tools/test.mjs fast
node tools/test.mjs release --list
```

The [test README](../tests/README.md) explains the groups, browser setup and native test requirements.

## Other Scripts

`measure-ai.mjs` measures CPU and boss decisions under repeatable conditions. `network-diagnostics.js` supports network checks, and `test-lan-interop.py` helps test native LAN communication between platforms.

These scripts are for development. They aren't part of the game distributed to players.
