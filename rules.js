import { kickSimulation as simulateKick } from "./special-teams.js";
import { previewFilm } from "./football.js";
import { enrichStatistics } from "./statistics.js";
import {
  VERSION,
  TEAMS,
  clone,
  clamp,
  rng,
  defaults,
  defenseDefaults,
  selectDefense,
  separateAwayRoster,
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
    teams: [
      clone(TEAMS[home]),
      home === away ? separateAwayRoster(TEAMS[away]) : clone(TEAMS[away]),
    ],
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
  if (
    g.clock > 0 ||
    g.phase === "try" ||
    g.final ||
    g.overtime ||
    g.untimedDown
  )
    return;
  if (g.quarter === 2) {
    for (const id of Object.keys(g.fatigue)) g.fatigue[id] *= 0.2;
    g.quarter = 3;
    g.clock = g.rules.quarter;
    g.timeouts = [3, 3];
    kickoff(g, g.openingReceiver);
    g.last += " • Halftime";
  } else if (g.quarter < 4) {
    for (const id of Object.keys(g.fatigue)) g.fatigue[id] *= 0.6;
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
  for (const id of Object.keys(g.fatigue))
    g.fatigue[id] = Math.max(0, g.fatigue[id] - 0.08);
  g.running = false;
  g.playClock = 25;
  g.last = `${g.teams[side].school} timeout`;
  return g;
}
export function advance(game, film, tempo = "normal") {
  let applied = film;
  const r = film.result,
    p = r.penalty;
  if (
    p &&
    ((p.side === 0 &&
      (r.turnover ||
        (game.down === 4 && r.reason === "incomplete") ||
        r.yards <= -p.yards)) ||
      (p.side === 1 &&
        !r.turnover &&
        r.complete &&
        r.yards >= Math.max(p.yards, game.distance)))
  ) {
    applied = clone(film);
    applied.result.declinedPenalty = p.name;
    applied.result.penalty = null;
  }
  const next = enrichStatistics(
    advanceCore(game, applied, tempo),
    game,
    applied,
  );
  if (applied.result.declinedPenalty)
    next.last += " • " + applied.result.declinedPenalty + " declined";
  return next;
}
function advanceCore(game, film, tempo = "normal") {
  const g = clone(game),
    r = film.result,
    side = g.possession,
    other = 1 - side,
    s = g.stats[side],
    oldBall = g.ball,
    wasTry = g.phase === "try";
  const untimed = !!g.untimedDown;
  g.untimedDown = false;
  g.seq++;
  if (g.final) throw Error("Game has ended");
  const runoff =
    g.running && !g.overtime && !wasTry && !untimed
      ? Math.max(
          0,
          ({ hurry: 4, normal: 22, chew: 38 }[tempo] ?? 22) -
            (g.readyDelay || 0),
        )
      : 0;
  g.readyDelay = 0;
  if (runoff >= g.clock && !g.overtime && !wasTry && !untimed) {
    g.clock = 0;
    g.last = "Period ended before the snap";
    endPeriod(g);
    return g;
  }
  if (!g.overtime && !wasTry)
    g.clock = Math.max(0, g.clock - runoff - Math.ceil(r.duration));
  const activeIds = new Set((film.players || []).map((p) => p.athleteId));
  for (const id of Object.keys(g.fatigue))
    g.fatigue[id] = Math.max(
      0,
      g.fatigue[id] -
        (activeIds.has(id) ? 0.008 + runoff * 0.00025 : 0.07 + runoff * 0.001),
    );
  for (const p of film.players || [])
    g.fatigue[p.athleteId] = clamp(
      (g.fatigue[p.athleteId] || 0) +
        r.duration * 0.0065 * (1.6 - (p.ratings?.stamina ?? 60) / 120),
      0,
      1,
    );
  let text = "";
  if (r.penalty && !r.penalty.loss && g.clock === 0 && !g.overtime)
    g.untimedDown = true;
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
    if (r.retained) {
      g.ball = r.retainedBall;
      g.phase = "scrimmage";
      g.running = false;
      g.playClock = 25;
      if (r.onside || g.ball >= g.line) first(g);
      else {
        g.down++;
        g.distance = Math.round((g.line - g.ball) * 10) / 10;
        if (g.down > 4) flip(g, 100 - g.ball);
      }
      text = r.onside ? "ONSIDE KICK RECOVERED" : "Blocked kick recovered";
      if (g.overtime) otEnd(g);
    } else if (r.returnTD) {
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
      else flip(g, r.touchback ? 20 : 100 - (oldBall + r.yards));
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
  if (g.phase === "try") {
    const scoring = g.possession,
      lead = g.score[scoring] - g.score[1 - scoring];
    if (
      (g.overtime?.possessions === 1 && lead > 0) ||
      (!g.overtime &&
        g.quarter === 4 &&
        g.clock === 0 &&
        (lead > 0 || lead < -2))
    ) {
      g.final = true;
      g.phase = "final";
      text += " • FINAL";
    }
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
export { kickSimulation as simulateKick } from "./special-teams.js";
export function runSnap(g, p, seed, penalties = true) {
  if (g.final) throw Error("Game has ended");
  if (g.phase === "try" && typeof p === "string" && p !== "extra_point")
    throw Error("Choose a two-point play or kick PAT");
  if (
    g.phase === "try" &&
    p === "extra_point" &&
    g.overtime?.round >= g.rules.otTwoFrom
  )
    throw Error("A two-point attempt is required this overtime round");
  if (g.phase !== "kickoff" && ["onside", "kickoff"].includes(p))
    throw Error(
      "A kickoff is only available after a score or at the start of a half",
    );
  if (g.phase !== "try" && p === "extra_point")
    throw Error("An extra point is only available after a touchdown");
  const runoff =
    g.running && !g.overtime && !g.untimedDown && g.phase === "scrimmage"
      ? Math.max(
          0,
          ({ hurry: 4, normal: 22, chew: 38 }[
            typeof p === "object" ? p.tempo : "normal"
          ] ?? 22) - (g.readyDelay || 0),
        )
      : 0;
  if (
    !g.overtime &&
    !g.untimedDown &&
    g.phase === "scrimmage" &&
    runoff >= g.clock
  ) {
    const play = typeof p === "object" ? p : defaults()[0],
      call = selectDefense(
        g.defenses[1 - g.possession],
        { receivers: play.slots.filter((s) => s.pos === "WR").length },
        g,
        seed ^ 1847,
      ),
      f = previewFilm(
        g.teams[g.possession],
        g.teams[1 - g.possession],
        play,
        call,
        g.ball,
        g.fatigue,
      );
    f.frames = [{ ...f.frames.at(-1), t: 0 }];
    f.preview = false;
    f.version = VERSION;
    f.seed = seed;
    f.events = [{ t: 0, type: "clock", text: "Period ends before the snap" }];
    f.result = {
      reason: "period_expired",
      duration: 0,
      yards: 0,
      turnover: false,
      seed,
      version: VERSION,
    };
    return f;
  }
  if (g.phase === "kickoff")
    return simulateKick(g, p === "onside" ? "onside" : "kickoff", seed);
  if (typeof p === "string") return simulateKick(g, p, seed);
  const def =
    g.practiceCall ||
    selectDefense(
      g.defenses[1 - g.possession],
      { receivers: p.slots.filter((s) => s.pos === "WR").length },
      g,
      seed ^ 1847,
    );
  const film = simulate({
    seed,
    offense: g.teams[g.possession],
    defense: g.teams[1 - g.possession],
    play: clone(p),
    call: def,
    ball: g.ball,
    fatigue: g.fatigue,
    penalties,
  });
  film.situation = {
    down: g.down,
    distance: g.distance,
    ball: g.ball,
    quarter: g.quarter,
    clock: g.clock,
  };
  return film;
}
export function aiPlay(g, book = defaults()) {
  if (g.phase === "kickoff")
    return g.quarter === 4 &&
      g.clock < 120 &&
      g.score[g.possession] < g.score[1 - g.possession]
      ? "onside"
      : "kickoff";
  if (g.phase === "try")
    return g.overtime?.round >= g.rules.otTwoFrom
      ? book.find((p) => p.kind === "run")
      : "extra_point";
  const side = g.possession,
    margin = g.score[side] - g.score[1 - side];
  const urgent = g.quarter === 4 && g.clock < 150 && margin < 0;
  if (g.down === 4) {
    const kicker = g.teams[side].roster.find((p) => p.pos === "K");
    const expectedRange = 20 + (kicker?.ratings.kicking || 60) * 0.43;
    const distance = 117 - g.ball;
    if (distance < expectedRange && (!urgent || margin >= -3))
      return "field_goal";
    if (!urgent && !g.overtime && g.ball < 65 && g.distance > 2) return "punt";
  }
  const r = rng(hash(`${g.seed}-${g.seq}`));
  let a = book.filter((p) => !["spike", "kneel"].includes(p.kind));
  if (g.distance > 8 && g.down >= 3) a = a.filter((p) => p.kind === "pass");
  const availableKneels = 5 - g.down;
  const stoppages = g.timeouts[1 - side];
  if (
    g.quarter === 4 &&
    margin > 0 &&
    g.down < 4 &&
    g.clock <= Math.max(0, availableKneels - stoppages) * 39 &&
    availableKneels > stoppages
  ) {
    const kneel = book.find((p) => p.kind === "kneel");
    if (kneel) return { ...clone(kneel), tempo: "chew" };
  }
  if (
    urgent &&
    g.clock < 18 &&
    g.running &&
    g.timeouts[side] === 0 &&
    g.down < 4
  ) {
    const spike = book.find((p) => p.kind === "spike");
    if (spike) return { ...clone(spike), tempo: "hurry" };
  }
  const scheme = g.teams[g.possession].id;
  const weights = a.map((p) => {
    let w = 1;
    if (scheme === 0 && p.kind === "run")
      w = [
        "Power Right",
        "Counter Left",
        "Trap",
        "Dive",
        "Inside Zone",
      ].includes(p.name)
        ? 9
        : 2;
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
    const recent = g.history
      .filter(
        (h) =>
          h.offense === g.possession && h.play === p.name && !h.result.penalty,
      )
      .slice(-6);
    if (recent.length >= 2) {
      const observed =
        recent.reduce(
          (n, h) =>
            n +
            (h.result.turnover
              ? -8
              : h.result.reason === "incomplete"
                ? 0
                : h.result.yards),
          0,
        ) / recent.length;
      w *= clamp(0.8 + observed * 0.06, 0.35, 1.7);
    }
    if (
      g.down >= 2 &&
      g.distance < 3 &&
      ["Dive", "Power Right", "QB Power"].includes(p.name)
    )
      w *= 1.8;
    return w;
  });
  let v = r() * weights.reduce((a, b) => a + b, 0);
  const chosen = clone(a[weights.findIndex((w) => (v -= w) < 0)] || book[0]);
  if (urgent) chosen.tempo = "hurry";
  else if (g.quarter === 4 && margin > 0) chosen.tempo = "chew";
  return chosen;
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
