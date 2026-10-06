# Editing the game sources

The four platform HTML files are self-contained builds **and** the source of the
legacy engine and platform glue. There is no minifier in the build. Their old,
compressed formatting was checked into the repository; synchronization copied it
and inserted additional compact hook strings.

## Source ownership

| Code | Edit here | Synchronization |
| --- | --- | --- |
| Shared rendering/interpolation, Royal Powerups, selection and validation | `game/royal-gameplay.js` | Copied verbatim into all four HTML files |
| Match rules, audio preferences/buses, contextual menus | `game/royal-rules.js`, `game/royal-audio.js`, `game/royal-ui.js` | Copied verbatim, in that order after gameplay |
| Shared Royal UI stylesheet | `game/royal-menu.css` | Replaces `style#royal-menu-style` contents |
| Royal translations | `game/royal-localization.js` | Replaces `script#royal-localization` contents |
| UI and polish hook bodies | `game/ui-integration.mjs`, `game/polish-integration.mjs` | Replaces existing `ROYAL UI` / `ROYAL POLISH` comment blocks |
| Legacy physics, CPU prediction, input, platform transport, original translations, HTML and original CSS | The corresponding platform HTML below, outside shared blocks | Preserved by synchronization |

The platform files are:

- `docs/demo/index.html` — browser build, with its existing external online scripts.
- `windows/webview-2/index.html` — Windows WebView2 build.
- `Linux/assets/index.html` — must remain byte-identical to the Windows HTML.
- `android/app/src/main/assets/index.html` — Android WebView build.

For a common legacy-engine change, update the corresponding code in every affected
platform shell, keeping platform-specific differences. Do not edit embedded shared
blocks: the next synchronization replaces them from `game/`.

## Generate and check

From the repository root:

```sh
node tools/sync-gameplay.mjs
node tools/sync-gameplay.mjs --check
node --test tests/*.mjs
```

Synchronization preserves source whitespace; it does not require a formatter or
new dependency. Use two-space indentation and ordinary multiline blocks. Embedded
script/style contents begin at column zero so shared source can be copied and
compared verbatim. Keep text-bearing inline HTML, string/template literals,
regular expressions and translation text intact when formatting.
In particular, keep the closing `title-actions` div adjacent to the Exit Game
button: the paddle button is inserted between them at runtime, and adding a text
node there changes the spacing of those inline controls.

The integration modules previously reapplied completed migrations by matching
compressed JavaScript strings. Those changes are already ordinary code in every
platform shell. They are no longer rerun: doing so after formatting could silently
miss an insertion, strip an existing hook, or restore compressed code.

Only the explicit hook bodies remain generated. Keep each opening and closing
hook comment on its own line at the same indentation. Multiple blocks in one
function correspond to the hook array in source order. Add or move a hook at its
intended location in every applicable shell; the generator checks the expected
block count and fails if a function or hook is missing. It never guesses a new
insertion point from an old minified statement. Native save loading still uses
its existing preference setters; its backup-validation hook and the browser's
save-loading hook retain their separate integration points.

The already-integrated legacy changes include the fixed-step/guest render path,
CPU prediction inputs, score rendering, rule/audio wiring, UI input guards and
viewport insets. In particular, the focused UI never draws the legacy canvas
header; do not build its CPU configuration/text at render frequency. Only a
confirmed paddle contact consumes the Royal Split duplicate; misses can still
score. Formatting or moving comments must not change these behaviors.
