# Online network format and measurements

The online adapters negotiate optional JSON tuple format `kp`, version `1`, over the existing reliable control channel. Until a supported `net-format` acknowledgment arrives, the sender uses the original object messages. Old peers ignore the extension. Four bounded hello attempts cover peers whose channels open at different times; unsupported versions do not enable compact sending.

`game/online-wire.js` documents the field order. Inputs carry room, sequence, axis and target. Every 20 Hz snapshot is complete, including selections, rules, ball, paddles, scores, hazards, countdown and Royal state. Explicit nulls clear expired powerups. Decoding restores the original message object before the existing validation, authority, revision and stale-sequence checks. Unknown tuple versions or malformed shapes are rejected. A later snapshot repairs dropped updates without a delta history or a reliable configuration dependency.

The guest sends changed input on its next 60 Hz physics tick. Targets use the same 0.01-pixel precision as paddle snapshots. Continuous changes are immediate; unchanged moving/unacknowledged input keeps the existing 30 Hz cadence. Confirmed idle input uses a 250 ms keepalive. The acknowledgment refers to the first packet carrying the unchanged value, so normal RTT does not prevent idle throttling. Drops of a release or new target retain the old retry cadence until acknowledged. Physics, ball precision, reconciliation and the 100 ms interpolation buffer are unchanged.

Matchmaking remembers the last successful queue notification in each socket attachment. Duplicate counts are suppressed across hibernation. Actual count/state changes still notify immediately. Heartbeats, leases, cleanup alarms, room reservations, ICE retry limits and TURN credential handling are unchanged.

## Reproduce

From the repository root, after installing the existing signaling development dependencies and Playwright Chromium:

```sh
node tools/sync-gameplay.mjs --check
node --test tests/*.mjs
node signaling/test/network-benchmark.mjs --output after.json
node signaling/test/network-benchmark.mjs --faults --output faults.json
node signaling/test/queue-benchmark.mjs
```

The benchmark accepts `--source /path/to/before-tree`, `--quick` (shortens the 30-minute simulated session), and `--scenario rally`. Run the same benchmark file against both source trees. It loads the production browser game twice, advances deterministic 60 Hz simulation, measures UTF-8 payloads at `send()`, and renders canvas frames. It measures rally, fast ball, Royal Powerups, score/serve, pause, idle, countdown and long-session traffic. Fault profiles add 80 ms base RTT, ±40 ms one-way jitter, seeded 10% unreliable-message loss, reordering and a one-second blackout. Reliable control messages stay ordered. Its clock and network are controlled; this is not an internet RTT, physical-display or TURN billing measurement.

For an actual connected test match, paste `tools/network-diagnostics.js` into DevTools on both peers, then run:

```js
const capture = await startKingPongNetworkDiagnostics();
// Play the chosen scenario, then:
const result = await capture.stop();
console.log(JSON.stringify(result, null, 2));
```

This optional tool is never included in production bundles. It counts payload upload/download and samples `RTCPeerConnection.getStats()` transport counters, selected route type and candidate-pair RTT. It collects no addresses, credentials or SDP, makes no requests and restores its hooks when stopped. Candidate-pair RTT measures connectivity checks, not input response. Transport bytes still do not equal Metered billing; verify usage in the provider dashboard during a separate controlled relay test.
