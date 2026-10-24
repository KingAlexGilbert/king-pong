function getCpuConfig() {
  if (mode === 4) {
    return {
      reaction: 0.108,
      maxMove: 5.4,
      prediction: 0.58,
      error: 24,
      deadZone: 6,
      horizon: 150,
      label: 88
    };
  }
  if (mode === 3) {
    const t = clamp(customCpuIntel / 100, 0, 1);
    return {
      reaction: lerp(0.026, 0.21, t),
      maxMove: customCpuMaxMove,
      prediction: lerp(0.06, 1, t),
      error: lerp(96, 2, t),
      deadZone: lerp(26, 0.75, t),
      horizon: Math.round(45 + 245 * t),
      label: Math.round(customCpuIntel)
    };
  }
  const levelNumber = absoluteLevelNumber();
  const t = clamp((levelNumber - 1) / (TOTAL_LEVELS - 1), 0, 1);
  if (levelNumber === 1) {
    return {
      reaction: 0.052,
      maxMove: 2.85,
      prediction: 0.3,
      error: 36,
      deadZone: 17,
      horizon: 95,
      label: 20
    };
  }
  if (levelNumber === 2) {
    return {
      reaction: 0.058,
      maxMove: 3,
      prediction: 0.34,
      error: 32,
      deadZone: 16,
      horizon: 105,
      label: 25
    };
  }
  if (levelNumber === 3) {
    return {
      reaction: 0.064,
      maxMove: 3.15,
      prediction: 0.38,
      error: 28,
      deadZone: 15,
      horizon: 115,
      label: 30
    };
  }
  if (levelNumber === 4) {
    return {
      reaction: 0.071,
      maxMove: 3.35,
      prediction: 0.39,
      error: 44,
      deadZone: 13.5,
      horizon: 125,
      label: 35
    };
  }
  if (levelNumber === 5) {
    return {
      reaction: 0.078,
      maxMove: 3.55,
      prediction: 0.45,
      error: 39,
      deadZone: 12,
      horizon: 135,
      label: 40
    };
  }
  if (levelNumber === 6) {
    return {
      reaction: 0.086,
      maxMove: 3.75,
      prediction: 0.51,
      error: 34,
      deadZone: 10.5,
      horizon: 145,
      label: 46
    };
  }
  if (levelNumber >= 13 && levelNumber <= 18) {
    const lateGameCpu = [{
      reaction: 0.144,
      maxMove: 6.2,
      prediction: 0.79,
      error: 19.5,
      deadZone: 5.7,
      horizon: 210,
      label: 76
    }, {
      reaction: 0.1385,
      maxMove: 5.92,
      prediction: 0.715,
      error: 28,
      deadZone: 7.8,
      horizon: 197,
      label: 78
    }, {
      reaction: 0.145,
      maxMove: 6.25,
      prediction: 0.8,
      error: 20,
      deadZone: 5.6,
      horizon: 212,
      label: 80
    }, {
      reaction: 0.143,
      maxMove: 6.15,
      prediction: 0.77,
      error: 23,
      deadZone: 6.4,
      horizon: 208,
      label: 82
    }, {
      reaction: 0.147,
      maxMove: 6.35,
      prediction: 0.82,
      error: 19,
      deadZone: 5.2,
      horizon: 216,
      label: 84
    }, {
      reaction: 0.155,
      maxMove: 6.7,
      prediction: 0.9,
      error: 11,
      deadZone: 3,
      horizon: 232,
      label: 86
    }];
    const base = lateGameCpu[levelNumber - 13];
    const deficit = mode === 1 ? Math.max(0, right.score - left.score) : 0;
    const assist = clamp(deficit / 2, 0, 1);
    if (assist <= 0) return base;
    return {
      reaction: base.reaction * lerp(1, 0.62, assist),
      maxMove: base.maxMove * lerp(1, 0.65, assist),
      prediction: base.prediction * lerp(1, 0.55, assist),
      error: base.error + 30 * assist,
      deadZone: base.deadZone + 7 * assist,
      horizon: Math.round(base.horizon * lerp(1, 0.9, assist)),
      label: base.label
    };
  }
  return {
    reaction: lerp(0.034, 0.185, t),
    maxMove: lerp(2.25, 7.85, t),
    prediction: lerp(0.12, 1, t),
    error: lerp(74, 4, t),
    deadZone: lerp(22, 1.25, t),
    horizon: Math.round(70 + 190 * t),
    label: Math.round(lerp(12, 100, t))
  };
}

function chooseCpuError() {
  const cfg = getCpuConfig();
  cpuErrorOffset = (Math.random() * 2 - 1) * cfg.error;
}
