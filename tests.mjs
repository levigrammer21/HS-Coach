import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAMS,
  ATTR,
  clone,
  rng,
  hash,
  defaults,
  defenseDefaults,
  validateFormation,
  selectDefense,
  teamFit,
} from "./data.js";
import { simulate, DT } from "./engine.js";
import {
  newGame,
  advance,
  runSnap,
  simulateKick,
  autoGame,
  timeout,
} from "./rules.js";
import {
  schedule,
  createFranchise,
  franchiseGame,
  finishWeek,
  nextYear,
  standings,
} from "./franchise.js";
const play = () => defaults()[0],
  call = () => defenseDefaults()[0];
const simulateSeed = (seed = 12, p = play(), c = call(), ball = 25) =>
  simulate({
    seed,
    offense: TEAMS[1],
    defense: TEAMS[0],
    play: p,
    call: c,
    ball,
    penalties: false,
  });
const fake = (r) => ({
  seed: 1,
  players: [],
  result: {
    reason: "tackle",
    yards: 4,
    duration: 5,
    turnover: false,
    pass: false,
    ...r,
  },
  play: { name: "Test" },
});
test("all eight official rosters have depth, unique identities and valid ratings", () => {
  assert.equal(TEAMS.length, 8);
  for (const t of TEAMS) {
    assert.equal(t.roster.length, 44);
    assert.equal(new Set(t.roster.map((p) => p.id)).size, 44);
    assert.equal(new Set(t.roster.map((p) => p.number)).size, 44);
    for (const p of t.roster) {
      assert.ok(p.name.includes(" "));
      for (const a of ATTR) assert.ok(p.ratings[a] >= 20 && p.ratings[a] <= 99);
    }
  }
  assert.notDeepEqual(TEAMS[0].roster, TEAMS[1].roster);
});
test("default installs are legal and include all offensive concepts", () => {
  for (const p of defaults())
    assert.deepEqual(validateFormation(p), [], p.name);
  for (const k of ["run", "pass", "option", "triple", "rpo", "qb"])
    assert.ok(defaults().some((p) => p.kind === k));
});
test("formation validator flags backs, covered receivers, numbering, motion and neutral zone", () => {
  const p = play();
  p.slots[6].y = -2;
  assert.ok(validateFormation(p).length);
  const q = play();
  q.slots[7].y = 0;
  q.slots[6].assignment = "route";
  assert.ok(validateFormation(q).some((x) => x.includes("ineligible")));
  const z = play();
  z.slots[8].motion = [
    [0, -2],
    [0, 0],
  ];
  assert.ok(validateFormation(z).some((x) => x.includes("toward")));
});
test("weighted defense excludes zeros, normalizes, respects eligibility and has safe fallback", () => {
  const d = defenseDefaults();
  d.forEach((x) => (x.weight = 0));
  d[2].weight = 17;
  for (let i = 0; i < 200; i++)
    assert.equal(
      selectDefense(d, { receivers: 4 }, { down: 2, distance: 10, ball: 30 }, i)
        .id,
      "d2",
    );
  d[2].situation = "short";
  assert.equal(
    selectDefense(d, { receivers: 4 }, { down: 3, distance: 12, ball: 40 }, 6)
      .id,
    "d0",
  );
  const d2 = defenseDefaults(),
    counts = {};
  for (let i = 1; i < 10000; i++) {
    const c = selectDefense(
      d2,
      { receivers: 2 },
      { down: 1, distance: 5, ball: 30 },
      i,
    );
    counts[c.id] = (counts[c.id] || 0) + 1;
  }
  assert.ok(
    counts.d0 > counts.d1 && counts.d1 > counts.d2 && counts.d2 > counts.d3,
  );
});
test("seeded simulation is exactly replayable and does not mutate the play or roster", () => {
  const p = play(),
    before = JSON.stringify(p),
    roster = JSON.stringify(TEAMS);
  const a = simulateSeed(17, p),
    b = simulateSeed(17, p);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(p), before);
  assert.equal(JSON.stringify(TEAMS), roster);
  assert.notDeepEqual(simulateSeed(18).frames, a.frames);
});
test("all 22 players occupy finite continuously sampled replay positions", () => {
  for (const c of defenseDefaults()) {
    const f = simulateSeed(52, play(), c);
    assert.equal(f.players.length, 22);
    assert.ok(f.frames.length > 2);
    for (const frame of f.frames) {
      assert.equal(frame.players.length, 22);
      for (const p of frame.players)
        for (const v of p.slice(0, 4)) assert.ok(Number.isFinite(v));
      for (const v of frame.ball) assert.ok(Number.isFinite(v));
    }
    assert.ok(f.frames.at(-1).t <= 22.1);
    assert.ok(f.events.some((e) => e.type === "read" || e.type === "tackle"));
  }
});
test("running assignments, pullers, options and custom routes affect real trajectories", () => {
  const p = defaults().find((p) => p.name === "Power Right"),
    a = simulateSeed(21, p);
  assert.ok(a.events.some((e) => e.type === "handoff"));
  const q = clone(p);
  q.slots[9].path = [
    [-15, -3],
    [-20, 10],
  ];
  const b = simulateSeed(21, q);
  assert.notDeepEqual(a.frames, b.frames);
  const c = play(),
    d = clone(c);
  d.reads = ["H"];
  d.slots[8].path = [
    [0, 3],
    [20, 3],
  ];
  assert.notDeepEqual(simulateSeed(87, c).frames, simulateSeed(87, d).frames);
});
test("fit scores use roster and book, never mutate simulation inputs", () => {
  const t = JSON.stringify(TEAMS);
  const a = teamFit(
      TEAMS[1],
      defaults().filter((p) => p.kind === "pass"),
    ),
    b = teamFit(
      TEAMS[0],
      defaults().filter((p) => p.kind === "pass"),
    );
  assert.ok(a.score > b.score);
  assert.equal(JSON.stringify(TEAMS), t);
});
test("downs, first downs, possession changes, incomplete passes and inbounds clock", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.possession = 0;
  g.ball = 25;
  g.line = 35;
  g = advance(g, fake({ yards: 6 }));
  assert.equal(g.down, 2);
  assert.equal(g.distance, 4);
  assert.equal(g.ball, 31);
  assert.ok(g.running);
  let t = g.clock;
  g = advance(g, fake({ reason: "incomplete", yards: 0 }), "hurry");
  assert.equal(g.ball, 31);
  assert.equal(g.down, 3);
  assert.equal(g.clock, t - 9);
  assert.equal(g.running, false);
  g = advance(g, fake({ yards: 5 }));
  assert.equal(g.down, 1);
  assert.equal(g.ball, 36);
  g.down = 4;
  g = advance(g, fake({ yards: 0 }));
  assert.equal(g.possession, 1);
  assert.equal(g.ball, 64);
  assert.equal(g.down, 1);
});
test("touchdown requires a try, conversion and kickoff before the next drive", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.possession = 0;
  g.ball = 98;
  g.line = 100;
  g = advance(g, fake({ reason: "touchdown", yards: 2 }));
  assert.deepEqual(g.score, [6, 0]);
  assert.equal(g.phase, "try");
  const clock = g.clock;
  g = advance(g, fake({ reason: "touchdown", yards: 3 }));
  assert.deepEqual(g.score, [8, 0]);
  assert.equal(g.clock, clock);
  assert.equal(g.phase, "kickoff");
  g = advance(g, fake({ reason: "kickoff", nextBall: 20 }));
  assert.equal(g.possession, 1);
  assert.equal(g.phase, "scrimmage");
  assert.equal(g.ball, 20);
});
test("safeties, intercepted returns, fumbles and missed field goals change possessions", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.possession = 0;
  g.ball = 5;
  g.line = 15;
  g = advance(g, fake({ reason: "safety", yards: -5 }));
  assert.deepEqual(g.score, [0, 2]);
  assert.equal(g.phase, "kickoff");
  let h = newGame();
  h.phase = "scrimmage";
  h.possession = 0;
  h = advance(
    h,
    fake({
      reason: "tackle",
      yards: 12,
      turnover: true,
      intercepted: true,
      pass: true,
    }),
  );
  assert.equal(h.possession, 1);
  assert.equal(h.stats[0].turnovers, 1);
  assert.equal(h.stats[0].yards, 0);
  h = advance(h, fake({ reason: "missed_field_goal", nextBall: 20 }));
  assert.equal(h.possession, 0);
});
test("penalties repeat down, apply half-distance and grounding loss of down", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.possession = 0;
  g.ball = 8;
  g.line = 18;
  g = advance(
    g,
    fake({
      reason: "penalty",
      penalty: { name: "Holding", side: 0, yards: 10, repeat: true },
    }),
  );
  assert.equal(g.down, 1);
  assert.equal(g.ball, 4);
  g = advance(
    g,
    fake({
      reason: "penalty",
      penalty: { name: "Grounding", side: 0, yards: 5, loss: true, spot: -1 },
    }),
  );
  assert.equal(g.down, 2);
  assert.ok(g.ball < 4);
});
test("timeouts and halftime restore appropriate clock state and kick recipient", () => {
  let g = newGame();
  g.running = true;
  g = timeout(g, 0);
  assert.equal(g.timeouts[0], 2);
  assert.equal(g.running, false);
  g.quarter = 2;
  g.phase = "scrimmage";
  g.clock = 1;
  g = advance(g, fake({ reason: "incomplete" }));
  assert.equal(g.quarter, 3);
  assert.equal(g.clock, 720);
  assert.deepEqual(g.timeouts, [3, 3]);
  assert.equal(g.phase, "kickoff");
  assert.equal(g.possession, 0);
});
test("paired overtime gives both sides a possession before deciding winner", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.quarter = 4;
  g.clock = 1;
  g = advance(g, fake({ reason: "incomplete" }));
  assert.ok(g.overtime);
  assert.equal(g.ball, 90);
  g = advance(g, fake({ reason: "field_goal" }));
  assert.equal(g.final, false);
  assert.equal(g.possession, 1);
  g.down = 4;
  g = advance(g, fake({ yards: 0 }));
  assert.equal(g.final, true);
  assert.deepEqual(g.score, [3, 0]);
});
test("special teams produce seeded physical flight and 22-player frames", () => {
  const g = newGame();
  const a = simulateKick(g, "kickoff", 100),
    b = simulateKick(g, "kickoff", 100);
  assert.deepEqual(a, b);
  assert.equal(a.players.length, 22);
  assert.ok(a.frames.some((f) => f.ball[2] > 5));
  g.phase = "scrimmage";
  g.ball = 50;
  assert.equal(simulateKick(g, "punt", 14).result.reason, "punt");
  g.phase = "try";
  assert.equal(simulateKick(g, "extra_point", 14).result.reason, "extra_point");
});
test("full regulation games complete legally across all eight teams", () => {
  for (let i = 0; i < 8; i++) {
    const g = autoGame(newGame(i, (i + 3) % 8, 100 + i));
    assert.equal(g.final, true, `team ${i}`);
    assert.notEqual(g.score[0], g.score[1]);
    assert.ok(g.seq < 600);
    assert.ok(g.stats.every((s) => Number.isFinite(s.yards)));
    assert.ok(g.history.some((h) => h.offense === 0));
    assert.ok(g.history.some((h) => h.offense === 1));
  }
});
test("ten-week schedule, playoffs, history, graduation and incoming class preserve program", () => {
  const f = createFranchise(1, "Test High");
  f.rules.quarter = 12;
  assert.equal(schedule().length, 10);
  for (const week of schedule())
    assert.equal(new Set(week.flatMap((m) => [m.home, m.away])).size, 8);
  let g = f;
  for (let w = 0; w < 12; w++) g = finishWeek(g, null);
  assert.equal(g.week, 12);
  assert.notEqual(g.champion, null);
  assert.equal(
    standings(g).reduce((s, t) => s + t.w, 0),
    40,
  );
  const old = g.teams[1].roster.filter((p) => p.grade === 12).map((p) => p.id),
    h = nextYear(g);
  assert.equal(h.year, 2027);
  assert.equal(h.archive.length, 1);
  assert.equal(h.teams[1].roster.length, 44);
  assert.ok(h.teams[1].roster.some((p) => p.grade === 9));
  assert.ok(h.teams[1].roster.every((p) => !old.includes(p.id)));
  assert.equal(new Set(h.teams[1].roster.map((p) => p.number)).size, 44);
});
import { turnPlan, joinPlan } from "./sync.js";
test("friend game join locks two coaches, permits same official school, and sets correct kicker turn", () => {
  const g = newGame(1, 1, 42),
    m = {
      version: g.version,
      members: ["a"],
      names: ["A"],
      status: "waiting",
      seq: 0,
      game: g,
      books: [defaults()],
    };
  const n = joinPlan(m, "b", TEAMS[1], defaults(), defenseDefaults(), "B");
  assert.equal(n.members.length, 2);
  assert.equal(n.turn, "b");
  const identity = (t) => ({
    ...t,
    roster: t.roster.map(({ id, sourceId, ...p }) => p),
  });
  assert.deepEqual(identity(n.game.teams[0]), identity(n.game.teams[1]));
  assert.equal(m.members.length, 1);
  assert.throws(() =>
    joinPlan(n, "c", TEAMS[0], defaults(), defenseDefaults(), "C"),
  );
});
test("turn transaction rejects stale sequence, wrong coach, changed rosters and changed defense", () => {
  const g = newGame(1, 0, 43),
    m = {
      version: g.version,
      members: ["a", "b"],
      names: ["A", "B"],
      status: "active",
      seq: 0,
      game: g,
      turn: "b",
    };
  const next = advance(g, runSnap(g, "kickoff", 2));
  const patch = turnPlan(m, "b", 0, next);
  assert.equal(patch.seq, 1);
  assert.equal(patch.turn, "a");
  assert.throws(() => turnPlan(m, "a", 0, next));
  assert.throws(() => turnPlan(m, "b", 1, next));
  const edited = clone(next);
  edited.teams[0].roster[0].ratings.speed = 99;
  assert.throws(() => turnPlan(m, "b", 0, edited));
  const defenseEdit = clone(next);
  defenseEdit.defenses[0][0].weight = 88;
  assert.throws(() => turnPlan(m, "b", 0, defenseEdit));
});
test("defensive overtime interception ends possession without a return score", () => {
  let g = newGame();
  g.quarter = 4;
  g.clock = 1;
  g.phase = "scrimmage";
  g = advance(g, fake({ reason: "incomplete" }));
  g = advance(
    g,
    fake({
      reason: "touchdown",
      turnover: true,
      intercepted: true,
      yards: -90,
    }),
  );
  assert.deepEqual(g.score, [0, 0]);
  assert.equal(g.overtime.possessions, 1);
  assert.equal(g.possession, 1);
});
test("kick return touchdown awards receiving team six points and a try", () => {
  const g = advance(
    newGame(),
    fake({ reason: "kickoff", returnTD: true, nextBall: 99 }),
  );
  assert.deepEqual(g.score, [6, 0]);
  assert.equal(g.phase, "try");
  assert.equal(g.possession, 0);
});
import { reschedule } from "./franchise.js";
test("schedule customization preserves eight unique schools and locked completed weeks", () => {
  let f = createFranchise(1);
  f = reschedule(f, 0, 4, false);
  const m = f.schedule[0].find((m) => m.away === 1);
  assert.equal(m.home, 4);
  assert.equal(new Set(f.schedule[0].flatMap((m) => [m.home, m.away])).size, 8);
  f.week = 1;
  assert.throws(() => reschedule(f, 0, 3));
});
test("clock spike counts as an incomplete pass attempt", () => {
  const p = defaults().find((p) => p.kind === "spike"),
    f = simulateSeed(310, p);
  assert.equal(f.result.reason, "incomplete");
  assert.equal(f.result.pass, true);
  let g = newGame();
  g.phase = "scrimmage";
  g.possession = 0;
  g = advance(g, f);
  assert.equal(g.stats[0].attempts, 1);
  assert.equal(g.running, false);
});
import {
  previewFilm,
  preSnapFrames,
  pointOnPath,
  protectionPlan,
  evaluateLogic,
  smoothRoute,
} from "./football.js";
import { playArt } from "./play-art.js";
import { FORMATIONS, applyFormation, defensiveTemplate } from "./formations.js";
import { encodePayload, decodePayload } from "./payload.js";
import { lineup } from "./data.js";
import { leaders } from "./statistics.js";
test("play art includes distinct routes, run arrows, blocking bars, motion and progression numbers", () => {
  const p = defaults().find((p) => p.name === "Power Right");
  p.slots[8].motion = [[5, -2]];
  const art = playArt(p, call(), { defense: true });
  assert.ok(art.lines.some((l) => l.kind === "run"));
  assert.ok(art.lines.some((l) => l.kind === "block" && l.end === "bar"));
  assert.ok(art.lines.some((l) => l.kind === "motion" && l.dashed));
  assert.equal(art.reads[0].n, 1);
  assert.ok(art.zones.length > 0);
});
test("all formation templates preserve eleven athletes and legal alignments", () => {
  for (const name of FORMATIONS) {
    const p = applyFormation(play(), name);
    assert.equal(p.slots.length, 11);
    assert.deepEqual(validateFormation(p), [], name);
  }
});
test("motion and shifts are animated before snap; live simulation begins at the rendered endpoint", () => {
  const p = play();
  p.slots[8].motion = [
    [-5, -1.5],
    [4, -1.5],
  ];
  const f = simulateSeed(73, p);
  const before = f.frames.find((x) => x.t === -3),
    snap = f.frames.filter((x) => x.t === 0).at(-1);
  assert.equal(before.players[8][0], -10);
  assert.equal(snap.players[8][0], 4);
  assert.ok(
    f.frames.some(
      (x) => x.t < 0 && x.players[8][0] > -10 && x.players[8][0] < 4,
    ),
  );
  assert.equal(validateFormation(p).length, 0);
});
test("man coverage follows motion using the observed target path", () => {
  const p = play();
  p.slots[5].y = -1.5;
  p.slots[8].y = 0;
  p.slots[5].motion = [[-4, -1.5]];
  const c = defenseDefaults()[2];
  c.slots[7].target = "X";
  const f = previewFilm(TEAMS[1], TEAMS[0], p, c);
  assert.notEqual(f.frames[0].players[18][0], f.frames.at(-1).players[18][0]);
});
test("Cover 3 has three deep defenders; Cover 2 two; Cover 1 one", () => {
  assert.deepEqual(
    defenseDefaults()
      .slice(0, 3)
      .map((c) => c.slots.filter((s) => s.assignment === "deep").length),
    [3, 2, 1],
  );
});
test("front templates actually move defenders and change pressure responsibilities", () => {
  const a = defensiveTemplate(call(), "3–4"),
    b = defensiveTemplate(call(), "5–2");
  assert.notDeepEqual(a.slots, b.slots);
  assert.equal(b.slots.filter((p) => p.assignment === "rush").length, 5);
});
test("conditional rules evaluate live leverage and time and affect quarterback trace", () => {
  const p = play();
  p.rules = [
    {
      id: "r1",
      when: "time",
      threshold: 0.5,
      action: "prioritize",
      target: "H",
    },
  ];
  const f = simulateSeed(55, p);
  assert.ok(f.events.some((e) => e.type === "logic"));
  const os = p.slots.map((s) => ({
      ...s,
      vx: 0,
      vy: 0,
      ratings: { intelligence: 90, awareness: 90 },
    })),
    ds = call().slots.map((s) => ({ ...s, vx: 0, vy: 0 }));
  assert.equal(evaluateLogic(p, { os, ds, qb: os[10], t: 0.3 }).length, 0);
  assert.equal(evaluateLogic(p, { os, ds, qb: os[10], t: 1 }).length, 1);
});
test("rounded route transitions insert intermediate physical waypoints", () => {
  const path = smoothRoute(
    [0, 0],
    [
      [0, 10],
      [10, 10],
    ],
  );
  assert.ok(path.length > 2);
  assert.deepEqual(path.at(-1), [10, 10]);
  assert.ok(path.some(([x, y]) => x > 0 && x < 2 && y < 10));
});
test("post-whistle replay contains a fall, ground and recovery sequence without charging game clock", () => {
  const f = simulateSeed(13);
  assert.ok(f.frames.at(-1).t > f.result.duration);
  if (["tackle", "sack"].includes(f.result.reason)) {
    const states = f.frames.flatMap((f) => f.players.map((p) => p[4]));
    assert.ok(states.includes("fall"));
    assert.ok(states.includes("rise"));
  }
});
test("explicit depth chart selects the starter and fatigue rotates a reserve", () => {
  const team = clone(TEAMS[1]),
    slots = play().slots,
    backup = team.roster.find(
      (p) => p.pos === "QB" && p.id !== team.roster[0].id,
    );
  team.depth = { offense: { QB: backup.id } };
  assert.equal(lineup(team, slots)[10].id, backup.id);
  assert.notEqual(lineup(team, slots, { [backup.id]: 0.95 })[10].id, backup.id);
});
test("compressed profile/replay encoding is exact and legacy JSON still decodes", async () => {
  const f = simulateSeed(71),
    encoded = await encodePayload(f);
  assert.deepEqual(await decodePayload(encoded), f);
  assert.deepEqual(await decodePayload({ payload: '{"a":1}' }), { a: 1 });
  assert.ok(encoded.payload.length < JSON.stringify(f).length);
});
test("accepted defensive foul at zero permits an untimed down before the period ends", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.possession = 0;
  g.quarter = 4;
  g.clock = 1;
  g.score = [0, 3];
  g = advance(
    g,
    fake({
      reason: "penalty",
      penalty: { name: "DPI", side: 1, yards: 15, repeat: true },
    }),
  );
  assert.equal(g.final, false);
  assert.equal(g.untimedDown, true);
  g = advance(g, fake({ reason: "incomplete" }));
  assert.equal(g.final, true);
});
test("simulated franchise games contribute season and career stats and program game records", () => {
  let f = createFranchise();
  f.rules.quarter = 5;
  f = finishWeek(f, null);
  assert.equal(f.records.length, 1);
  assert.ok(f.seasonStats[1]);
  assert.ok(f.careerStats[1]);
  assert.ok(f.seasonStats[1].plays > 0);
  assert.ok(f.records[0].stats);
});
test("class turnover replaces graduated positions and archives their career records", () => {
  let f = createFranchise();
  const before = f.teams[1].roster.reduce(
    (a, p) => ((a[p.pos] = (a[p.pos] || 0) + 1), a),
    {},
  );
  f.champion = 1;
  const g = nextYear(f),
    after = g.teams[1].roster.reduce(
      (a, p) => ((a[p.pos] = (a[p.pos] || 0) + 1), a),
      {},
    );
  assert.deepEqual(after, before);
  assert.ok(g.graduation.length > 0);
});
import { toWire, fromWire } from "./wire.js";
import { migrateProfile } from "./migration.js";
test("Firestore wire data round-trips every nested playbook, route and score array without illegal nested arrays", () => {
  const value = {
      game: newGame(),
      books: [defaults(), defaults()],
      scoreLine: [
        [0, 7],
        [3, 0],
      ],
    },
    wire = toWire(value);
  function check(v, inArray = false) {
    if (Array.isArray(v)) {
      assert.equal(inArray, false);
      v.forEach((p) => check(p, true));
    } else if (v && typeof v === "object")
      Object.values(v).forEach((p) => check(p, false));
  }
  check(wire);
  assert.deepEqual(fromWire(wire), value);
});
test("untouched factory migration preserves custom installs and creates no duplicate play IDs", () => {
  const p = play();
  p.name = "My custom Air Raid";
  p.slots[5].path = [[10, 7]];
  const d = migrateProfile({ version: "hsf-1.0.0", book: [p], books: [] });
  assert.equal(d.book[0].name, p.name);
  assert.deepEqual(d.book[0].slots[5].path, [[10, 7]]);
  assert.equal(d.libraryRevision, 3);
});
test("mesh drag routes cross inward rather than running outward", () => {
  const p = defaults().find((p) => p.name === "Mesh"),
    left = p.slots.find((s) => s.id === "H"),
    right = p.slots.find((s) => s.id === "Z");
  assert.ok(left.path.at(-1)[0] > left.x);
  assert.ok(right.path.at(-1)[0] < right.x);
});
test("a period expiring during selected runoff does not simulate or count a fake snap", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.clock = 2;
  g.running = true;
  const p = play(),
    f = runSnap(g, p, 45);
  assert.equal(f.result.reason, "period_expired");
  assert.equal(f.frames.length, 1);
  g = advance(g, f);
  assert.equal(g.quarter, 2);
  assert.equal(g.stats[1].plays, 0);
});
test("a lead blocker reaches engagement instead of remaining stuck forever at its final path point", () => {
  const p = defaults().find((p) => p.name === "Power Right"),
    f = simulateSeed(5, p);
  const lead = f.players.find((p) => p.id === "Y");
  assert.ok(f.result.production[lead.athleteId]?.blocks > 0);
});
test("feature running back is selected before an automatic fullback in I personnel", () => {
  const p = defaults().find((p) => p.name === "Power Right"),
    l = lineup(TEAMS[0], p.slots);
  assert.equal(l[9].id, TEAMS[0].roster[1].id);
  assert.notEqual(l[8].id, l[9].id);
});
test("two-way depth choices reserve explicit athletes and never duplicate a player on the same unit", () => {
  const t = clone(TEAMS[0]),
    p = play();
  t.depth = { offense: { X: t.roster.find((p) => p.pos === "CB").id } };
  const l = lineup(t, p.slots);
  assert.equal(l[5].id, t.depth.offense.X);
  assert.equal(new Set(l.map((p) => p.id)).size, 11);
});

test("fan protection puts tackles on edges and guards on interior rushers", () => {
  const p = play(),
    c = call(),
    plan = protectionPlan(p.slots, c.slots, p);
  assert.equal(plan.LT, "D0");
  assert.equal(plan.RT, "D3");
  assert.equal(plan.LG, "D1");
  assert.equal(plan.RG, "D2");
});
test("running lane decisions preserve lateral and counter tracks", async () => {
  const { runningLane } = await import("./tactics.js");
  const r = { x: 0, y: -3, side: 0, ratings: { awareness: 90, agility: 90 } };
  const target = { x: 7, y: -3 };
  assert.deepEqual(
    runningLane(
      r,
      target,
      [{ x: 1, y: 0, id: "e", ratings: { tackle: 80 } }],
      new Set(),
    ),
    target,
  );
});
test("coverage follows observed geometry rather than a receiver's hidden future path", async () => {
  const { coverageTarget } = await import("./tactics.js");
  const def = {
    id: "D1",
    x: 0,
    y: 10,
    zone: [0, 8],
    assignment: "zone",
    ratings: { awareness: 80 },
  };
  const r = {
    id: "X",
    x: 2,
    y: 6,
    vx: 2,
    vy: 3,
    assignment: "route",
    path: [[20, 30]],
  };
  const before = coverageTarget(def, [r], [def], { x: 0, y: -5 });
  r.path = [[-20, -5]];
  assert.deepEqual(coverageTarget(def, [r], [def], { x: 0, y: -5 }), before);
});
test("triple option pitches a live ball with an airborne carrier-free interval", () => {
  const p = defaults().find((p) => p.kind === "triple");
  const f = simulate({
    seed: 11,
    offense: TEAMS[2],
    defense: TEAMS[3],
    play: p,
    call: call(),
    penalties: false,
  });
  const pitch = f.events.find((e) => e.type === "pitch");
  assert.ok(pitch);
  assert.ok(
    f.frames.some((v) => v.t >= pitch.t && v.carrier === -1 && v.ball[2] > 1),
  );
  assert.ok(
    f.events.some(
      (e) => e.type === "handoff" && e.text.includes("Pitch secured"),
    ),
  );
  assert.equal(f.result.pass, false);
});
test("a contain edge can force the option give rather than the keep", () => {
  const p = defaults().find((p) => p.kind === "option"),
    d = call();
  d.slots[3].assignment = "contain";
  const f = simulate({
    seed: 11,
    offense: TEAMS[2],
    defense: TEAMS[3],
    play: p,
    call: d,
    penalties: false,
  });
  assert.ok(f.events.some((e) => e.type === "handoff"));
  assert.ok(!f.events.some((e) => e.text.includes("QB keeps")));
});
test("special teams select 22 distinct athletes and preserve seeded film", async () => {
  const { specialTeamsUnit } = await import("./tactics.js");
  for (const t of TEAMS)
    for (const receiving of [false, true]) {
      const ps = specialTeamsUnit(t, "punt", receiving);
      assert.equal(ps.length, 11);
      assert.equal(new Set(ps.map((p) => p.id)).size, 11);
      if (!receiving) assert.equal(ps[0].pos, "P");
    }
  const g = newGame();
  g.phase = "scrimmage";
  g.ball = 45;
  const a = simulateKick(g, "punt_left", 45),
    b = simulateKick(g, "punt_right", 45);
  assert.deepEqual(a, simulateKick(g, "punt_left", 45));
  assert.notDeepEqual(a.frames, b.frames);
  assert.equal(new Set(a.players.map((p) => p.athleteId)).size, 22);
});
test("onside recoveries and punt touchbacks update possession without phantom downs", () => {
  let g = newGame(),
    side = g.possession;
  g = advance(
    g,
    fake({ reason: "kickoff", onside: true, retained: true, retainedBall: 52 }),
  );
  assert.equal(g.possession, side);
  assert.equal(g.ball, 52);
  assert.equal(g.down, 1);
  assert.equal(g.phase, "scrimmage");
  g = advance(g, fake({ reason: "punt", touchback: true, nextBall: 20 }));
  assert.equal(g.possession, 1 - side);
  assert.equal(g.ball, 20);
});
test("invalid special-teams calls are rejected at the rules boundary", () => {
  const g = newGame();
  g.phase = "try";
  assert.throws(() => runSnap(g, "punt", 1));
  g.overtime = { round: 3 };
  assert.throws(() => runSnap(g, "extra_point", 1));
  g.phase = "scrimmage";
  assert.throws(() => runSnap(g, "onside", 1));
});
test("a last-second winning touchdown ends without an unnecessary conversion", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.quarter = 4;
  g.clock = 1;
  g.running = false;
  g.score = [0, 0];
  g = advance(g, fake({ reason: "touchdown", yards: 75, duration: 4 }));
  assert.equal(g.final, true);
  assert.equal(g.phase, "final");
});
test("second overtime possession ends immediately on a winning touchdown", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.quarter = 5;
  g.clock = 0;
  g.ball = 90;
  g.line = 100;
  g.possession = 1;
  g.score = [3, 0];
  g.overtime = { round: 1, possessions: 1, first: 0 };
  g = advance(g, fake({ reason: "touchdown", yards: 10, duration: 4 }));
  assert.equal(g.final, true);
  assert.deepEqual(g.score, [3, 6]);
});
test("film notes cite actual exchanges and release events", async () => {
  const { analyzeFilm } = await import("./film-analysis.js");
  const f = simulateSeed(
    15,
    defaults().find((p) => p.name === "Dive"),
  );
  const notes = analyzeFilm(f);
  assert.ok(notes.length);
  assert.ok(notes.every((n) => n.title && n.detail));
  assert.ok(!notes.some((n) => n.title === "Quarterback decision"));
});
test("formation switching restores personnel roles and flags a single forward motion segment", () => {
  const p = applyFormation(applyFormation(play(), "Empty"), "Spread");
  assert.equal(p.slots[9].pos, "RB");
  p.slots[8].motion = [[0, 0]];
  assert.ok(validateFormation(p).some((x) => x.includes("toward")));
});

test("pursuit solves a meeting point without oscillating between the runner and an unreachable lead", async () => {
  const { pursuitPoint } = await import("./tactics.js");
  const d = { x: 4, y: 8, energy: 1, ratings: { speed: 70, pursuit: 90 } };
  const r = { x: 0, y: 0, vx: 0, vy: 5 };
  const p = pursuitPoint(d, r),
    t = p.y / 5,
    speed = 3.3 + 70 * 0.058;
  assert.ok(t > 0 && t < 2);
  assert.ok(Math.abs(Math.hypot(p.x - d.x, p.y - d.y) / speed - t) < 0.00001);
  const slow = { x: 0, y: -8, energy: 1, ratings: { speed: 20, pursuit: 90 } };
  assert.deepEqual(pursuitPoint(slow, { x: 0, y: 0, vx: 0, vy: 10 }), {
    x: 0,
    y: 0,
  });
});

test("deep defenders preserve shell depth over an underneath route", async () => {
  const { coverageTarget } = await import("./tactics.js");
  const d = {
    id: "D10",
    x: 0,
    y: 14,
    zone: [0, 27],
    assignment: "deep",
    ratings: { awareness: 80 },
  };
  const p = coverageTarget(
    d,
    [{ id: "H", assignment: "route", x: 2, y: 5, vx: 0, vy: 3 }],
    [d],
    { x: 0, y: -5 },
  );
  assert.ok(p.y >= 27);
});
test("a quarterback may operate in his own end zone without an instant safety", () => {
  const f = simulateSeed(14, play(), call(), 1);
  assert.ok(f.result.duration > 0.6);
});
test("short-field pre-snap defenders stay inside the end line", () => {
  const f = simulateSeed(14, play(), call(), 99);
  assert.ok(
    f.frames
      .filter((f) => f.t <= 0)
      .every((f) => f.players.slice(11).every((p) => p[1] <= 11)),
  );
});

test("called running concepts never fall through into the passing progression", () => {
  for (const p of defaults().filter((p) =>
    ["run", "qb", "option", "triple"].includes(p.kind),
  )) {
    const f = simulate({
      seed: 16,
      offense: TEAMS[0],
      defense: TEAMS[1],
      play: p,
      call: call(),
      penalties: false,
    });
    assert.equal(f.result.pass, false, p.name);
    assert.ok(!f.events.some((e) => e.type === "throw"), p.name);
  }
});

test("active athletes accumulate stamina-dependent fatigue while the bench recovers", () => {
  let g = newGame();
  g.phase = "scrimmage";
  g.fatigue = { bench: 0.6 };
  const f = fake({ duration: 6, yards: 0 });
  f.players = [
    { athleteId: "active", ratings: { stamina: 45 } },
    { athleteId: "fit", ratings: { stamina: 95 } },
  ];
  for (let n = 0; n < 8; n++) g = advance(g, f);
  assert.ok(g.fatigue.active > 0.15);
  assert.ok(g.fatigue.active > g.fatigue.fit);
  assert.ok(g.fatigue.bench < 0.1);
  const rested = timeout(g, g.possession);
  assert.ok(rested.fatigue.active < g.fatigue.active);
});

test("two coaches choosing the same school have independent fatigue and roster IDs", () => {
  const g = newGame(1, 1, 100);
  assert.equal(
    new Set(g.teams.flatMap((t) => t.roster.map((p) => p.id))).size,
    88,
  );
  const p = play();
  p.slots[10].athlete = TEAMS[1].roster[0].id;
  const away = lineup(g.teams[1], p.slots);
  assert.equal(away[10].sourceId, TEAMS[1].roster[0].id);
  assert.notEqual(away[10].id, g.teams[0].roster[0].id);
  assert.deepEqual(away[10].ratings, g.teams[0].roster[0].ratings);
});
