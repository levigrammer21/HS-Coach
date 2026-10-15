import {
  VERSION,
  TEAMS,
  clone,
  clamp,
  rng,
  defaults,
  defenseDefaults,
  selectDefense,
  hash,
} from "./data.js";
import { simulate } from "./engine.js";
export const DEFAULT_RULES = {
  quarter: 720,
  otStart: 90,
  mercy: 0,
  otTwoFrom: 3,
};
export function newGame(home = 1, away = 0, seed = Date.now(), rules = {}) {
  return {
    version: VERSION,
    seed: seed >>> 0,
    teams: [clone(TEAMS[home]), clone(TEAMS[away])],
    score: [0, 0],
    quarter: 1,
    clock: rules.quarter || 720,
    ball: 40,
    down: 1,
    distance: 10,
    line: 50,
    possession: 1,
    openingReceiver: 0,
    phase: "kickoff",
    running: false,
    playClock: 25,
    timeouts: [3, 3],
    rules: { ...DEFAULT_RULES, ...rules },
    seq: 0,
    history: [],
    stats: [stats(), stats()],
    fatigue: {},
    overtime: null,
    final: false,
    last: "Opening kickoff",
    defenses: [defenseDefaults(), defenseDefaults()],
  };
}
function stats() {
  return {
    plays: 0,
    yards: 0,
    passing: 0,
    rushing: 0,
    completions: 0,
    attempts: 0,
    turnovers: 0,
    firstDowns: 0,
    players: {},
  };
}
function first(g) {
  g.down = 1;
  g.line = Math.min(100, g.ball + 10);
  g.distance = Math.round((g.line - g.ball) * 10) / 10;
}
function flip(g, spot) {
  g.possession = 1 - g.possession;
  g.ball = clamp(spot, 1, 99);
  g.running = false;
  g.playClock = 25;
  first(g);
}
function kickoff(g, kicker, safety = false) {
  g.phase = "kickoff";
  g.possession = kicker;
  g.ball = safety ? 20 : 40;
  g.running = false;
  g.playClock = 25;
  first(g);
}
function endPeriod(g) {
  if (g.clock > 0 || g.phase === "try" || g.final || g.overtime) return;
  if (g.quarter === 2) {
    g.quarter = 3;
    g.clock = g.rules.quarter;
    g.timeouts = [3, 3];
    kickoff(g, g.openingReceiver);
    g.last += " • Halftime";
  } else if (g.quarter < 4) {
    g.quarter++;
    g.clock = g.rules.quarter;
    g.running = false;
    g.playClock = 25;
  } else if (g.score[0] !== g.score[1]) {
    g.final = true;
    g.phase = "final";
    g.last += " • FINAL";
  } else {
    g.quarter = 5;
    g.clock = 0;
    g.overtime = { round: 1, possessions: 0, first: 0 };
    g.timeouts = [1, 1];
    g.possession = 0;
    g.phase = "scrimmage";
    g.ball = g.rules.otStart;
    first(g);
    g.last += " • Overtime";
  }
}
function otEnd(g) {
  const ot = g.overtime;
  if (!ot) return;
  ot.possessions++;
  if (ot.possessions === 2) {
    if (g.score[0] !== g.score[1]) {
      g.final = true;
      g.phase = "final";
      return;
    }
    ot.round++;
    ot.possessions = 0;
    ot.first = 1 - ot.first;
    g.timeouts = [1, 1];
  }
  g.possession = ot.possessions === 0 ? ot.first : 1 - ot.first;
  g.ball = g.rules.otStart;
  first(g);
  g.phase = "scrimmage";
  g.running = false;
  g.playClock = 25;
}
export function timeout(game, side) {
  const g = clone(game);
  if (g.final || g.timeouts[side] <= 0) return g;
  g.timeouts[side]--;
  g.running = false;
  g.playClock = 25;
  g.last = `${g.teams[side].school} timeout`;
  return g;
}
export function advance(game, film, tempo = "normal") {
  const g = clone(game),
    r = film.result,
    side = g.possession,
    other = 1 - side,
    s = g.stats[side],
    oldBall = g.ball,
    wasTry = g.phase === "try";
  g.seq++;
  if (g.final) throw Error("Game has ended");
  const runoff =
    g.running && !g.overtime && !wasTry
      ? Math.max(
          0,
          ({ hurry: 4, normal: 22, chew: 38 }[tempo] ?? 22) -
            (g.readyDelay || 0),
        )
      : 0;
  g.readyDelay = 0;
  if (runoff >= g.clock && !g.overtime && !wasTry) {
    g.clock = 0;
    g.last = "Period ended before the snap";
    endPeriod(g);
    return g;
  }
  if (!g.overtime && !wasTry)
    g.clock = Math.max(0, g.clock - runoff - Math.ceil(r.duration));
  for (const id of Object.keys(g.fatigue))
    g.fatigue[id] = Math.max(0, g.fatigue[id] - 0.035);
  for (const p of film.players || [])
    g.fatigue[p.athleteId] = clamp(
      (g.fatigue[p.athleteId] || 0) +
        r.duration * 0.004 * (1.4 - p.ratings?.stamina / 150 || 1),
      0,
      1,
    );
  let text = "";
  if (r.penalty) {
    const p = r.penalty;
    const delta =
      (p.side === 0 ? -1 : 1) *
      Math.min(p.yards, (p.side === 0 ? g.ball : 100 - g.ball) / 2);
    g.ball = clamp(
      (p.spot !== undefined ? oldBall + p.spot : oldBall) + delta,
      0,
      99.5,
    );
    if (g.ball <= 0) {
      g.score[other] += 2;
      g.last = "Safety on penalty";
      if (g.overtime) otEnd(g);
      else kickoff(g, side, true);
      return g;
    }
    if (p.loss) g.down++;
    g.distance = Math.round((g.line - g.ball) * 10) / 10;
    if (g.ball >= g.line) first(g);
    if (g.down > 4) {
      if (g.overtime) otEnd(g);
      else flip(g, 100 - g.ball);
    }
    g.playClock = 25;
    g.running = false;
    text = `${p.name} • ${p.yards} yards${p.loss ? " • loss of down" : ""}`;
  } else if (
    g.phase === "kickoff" ||
    r.reason === "punt" ||
    r.reason === "field_goal" ||
    r.reason === "missed_field_goal" ||
    r.reason === "extra_point"
  ) {
    if (r.returnTD) {
      g.score[other] += 6;
      g.possession = other;
      g.phase = "try";
      g.ball = 97;
      g.running = false;
      first(g);
      text = "KICK RETURN TOUCHDOWN";
    } else if (r.reason === "extra_point") {
      g.score[side] += r.good ? 1 : 0;
      text = r.good ? "Extra point good" : "Extra point missed";
      if (g.overtime) otEnd(g);
      else kickoff(g, side);
    } else if (r.reason === "field_goal") {
      g.score[side] += 3;
      text = "FIELD GOAL";
      if (g.overtime) otEnd(g);
      else kickoff(g, side);
    } else if (g.overtime) {
      text = "Possession over";
      otEnd(g);
    } else {
      const start = clamp(r.nextBall ?? 20, 1, 99);
      flip(g, start);
      g.phase = "scrimmage";
      text = `${r.reason === "punt" ? "Punt" : r.reason === "missed_field_goal" ? "Missed field goal" : "Kickoff"} • ${g.teams[g.possession].school} ball at ${Math.round(g.ball)}`;
    }
  } else if (wasTry) {
    const success = r.reason === "touchdown" && !r.turnover;
    g.score[side] += success ? 2 : 0;
    text = success ? "TWO POINTS" : "Conversion no good";
    if (g.overtime) otEnd(g);
    else kickoff(g, side);
  } else {
    s.plays++;
    if (r.pass) {
      s.attempts++;
      if (r.complete) s.completions++;
      if (r.passer) {
        const q = s.players[r.passer] || { yards: 0, touches: 0, td: 0 };
        q.passAttempts = (q.passAttempts || 0) + 1;
        q.passCompletions = (q.passCompletions || 0) + (r.complete ? 1 : 0);
        q.passYards =
          (q.passYards || 0) + (r.complete ? Math.round(r.yards) : 0);
        q.interceptions = (q.interceptions || 0) + (r.intercepted ? 1 : 0);
        s.players[r.passer] = q;
      }
    }
    const yards = r.reason === "incomplete" ? 0 : Math.round(r.yards);
    const credited = r.intercepted ? 0 : yards;
    s.yards += credited;
    s[r.pass ? "passing" : "rushing"] += credited;
    const pid = r.receiver || r.carrier;
    if (pid) {
      const ps = s.players[pid] || { yards: 0, touches: 0, td: 0 };
      ps.yards += credited;
      ps.touches++;
      if (r.reason === "touchdown" && !r.turnover) ps.td++;
      s.players[pid] = ps;
    }
    if (r.turnover) {
      s.turnovers++;
      text = r.intercepted ? "INTERCEPTION" : "FUMBLE LOST";
      if (g.overtime) otEnd(g);
      else if (r.reason === "touchdown") {
        g.score[other] += 6;
        g.possession = other;
        g.phase = "try";
        g.ball = 97;
        first(g);
      } else if (g.overtime) otEnd(g);
      else flip(g, 100 - (oldBall + r.yards));
    } else if (r.reason === "touchdown") {
      g.score[side] += 6;
      g.phase = "try";
      g.ball = 97;
      g.running = false;
      g.playClock = 25;
      first(g);
      text = "TOUCHDOWN";
    } else if (
      r.reason === "safety" ||
      (oldBall + yards <= 0 && r.reason !== "incomplete")
    ) {
      g.score[other] += 2;
      text = "SAFETY";
      if (g.overtime) otEnd(g);
      else kickoff(g, side, true);
    } else {
      g.ball = clamp(oldBall + credited, 0.5, 99.9);
      g.running = !["incomplete", "out", "spike"].includes(r.reason);
      g.playClock = 40;
      if (g.ball >= g.line) {
        first(g);
        s.firstDowns++;
        g.readyDelay = g.running ? 4 : 0;
        text = `${credited} yards • FIRST DOWN`;
      } else {
        g.down++;
        g.distance = Math.round((g.line - g.ball) * 10) / 10;
        text =
          r.reason === "incomplete"
            ? "Incomplete pass"
            : `${r.reason === "sack" ? "Sack • " : ""}${credited} yards`;
        if (g.down > 4) {
          text += " • Turnover on downs";
          if (g.overtime) otEnd(g);
          else flip(g, 100 - g.ball);
        }
      }
    }
  }
  if (
    g.quarter === 4 &&
    g.clock < 150 &&
    g.clock > 0 &&
    g.running &&
    g.score[other] < g.score[side] &&
    g.timeouts[other] > 0 &&
    !g.overtime
  ) {
    g.timeouts[other]--;
    g.running = false;
    g.playClock = 25;
    text += " • Defense calls timeout";
  }
  g.last = text;
  g.history.push({
    seq: g.seq,
    offense: side,
    quarter: g.quarter,
    clock: g.clock,
    ball: oldBall,
    play: film.play?.name || r.reason,
    result: clone(r),
    text,
    seed: film.seed,
  });
  endPeriod(g);
  return g;
}
export function simulateKick(g, type, seed) {
  const random = rng(seed),
    team = g.teams[g.possession],
    opponent = g.teams[1 - g.possession],
    k = team.roster.find((p) => p.pos === (type === "punt" ? "P" : "K")),
    kickoff = g.phase === "kickoff",
    start = g.ball,
    accuracy = k.ratings.kicking,
    range = type === "punt" ? k.ratings.punting : accuracy;
  const distance = kickoff
    ? 43 + range * 0.22 + (random() - 0.5) * 10
    : type === "punt"
      ? 24 + range * 0.22 + (random() - 0.5) * 12
      : 100 - start + 17;
  const lateral = (random() - 0.5) * (100 - accuracy) * 0.6,
    good = distance < 18 + range * 0.42 && Math.abs(lateral) < 35 / 9,
    landing = start + distance,
    flightTime = type === "punt" || kickoff ? 3.6 : 1.6;
  const players = Array.from({ length: 22 }, (_, i) => {
    const source =
      i === 0 ? k : (i < 11 ? team : opponent).roster[i < 11 ? i : i - 11];
    return {
      id: `K${i}`,
      athleteId: source.id,
      name: source.name,
      number: source.number,
      pos: source.pos,
      side: i < 11 ? 0 : 1,
      ratings: source.ratings,
    };
  });
  const pos = players.map((p, i) => ({
      x: i === 0 ? 0 : i < 11 ? (i - 5) * 4 : i === 21 ? lateral : (i - 16) * 4,
      y:
        i === 0
          ? kickoff
            ? 0
            : type === "punt"
              ? -12
              : -7
          : i < 11
            ? kickoff
              ? 0
              : -1
            : i === 21
              ? Math.min(98, landing) - start
              : 15 + (i % 3) * 10,
      vx: 0,
      vy: 0,
      state: "ready",
    })),
    frames = [],
    events = [{ t: 0, type: "kick", text: type.replaceAll("_", " ") }];
  let football = { x: 0, y: 0, z: 0 },
    caught = false,
    dead = false,
    returnY = landing,
    carrier = -1,
    t = 0;
  for (let n = 0; n < 30 * 17 && !dead; n++) {
    t = n / 30;
    const u = clamp((t - 0.25) / flightTime, 0, 1),
      launch = kickoff ? 0 : type === "punt" ? -12 : -7;
    if (!caught)
      football = {
        x: lateral * u,
        y: launch + (distance - launch) * u,
        z: Math.sin(Math.PI * u) * (kickoff || type === "punt" ? 15 : 8),
      };
    if (u === 1 && !caught) {
      if (type === "field_goal" || type === "extra_point" || landing >= 100) {
        dead = true;
      } else {
        caught = true;
        carrier = 21;
        pos[21].x = lateral;
        pos[21].y = landing - start;
        events.push({ t, type: "return", text: "Return begins" });
      }
    }
    for (let i = 0; i < 22; i++) {
      const p = pos[i],
        s = players[i].ratings.speed * 0.05 + 4;
      if (i === 0 && t < 0.5) {
        p.state = "kick";
        continue;
      }
      let target =
        i < 11
          ? caught
            ? pos[21]
            : { x: lateral, y: distance }
          : caught
            ? { x: pos[21].x, y: pos[21].y - 3 }
            : { x: p.x, y: p.y };
      if (caught && i >= 11 && i < 21) {
        const threat = pos
          .slice(0, 11)
          .reduce((a, b) =>
            Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y)
              ? a
              : b,
          );
        target = threat;
        if (Math.hypot(threat.x - p.x, threat.y - p.y) < 1.3) {
          p.state = "block";
          const power = players[i].ratings.runBlock;
          threat.vx *= 1 - power / 130;
          threat.vy *= 1 - power / 130;
          threat.y += 0.035;
        }
      }
      if (i === 21 && caught) target = { x: clamp(p.x, -23, 23), y: -start };
      const dx = target.x - p.x,
        dy = target.y - p.y,
        l = Math.hypot(dx, dy) || 1;
      p.vx = (dx / l) * s;
      p.vy = (dy / l) * s;
      p.x += p.vx / 30;
      p.y += p.vy / 30;
      p.state = "run";
    }
    if (caught) {
      football = { x: pos[21].x, y: pos[21].y, z: 1 };
      returnY = start + pos[21].y;
      if (
        pos
          .slice(0, 11)
          .some((p) => Math.hypot(p.x - pos[21].x, p.y - pos[21].y) < 1) ||
        Math.abs(pos[21].x) > 26.67 ||
        returnY <= 0
      ) {
        dead = true;
        pos[21].state = "down";
      }
    }
    if (n % 3 === 0 || dead)
      frames.push({
        t,
        players: pos.map((p) => [p.x, p.y, p.vx, p.vy, p.state]),
        ball: [football.x, football.y, football.z],
        carrier,
      });
  }
  let reason = kickoff
    ? "kickoff"
    : type === "punt"
      ? "punt"
      : type === "extra_point"
        ? "extra_point"
        : good
          ? "field_goal"
          : "missed_field_goal";
  const nextBall = landing >= 100 ? 20 : clamp(100 - returnY, 1, 99);
  return {
    version: VERSION,
    seed,
    ball: start,
    players,
    frames,
    events,
    offense: team,
    defense: opponent,
    play: { name: type.replaceAll("_", " "), slots: [] },
    call: { name: "Special teams", slots: [] },
    result: {
      reason,
      good,
      yards: 0,
      duration:
        landing >= 100 || ["field_goal", "extra_point"].includes(type)
          ? flightTime
          : Math.max(flightTime, t),
      nextBall,
      returnTD: caught && returnY <= 0,
      turnover: false,
      version: VERSION,
      seed,
    },
  };
}
export function runSnap(g, p, seed, penalties = true) {
  if (g.phase === "kickoff") return simulateKick(g, "kickoff", seed);
  if (typeof p === "string") return simulateKick(g, p, seed);
  const def = selectDefense(
    g.defenses[1 - g.possession],
    { receivers: p.slots.filter((s) => s.pos === "WR").length },
    g,
    seed ^ 1847,
  );
  return simulate({
    seed,
    offense: g.teams[g.possession],
    defense: g.teams[1 - g.possession],
    play: clone(p),
    call: def,
    ball: g.ball,
    fatigue: g.fatigue,
    penalties,
  });
}
export function aiPlay(g, book = defaults()) {
  if (g.phase === "kickoff") return "kickoff";
  if (g.phase === "try")
    return g.overtime?.round >= g.rules.otTwoFrom
      ? book.find((p) => p.kind === "run")
      : "extra_point";
  if (g.down === 4) {
    if (g.ball > 65) return "field_goal";
    if (g.ball < 65 && g.distance > 2) return "punt";
  }
  const r = rng(hash(`${g.seed}-${g.seq}`));
  let a = book.filter((p) => !["spike", "kneel"].includes(p.kind));
  if (g.distance > 8 && g.down >= 3) a = a.filter((p) => p.kind === "pass");
  if (
    g.clock < 100 &&
    g.quarter === 4 &&
    g.score[g.possession] > g.score[1 - g.possession] &&
    g.down < 4
  )
    return book.find((p) => p.kind === "kneel") || a[0];
  const scheme = g.teams[g.possession].id;
  const weights = a.map((p) => {
    let w = 1;
    if (scheme === 0 && p.kind === "run") w = 4;
    if (scheme === 1 && p.kind === "pass") w = 4;
    if (scheme === 2 && ["option", "triple"].includes(p.kind)) w = 7;
    if (
      scheme === 4 &&
      ["Bubble Screen", "Jet Sweep", "RPO Glance"].includes(p.name)
    )
      w = 7;
    if (
      scheme === 5 &&
      ["Dive", "Power Right", "Inside Zone", "Draw"].includes(p.name)
    )
      w = 6;
    if (scheme === 6 && ["qb", "rpo", "option"].includes(p.kind)) w = 6;
    if (
      scheme === 7 &&
      ["Stick", "Drive", "Mesh", "Play Action Cross"].includes(p.name)
    )
      w = 6;
    return w;
  });
  let v = r() * weights.reduce((a, b) => a + b, 0);
  return a[weights.findIndex((w) => (v -= w) < 0)] || a[0];
}
export function autoGame(g) {
  let n = 0;
  while (!g.final && n++ < 600) {
    const p = aiPlay(g);
    g = advance(
      g,
      runSnap(g, p, hash(`${g.seed}-${g.seq}`)),
      p.tempo || "normal",
    );
  }
  return g;
}
