# Regression checks

Run commands from the repository root. Use Node 24 and Python 3; install the
existing browser/Worker tools with `npm ci --prefix signaling`, then install
Chromium with `npx --prefix signaling playwright install chromium` (CI also
installs the browser's system libraries).

| Command | Checks |
| --- | --- |
| `node tools/test.mjs fast` | Source synchronization and all root JavaScript tests |
| `node tools/test.mjs core` | Fast checks, Python, signaling/security unit tests, Worker dry-run build |
| `node tools/test.mjs browser` | Every standard browser gate used by pull requests |
| `node tools/test.mjs extended` | Extended networking, layout, audio, fullscreen, LAN, pairing, powerup and disconnect scenarios |
| `node tools/test.mjs standard` | Core and standard browser checks |
| `node tools/test.mjs release` | All of the above |

`--list` shows the exact commands. `--only=id,id` selects commands within a group;
for example, `node tools/test.mjs browser --only=ui-browser,level-select-browser`.
`--report=path.json` writes exit codes and wall times after each command.
Suites run sequentially, continue after failures, and return a failing exit code
if any command fails. There are no automatic retries or environment-based success
conversions. Existing targeted npm scripts in `signaling/` remain available;
`npm run test:release --prefix signaling` is also a full-suite entry point.

The JavaScript tests retain platform integration checks even when a deterministic
calculation is tested once. `shared-sections.mjs` verifies the canonical sections
in all four generated HTML shells, and `misc-consistency.mjs` parses their scripts.
Browser suites load Browser, Windows, Linux and Android HTML and exercise real
DOM, canvas, Web Audio and browser APIs. Running an HTML shell in Chromium does
not verify native WebView2, WebKitGTK or Android WebView execution.

Browser test contexts own their saves and application state. The shared static
server helper only serves repository files; it does not share a browser context,
Worker, timers, or network session. The JavaScript fixture cache stores source
text and compiled scripts only; each test gets a fresh VM and mutable state.

## Network and native prerequisites

Normal private-room and matchmaking suites negotiate real browser transports and
report the selected route. A passing encrypted WebSocket fallback does not prove
direct WebRTC or live Metered TURN connectivity. The controlled-channel scenarios
verify protocol behavior, recovery and faults deterministically, alongside the
normal browser scenarios; they do not replace real network validation.

The LAN browser fixtures use `python3` and the production Linux bridge, so run
those extended scenarios on Linux. Windows and Java production-core checks use
the separate native drivers below. The raw `local-lan-browser` scenario also
needs working local WebRTC ICE candidates.
It must fail visibly when the environment cannot establish that route. Controlled
LAN scenarios still use the production Python bridge and real local UDP/TCP
discovery, admission and signaling; their gameplay data channel is controlled.

Python discovery reports its native skips explicitly. The C# production-core
driver requires Windows and .NET; the Java driver requires Java and the documented
test classpath (`KING_PONG_JAVA_LAN_CLASSPATH`). See `test_native_lan_drivers.py` and
`tools/test-lan-interop.py` for driver invocation. These are core interoperability
checks, not native UI tests. Linux audio, battery and save bridge tests use their
test fixtures and do not certify a live desktop session.

Android's separate build workflow retains its release APK check. The repository's
Android instrumentation smoke test needs a device/emulator and AndroidX test
configuration; it is not invoked by this runner or the APK build job. Complete
release validation also needs native application runs on supported platforms.

## Targeted diagnostics

`homepage-browser.mjs` remains directly invocable; its exact helper also runs in
`ui-browser.mjs`, so the aggregate runner does not launch it a second time.
`matchmaking-browser.mjs --signaling-only` remains a useful diagnostic subset.
`serve-comparison.mjs`, `ripple-profile.mjs`, `queue-benchmark.mjs`,
`relay-benchmark.mjs`, and `relay-benchmark-pairs.mjs` are optional measurement or
visual-comparison tools. `network-benchmark.mjs --faults` is a required standard
regression gate; its broader deterministic benchmark mode runs in extended validation.

CI keeps Node/Python on both Ubuntu and Windows, and signaling, Worker and all
standard browser checks on Ubuntu. Manual workflow dispatch with `extended`
enabled adds the release browser scenarios. No security or multiplayer gate was
moved out of pull-request validation.
