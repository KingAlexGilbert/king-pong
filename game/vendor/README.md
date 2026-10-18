# Local QR components

Only these bundled files run in the game. No QR service, runtime package manager,
camera frame upload, analytics, or additional native framework is used.

* `jsqr.min.js`: jsQR 1.4.0, Apache-2.0, https://github.com/cozmo/jsQR.
  npm archive SHA-256: `b5299b37917a1fe7a8cab9dd5cc6b8accf82663add80abe5bf7761a921cc6602`.
  Built from published `dist/jsQR.js` with the existing development esbuild:
  `esbuild dist/jsQR.js --minify`, retaining the full license in the file header.
* `qr-creator.min.js`: qr-creator 1.0.0, MIT, https://github.com/nimiq/qr-creator.
  npm archive SHA-256: `ba265b3e86a5d8e081149b5f7561612ff1ab595c9a96f6971cfeac5811382e04`.
  Published `dist/qr-creator.min.js`, full MIT license retained; source-map link removed.

The synchronization tool isolates vendor declarations in closures. jsQR is bundled
because browser BarcodeDetector support is inconsistent and Android's implementation
can depend on downloaded Google Play Services components. Camera scanning must work
offline, including builds without Google services.
