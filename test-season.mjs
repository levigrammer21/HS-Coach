import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  TEAMS,
  defaults,
  defenseDefaults,
  clone,
  validateFormation,
} from "./data.js";
import { newGame, autoGame } from "./rules.js";
import {
  createFranchise,
  finishWeek,
  nextYear,
  standings,
} from "./franchise.js";
import { simulate } from "./engine.js";
const began = performance.now(),
  rows = [];
for (let t = 0; t < 8; t++) {
  const g = autoGame(newGame(t, (t + 3) % 8, 8290 + t));
  assert.equal(g.final, true, `Regulation matchup ${t} must finish`);
  assert.ok(g.seq < 600);
  assert.ok(g.score.every(Number.isFinite));
  assert.notEqual(g.score[0], g.score[1]);
  rows.push({
    home: TEAMS[t].school,
    away: TEAMS[(t + 3) % 8].school,
    score: g.score,
    snaps: g.seq,
    stats: g.stats.map((s) => ({
      yards: s.yards,
      passing: s.passing,
      rushing: s.rushing,
      turnovers: s.turnovers,
    })),
  });
  console.log("REGULATION", JSON.stringify(rows.at(-1)));
}
let f = createFranchise(2);
f.rules.quarter = 90;
for (let season = 0; season < 3; season++) {
  while (f.champion === null) f = finishWeek(f);
  assert.equal(f.week, 12);
  assert.equal(
    standings(f).reduce((n, t) => n + t.w, 0),
    40,
  );
  console.log(
    "SEASON",
    JSON.stringify({
      year: f.year,
      champion: f.teams[f.champion].school,
      records: f.records.length,
    }),
  );
  f = nextYear(f);
  for (const t of f.teams) {
    assert.equal(t.roster.length, 44);
    assert.equal(new Set(t.roster.map((p) => p.number)).size, 44);
    for (const p of t.roster.filter((p) => ["C", "G", "T"].includes(p.pos)))
      assert.ok(
        p.number >= 50 && p.number <= 79,
        "Graduating line numbers stay legal",
      );
  }
}
// Every default concept produces a finite play with all 22 athletes on all eight rosters.
let snaps = 0;
for (let t = 0; t < 8; t++)
  for (let i = 0; i < defaults().length; i++) {
    const p = defaults()[i];
    assert.deepEqual(validateFormation(p), []);
    const film = simulate({
      seed: 8181 + i,
      offense: TEAMS[t],
      defense: TEAMS[(t + 1) % 8],
      play: p,
      call: defenseDefaults()[i % 4],
      penalties: false,
    });
    assert.equal(film.players.length, 22);
    assert.ok(Number.isFinite(film.result.yards));
    assert.ok(
      film.frames.every((v) =>
        v.players.every((p) => p.slice(0, 4).every(Number.isFinite)),
      ),
    );
    snaps++;
  }
console.log(
  `PASS: 8 regulation matchups, 3 complete seasons and offseasons, ${snaps} roster/concept checks. ${((performance.now() - began) / 1000).toFixed(1)} seconds.`,
);
