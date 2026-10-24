const CAMPAIGNS = [{
  id: "training",
  name: "Training Circuit",
  shortName: "Training",
  accent: "#60d8ff",
  levels: [{
    name: "Open Court",
    goal: 3,
    ballSpeed: 4.1,
    maxSpeed: 8.7,
    hazards: []
  }, {
    name: "Center Post",
    goal: 3,
    ballSpeed: 4.25,
    maxSpeed: 9,
    hazards: [{
      type: "rect",
      x: W / 2 - 5,
      y: H / 2 - 58,
      w: 10,
      h: 116,
      bounce: 0.15
    }]
  }, {
    name: "Split Gate",
    goal: 4,
    ballSpeed: 4.35,
    maxSpeed: 9.2,
    hazards: [{
      type: "rect",
      x: W / 2 - 7,
      y: 58,
      w: 14,
      h: 112,
      bounce: 0.2
    }, {
      type: "rect",
      x: W / 2 - 7,
      y: 310,
      w: 14,
      h: 112,
      bounce: 0.2
    }]
  }, {
    name: "Side Rails",
    goal: 4,
    ballSpeed: 4.5,
    maxSpeed: 9.5,
    hazards: [{
      type: "rect",
      x: 104,
      y: 70,
      w: 12,
      h: 86,
      bounce: 0.25
    }, {
      type: "rect",
      x: 104,
      y: 326,
      w: 12,
      h: 86,
      bounce: 0.25
    }, {
      type: "rect",
      x: W - 116,
      y: 70,
      w: 12,
      h: 86,
      bounce: 0.25
    }, {
      type: "rect",
      x: W - 116,
      y: 326,
      w: 12,
      h: 86,
      bounce: 0.25
    }]
  }, {
    name: "Drift Blocks",
    goal: 4,
    ballSpeed: 4.65,
    maxSpeed: 9.8,
    hazards: [{
      type: "rect",
      x: W / 2 - 52,
      y: 96,
      w: 18,
      h: 72,
      vy: 1.15,
      minY: 62,
      maxY: 178,
      bounce: 0.25
    }, {
      type: "rect",
      x: W / 2 + 34,
      y: 312,
      w: 18,
      h: 72,
      vy: -1.15,
      minY: 238,
      maxY: 354,
      bounce: 0.25
    }]
  }, {
    name: "Pinball Warmup",
    goal: 5,
    ballSpeed: 4.75,
    maxSpeed: 10.1,
    hazards: [{
      type: "circle",
      x: 278,
      y: 150,
      r: 16,
      boost: 0.35
    }, {
      type: "circle",
      x: 362,
      y: 330,
      r: 16,
      boost: 0.35
    }, {
      type: "rect",
      x: 126,
      y: H / 2 - 48,
      w: 10,
      h: 96,
      bounce: 0.18
    }, {
      type: "rect",
      x: W - 136,
      y: H / 2 - 48,
      w: 10,
      h: 96,
      bounce: 0.18
    }]
  }]
}, {
  id: "ricochet",
  name: "Ricochet League",
  shortName: "Ricochet",
  accent: "#f8c35a",
  levels: [{
    name: "Twin Bumpers",
    goal: 4,
    ballSpeed: 4.95,
    maxSpeed: 10.4,
    hazards: [{
      type: "circle",
      x: 282,
      y: 180,
      r: 18,
      boost: 0.45
    }, {
      type: "circle",
      x: 358,
      y: 300,
      r: 18,
      boost: 0.45
    }]
  }, {
    name: "Shifting Gate",
    goal: 4,
    ballSpeed: 5.05,
    maxSpeed: 10.8,
    hazards: [{
      type: "rect",
      x: W / 2 - 9,
      y: 72,
      w: 18,
      h: 92,
      vy: 1.45,
      minY: 54,
      maxY: 190,
      bounce: 0.3
    }, {
      type: "rect",
      x: W / 2 - 9,
      y: 316,
      w: 18,
      h: 92,
      vy: -1.45,
      minY: 236,
      maxY: 344,
      bounce: 0.3
    }]
  }, {
    name: "Mirror Sides",
    goal: 5,
    ballSpeed: 5.15,
    maxSpeed: 11,
    hazards: [{
      type: "rect",
      x: 90,
      y: 74,
      w: 14,
      h: 82,
      vy: 1.2,
      minY: 42,
      maxY: 190,
      bounce: 0.35
    }, {
      type: "rect",
      x: 90,
      y: 326,
      w: 14,
      h: 82,
      vy: -1.2,
      minY: 248,
      maxY: 356,
      bounce: 0.35
    }, {
      type: "rect",
      x: W - 104,
      y: 74,
      w: 14,
      h: 82,
      vy: 1.2,
      minY: 42,
      maxY: 190,
      bounce: 0.35
    }, {
      type: "rect",
      x: W - 104,
      y: 326,
      w: 14,
      h: 82,
      vy: -1.2,
      minY: 248,
      maxY: 356,
      bounce: 0.35
    }]
  }, {
    name: "Cross Traffic",
    goal: 5,
    ballSpeed: 5.25,
    maxSpeed: 11.3,
    hazards: [{
      type: "rect",
      x: 250,
      y: 138,
      w: 64,
      h: 12,
      vx: 1.55,
      minX: 190,
      maxX: 378,
      bounce: 0.32
    }, {
      type: "rect",
      x: 326,
      y: 330,
      w: 64,
      h: 12,
      vx: -1.55,
      minX: 190,
      maxX: 378,
      bounce: 0.32
    }, {
      type: "circle",
      x: W / 2,
      y: H / 2,
      r: 14,
      boost: 0.3
    }]
  }, {
    name: "Quad Posts",
    goal: 5,
    ballSpeed: 5.35,
    maxSpeed: 11.5,
    hazards: [{
      type: "rect",
      x: 252,
      y: 80,
      w: 14,
      h: 80,
      bounce: 0.24
    }, {
      type: "rect",
      x: 374,
      y: 80,
      w: 14,
      h: 80,
      bounce: 0.24
    }, {
      type: "rect",
      x: 252,
      y: 320,
      w: 14,
      h: 80,
      bounce: 0.24
    }, {
      type: "rect",
      x: 374,
      y: 320,
      w: 14,
      h: 80,
      bounce: 0.24
    }, {
      type: "circle",
      x: W / 2,
      y: H / 2,
      r: 17,
      boost: 0.45
    }]
  }, {
    name: "Pinball Alley",
    goal: 5,
    ballSpeed: 5.2,
    maxSpeed: 11,
    hazards: [{
      type: "circle",
      x: 240,
      y: 120,
      r: 15,
      boost: 0.38
    }, {
      type: "circle",
      x: 320,
      y: 240,
      r: 18,
      boost: 0.38
    }, {
      type: "circle",
      x: 400,
      y: 360,
      r: 15,
      boost: 0.38
    }, {
      type: "rect",
      x: 132,
      y: 160,
      w: 12,
      h: 160,
      vy: 1.1,
      minY: 84,
      maxY: 236,
      bounce: 0.23
    }, {
      type: "rect",
      x: W - 144,
      y: 160,
      w: 12,
      h: 160,
      vy: -1.1,
      minY: 84,
      maxY: 236,
      bounce: 0.23
    }]
  }]
}, {
  id: "chaos",
  name: "Chaos Cup",
  shortName: "Chaos",
  accent: "#ff66cc",
  levels: [{
    name: "Sweepers",
    goal: 5,
    ballSpeed: 5.25,
    maxSpeed: 11.15,
    hazards: [{
      type: "rect",
      x: 238,
      y: 116,
      w: 58,
      h: 9,
      vx: 0.28,
      minX: 210,
      maxX: 342,
      bounce: 0.2
    }, {
      type: "rect",
      x: 344,
      y: 355,
      w: 58,
      h: 9,
      vx: -0.28,
      minX: 238,
      maxX: 370,
      bounce: 0.2
    }]
  }, {
    name: "Fortress",
    goal: 5,
    ballSpeed: 5.35,
    maxSpeed: 11.35,
    hazards: [{
      type: "rect",
      x: 282,
      y: 126,
      w: 10,
      h: 40,
      bounce: 0.17
    }, {
      type: "rect",
      x: 348,
      y: 314,
      w: 10,
      h: 40,
      bounce: 0.17
    }]
  }, {
    name: "Side Shuffle",
    goal: 5,
    ballSpeed: 5.45,
    maxSpeed: 11.55,
    hazards: [{
      type: "circle",
      x: 170,
      y: 150,
      r: 11,
      vy: 0.36,
      minY: 124,
      maxY: 356,
      boost: 0.25
    }, {
      type: "circle",
      x: W - 170,
      y: 330,
      r: 11,
      vy: -0.36,
      minY: 124,
      maxY: 356,
      boost: 0.25
    }]
  }, {
    name: "Vortex",
    goal: 5,
    ballSpeed: 5.55,
    maxSpeed: 11.75,
    hazards: [{
      type: "circle",
      x: 274,
      y: 184,
      r: 11,
      vx: 0.3,
      vy: 0.24,
      minX: 238,
      maxX: 324,
      minY: 148,
      maxY: 224,
      boost: 0.25
    }, {
      type: "circle",
      x: 366,
      y: 296,
      r: 11,
      vx: -0.3,
      vy: -0.24,
      minX: 316,
      maxX: 402,
      minY: 256,
      maxY: 332,
      boost: 0.25
    }]
  }, {
    name: "Diamond Trap",
    goal: 5,
    ballSpeed: 5.65,
    maxSpeed: 11.95,
    hazards: [{
      type: "circle",
      x: W / 2,
      y: H / 2 - 72,
      r: 10,
      boost: 0.26
    }, {
      type: "circle",
      x: W / 2 - 72,
      y: H / 2 + 28,
      r: 10,
      boost: 0.26
    }, {
      type: "circle",
      x: W / 2 + 72,
      y: H / 2 + 28,
      r: 10,
      boost: 0.26
    }, {
      type: "circle",
      x: W / 2,
      y: H / 2 + 82,
      r: 10,
      boost: 0.27
    }]
  }, {
    name: "Final Firewall",
    goal: 6,
    ballSpeed: 5.75,
    maxSpeed: 12.15,
    hazards: [{
      type: "rect",
      x: W / 2 - 7,
      y: 82,
      w: 14,
      h: 48,
      vy: 0.32,
      minY: 70,
      maxY: 150,
      bounce: 0.21
    }, {
      type: "rect",
      x: W / 2 - 7,
      y: 218,
      w: 14,
      h: 48,
      vy: -0.32,
      minY: 198,
      maxY: 234,
      bounce: 0.21
    }, {
      type: "rect",
      x: W / 2 - 7,
      y: 354,
      w: 14,
      h: 48,
      vy: 0.32,
      minY: 330,
      maxY: 376,
      bounce: 0.21
    }, {
      type: "circle",
      x: 214,
      y: 158,
      r: 10,
      vx: 0.24,
      minX: 182,
      maxX: 272,
      boost: 0.28
    }, {
      type: "circle",
      x: 426,
      y: 322,
      r: 10,
      vx: -0.24,
      minX: 368,
      maxX: 458,
      boost: 0.28
    }]
  }]
}];
const BOSS_LEVEL = {
  name: "The Hidden Wall",
  goal: 0,
  ballSpeed: 4.45,
  maxSpeed: 9.9,
  hazards: [{
    type: "rect",
    x: W / 2 - 7,
    y: 82,
    w: 14,
    h: 72,
    bounce: 0.18,
    color: "#9d4dff"
  }, {
    type: "rect",
    x: W / 2 - 7,
    y: H - 154,
    w: 14,
    h: 72,
    bounce: 0.18,
    color: "#9d4dff"
  }, {
    type: "circle",
    x: W / 2 - 92,
    y: H / 2,
    r: 12,
    boost: 0.26,
    color: "#b14dff"
  }, {
    type: "circle",
    x: W / 2 + 92,
    y: H / 2,
    r: 12,
    boost: 0.26,
    color: "#b14dff"
  }, {
    type: "rect",
    x: W / 2 - 34,
    y: H / 2 - 5,
    w: 68,
    h: 10,
    vx: 0.65,
    minX: W / 2 - 64,
    maxX: W / 2 - 4,
    bounce: 0.2,
    color: "#6e28d9"
  }]
};
const BOSS_CAMPAIGN = {
  id: "secret-boss",
  name: "Secret Boss",
  shortName: "Boss",
  accent: "#b14dff",
  levels: [BOSS_LEVEL]
};
