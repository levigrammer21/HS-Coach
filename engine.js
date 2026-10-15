import {
  VERSION,
  clone,
  clamp,
  rng,
  lineup,
  validateFormation,
} from "./data.js";
export const DT = 1 / 30;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pt = (p) => ({ x: p[0], y: p[1] });
const round = (x) => Math.round(x * 100) / 100;
export function simulate({
  seed = 1,
  offense,
  defense,
  play,
  call,
  ball = 25,
  fatigue = {},
  penalties = true,
}) {
  const random = rng(seed),
    o = lineup(offense, play.slots, fatigue),
    d = lineup(defense, call.slots, fatigue),
    events = [],
    frames = [];
  const players = [
    ...o.map((p, i) => ({
      ...p,
      ...clone(play.slots[i]),
      athleteId: p.id,
      id: play.slots[i].id,
      side: 0,
      vx: 0,
      vy: 0,
      node: 0,
      state: "ready",
      energy: 1 - (fatigue[p.id] || 0) * 0.35,
    })),
    ...d.map((p, i) => ({
      ...p,
      ...clone(call.slots[i]),
      athleteId: p.id,
      id: call.slots[i].id,
      side: 1,
      vx: 0,
      vy: 0,
      node: 0,
      state: "ready",
      energy: 1 - (fatigue[p.id] || 0) * 0.35,
    })),
  ];
  const os = players.slice(0, 11),
    ds = players.slice(11),
    qb = os.find((p) => p.id === "QB"),
    byId = (id) => os.find((p) => p.id === id),
    goal = 100 - ball;
  let t = 0,
    carrier = qb,
    flight = null,
    loose = null,
    thrown = false,
    complete = false,
    intercepted = false,
    handed = false,
    pitched = false,
    dead = false,
    result = null,
    nextRead = play.release || 1.5,
    readIndex = 0;
  let football = { x: qb.x, y: qb.y, z: 1 },
    pairs = new Map(),
    tackles = new Map(),
    holding = null,
    passer = null,
    receiver = null;
  const event = (type, text, extra = {}) =>
    events.push({ t: round(t), type, text, ...extra });
  const finish = (reason, p = carrier) => {
    if (dead) return;
    dead = true;
    result = {
      reason,
      yards: round(p?.y || 0),
      x: round(p?.x || 0),
      duration: round(t),
      complete,
      intercepted: intercepted && reason !== "fumble",
      pass: thrown,
      carrier: p?.athleteId || null,
      passer,
      receiver,
      turnover: intercepted,
      seed,
      version: VERSION,
      penalty: null,
    };
    if (p)
      p.state =
        reason === "touchdown"
          ? "celebrate"
          : reason === "out"
            ? "idle"
            : "down";
    event(
      "whistle",
      reason === "touchdown" ? "TOUCHDOWN" : reason.replaceAll("_", " "),
    );
  };
  const snapshot = () =>
    frames.push({
      t: round(t),
      players: players.map((p) => [
        round(p.x),
        round(p.y),
        round(p.vx),
        round(p.vy),
        p.state,
      ]),
      ball: [round(football.x), round(football.y), round(football.z)],
      carrier: carrier ? players.indexOf(carrier) : -1,
    });
  const move = (p, target, mult = 1) => {
    if (p.side === 0 && p.assignment === "route" && t < 1) {
      const press = ds.find((d) => dist(d, p) < 1.6);
      if (press)
        mult *= clamp(
          0.78 + (p.ratings.release - press.ratings.coverage) * 0.008,
          0.5,
          1.15,
        );
    }
    const dx = target.x - p.x,
      dy = target.y - p.y,
      len = Math.hypot(dx, dy),
      speed = (3.3 + p.ratings.speed * 0.058) * p.energy * mult,
      desiredX = len > 0.15 ? (dx / len) * speed : 0,
      desiredY = len > 0.15 ? (dy / len) * speed : 0,
      acc = 7 + p.ratings.acceleration * 0.1,
      turn = 0.3 + p.ratings.agility * 0.009;
    p.vx += clamp(desiredX - p.vx, -acc * DT * turn, acc * DT * turn);
    p.vy += clamp(desiredY - p.vy, -acc * DT * turn, acc * DT * turn);
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    p.state = p.vy < -0.8 && p.side === 1 && !thrown ? "backpedal" : "run";
  };
  const route = (p) => {
    let path = p.adjustedPath || p.path || [];
    if (p.option && p.option !== "none" && !p.routeDecision && p.y > 4) {
      const nearest = ds.reduce((a, b) => (dist(p, a) < dist(p, b) ? a : b));
      p.routeDecision = true;
      const follows = Math.abs(nearest.vx - p.vx) < 2 && dist(p, nearest) < 4;
      if (p.option === "sit-zone" && !follows) {
        p.adjustedPath = [[p.x, Math.max(7, p.y)]];
        p.node = 0;
        event("route", p.id + " settles in open grass");
      } else if (p.option === "break-away") {
        p.adjustedPath = [
          [clamp(p.x + (nearest.x > p.x ? -8 : 8), -25, 25), p.y + 8],
        ];
        p.node = 0;
        event("route", p.id + " breaks away from defender leverage");
      } else if (p.option === "motion-read" && p.motion?.length && follows) {
        p.adjustedPath = [
          [clamp(p.x + (p.x > 0 ? -12 : 12), -25, 25), p.y + 3],
        ];
        p.node = 0;
        event("route", p.id + " crosses away from trailing coverage");
      }
      path = p.adjustedPath || path;
    }
    if (
      (p.startAfter === "handoff" && !handed) ||
      (p.startAfter === "throw" && !thrown) ||
      (p.startAfter === "los" && (!carrier || carrier.y < 0))
    )
      return move(p, { x: p.x, y: p.y }, 0.2);
    if (t < (p.delay || 0)) return move(p, { x: p.x, y: p.y }, 0.4);
    const target = path[Math.min(p.node, path.length - 1)];
    if (!target) return move(p, { x: p.x, y: p.y });
    if (dist(p, pt(target)) < 0.7 && p.node < path.length - 1) p.node++;
    move(
      p,
      pt(path[Math.min(p.node, path.length - 1)]),
      p.ratings.route ? 0.78 + p.ratings.route * 0.0022 : 1,
    );
  };
  const run = (p) => {
    const dir = p.side === 0 ? 1 : -1;
    let target;
    if (p.side === 0 && p.node < (p.path?.length || 0)) {
      target = pt(p.path[p.node]);
      if (dist(p, target) < 1.2) p.node++;
    } else target = { x: clamp(p.x, -22, 22), y: p.y + 15 * dir };
    const enemies = p.side === 0 ? ds : os;
    for (const e of enemies) {
      const dy = (e.y - p.y) * dir;
      if (dy > 0 && dy < 5 && Math.abs(e.x - p.x) < 2) {
        target = {
          x: clamp(target.x + (p.x >= e.x ? 1 : -1) * 3, -25, 25),
          y: target.y,
        };
        break;
      }
    }
    move(p, target);
  };
  for (const p of os) {
    if (p.shift?.length) {
      const z = p.shift.at(-1);
      p.x = z[0];
      p.y = z[1];
    }
    if (p.motion?.length) {
      const z = p.motion.at(-1);
      p.x = z[0];
      p.y = z[1];
      p.vx = (z[0] > (p.motion.at(-2)?.[0] ?? p.x) ? 1 : -1) * 3;
    }
  }
  snapshot();
  event("snap", `${offense.school}: ${play.name} vs ${call.name}`);
  const issues = validateFormation(play);
  if (issues.length && penalties) {
    finish("penalty");
    result.penalty = {
      name: "Illegal formation",
      side: 0,
      yards: 5,
      repeat: true,
    };
    event("flag", issues[0]);
    return packageResult();
  }
  if (penalties && random() < 0.018) {
    const side = random() < 0.52 ? 0 : 1;
    finish("penalty");
    result.penalty = {
      name: side ? "Encroachment" : "False start",
      side,
      yards: 5,
      repeat: true,
    };
    event("flag", result.penalty.name);
    return packageResult();
  }
  function throwPass(target) {
    const rush = ds.reduce((a, b) => (dist(qb, a) < dist(qb, b) ? a : b));
    const pressure = clamp((4 - dist(qb, rush)) / 4, 0, 1),
      distance = dist(qb, target),
      time = clamp(distance / (17 + qb.ratings.throwPower * 0.15), 0.35, 2),
      err =
        (100 - qb.ratings.accuracy) * 0.025 * (1 + distance / 20) +
        pressure * 2;
    let tx = target.x,
      ty = target.y,
      travel = Math.hypot(target.vx, target.vy) * time;
    const path = target.adjustedPath || target.path || [];
    for (let n = target.node; n < path.length && travel > 0; n++) {
      const [px, py] = path[n],
        len = Math.hypot(px - tx, py - ty);
      if (len <= travel) {
        tx = px;
        ty = py;
        travel -= len;
      } else {
        tx += ((px - tx) * travel) / len;
        ty += ((py - ty) * travel) / len;
        travel = 0;
      }
    }
    const x = tx + (random() - 0.5) * err * 1.35,
      y = ty + (random() - 0.5) * err * 1.35;
    flight = {
      from: { x: qb.x, y: qb.y },
      to: { x, y },
      start: t,
      duration: time,
      type: "pass",
      target: target.id,
    };
    carrier = null;
    thrown = true;
    passer = qb.athleteId;
    qb.state = "throw";
    event(
      "throw",
      `#${qb.number} reads ${target.id}; pressure ${Math.round(pressure * 100)}%`,
      { target: target.id },
    );
  }
  for (let step = 1; step <= 30 * 22 && !dead; step++) {
    t = step * DT;
    const engaged = new Set();
    // Match blocks to nearby threats. Success is local strength/technique versus rush/shed.
    for (const b of os.filter(
      (p) =>
        p !== carrier &&
        [
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
        ].includes(p.assignment),
    )) {
      let target;
      if (
        ["pull", "trap", "lead"].includes(b.assignment) &&
        b.node < (b.path?.length || 0)
      ) {
        route(b);
        continue;
      }
      if (b.assignment === "chip" && t > 1.2) {
        route(b);
        continue;
      }
      if (b.target && b.target !== "nearest")
        target = ds.find((p) => p.id === b.target);
      const threats = ds.filter(
        (p) => !engaged.has(p.id) || b.assignment === "double",
      );
      target =
        target ||
        threats.sort((a, c) => {
          const cost = (p) =>
            dist(b, p) + (b.assignment === "pass" ? Math.max(0, p.y - 7) : 0);
          return cost(a) - cost(c);
        })[0] ||
        ds[0];
      const pass = ["pass", "slide"].includes(b.assignment);
      const anchor = pass
        ? {
            x: b.x + (b.assignment === "slide" ? 0.025 : 0),
            y: Math.max(-3, b.y - 0.07),
          }
        : {
            x:
              target.x +
              (b.assignment === "reach"
                ? Math.sign(target.x || 1) * 0.65
                : b.assignment === "down"
                  ? -Math.sign(b.x) * 0.45
                  : 0),
            y: target.y,
          };
      if (dist(b, target) > 1.25) {
        move(
          b,
          pass && dist(b, target) > 4 ? anchor : pass ? target : anchor,
          0.8,
        );
        continue;
      }
      const key = b.id + target.id;
      let pair = pairs.get(key);
      if (!pair || t > pair.until) {
        const attack =
            (pass ? b.ratings.passBlock : b.ratings.runBlock) * 0.6 +
            b.ratings.strength * 0.4,
          defend =
            (pass ? target.ratings.rush : target.ratings.shed) * 0.65 +
            target.ratings.strength * 0.35;
        pair = {
          until: t + 0.55 + random() * 0.7,
          push: clamp(
            (attack - defend) / 40 + (random() - 0.5) * 0.6,
            -0.9,
            0.9,
          ),
        };
        pairs.set(key, pair);
        if (penalties && !holding && pair.push < -0.4 && random() < 0.018)
          holding = { name: "Holding", side: 0, yards: 10, repeat: true };
      }
      engaged.add(target.id);
      b.state = "block";
      target.state = "shed";
      const push = pair.push * (pass ? 0.5 : 1.5);
      b.y += push * DT;
      target.y += push * DT;
      b.vx = b.vy = target.vx = target.vy = 0;
      // Keep pads in contact while allowing a beaten rusher to disengage.
      if (pair.push < -0.28) {
        target.x += (target.x > b.x ? 1 : -1) * DT * 2.1;
        if (Math.abs(target.x - b.x) > 1.2) engaged.delete(target.id);
      }
    }
    for (const p of os) {
      if (engaged.has(p.id) || p.state === "block") continue;
      if (p === carrier && p !== qb) {
        run(p);
        continue;
      }
      if (p === qb) {
        if (carrier === qb) {
          if (play.kind === "kneel" && t > 0.65) {
            qb.y = -1.3;
            finish("kneel");
            break;
          }
          if (play.kind === "spike" && t > 0.15) {
            thrown=true;passer=qb.athleteId;
            finish("incomplete");
            break;
          }
          if (
            ["run", "option", "triple", "rpo", "qb"].includes(play.kind) &&
            !handed &&
            t > 0.65
          ) {
            const runner = byId(play.runner) || byId("RB"),
              edge = ds.find((p) => p.pos === play.readDefender) || ds[3];
            let keep =
              play.kind === "qb" ||
              (["option", "triple"].includes(play.kind) &&
                edge.x > 0 &&
                edge.y < 2 &&
                qb.ratings.decision + random() * 35 > 70);
            let passRpo =
              play.kind === "rpo" &&
              ds.filter((p) => Math.abs(p.x) < 7 && p.y < 7).length >= 5;
            if (passRpo) {
              handed = true;
              play = clone(play);
              play.kind = "pass";
              nextRead = t + 0.1;
              event("read", "RPO: box count triggers pass");
            } else {
              handed = true;
              if (keep) {
                qb.path = clone(
                  play.slots[9].path || [
                    [8, 0],
                    [15, 20],
                  ],
                );
                qb.node = 0;
                event("read", "Read defender crashes; QB keeps");
              } else {
                carrier = runner;
                runner.x = qb.x + 1;
                runner.y = qb.y;
                runner.node = 0;
                event("handoff", `Mesh to #${runner.number}`);
              }
            }
          }
          if (carrier === qb) {
            if (handed && play.kind !== "pass") {
              run(qb);
              if (
                play.kind === "triple" &&
                !pitched &&
                t > 1.2 &&
                ds.some((p) => dist(p, qb) < 3)
              ) {
                const rb = byId("RB");
                if (dist(rb, qb) < 8) {
                  carrier = rb;
                  pitched = true;
                  event("pitch", "Pitch to the trailing back");
                }
              }
            } else {
              const pressure = ds.some((p) => dist(p, qb) < 2.8);
              move(
                qb,
                {
                  x: pressure && play.scramble ? qb.x + (qb.x > 0 ? 3 : -3) : 0,
                  y: -Math.max(1, play.drop || 5),
                },
                0.7,
              );
              if (t >= nextRead && !thrown && t > 0.5) {
                let reads = play.reads || ["X", "Y", "Z", "H", "RB"];
                if (
                  play.condition === "hot-blitz" &&
                  ds.filter((p) => p.assignment === "rush").length > 4 &&
                  qb.ratings.awareness > 60
                )
                  reads = [play.hot, ...reads];
                if (
                  play.condition === "overload" &&
                  ds.filter((p) => p.x > 0 && p.y < 6).length >= 5
                )
                  reads = [...reads].reverse();
                if (play.condition === "leverage")
                  reads = [...reads].sort((a, b) => {
                    const sep = (id) => {
                      const v = byId(id);
                      return v ? Math.min(...ds.map((d) => dist(d, v))) : -1;
                    };
                    return sep(b) - sep(a);
                  });
                const target = byId(reads[readIndex % reads.length]);
                readIndex++;
                nextRead =
                  t +
                  0.16 +
                  (200 - qb.ratings.decision - qb.ratings.intelligence) *
                    0.0035;
                if (target && ["route", "chip"].includes(target.assignment)) {
                  const sep = Math.min(...ds.map((d) => dist(d, target)));
                  event(
                    "read",
                    `${target.id}: ${sep.toFixed(1)} yd separation`,
                  );
                  if (
                    sep > 1.1 + (100 - qb.ratings.decision) * 0.018 ||
                    (pressure && sep > 0.9) ||
                    t > 4.8
                  )
                    throwPass(target);
                }
                if (!thrown && t > 5.7 && play.scramble) {
                  handed = true;
                  qb.path = [
                    [qb.x > 0 ? 8 : -8, 0],
                    [qb.x > 0 ? 12 : -12, 20],
                  ];
                  qb.node = 0;
                  event("scramble", "Protection exhausted; QB escapes");
                } else if (!thrown && t > 7) {
                  if (Math.abs(qb.x) > 3) {
                    finish("incomplete");
                    event("throwaway", "Outside tackle box; throw beyond line");
                  } else {
                    finish("penalty");
                    result.penalty = {
                      name: "Intentional grounding",
                      side: 0,
                      yards: 5,
                      spot: qb.y,
                      loss: true,
                    };
                    event("flag", "Grounding: no eligible receiver in area");
                  }
                }
              }
            }
          }
        } else if (qb.state !== "throw") move(qb, { x: qb.x, y: qb.y }, 0.2);
        continue;
      }
      if (["route", "run"].includes(p.assignment)) route(p);
    }
    for (const p of ds) {
      if (engaged.has(p.id)) continue;
      const runKnown =
        (carrier && carrier !== qb && t > 0.8) ||
        (carrier === qb && handed) ||
        complete ||
        intercepted;
      if (intercepted && p === carrier) {
        run(p);
        continue;
      }
      if (intercepted && p !== carrier) {
        const threat = os.reduce((a, b) => (dist(p, a) < dist(p, b) ? a : b));
        if (dist(p, threat) < 1.3) {
          p.state = "block";
          threat.vx *= 0.65;
          threat.vy *= 0.65;
        } else move(p, threat, 0.85);
        continue;
      }
      if (runKnown && carrier) {
        if (p.fit && p.fit !== "auto" && t < 1.8) {
          const gap = {
            leftA: -0.8,
            rightA: 0.8,
            leftB: -2.4,
            rightB: 2.4,
            leftC: -5,
            rightC: 5,
          }[p.fit];
          move(p, { x: gap, y: 1.5 }, 1);
          continue;
        }
        if (
          (p.contain || p.assignment === "contain") &&
          carrier.y < 1 &&
          Math.abs(carrier.x) > 5
        ) {
          move(
            p,
            {
              x: Math.sign(p.x || 1) * Math.max(7, Math.abs(carrier.x) + 1),
              y: carrier.y + 2,
            },
            1,
          );
          continue;
        }
        const lead = clamp(
          dist(p, carrier) / (4 + p.ratings.pursuit * 0.05),
          0,
          0.8,
        );
        move(
          p,
          {
            x: clamp(carrier.x + carrier.vx * lead, -27, 27),
            y: carrier.y + carrier.vy * lead,
          },
          1,
        );
        continue;
      }
      if (
        penalties &&
        flight &&
        !holding &&
        t - flight.start < flight.duration * 0.85
      ) {
        const intended = byId(flight.target);
        if (
          intended &&
          intended.y > 1 &&
          dist(p, intended) < 0.7 &&
          Math.hypot(p.vx - intended.vx, p.vy - intended.vy) > 2 &&
          random() < 0.006
        ) {
          holding = {
            name: "Defensive pass interference",
            side: 1,
            yards: 15,
            repeat: true,
          };
          event("flag", "Early coverage contact");
        }
      }
      if (flight && !["rush", "stunt", "contain"].includes(p.assignment)) {
        const aware =
          t - flight.start >
          flight.duration * 0.58 + (100 - p.ratings.awareness) * 0.004;
        if (aware) {
          move(p, flight.to, 1);
          continue;
        }
      }
      if (p.assignment === "rush" || p.assignment === "stunt") {
        move(
          p,
          { x: qb.x + (p.stunt ? Math.sin(t * 2) * p.stunt : 0), y: qb.y },
          0.95,
        );
        continue;
      }
      if (p.assignment === "contain") {
        move(p, { x: Math.sign(p.x) * 7, y: Math.min(0, qb.y + 2) }, 0.8);
        continue;
      }
      if (p.assignment === "man") {
        const receiver = byId(p.target) || os[5];
        const lag = (100 - p.ratings.coverage) * 0.022;
        move(
          p,
          {
            x: receiver.x + receiver.vx * lag,
            y: receiver.y + 1 + receiver.vy * lag,
          },
          0.96,
        );
      } else {
        const zone = pt(p.zone || [p.x, p.assignment === "deep" ? 22 : 8]);
        const nearby = os
          .filter((o) => ["route", "run"].includes(o.assignment))
          .sort((a, b) => dist(a, zone) - dist(b, zone))[0];
        let target = zone;
        if (nearby && dist(nearby, zone) < (p.assignment === "deep" ? 15 : 10))
          target = {
            x: zone.x * 0.25 + nearby.x * 0.75,
            y:
              p.assignment === "deep"
                ? Math.max(zone.y, nearby.y + 2)
                : nearby.y + 1,
          };
        move(p, target, 0.9);
      }
    }
    // Offensive pursuit after interception; legal contact and body separation otherwise.
    if (intercepted && carrier)
      for (const p of os) move(p, { x: carrier.x, y: carrier.y }, 0.95);
    for (let i = 0; i < 22; i++)
      for (let j = i + 1; j < 22; j++) {
        const a = players[i],
          b = players[j],
          dd = dist(a, b);
        if (dd > 0 && dd < 0.62) {
          const n = (0.62 - dd) * 0.35,
            dx = (a.x - b.x) / dd,
            dy = (a.y - b.y) / dd;
          a.x += dx * n;
          a.y += dy * n;
          b.x -= dx * n;
          b.y -= dy * n;
        }
      }
    if (flight) {
      const u = clamp((t - flight.start) / flight.duration, 0, 1);
      football = {
        x: flight.from.x + (flight.to.x - flight.from.x) * u,
        y: flight.from.y + (flight.to.y - flight.from.y) * u,
        z:
          1 +
          Math.sin(Math.PI * u) *
            Math.min(9, dist(flight.from, flight.to) * 0.21),
      };
      if (u >= 1) {
        const eligible = os.filter((p) =>
            ["route", "chip"].includes(p.assignment),
          ),
          candidates = [...eligible, ...ds]
            .filter((p) => dist(p, football) < 1.8)
            .sort((a, b) => dist(a, football) - dist(b, football));
        let caught = null;
        for (const p of candidates) {
          const separation = dist(p, football),
            r = p.side
              ? p.ratings.coverage * 0.4 + p.ratings.catching * 0.6
              : p.ratings.catching,
            contest = players.filter(
              (q) => q.side !== p.side && dist(q, p) < 1.8,
            ).length;
          const chance = clamp(
            (p.side ? 0.04 : 0.35) +
              r * (p.side ? 0.005 : 0.007) -
              separation * 0.19 -
              contest * 0.09,
            0.05,
            0.97,
          );
          if (random() < chance) {
            caught = p;
            break;
          }
        }
        if (caught) {
          carrier = caught;
          receiver = caught.athleteId;
          if (caught.side) {
            intercepted = true;
            event("interception", `#${caught.number} intercepts`);
          } else {
            complete = true;
            event("catch", `#${caught.number} secures the catch`);
          }
          caught.node = 99;
          flight = null;
        } else {
          flight = null;
          finish("incomplete");
        }
      }
    } else if (carrier) {
      football = {
        x: carrier.x + 0.18,
        y: carrier.y,
        z: carrier.state === "down" ? 0.2 : 1,
      };
      if (loose) {
        football = { ...loose, z: 0.2 };
        const recover = players
          .filter((p) => dist(p, loose) < 1.2)
          .sort((a, b) => dist(a, loose) - dist(b, loose))[0];
        if (recover) {
          carrier = recover;
          intercepted = recover.side === 1;
          event("recovery", `#${recover.number} recovers`);
          loose = null;
          finish("fumble");
          result.turnover = intercepted;
        }
      }
      if (carrier && !loose && !dead) {
        const opponents = carrier.side ? os : ds;
        for (const defender of opponents) {
          if (
            engaged.has(defender.id) ||
            dist(carrier, defender) > 1 ||
            t < 0.6
          )
            continue;
          const key = defender.id + carrier.id;
          if ((tackles.get(key) || 0) > t) continue;
          tackles.set(key, t + 0.7);
          const rating =
              defender.ratings.tackle * 0.65 + defender.ratings.strength * 0.35,
            evade =
              carrier.ratings.agility * 0.5 + carrier.ratings.strength * 0.5,
            closing = Math.hypot(
              defender.vx - carrier.vx,
              defender.vy - carrier.vy,
            );
          if (
            random() <
            clamp(0.58 + (rating - evade) * 0.008 + closing * 0.012, 0.18, 0.94)
          ) {
            event("tackle", `#${defender.number} wraps #${carrier.number}`);
            defender.state = "tackle";
            if (
              random() <
              clamp((100 - carrier.ratings.security) * 0.0008, 0, 0.06)
            ) {
              loose = {
                x: carrier.x + (random() - 0.5) * 2,
                y: carrier.y + (random() - 0.5) * 2,
              };
              event("fumble", "Ball knocked loose");
            } else finish(carrier === qb && !handed ? "sack" : "tackle");
            break;
          } else {
            event("break", "Tackle broken");
            defender.state = "stumble";
            defender.vx *= 0.2;
            defender.vy *= 0.2;
          }
        }
        if (!dead && !loose) {
          if (Math.abs(carrier.x) > 26.67) finish("out");
          else if (
            (carrier.side === 0 && carrier.y >= goal) ||
            (carrier.side === 1 && carrier.y <= -ball)
          )
            finish("touchdown");
          else if (
            (carrier.side === 0 && carrier.y <= -ball) ||
            (carrier.side === 1 && carrier.y >= goal)
          )
            finish("safety");
        }
      }
    }
    if (step % 3 === 0 || dead) snapshot();
    // Reset animation states on the next physics step; no effect on assignment logic.
    for (const p of os) if (p.state === "block") p.state = "ready";
  }
  if (!dead) finish("forward_progress");
  if (
    holding &&
    !(holding.side === 1 && result.reason === "touchdown" && !result.turnover)
  ) {
    result.penalty = holding;
    event("flag", holding.name + "; repeat down");
  }
  return packageResult();
  function packageResult() {
    return {
      result,
      events,
      frames,
      players: players.map(
        ({ id, athleteId, name, number, pos, side, ratings }) => ({
          id,
          athleteId,
          name,
          number,
          pos,
          side,
          ratings,
        }),
      ),
      play: clone(play),
      call: clone(call),
      ball,
      offense: {
        school: offense.school,
        primary: offense.primary,
        secondary: offense.secondary,
      },
      defense: {
        school: defense.school,
        primary: defense.primary,
        secondary: defense.secondary,
      },
      version: VERSION,
      seed,
    };
  }
}
