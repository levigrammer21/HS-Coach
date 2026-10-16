import { clone, clamp, lineup } from "./data.js";
export const BLOCK_TYPES = [
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
export const CONDITIONS = {
  blitz: "Pressure crosses the line",
  crash: "Read defender crashes inside",
  leverage: "Receiver wins separation",
  motion: "Defender follows motion",
  overload: "Defense overloads a side",
  zone: "Defender leaves the underneath window",
  time: "Read clock reaches delay",
};
export const LOGIC_ACTIONS = {
  prioritize: "Prioritize receiver",
  hot: "Throw hot",
  keep: "Keep at the mesh",
  handoff: "Give at the mesh",
  scramble: "Escape the pocket",
  route: "Apply receiver option",
};
export function pointOnPath(start, path, u) {
  const pts = [start, ...(path || [])];
  if (pts.length === 1) return [...start];
  const lengths = pts
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])),
    total = lengths.reduce((a, b) => a + b, 0);
  let travel = clamp(u, 0, 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (travel <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? travel / lengths[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      ];
    }
    travel -= lengths[i];
  }
  return pts.at(-1);
}
export function snapSlot(s) {
  let p = [s.x, s.y];
  if (s.shift?.length) p = s.shift.at(-1);
  if (s.motion?.length) p = s.motion.at(-1);
  return { ...s, x: p[0], y: p[1] };
}
export function preSnapFrames(players, slots) {
  const length = (start, path) => {
      let sum = 0,
        prev = start;
      for (const p of path || []) {
        sum += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
      }
      return sum;
    },
    motionTime = Math.max(
      1.1,
      ...slots
        .slice(0, 11)
        .map((s) => length(s.shift?.at(-1) || [s.x, s.y], s.motion) / 6.5),
    ),
    shiftTime = Math.max(
      0.8,
      ...slots.slice(0, 11).map((s) => length([s.x, s.y], s.shift) / 5),
    ),
    duration = Math.ceil(Math.max(3, motionTime + 1.05 + shiftTime) * 20) / 20,
    out = [],
    steps = Math.round(duration * 20);
  for (let n = 0; n <= steps; n++) {
    const t = Math.round((-duration + n * 0.05) * 100) / 100,
      positions = slots.map((s, i) => {
        let pos = [s.x, s.y],
          state = "ready";
        if (i < 11) {
          if (s.shift?.length) {
            pos = pointOnPath(
              pos,
              s.shift,
              clamp((t + duration) / shiftTime, 0, 1),
            );
            if (t < -duration + shiftTime) state = "run";
          }
          if (s.motion?.length) {
            pos = pointOnPath(
              pos,
              s.motion,
              clamp((t + motionTime) / motionTime, 0, 1),
            );
            if (t > -motionTime) state = "run";
          }
        } else if (s.assignment === "man") {
          const target = slots.find((o) => o.id === s.target);
          if (target?.motion?.length) {
            const start = target.shift?.at(-1) || [target.x, target.y],
              p = pointOnPath(
                start,
                target.motion,
                clamp((t + motionTime - 0.12) / motionTime, 0, 1),
              );
            pos[0] += (p[0] - start[0]) * 0.85;
            state = t > -motionTime ? "shuffle" : "ready";
          }
        }
        const last = out.at(-1)?.players[i],
          vx = last ? (pos[0] - last[0]) / 0.05 : 0,
          vy = last ? (pos[1] - last[1]) / 0.05 : 0;
        return [pos[0], pos[1], vx, vy, state];
      });
    const qi = slots.findIndex((s) => s.id === "QB"),
      q = positions[qi];
    out.push({
      t,
      players: positions,
      ball: [q?.[0] || 0, q?.[1] || 0, 1],
      carrier: qi,
    });
  }
  return out;
}
export function previewFilm(
  offense,
  defense,
  play,
  call,
  ball = 25,
  fatigue = {},
) {
  const slots = [...play.slots, ...call.slots].map((s, i) =>
      i < 11 ? s : { ...s, y: Math.min(s.y, 105 - ball) },
    ),
    players = [
      ...lineup(offense, play.slots, fatigue),
      ...lineup(defense, call.slots, fatigue),
    ].map((p, i) => ({
      ...p,
      athleteId: p.id,
      id: slots[i].id,
      side: i < 11 ? 0 : 1,
    }));
  return {
    players,
    frames: preSnapFrames(players, slots),
    play,
    call,
    ball,
    offense,
    defense,
    events: [],
    preview: true,
  };
}
// Stable responsibility mapping prevents adjacent linemen from all chasing the same rusher.
export function protectionPlan(os, ds, play) {
  const plan = {},
    claimed = new Map(),
    direction = play.slide === "left" ? -1 : 1;
  for (const b of os
    .filter((s) => BLOCK_TYPES.includes(s.assignment))
    .sort((a, b) => {
      const deferred = (p) =>
        ["pull", "trap", "lead"].includes(p.assignment) && p.path?.length
          ? 1
          : 0;
      return deferred(a) - deferred(b) || Math.abs(b.x) - Math.abs(a.x);
    })) {
    const explicit = ds.find((d) => d.id === b.target);
    let target = explicit;
    if (!target) {
      const readEdge = ["option", "triple"].includes(play.kind)
        ? ds
            .filter((d) => d.pos === play.readDefender)
            .sort((a, b) =>
              play.readSide === "left" ? a.x - b.x : b.x - a.x,
            )[0]?.id
        : null;
      const eligible = ds
        .filter((d) => d.id !== readEdge)
        .filter((d) =>
          b.assignment === "lead"
            ? d.pos === "LB"
            : ["pass", "slide"].includes(b.assignment)
              ? d.y < 3
              : d.y < 10,
        );
      target = eligible.slice().sort((a, c) => {
        const cost = (d) => {
          const pass = ["pass", "slide"].includes(b.assignment);
          // Fan protection gives tackles the edge and guards the interior. Nearest
          // Euclidean matching otherwise crossed both guards behind the tackles.
          const line = ["C", "G", "T"].includes(b.pos);
          let score =
            pass || line
              ? Math.abs(b.x * 1.6 - d.x) +
                Math.abs(b.y - d.y) * (pass ? 0.35 : 0.65)
              : Math.hypot(b.x - d.x, b.y - d.y);
          if (["pass", "slide"].includes(b.assignment))
            score += d.y > 3 ? 4 : 0;
          if (b.assignment === "down")
            score += Math.sign(b.x) * d.x > Math.abs(b.x) ? 5 : 0;
          if (b.assignment === "reach")
            score -= Math.sign(b.x || direction) * d.x * 0.12;
          if (b.assignment === "double") score -= d.pos === "DT" ? 4 : 0;
          else score += (claimed.get(d.id) || 0) * 7;
          return score;
        };
        return cost(a) - cost(c);
      })[0];
    }
    if (target) {
      plan[b.id] = target.id;
      claimed.set(target.id, (claimed.get(target.id) || 0) + 1);
    }
  }
  return plan;
}
export function evaluateLogic(play, { os, ds, qb, t, handed }) {
  const hits = [],
    by = (id) => os.find((p) => p.id === id);
  for (const rule of play.rules || []) {
    if (rule.enabled === false) continue;
    const target = by(rule.target) || by("X"),
      def =
        ds.find((d) => d.id === rule.defender) ||
        ds.reduce((a, b) =>
          Math.hypot(a.x - qb.x, a.y - qb.y) <
          Math.hypot(b.x - qb.x, b.y - qb.y)
            ? a
            : b,
        ),
      sep = target
        ? Math.min(...ds.map((d) => Math.hypot(d.x - target.x, d.y - target.y)))
        : 0,
      threshold = Number(rule.threshold) || 2;
    let hit = false;
    switch (rule.when) {
      case "blitz":
        hit =
          ds.filter((d) => d.y < 0.5 && d.vy < 0).length >=
          Math.max(1, threshold);
        break;
      case "crash":
        hit = def.y < 2 && Math.abs(def.x) < 5 && def.vy < -0.5;
        break;
      case "leverage":
        hit = sep >= threshold;
        break;
      case "motion":
        hit =
          !!target?.motion?.length &&
          ds.some(
            (d) =>
              d.followedMotion === target.id ||
              (Math.abs(d.x - target.x) < 3 &&
                Math.sign(d.vx) === Math.sign(target.vx) &&
                Math.abs(d.vx) > 1),
          );
        break;
      case "overload":
        hit =
          ds.filter(
            (d) => (rule.side === "left" ? d.x < 0 : d.x > 0) && d.y < 7,
          ).length >= threshold;
        break;
      case "zone":
        hit =
          target &&
          ds.filter(
            (d) => Math.abs(d.x - target.x) < 4 && Math.abs(d.y - target.y) < 4,
          ).length === 0;
        break;
      case "time":
        hit = t >= threshold;
        break;
    }
    if (hit && qb.ratings.intelligence + qb.ratings.awareness >= 100)
      hits.push({ ...rule, recognized: true });
  }
  return hits;
}
export function smoothRoute(start, path) {
  if (path.length < 2) return clone(path);
  const pts = [start, ...path],
    out = [];
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1],
      cur = pts[i],
      next = pts[i + 1];
    if (!next) {
      out.push(cur);
      continue;
    }
    const before = [
        cur[0] * 0.82 + prev[0] * 0.18,
        cur[1] * 0.82 + prev[1] * 0.18,
      ],
      after = [cur[0] * 0.82 + next[0] * 0.18, cur[1] * 0.82 + next[1] * 0.18];
    out.push(before);
    for (let n = 1; n <= 4; n++) {
      const u = n / 4;
      out.push([
        (1 - u) ** 2 * before[0] + 2 * (1 - u) * u * cur[0] + u * u * after[0],
        (1 - u) ** 2 * before[1] + 2 * (1 - u) * u * cur[1] + u * u * after[1],
      ]);
    }
  }
  return out;
}
