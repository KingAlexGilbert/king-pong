function makePaddleProfile(name, offsets, contactScale = 1.04, slopeInfluence = 0.7, aimStrength = 0, noise = 0, bias =
  0) {
  return Object.freeze({
    name,
    offsets: Object.freeze(offsets.slice()),
    contactScale,
    slopeInfluence,
    aimStrength,
    noise,
    bias
  });
}
const DEFAULT_PADDLE_PROFILE = makePaddleProfile("Classic", [0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PLAYER_PADDLE_PROFILES = [DEFAULT_PADDLE_PROFILE, DEFAULT_PADDLE_PROFILE, makePaddleProfile("Soft Crown", [0, 1,
    2, 3, 4, 3, 2, 1, 0
  ], 1.03, 0.72), makePaddleProfile("High Crown", [0, 2, 4, 5, 4, 2, 1, 0, 0], 1.02, 0.76), makePaddleProfile(
    "Low Crown", [0, 0, 1, 2, 4, 5, 4, 2, 0], 1.01, 0.8), makePaddleProfile("Shallow Cup", [4, 3, 2, 1, 0, 1, 2, 3,
    4], 1, 0.84), makePaddleProfile("Top Hook", [0, 1, 3, 5, 4, 2, 1, 0, 0], 0.99, 0.88, 0, 0.003), makePaddleProfile(
    "Bottom Hook", [0, 0, 1, 2, 4, 5, 3, 1, 0], 0.98, 0.92, 0, 0.004), makePaddleProfile("Rising Steps", [0, 1, 1, 2,
    2, 3, 3, 4, 4
  ], 0.97, 0.96, 0, 0.005), makePaddleProfile("Falling Steps", [4, 4, 3, 3, 2, 2, 1, 1, 0], 0.96, 1, 0, 0.006),
  makePaddleProfile("Hourglass", [4, 3, 1, 0, 0, 0, 1, 3, 4], 0.95, 1.04, 0, 0.008), makePaddleProfile("Diamond", [0,
    1, 3, 5, 7, 5, 3, 1, 0
  ], 0.94, 1.08, 0, 0.01), makePaddleProfile("Gentle Crown", [0, 1, 2, 3, 4, 3, 2, 1, 0], 0.95, 0.9, 0, 0.004),
  makePaddleProfile("Shallow Cup II", [3, 2, 1, 0, 0, 0, 1, 2, 3], 0.94, 0.94, 0, 0.005), makePaddleProfile(
    "Rising Ramp II", [0, 0, 1, 1, 2, 2, 3, 3, 4], 0.93, 0.98, 0, 0.006), makePaddleProfile("Falling Ramp II", [4, 3,
    3, 2, 2, 1, 1, 0, 0
  ], 0.92, 1.02, 0, 0.007), makePaddleProfile("Late Diamond", [0, 1, 2, 4, 5, 4, 2, 1, 0], 0.91, 1.06, 0, 0.008),
  makePaddleProfile("Final Ridge", [0, 2, 1, 3, 2, 4, 2, 3, 0], 0.9, 1.1, 0, 0.009)
];
const ENEMY_PADDLE_PROFILES = [DEFAULT_PADDLE_PROFILE, DEFAULT_PADDLE_PROFILE, makePaddleProfile("Center Crown", [0, 1,
    3, 5, 6, 5, 3, 1, 0
  ], 1.05, 0.76, 0.04), makePaddleProfile("Broad Crown", [0, 2, 4, 5, 5, 5, 4, 2, 0], 1.06, 0.8, 0.06),
  makePaddleProfile("Upper Lens", [0, 1, 3, 6, 7, 5, 3, 1, 0], 1.07, 0.84, 0.08), makePaddleProfile("Lower Lens", [0,
    1, 3, 5, 7, 6, 3, 1, 0
  ], 1.08, 0.88, 0.1), makePaddleProfile("Twin Crown", [0, 3, 5, 2, 0, 2, 5, 3, 0], 1.09, 0.92, 0.12),
  makePaddleProfile("Guided Cup", [5, 4, 2, 1, 0, 1, 2, 4, 5], 1.1, 0.96, 0.14), makePaddleProfile("Rising Ramp", [0,
    1, 2, 3, 4, 5, 6, 7, 8
  ], 1.11, 1, 0.16), makePaddleProfile("Falling Ramp", [8, 7, 6, 5, 4, 3, 2, 1, 0], 1.12, 1.04, 0.18),
  makePaddleProfile("Top Flare", [0, 3, 6, 7, 5, 3, 2, 1, 0], 1.13, 1.08, 0.2), makePaddleProfile("Bottom Flare", [0,
    1, 2, 3, 5, 7, 6, 3, 0
  ], 1.14, 1.12, 0.22), makePaddleProfile("Precision Diamond", [0, 2, 4, 6, 8, 6, 4, 2, 0], 1.12, 1.08, 0.22),
  makePaddleProfile("Precision Cup", [6, 4, 2, 1, 0, 1, 2, 4, 6], 1.13, 1.11, 0.23), makePaddleProfile("Triple Facet",
    [1, 4, 2, 5, 1, 5, 2, 4, 1], 1.14, 1.14, 0.24), makePaddleProfile("Control Wave", [2, 5, 3, 1, 4, 6, 4, 1, 2],
    1.15, 1.17, 0.25), makePaddleProfile("Precision Ridge", [0, 3, 6, 4, 1, 5, 7, 4, 0], 1.16, 1.2, 0.26),
  makePaddleProfile("King Crown", [1, 4, 7, 4, 1, 4, 7, 4, 1], 1.17, 1.23, 0.27)
];
const BOSS_ADAPTIVE_PROFILES = [makePaddleProfile("Adaptive Flat", [0, 0, 0, 0, 0, 0, 0, 0, 0], 0.88, 1.25),
  makePaddleProfile("Adaptive Up Ramp", [0, 1, 2, 3, 4, 5, 6, 7, 8], 0.86, 1.85, 0, 0, -0.1), makePaddleProfile(
    "Adaptive Down Ramp", [8, 7, 6, 5, 4, 3, 2, 1, 0], 0.86, 1.85, 0, 0, 0.1), makePaddleProfile(
    "Adaptive Upper Hook", [0, 1, 4, 8, 7, 4, 2, 1, 0], 0.84, 1.95, 0, 0, -0.18), makePaddleProfile(
    "Adaptive Lower Hook", [0, 1, 2, 4, 7, 8, 4, 1, 0], 0.84, 1.95, 0, 0, 0.18), makePaddleProfile("Adaptive Crown", [
    0, 2, 5, 8, 10, 8, 5, 2, 0
  ], 0.82, 2.05), makePaddleProfile("Adaptive Cup", [9, 7, 4, 2, 0, 2, 4, 7, 9], 0.82, 2.05), makePaddleProfile(
    "Adaptive Saw Up", [0, 5, 1, 7, 2, 8, 3, 6, 1], 0.8, 2.15, 0, 0, -0.24), makePaddleProfile("Adaptive Saw Down", [
    1, 6, 3, 8, 2, 7, 1, 5, 0
  ], 0.8, 2.15, 0, 0, 0.24)
];
