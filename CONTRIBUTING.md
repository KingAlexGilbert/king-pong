# Contributing to King Pong

King Pong is a personal open-source project. Bug reports, ideas, testing and focused pull requests are welcome.

The game has an 18-level arcade campaign, local and online multiplayer, save slots and versions for browsers, Android, Windows and Linux. Changes should keep the game approachable and true to its retro style.

## Before Changing Code

Most shared gameplay code is in [`game/`](game/README.md). After editing it, run:

```sh
node tools/sync-gameplay.mjs
node tools/test.mjs fast
```

The sync step copies shared code into the four platform versions. Don't edit generated shared sections directly. Larger changes are worth discussing in an issue before starting.

For other tests, including multiplayer and platform requirements, see [`tests/README.md`](tests/README.md).

## Pull Requests

Explain what you changed, why you changed it, and how you tested it. Mention which versions are affected. Keep unrelated fixes out of the same pull request when you can.

## Bug Reports

Please include the game version, platform, steps to reproduce, what happened and what you expected. Screenshots or a short recording can help.

For Linux, specify whether you used the `.deb` or AppImage. For Windows, say whether you used the installer or portable version. For multiplayer problems, include the connection type if you know it.

If you discover a security issue, follow [`SECURITY.md`](SECURITY.md) instead of posting sensitive details publicly.
