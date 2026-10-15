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
  assert.deepEqual(n.game.teams[0], n.game.teams[1]);
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
test('clock spike counts as an incomplete pass attempt',()=>{const p=defaults().find(p=>p.kind==='spike'),f=simulateSeed(310,p);assert.equal(f.result.reason,'incomplete');assert.equal(f.result.pass,true);let g=newGame();g.phase='scrimmage';g.possession=0;g=advance(g,f);assert.equal(g.stats[0].attempts,1);assert.equal(g.running,false)});
