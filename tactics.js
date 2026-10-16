import { clamp } from "./data.js";
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Coverage reads only current positions and velocity, never a route's future points.
export function coverageTarget(defender, offense, defense, qb) {
  const zone = {
    x: defender.zone?.[0] ?? defender.x,
    y: defender.zone?.[1] ?? 8,
  };
  const deep = defender.assignment === "deep";
  const peers = defense.filter(
    (d) => d.assignment === defender.assignment && d.id !== defender.id,
  );
  const threats = offense.filter(
    (p) => ["route", "chip", "run"].includes(p.assignment) && p.y > -2,
  );
  let best = null,
    score = Infinity;
  for (const p of threats) {
    const dx = Math.abs(p.x - zone.x);
    // Own the route in your sector; overlapping defenders can carry crossing routes at boundaries.
    const closer = peers.some(
      (d) => Math.abs((d.zone?.[0] ?? d.x) - p.x) + 2 < dx,
    );
    const cost =
      dx +
      (deep ? -p.y * 0.45 : Math.abs(p.y - zone.y) * 0.7) +
      (closer ? 12 : 0);
    if (cost < score && dx < (deep ? 19 : 12) && (deep || p.y < zone.y + 9)) {
      best = p;
      score = cost;
    }
  }
  if (!best) return zone;
  if (deep)
    return {
      x: clamp(best.x + best.vx * 0.18, zone.x - 12, zone.x + 12),
      y: Math.max(zone.y, best.y + 2.5 + Math.max(0, best.vy) * 0.28),
    };
  const look = clamp((defender.ratings.awareness - 40) / 100, 0, 0.5);
  return {
    x: clamp(best.x + best.vx * look, zone.x - 8, zone.x + 8),
    y: clamp(best.y + 1, Math.max(1, zone.y - 6), zone.y + 7),
  };
}

export function pursuitPoint(defender, carrier) {
  const speed = (3.3 + defender.ratings.speed * 0.058) * (defender.energy ?? 1);
  const rx = carrier.x - defender.x,
    ry = carrier.y - defender.y;
  const a = carrier.vx ** 2 + carrier.vy ** 2 - speed ** 2;
  const b = 2 * (rx * carrier.vx + ry * carrier.vy),
    c = rx * rx + ry * ry;
  let roots = [];
  if (Math.abs(a) < 0.001) {
    if (Math.abs(b) > 0.001) roots = [-c / b];
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0)
      roots = [
        (-b - Math.sqrt(disc)) / (2 * a),
        (-b + Math.sqrt(disc)) / (2 * a),
      ];
  }
  const viable = roots.filter((v) => v >= 0 && Number.isFinite(v));
  const intercept = viable.length ? Math.min(2, ...viable) : 0;
  const awareness = clamp(defender.ratings.pursuit / 90, 0.45, 1);
  return {
    x: clamp(carrier.x + carrier.vx * intercept * awareness, -26.5, 26.5),
    y: carrier.y + carrier.vy * intercept * awareness,
  };
}

export function runningLane(runner, target, enemies, engaged) {
  const dir = runner.side === 0 ? 1 : -1;
  // Honor the designed counter step, sweep track and option edge before cutting upfield.
  if ((target.y - runner.y) * dir < 1.5) return target;
  const ahead = enemies.filter(
    (p) =>
      !engaged.has(p.id) &&
      (p.y - runner.y) * dir > -0.25 &&
      (p.y - runner.y) * dir < 5.5,
  );
  if (!ahead.length) return target;
  let best = target,
    bestCost = Infinity;
  for (const offset of [0, -1.8, 1.8, -3.4, 3.4]) {
    const x = clamp(runner.x + offset, -25.8, 25.8),
      y = runner.y + 3.8 * dir;
    let cost = Math.abs(x - target.x) * 0.18 + Math.abs(offset) * 0.12;
    for (const e of ahead) {
      const reach = distance({ x, y }, e);
      cost += Math.max(0, 3.5 - reach) ** 2 * (e.ratings.tackle / 70);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = { x, y };
    }
  }
  // Awareness controls how much of the visible lane can be used.
  const vision = clamp(
    (runner.ratings.awareness + runner.ratings.agility) / 180,
    0.35,
    1,
  );
  return { x: target.x * (1 - vision) + best.x * vision, y: best.y };
}

export function specialTeamsUnit(
  team,
  kickType,
  receiving = false,
  fatigue = {},
) {
  const used = new Set(),
    result = [];
  const choose = (score) => {
    const p = team.roster
      .filter((p) => !used.has(p.id))
      .sort((a, b) => score(b) - score(a))[0];
    used.add(p.id);
    result.push(p);
    return p;
  };
  const fresh = (p) => 1 - (fatigue[p.id] || 0) * 0.3;
  if (!receiving)
    choose(
      (p) =>
        (p.pos === (kickType === "punt" ? "P" : "K") ? 200 : 0) +
        (kickType === "punt" ? p.ratings.punting : p.ratings.kicking),
    );
  // Reserve the best actual returner before selecting the blocking unit.
  const returner = receiving
    ? choose(
        (p) =>
          (p.ratings.speed * 0.35 +
            p.ratings.agility * 0.25 +
            p.ratings.security * 0.25 +
            p.ratings.catching * 0.15) *
          fresh(p),
      )
    : null;
  for (let n = result.length; n < 11; n++)
    choose(
      (p) =>
        (receiving
          ? p.ratings.runBlock * 0.4 +
            p.ratings.strength * 0.25 +
            p.ratings.speed * 0.35
          : p.ratings.speed * 0.35 +
            p.ratings.tackle * 0.4 +
            p.ratings.pursuit * 0.25) * fresh(p),
    );
  if (returner) result.push(result.shift());
  return result;
}
