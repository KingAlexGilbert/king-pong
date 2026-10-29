# King Pong Tests

King Pong has tests for gameplay, multiplayer, the browser versions and native LAN code. Run the commands below from the repository root.

You'll need Node.js 24 and Python 3. For browser tests, install the tools in `signaling/` and Playwright Chromium:

```sh
npm ci --prefix signaling
npx --prefix signaling playwright install chromium
```

## Running Tests

The main runner is `tools/test.mjs`. Choose the group that fits what you changed:

| Command | What it runs |
| --- | --- |
| `node tools/test.mjs fast` | Shared source checks and JavaScript tests |
| `node tools/test.mjs core` | Fast tests, Python, signaling tests and a Worker build check |
| `node tools/test.mjs browser` | Standard browser and multiplayer tests |
| `node tools/test.mjs extended` | Additional networking, LAN, audio and layout checks |
| `node tools/test.mjs standard` | Core and browser tests |
| `node tools/test.mjs release` | All test groups |

You can list a group's commands, run one check or save a report:

```sh
node tools/test.mjs release --list
node tools/test.mjs browser --only=ui-browser
node tools/test.mjs release --report=release-results.json
```

A failed check gives the runner a failed result. The console output and JSON report identify which command failed. Individual tests in this folder and `signaling/test/` can also run directly.

## Multiplayer and Native Tests

The browser suites load the actual game pages. Some use controlled connections to reproduce disconnections and transport problems; others use normal browser networking.

**A passing WebSocket fallback test does not prove direct WebRTC or TURN works.** The raw `local-lan-browser` test also requires a machine that can gather local WebRTC connection candidates. Controlled LAN tests cover real Python discovery and signaling, but they don't replace a real LAN connection test.

LAN browser tests use the Python bridge and are best run on Linux. Java LAN tests need a JDK and their test classpath; C# LAN tests need Windows and .NET. A native test reported as skipped has not been verified.

Loading Windows, Android and Linux game pages in Chromium checks their shared code, not the actual desktop or mobile apps. Before release, install and test the finished packages on their supported systems.

## Other Checks

Run `node tools/sync-gameplay.mjs --check` to verify that generated game pages are current. If you intentionally changed shared source, run the sync command without `--check` first.

For performance work, `signaling/test/network-benchmark.mjs`, `signaling/test/ripple-profile.mjs` and `tools/measure-ai.mjs` provide repeatable measurements. `tools/measure-ai.mjs --boss-only` focuses on the Wall boss. These tools help compare changes, but real-device testing still matters.
