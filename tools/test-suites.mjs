// Retains every previous standard pull-request browser gate.
export const browserSuites = [
  ['browser'], ['private-room-browser'],
  ['private-controlled', 'private-room-browser', '--controlled-channels'],
  ['transport-recovery', 'private-room-browser', '--controlled-channels', '--transport-recovery'],
  ['transport-faults', 'private-room-browser', '--websocket-fallback', '--transport-faults'],
  ['preferences-browser'], ['matchmaking-browser'], ['online-flow-browser'],
  ['network-faults', 'network-benchmark', '--faults'], ['matchmaking-polish-browser'],
  ['gameplay-browser'], ['ui-browser'], ['level-select-browser'], ['serve-feedback-browser'],
  ['engineering-browser'], ['serve-browser'], ['ripple-browser'], ['appearance-browser']
];
export const extendedSuites = [
  ['network-long', 'network-benchmark'],
  ['arena-layout-browser'], ['boss-audio-browser'], ['campaign-polish-browser'],
  ['fullscreen-browser'], ['lan-qr-browser'],
  ['local-lan-browser'], ['lan-controlled', 'local-lan-browser', '--controlled-channels'],
  ['lan-pairing', 'local-lan-browser', '--controlled-channels', '--verify-pairing'],
  ['powerup-perspective-browser'], ['responsive-polish-browser'],
  ['public-powerups', 'private-room-browser', '--controlled-channels', '--public-powerups'],
  ['fallback-disconnect', 'private-room-browser', '--fallback-disconnect']
];
// homepage-browser wraps the exact helper run by ui-browser.
// matchmaking --signaling-only is a diagnostic subset of the normal suite.
