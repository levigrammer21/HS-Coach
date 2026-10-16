import { clone } from "./data.js";
const numerical = [
  "plays",
  "yards",
  "passing",
  "rushing",
  "completions",
  "attempts",
  "turnovers",
  "firstDowns",
  "thirdAttempts",
  "thirdMade",
  "fourthAttempts",
  "fourthMade",
  "possessionSeconds",
  "penalties",
  "penaltyYards",
];
export function enrichStatistics(g, before, film) {
  const r = film.result;
  if (!g.history.some((h) => h.seq === g.seq)) return g;
  const side = before.possession,
    other = 1 - side;
  g.scoreLine ||= Array.from({ length: 2 }, () => [0, 0, 0, 0, 0]);
  for (let i = 0; i < 2; i++)
    g.scoreLine[i][Math.min(before.quarter, 5) - 1] +=
      g.score[i] - before.score[i];
  for (const s of g.stats) for (const k of numerical) s[k] ??= 0;
  const s = g.stats[side],
    wasPlay = before.phase === "scrimmage";
  if (wasPlay) {
    s.possessionSeconds += Math.min(
      before.clock,
      Math.ceil(r.duration) +
        (before.running
          ? Math.max(
              0,
              ({ normal: 22, hurry: 4, chew: 38 }[film.play?.tempo] || 22) -
                (before.readyDelay || 0),
            )
          : 0),
    );
    if (r.penalty) {
      const pen = g.stats[r.penalty.side === 0 ? side : other];
      pen.penalties++;
      pen.penaltyYards += r.penalty.yards;
    } else {
      if (before.down === 3) {
        s.thirdAttempts++;
        if (
          !r.turnover &&
          (r.yards >= before.distance || r.reason === "touchdown")
        )
          s.thirdMade++;
      }
      if (
        before.down === 4 &&
        !["punt", "field_goal", "missed_field_goal"].includes(r.reason)
      ) {
        s.fourthAttempts++;
        if (
          !r.turnover &&
          (r.yards >= before.distance || r.reason === "touchdown")
        )
          s.fourthMade++;
      }
      const carrier =
          r.carrier && film.players.find((p) => p.athleteId === r.carrier),
        id = r.complete ? r.receiver : r.carrier;
      if (id && !r.turnover) {
        const p = (s.players[id] ||= { yards: 0, touches: 0, td: 0 });
        if (r.complete) {
          p.receptions = (p.receptions || 0) + 1;
          p.receivingYards = (p.receivingYards || 0) + Math.round(r.yards);
          p.yac =
            (p.yac || 0) +
            Math.max(0, Math.round(r.yards - (r.catchY || r.yards)));
        } else if (!r.pass && carrier?.side === 0) {
          p.carries = (p.carries || 0) + 1;
          p.rushYards = (p.rushYards || 0) + Math.round(r.yards);
        }
        p.longest = Math.max(p.longest || 0, Math.round(r.yards));
      }
      if (r.reason === "touchdown" && !r.turnover && r.passer) {
        const p = s.players[r.passer];
        p.passTD = (p.passTD || 0) + 1;
      }
    }
  }
  for (const [id, values] of Object.entries(r.production || {})) {
    const p = film.players.find((p) => p.athleteId === id);
    if (!p) continue;
    const ps = (g.stats[p.side === 0 ? side : other].players[id] ||= {
      yards: 0,
      touches: 0,
      td: 0,
    });
    for (const [k, v] of Object.entries(values)) ps[k] = (ps[k] || 0) + v;
  }
  if (
    [
      "field_goal",
      "missed_field_goal",
      "extra_point",
      "punt",
      "kickoff",
    ].includes(r.reason)
  ) {
    if (r.returner) {
      const ps = (g.stats[other].players[r.returner] ||= {
        yards: 0,
        touches: 0,
        td: 0,
      });
      ps.returns = (ps.returns || 0) + 1;
      ps.returnYards = (ps.returnYards || 0) + (r.returnYards || 0);
      if (r.returnTD) ps.returnTD = (ps.returnTD || 0) + 1;
    }
    const id = film.players?.[0]?.athleteId;
    if (id) {
      const ps = (s.players[id] ||= { yards: 0, touches: 0, td: 0 });
      if (r.reason.includes("field_goal")) {
        ps.fgAttempts = (ps.fgAttempts || 0) + 1;
        ps.fieldGoals = (ps.fieldGoals || 0) + (r.good ? 1 : 0);
      }
      if (r.reason === "extra_point") {
        ps.patAttempts = (ps.patAttempts || 0) + 1;
        ps.pats = (ps.pats || 0) + (r.good ? 1 : 0);
      }
      if (r.reason === "punt") {
        ps.punts = (ps.punts || 0) + 1;
        ps.puntYards = (ps.puntYards || 0) + (r.kickDistance || 0);
      }
    }
  }
  g.drives ||= [];
  if (wasPlay) {
    let d = g.drives.at(-1);
    if (!d || d.closed || d.team !== side) {
      d = {
        team: side,
        from: before.ball,
        plays: 0,
        yards: 0,
        startQuarter: before.quarter,
        startClock: before.clock,
        points: 0,
        closed: false,
      };
      g.drives.push(d);
    }
    d.plays++;
    if (!r.penalty && !r.intercepted)
      d.yards += r.reason === "incomplete" ? 0 : Math.round(r.yards);
    d.endQuarter = g.quarter;
    d.endClock = g.clock;
    if (
      g.possession !== side ||
      g.phase === "try" ||
      g.phase === "kickoff" ||
      g.final
    ) {
      d.closed = true;
      d.result = g.last;
      d.points = g.score[side] - before.score[side];
    }
  }
  return g;
}
export function mergeTotals(target, stats) {
  target ||= { players: {} };
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === "number") target[k] = (target[k] || 0) + v;
  }
  target.players ||= {};
  for (const [id, p] of Object.entries(stats.players || {})) {
    const row = (target.players[id] ||= {});
    for (const [k, v] of Object.entries(p))
      if (typeof v === "number") row[k] = (row[k] || 0) + v;
  }
  return target;
}
export function leaders(teams, season, category) {
  return teams
    .flatMap((t) =>
      t.roster.map((p) => ({
        ...p,
        school: t.school,
        total: season?.[t.id]?.players?.[p.id]?.[category] || 0,
      })),
    )
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
}
export function scout(team, book = []) {
  const avg = (pos, keys) => {
    const a = team.roster.filter((p) => pos.includes(p.pos)).slice(0, 5);
    return Math.round(
      a.reduce(
        (s, p) => s + keys.reduce((n, k) => n + p.ratings[k], 0) / keys.length,
        0,
      ) / Math.max(1, a.length),
    );
  };
  const ratings = {
    pass: avg(["QB"], ["accuracy", "decision", "throwPower"]),
    run: avg(["RB"], ["strength", "agility", "security"]),
    front: avg(["DE", "DT", "LB"], ["shed", "tackle", "rush"]),
    coverage: avg(["CB", "S"], ["speed", "coverage", "awareness"]),
    line: avg(["C", "G", "T"], ["runBlock", "passBlock", "strength"]),
  };
  const strong = Object.entries(ratings).sort((a, b) => b[1] - a[1]);
  return {
    ratings,
    strong: strong[0][0],
    weak: strong.at(-1)[0],
    tips: [
      ratings.front > 75
        ? "Use quick throws, screens, and misdirection against this front."
        : "Test the interior early and make the front prove it can stop you.",
      ratings.coverage > 76
        ? "Layer routes and make defenders choose between two receivers."
        : "Create isolated routes for your best matchup.",
      ratings.pass > 78
        ? "Expect a dangerous passing attack. Protect against explosives."
        : "Make their quarterback finish long drives.",
    ],
  };
}
