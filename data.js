export const VERSION = "hsf-1.0.0";
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export const ATTR = [
  "speed",
  "acceleration",
  "agility",
  "strength",
  "stamina",
  "awareness",
  "intelligence",
  "throwPower",
  "accuracy",
  "decision",
  "catching",
  "route",
  "release",
  "runBlock",
  "passBlock",
  "shed",
  "rush",
  "tackle",
  "pursuit",
  "coverage",
  "security",
  "kicking",
  "punting",
];
const specs = [
  [
    "Red Creek",
    "Rams",
    "#981e35",
    "#edc458",
    "Power & counter",
    "Heavy hands. Downhill backs. Protect the edges.",
    {
      runBlock: 15,
      strength: 12,
      security: 7,
      speed: -6,
      passBlock: -8,
      accuracy: -4,
    },
  ],
  [
    "Eastview",
    "Lightning",
    "#1378e5",
    "#cbd4e0",
    "Air Raid",
    "Win through timing, spacing, and a clean pocket.",
    {
      accuracy: 16,
      catching: 13,
      route: 10,
      passBlock: 12,
      strength: -10,
      runBlock: -8,
    },
  ],
  [
    "Pine Valley",
    "Wildcats",
    "#18563d",
    "#f0f2e8",
    "Option",
    "Athletic backs and a quarterback built for the mesh.",
    { speed: 10, agility: 12, decision: 8, accuracy: -12, strength: -8 },
  ],
  [
    "Ironwood",
    "Tigers",
    "#171b22",
    "#ee892f",
    "Multiple",
    "A dependable roster that rewards a balanced call sheet.",
    { awareness: 6, decision: 6, security: 6 },
  ],
  [
    "Summit Ridge",
    "Hawks",
    "#633b96",
    "#eec653",
    "Speed & space",
    "Create space for explosive slots. Avoid a phone booth.",
    {
      speed: 16,
      acceleration: 13,
      agility: 8,
      strength: -12,
      runBlock: -9,
      decision: -9,
    },
  ],
  [
    "Stonebridge",
    "Bulldogs",
    "#182d51",
    "#c3cbd6",
    "Ball control",
    "Let the defense and kicking game dictate the field.",
    {
      tackle: 16,
      shed: 13,
      rush: 12,
      pursuit: 10,
      accuracy: -12,
      route: -8,
      speed: -5,
      kicking: 9,
    },
  ],
  [
    "Blackwater",
    "Cobras",
    "#188b88",
    "#101b20",
    "Dual threat",
    "Build around an electric quarterback. Protect the football.",
    { speed: 7, agility: 8, runBlock: 5, security: -9, coverage: -9 },
  ],
  [
    "Westfield",
    "Falcons",
    "#702b42",
    "#f7f0e4",
    "West Coast",
    "Disciplined routes. Smart reads. Throw on schedule.",
    {
      intelligence: 15,
      decision: 14,
      route: 14,
      awareness: 13,
      speed: -5,
      agility: -4,
    },
  ],
];
const first = [
  "Mason",
  "Eli",
  "Noah",
  "Isaiah",
  "Caleb",
  "Jace",
  "Micah",
  "Owen",
  "Carter",
  "Miles",
  "Wyatt",
  "Cole",
  "Luke",
  "Nolan",
  "Ty",
  "Asher",
  "Drew",
  "Landon",
  "Kai",
  "Jonah",
  "Tate",
  "Finn",
  "Zane",
  "Roman",
  "Hayes",
  "Theo",
  "Beau",
  "Dante",
  "Silas",
  "Gavin",
  "Jude",
  "Malik",
  "Levi",
  "Bennett",
  "Dax",
  "Reed",
  "Cam",
  "Amir",
  "Logan",
  "Grant",
  "Ezra",
  "Brooks",
  "Bryce",
  "Austin",
];
const last = [
  "Walker",
  "Mitchell",
  "Hayes",
  "Reynolds",
  "Bennett",
  "Cruz",
  "Carter",
  "Brooks",
  "Sullivan",
  "Foster",
  "Marshall",
  "Griffin",
  "Simmons",
  "Harris",
  "Douglas",
  "Lawson",
  "Pierce",
  "Reeves",
  "Johnson",
  "Porter",
  "Davis",
  "Reed",
  "Parker",
  "Morris",
  "Grant",
  "Collins",
  "Bell",
  "Ward",
  "Ramsey",
  "Fields",
  "Turner",
  "Mills",
  "Hughes",
  "Fox",
  "West",
  "King",
  "Gray",
  "Cohen",
  "Price",
  "Ellis",
  "James",
  "Wells",
  "Ford",
  "Ross",
];
const positions = [
  "QB",
  "RB",
  "WR",
  "WR",
  "TE",
  "C",
  "G",
  "G",
  "T",
  "T",
  "WR",
  "DE",
  "DT",
  "DT",
  "DE",
  "LB",
  "LB",
  "LB",
  "CB",
  "CB",
  "S",
  "S",
  "K",
  "P",
];
const nums = [
  12, 22, 1, 8, 88, 55, 62, 64, 71, 74, 3, 91, 95, 97, 99, 42, 44, 48, 7, 9, 2,
  4, 16, 18,
];
export function makeRoster(teamIndex, year = 2026) {
  const r = rng(3000 + teamIndex * 97 + year);
  return Array.from({ length: 44 }, (_, i) => {
    const p = positions[i % 24],
      rating = {};
    for (const a of ATTR)
      rating[a] = clamp(
        Math.round(55 + r() * 20 + (specs[teamIndex]?.[6][a] || 0)),
        25,
        98,
      );
    if (["C", "G", "T", "DT"].includes(p)) {
      rating.speed -= 18;
      rating.strength += 12;
      rating.runBlock += 9;
      rating.passBlock += 7;
    }
    if (["WR", "CB", "S"].includes(p)) {
      rating.speed += 7;
      rating.strength -= 7;
      rating.catching += 7;
    }
    if (p === "QB") {
      rating.accuracy += 8;
      rating.throwPower += 10;
      rating.decision += 8;
      if (teamIndex === 6) {
        rating.speed = 91;
        rating.accuracy = 85;
        rating.throwPower = 91;
      }
    }
    if (["K", "P"].includes(p)) {
      rating.kicking = 70 + Math.floor(r() * 20);
      rating.punting = 70 + Math.floor(r() * 20);
    }
    if (i >= 24) for (const a of ATTR) rating[a] -= 7;
    if (i === 1 && teamIndex === 0) rating.strength = 95;
    for (const a of ATTR) rating[a] = clamp(rating[a], 20, 99);
    return {
      id: `t${teamIndex}p${year}-${i}`,
      name: `${first[(i + teamIndex * 3) % 44]} ${last[(i * 7 + teamIndex * 5) % 44]}`,
      number:
        i < 24
          ? nums[i]
          : [
              15, 26, 11, 14, 89, 58, 65, 67, 75, 78, 6, 90, 96, 98, 92, 43, 45,
              49, 5, 10,
            ][i - 24],
      pos: p,
      grade: 9 + Math.floor(r() * 4),
      height: Math.round(
        (["C", "G", "T", "DT"].includes(p) ? 72 : 68) + r() * 6,
      ),
      weight: Math.round(
        (["C", "G", "T", "DT"].includes(p) ? 225 : 160) + r() * 40,
      ),
      ratings: rating,
      potential: 60 + Math.floor(r() * 39),
    };
  });
}
export const TEAMS = specs.map((s, i) => ({
  id: i,
  school: s[0],
  mascot: s[1],
  primary: s[2],
  secondary: s[3],
  scheme: s[4],
  description: s[5],
  roster: makeRoster(i),
}));
export const SLOT = [
  "LT",
  "LG",
  "C",
  "RG",
  "RT",
  "X",
  "Y",
  "Z",
  "H",
  "RB",
  "QB",
];
export const baseSlots = () =>
  [
    [-3, 0, "T"],
    [-1.5, 0, "G"],
    [0, 0, "C"],
    [1.5, 0, "G"],
    [3, 0, "T"],
    [-21, 0, "WR"],
    [5, 0, "TE"],
    [21, -1.5, "WR"],
    [-10, -1.5, "WR"],
    [3, -5, "RB"],
    [0, -5, "QB"],
  ].map((v, i) => ({
    id: SLOT[i],
    x: v[0],
    y: v[1],
    pos: v[2],
    assignment: i < 5 ? "pass" : i === 10 ? "quarterback" : "route",
    path:
      i < 5 || i === 10
        ? []
        : [
            [v[0], 8],
            [v[0], 22],
          ],
    delay: 0,
    target: "nearest",
    option: "none",
    motion: [],
    shift: [],
  }));
export const BLOCKS = [
  "pass",
  "slide",
  "man",
  "zone",
  "double",
  "pull",
  "trap",
  "reach",
  "down",
  "lead",
  "chip",
  "contain",
];
export const ROUTES = {
  Go: [[0, 25]],
  Slant: [
    [0, 4],
    [8, 12],
  ],
  Out: [
    [0, 9],
    [10, 9],
  ],
  In: [
    [0, 10],
    [-12, 10],
  ],
  Post: [
    [0, 12],
    [-10, 25],
  ],
  Corner: [
    [0, 12],
    [10, 23],
  ],
  Curl: [
    [0, 12],
    [0, 10],
  ],
  Flat: [
    [8, 1],
    [15, 2],
  ],
  Wheel: [
    [10, 2],
    [12, 22],
  ],
  Screen: [
    [0, -2],
    [6, -2],
  ],
  Drag: [
    [0, 3],
    [18, 3],
  ],
  Seam: [[0, 20]],
};
export function routeFor(slot, name) {
  return ROUTES[name].map(([x, y]) => [
    clamp(slot.x + x * (slot.x < 0 ? -1 : 1), -26, 26),
    slot.y + y,
  ]);
}
function play(id, name, concept, kind = "pass", formation = "Spread") {
  return {
    id,
    name,
    concept,
    kind,
    formation,
    tags: [],
    slots: baseSlots(),
    reads: ["X", "H", "Y", "Z", "RB"],
    drop: 5,
    release: 1.5,
    runner: "RB",
    readDefender: "DE",
    hot: "H",
    condition: "none",
    scramble: true,
    tempo: "normal",
  };
}
export function defaults() {
  const a = [];
  for (const [name, concept, routes] of [
    ["Four Verticals", "Vertical", ["Go", "Seam", "Go", "Seam", "Flat"]],
    ["Mesh", "Crossers", ["Post", "Corner", "Drag", "Drag", "Flat"]],
    ["Stick", "Quick", ["Go", "Out", "Go", "Curl", "Flat"]],
    ["Flood", "Boot", ["Post", "Corner", "Out", "Drag", "Flat"]],
    ["Drive", "West Coast", ["In", "Seam", "Go", "Drag", "Flat"]],
    ["Bubble Screen", "Screen", ["Go", "Go", "Go", "Screen", "Flat"]],
    ["Play Action Cross", "Play Action", ["Post", "In", "Go", "Drag", "Flat"]],
  ]) {
    const p = play(`o${a.length}`, name, concept);
    [5, 6, 7, 8, 9].forEach(
      (j, k) => (p.slots[j].path = routeFor(p.slots[j], routes[k])),
    );
    if (concept === "Quick") p.release = 0.9;
    if (concept === "Play Action") p.release = 2.2;
    a.push(p);
  }
  for (const [name, kind, blocks, path] of [
    [
      "Inside Zone",
      "run",
      "zone",
      [
        [1, -3],
        [1, 2],
        [4, 20],
      ],
    ],
    [
      "Outside Zone",
      "run",
      "reach",
      [
        [5, -3],
        [9, 1],
        [14, 20],
      ],
    ],
    [
      "Power Right",
      "run",
      "down",
      [
        [2, -3],
        [4, 2],
        [4, 20],
      ],
    ],
    [
      "Counter Left",
      "run",
      "down",
      [
        [4, -4],
        [-4, -2],
        [-5, 6],
        [-7, 20],
      ],
    ],
    [
      "Trap",
      "run",
      "man",
      [
        [1, -2],
        [0, 10],
      ],
    ],
    [
      "Dive",
      "run",
      "man",
      [
        [0, -2],
        [0, 18],
      ],
    ],
    [
      "Jet Sweep",
      "run",
      "reach",
      [
        [5, -2],
        [16, -1],
        [20, 20],
      ],
    ],
    [
      "Toss Right",
      "run",
      "reach",
      [
        [10, -4],
        [17, 0],
        [17, 20],
      ],
    ],
    [
      "Draw",
      "run",
      "pass",
      [
        [2, -4],
        [0, 2],
        [0, 20],
      ],
    ],
    [
      "QB Power",
      "qb",
      "down",
      [
        [2, -3],
        [4, 4],
        [6, 20],
      ],
    ],
    [
      "Read Option",
      "option",
      "zone",
      [
        [5, -3],
        [7, 3],
        [10, 20],
      ],
    ],
    [
      "Triple Option",
      "triple",
      "zone",
      [
        [6, -3],
        [14, 2],
        [18, 22],
      ],
    ],
    [
      "RPO Glance",
      "rpo",
      "zone",
      [
        [2, -2],
        [1, 20],
      ],
    ],
  ]) {
    const p = play(`o${a.length}`, name, name, kind, "Multiple");
    p.slots.slice(0, 5).forEach((s) => (s.assignment = blocks));
    p.slots[9].assignment = "run";
    p.slots[9].path = path;
    p.slots[6].assignment = "lead";
    p.slots[6].path = [
      [5, 1],
      [5, 8],
    ];
    if (name.includes("Power") || name.includes("Counter") || name === "Trap") {
      p.slots[1].assignment = name === "Trap" ? "trap" : "pull";
      p.slots[1].path = [
        [0, -2],
        [5, -2],
        [5, 5],
      ];
    }
    if (kind === "qb") {
      p.runner = "QB";
      p.slots[10].path = path;
      p.slots[9].assignment = "lead";
    }
    if (kind === "rpo") {
      p.slots[5].path = routeFor(p.slots[5], "Slant");
      p.reads = ["X"];
      p.release = 0.9;
    }
    a.push(p);
  }
  a.push({ ...play("kneel", "Victory Kneel", "Clock", "kneel"), release: 0.7 });
  a.push({ ...play("spike", "Clock Spike", "Clock", "spike"), release: 0.15 });
  return a;
}
export function defenseDefaults() {
  return ["Cover 3", "Cover 2", "Cover 1 Man", "Blitz"].map((name, i) => ({
    id: `d${i}`,
    name,
    weight: [40, 30, 20, 10][i],
    situation: "any",
    slots: Array.from({ length: 11 }, (_, j) => ({
      id: `D${j}`,
      x: [-5, -1.7, 1.7, 5, -5, 0, 5, -20, 20, -9, 9][j],
      y: [1, 1, 1, 1, 5, 5, 5, 4, 4, 14, 14][j],
      pos: ["DE", "DT", "DT", "DE", "LB", "LB", "LB", "CB", "CB", "S", "S"][j],
      assignment:
        j < 4 || (i === 3 && j < 7)
          ? "rush"
          : i === 2
            ? "man"
            : i === 0
              ? j >= 9 || j === 7
                ? "deep"
                : "zone"
              : i === 1
                ? j >= 9
                  ? "deep"
                  : "zone"
                : "man",
      target: ["X", "Y", "Z", "H", "RB"][Math.max(0, j - 4) % 5],
      zone: [
        [-5, 0],
        [-2, 0],
        [2, 0],
        [5, 0],
        [-12, 7],
        [0, 8],
        [12, 7],
        [-20, 16],
        [20, 16],
        [-9, 24],
        [9, 24],
      ][j],
      stunt: 0,
      contain: j === 0 || j === 3,
    })),
  }));
}
export function validateFormation(p) {
  const issues = [],
    line = p.slots.filter((s) => Math.abs(s.y) < 0.4).sort((a, b) => a.x - b.x),
    back = p.slots.filter((s) => s.y < -0.4);
  if (p.slots.length !== 11)
    issues.push("Exactly 11 offensive players required.");
  if (back.length > 4) issues.push("No more than four backs.");
  if (line.length < 7)
    issues.push("With 11 players, at least seven must be on the line.");
  if (
    p.slots.filter(
      (s) => ["C", "G", "T"].includes(s.pos) && Math.abs(s.y) < 0.4,
    ).length < 5
  )
    issues.push("Five numbered linemen must be on the line.");
  if (p.slots.some((s) => s.y > 0.4))
    issues.push("Offensive player beyond the neutral zone.");
  for (const s of line.slice(1, -1))
    if (["route", "run"].includes(s.assignment))
      issues.push(`${s.id} is covered on the line and ineligible.`);
  if (p.slots.filter((s) => s.motion?.length).length > 1)
    issues.push("Only one player may be in motion at the snap.");
  for (const s of p.slots) {
    if (s.motion?.length && s.y >= -0.4)
      issues.push(`${s.id} must shift into the backfield before motion.`);
    const m = s.motion;
    if (m?.length > 1 && m.at(-1)[1] > m.at(-2)[1])
      issues.push("Motion cannot be toward the goal line at the snap.");
  }
  return [...new Set(issues)];
}
export function selectDefense(book, visible, state, seed) {
  const r = rng(seed),
    weighted = book.map((d) => {
      let w = Math.max(0, +d.weight || 0);
      if (
        (d.situation === "long" && state.distance < 7) ||
        (d.situation === "short" && state.distance > 3) ||
        (d.situation === "redzone" && state.ball < 80)
      )
        w = 0;
      const rush = d.slots.filter((s) => s.assignment === "rush").length,
        deep = d.slots.filter((s) => s.assignment === "deep").length;
      if (state.distance >= 8 && state.down >= 3) w *= 1 + deep * 0.35;
      if (state.ball > 92 || state.distance <= 2)
        w *= 1 + Math.max(0, rush - 4) * 0.3;
      if (visible.receivers >= 4 && deep) w *= 1.25;
      const offenseStats = state.stats?.[state.possession],
        runRate = offenseStats?.plays
          ? (offenseStats.plays - offenseStats.attempts) / offenseStats.plays
          : 0.5;
      if (offenseStats?.plays > 6)
        w *= 1 + (runRate - 0.5) * Math.max(0, rush - 3) * 0.4;
      const trailing =
        state.score &&
        state.score[1 - state.possession] < state.score[state.possession];
      if (trailing && state.quarter === 4 && state.clock < 180 && rush > 4)
        w *= 1.35;
      const roster = state.teams?.[1 - state.possession]?.roster || [],
        tired = roster.length
          ? roster.reduce((n, p) => n + (state.fatigue?.[p.id] || 0), 0) /
            roster.length
          : 0;
      if (rush > 4) w *= 1 - tired * 0.4;
      return w;
    });
  let v = r() * weighted.reduce((s, x) => s + x, 0);
  if (!weighted.some(Boolean)) return defenseDefaults()[0];
  return book[weighted.findIndex((w) => (v -= w) < 0)] || book.at(-1);
}
export function lineup(team, slots, fatigue = {}) {
  const used = new Set();
  return slots.map((s) => {
    const candidates = team.roster.filter((p) => !used.has(p.id));
    candidates.sort((a, b) => {
      const score = (p) =>
        (p.pos === s.pos
          ? 100
          : ["WR", "TE"].includes(s.pos) && ["WR", "TE"].includes(p.pos)
            ? 75
            : 0) +
        Object.values(p.ratings).reduce((a, b) => a + b, 0) / ATTR.length -
        (fatigue[p.id] || 0) * 35;
      return score(b) - score(a);
    });
    const preferred = candidates.find((p) => p.id === s.athlete);
    const p =
      preferred && (fatigue[preferred.id] || 0) < 0.8
        ? preferred
        : candidates[0];
    used.add(p.id);
    return clone(p);
  });
}
export function teamFit(team, book) {
  const passing = book.filter((p) => ["pass", "rpo"].includes(p.kind)),
    option = book.filter((p) => ["option", "triple", "qb"].includes(p.kind));
  const slots = baseSlots(),
    l = lineup(team, slots),
    avg = (players, keys) =>
      players.reduce(
        (s, p) => s + keys.reduce((a, k) => a + p.ratings[k], 0) / keys.length,
        0,
      ) / players.length;
  const pass =
    avg([l[10]], ["accuracy", "throwPower", "decision"]) * 0.4 +
    avg(l.slice(5, 9), ["speed", "route", "catching"]) * 0.35 +
    avg(l.slice(0, 5), ["passBlock"]) * 0.25;
  const run =
    avg([l[9]], ["speed", "agility", "security", "strength"]) * 0.4 +
    avg(l.slice(0, 5), ["runBlock", "strength"]) * 0.6;
  const opt =
    avg([l[10], l[9]], ["speed", "decision", "security"]) * 0.6 +
    avg(l.slice(0, 5), ["runBlock", "agility"]) * 0.4;
  return {
    score: Math.round(
      (pass * passing.length +
        opt * option.length +
        run * (book.length - passing.length - option.length)) /
        Math.max(1, book.length),
    ),
    pass: Math.round(pass),
    run: Math.round(run),
    option: Math.round(opt),
  };
}
