import {
  preSnapFrames,
  protectionPlan,
  evaluateLogic,
  smoothRoute,
} from "./football.js";
import {
  VERSION,
  clone,
  clamp,
  rng,
  lineup,
  validateFormation,
} from "./data.js";
import { coverageTarget, pursuitPoint, runningLane } from "./tactics.js";
export const DT = 1 / 30;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pt = (p) => ({ x: p[0], y: p[1] });
const round = (x) => Math.round(x * 100) / 100 || 0;
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
  for (const p of players)
    if (p.curved && p.path?.length) p.path = smoothRoute([p.x, p.y], p.path);
  const blockPlan = protectionPlan(
      players.slice(0, 11),
      players.slice(11),
      play,
    ),
    observation = [],
    logicSeen = new Set(),
    production = {};
  const credit = (p, key, n = 1) => {
    if (!p) return;
    const a = (production[p.athleteId] ||= {});
    a[key] = (a[key] || 0) + n;
  };
  const os = players.slice(0, 11),
    ds = players.slice(11),
    qb = os.find((p) => p.id === "QB"),
    byId = (id) => os.find((p) => p.id === id),
    goal = 100 - ball;
  for (const p of ds) p.y = Math.min(p.y, goal + 5);
  let t = 0,
    carrier = qb,
    flight = null,
    loose = null,
    thrown = false,
    complete = false,
    intercepted = false,
    handed = false,
    pitched = false,
    escaping = false,
    dead = false,
    result = null,
    meshAt = play.mesh ?? (play.concept === "Draw" ? 1.65 : 0.75),
    nextRead = play.release || 1.5,
    readIndex = 0;
  let football = { x: qb.x, y: qb.y, z: 1 },
    activeEngaged = new Set(),
    pairs = new Map(),
    tackles = new Map(),
    holding = null,
    passer = null,
    receiver = null,
    catchY = null,
    inReturnEndzone = false;
  const event = (type, text, extra = {}) =>
    events.push({ t: round(t), type, text, ...extra });
  const finish = (reason, p = carrier) => {
    if (dead) return;
    if (
      p &&
      ["tackle", "sack", "out", "kneel", "forward_progress"].includes(reason) &&
      ((p.side === 0 && p.y <= -ball) ||
        (p.side === 1 && p.y >= goal && !inReturnEndzone))
    )
      reason = "safety";
    dead = true;
    result = {
      reason,
      yards: round(
        reason === "touchdown" ? (p?.side === 1 ? -ball : goal) : p?.y || 0,
      ),
      x: round(p?.x || 0),
      duration: round(t),
      complete,
      catchY,
      intercepted: intercepted && reason !== "fumble",
      touchback: intercepted && inReturnEndzone && p?.y >= goal,
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
        p.poseUntil > t ? p.pose : p.state,
        0,
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
      approach = Math.min(
        speed,
        Math.sqrt(2 * (7 + p.ratings.acceleration * 0.1) * len),
      ),
      desiredX = len > 0.08 ? (dx / len) * approach : 0,
      desiredY = len > 0.08 ? (dy / len) * approach : 0,
      acc = 7 + p.ratings.acceleration * 0.1,
      turn = 0.3 + p.ratings.agility * 0.009;
    p.vx += clamp(desiredX - p.vx, -acc * DT * turn, acc * DT * turn);
    p.vy += clamp(desiredY - p.vy, -acc * DT * turn, acc * DT * turn);
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    p.state =
      p.vy > 0.8 &&
      p.side === 1 &&
      !thrown &&
      ["man", "zone", "deep"].includes(p.assignment) &&
      t < 1.5
        ? "backpedal"
        : "run";
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
    if (play.fake && p.id === "RB" && t < 0.7)
      return move(p, { x: qb.x + 1, y: qb.y }, 0.8);
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
    target = runningLane(p, target, enemies, activeEngaged);
    move(p, target);
  };
  const preSlots = [...play.slots, ...call.slots].map((s, i) =>
    i < 11 ? s : { ...s, y: Math.min(s.y, goal + 5) },
  );
  const pre = preSnapFrames(players, preSlots);
  frames.push(...pre);
  const preEnd = pre.at(-1);
  players.forEach((p, i) => {
    if (i >= 11 && Math.abs(preEnd.players[i][0] - p.x) > 1)
      p.followedMotion = p.target;
    p.x = preEnd.players[i][0];
    p.y =
      i >= 11 ? Math.min(preEnd.players[i][1], goal + 5) : preEnd.players[i][1];
    p.vx = preEnd.players[i][2];
    p.vy = preEnd.players[i][3];
  });
  football = { x: qb.x, y: qb.y, z: 1 };
  for (const p of os)
    if (p.motion?.length)
      event("motion", p.id + " completes motion before the snap");
  snapshot();
  event("snap", `${offense.school}: ${play.name} vs ${call.name}`);
  const issues = validateFormation(play);
  if (
    os.filter((p) => Math.abs(p.y) < 0.4 && p.number >= 50 && p.number <= 79)
      .length < 5
  )
    issues.push(
      "Five linemen must wear numbers 50–79 in a scrimmage formation.",
    );
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
    const rush = ds
      .filter((d) => !activeEngaged.has(d.id))
      .reduce((a, b) => (dist(qb, a) < dist(qb, b) ? a : b), ds[0]);
    const pressure = clamp((4 - dist(qb, rush)) / 4, 0, 1),
      distance = dist(qb, target),
      time = clamp(distance / (17 + qb.ratings.throwPower * 0.15), 0.35, 3),
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
    const maxRange = 18 + qb.ratings.throwPower * 0.42;
    const aimDistance = Math.hypot(tx - qb.x, ty - qb.y);
    if (aimDistance > maxRange) {
      const scale = maxRange / aimDistance;
      tx = qb.x + (tx - qb.x) * scale;
      ty = qb.y + (ty - qb.y) * scale;
      event("range", "Throw reaches the quarterback’s arm limit");
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
    if (
      penalties &&
      y > 0 &&
      os.some(
        (p) =>
          ["C", "G", "T"].includes(p.pos) &&
          p.y > 2 &&
          !["pass", "slide"].includes(p.assignment),
      )
    ) {
      holding = {
        name: "Ineligible receiver downfield",
        side: 0,
        yards: 5,
        repeat: true,
      };
      event("flag", "Ineligible lineman beyond the expanded neutral zone");
    }
    carrier = null;
    thrown = true;
    passer = qb.athleteId;
    qb.state = "throw";
    qb.pose = "throw";
    qb.poseUntil = t + 0.35;
    event(
      "throw",
      `#${qb.number} reads ${target.id}; pressure ${Math.round(pressure * 100)}%`,
      { target: target.id },
    );
  }
  for (let step = 1; step <= 30 * 22 && !dead; step++) {
    t = step * DT;
    observation.push(
      os.map((p) => ({ id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
    );
    if (observation.length > 22) observation.shift();
    const engaged = (activeEngaged = new Set());
    // Once possession is declared, eligible receivers stalk the nearest live pursuit threat.
    if ((handed && play.kind !== "pass") || complete)
      for (const p of os)
        if (
          p !== carrier &&
          p !== qb &&
          p.assignment === "route" &&
          t > meshAt + 0.2
        ) {
          p.assignment = "stalk";
          delete blockPlan[p.id];
        }
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
          "stalk",
        ].includes(p.assignment),
    )) {
      let target = ds.find((d) => d.id === blockPlan[b.id]);
      if (b.recoverUntil > t) {
        move(b, carrier || qb, 0.45);
        continue;
      }
      if (b.assignment === "stalk")
        target = ds
          .filter((d) => !engaged.has(d.id) && d.y > (carrier?.y ?? 0) - 2)
          .sort((a, c) => dist(b, a) - dist(b, c))[0];
      if (b.assignment === "pass" && play.concept === "Draw" && handed)
        b.assignment = "zone";
      if (
        ["pull", "trap", "lead"].includes(b.assignment) &&
        b.node < (b.path?.length || 0)
      ) {
        const last = b.path.at(-1);
        if (dist(b, pt(last)) < 1.1 || (target && dist(b, target) < 1.25))
          b.node = b.path.length;
        else {
          route(b);
          continue;
        }
      }
      if (b.assignment === "chip" && t > 1.2) {
        route(b);
        continue;
      }
      if (b.target && b.target !== "nearest")
        target = ds.find((p) => p.id === b.target);
      const threats = ds.filter(
        (p) =>
          (!engaged.has(p.id) || b.assignment === "double") &&
          !(p.escapedBlocker === b.id && p.escapeUntil > t),
      );
      if (target?.escapedBlocker === b.id && target.escapeUntil > t)
        target = null;
      target =
        target ||
        threats.sort((a, c) => {
          const cost = (p) =>
            dist(b, p) + (b.assignment === "pass" ? Math.max(0, p.y - 7) : 0);
          return cost(a) - cost(c);
        })[0] ||
        null;
      if (!target) continue;
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
      if (b.blockTarget !== target.id) {
        b.blockTarget = target.id;
        b.blockSince = t;
      }
      let pair = pairs.get(key);
      if (!pair || t > pair.until) {
        const partners = os.filter(
            (q) =>
              q !== b && blockPlan[q.id] === target.id && dist(q, target) < 1.7,
          ),
          help = partners.reduce(
            (sum, q) => sum + (q.ratings.runBlock + q.ratings.strength) * 0.09,
            0,
          );
        const attack =
            help +
            ((pass ? b.ratings.passBlock : b.ratings.runBlock) * 0.6 +
              b.ratings.strength * 0.4) *
              (0.6 + b.energy * 0.4) +
            clamp(((b.weight || 210) - (target.weight || 210)) * 0.025, -3, 3),
          defend =
            ((pass ? target.ratings.rush : target.ratings.shed) * 0.65 +
              target.ratings.strength * 0.35) *
            (0.6 + target.energy * 0.4);
        pair = {
          until: t + 0.55 + random() * 0.7,
          push: clamp(
            (attack - defend) / 40 + (random() - 0.5) * 0.6,
            -0.9,
            0.9,
          ),
        };
        pairs.set(key, pair);
        credit(b, "blocks");
        if (partners.length)
          event(
            "combo",
            b.id +
              " combines with " +
              partners.map((q) => q.id).join("+") +
              " on " +
              target.id,
          );
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
      // Match lateral footwork as the defender works around a shoulder. Contact
      // cannot freeze a pursuit athlete indefinitely, particularly on stalk blocks.
      const shoulder = Math.sign(target.x - b.x) || Math.sign(target.x) || 1;
      const blockSkill = pass ? b.ratings.passBlock : b.ratings.runBlock;
      const shedSkill = pass ? target.ratings.rush : target.ratings.shed;
      target.x +=
        shoulder *
        (0.8 + shedSkill * 0.008 + Math.max(0, -pair.push) * 0.6) *
        DT;
      b.x +=
        ((shoulder * (0.7 + blockSkill * 0.008)) /
          (1 + (t - b.blockSince) * 0.06)) *
        DT;
      if (Math.abs(target.x - b.x) > 1.25) {
        target.escapedBlocker = b.id;
        target.escapeUntil = t + 0.75;
        b.recoverUntil = t + 0.3;
        engaged.delete(target.id);
      }
      // Keep pads in contact while allowing a beaten rusher to disengage.
      if (b.assignment === "double" && t > 1.2 && pair.push > 0.15) {
        const backer = ds
          .filter((d) => d.pos === "LB" && !engaged.has(d.id))
          .sort((a, c) => dist(b, a) - dist(b, c))[0];
        if (backer) {
          blockPlan[b.id] = backer.id;
          event("climb", b.id + " climbs to " + backer.id);
        }
      }
      // A rusher wins the edge through accumulated leverage, not perpetual pad contact.
      const leverage = dist(b, target);
      if (
        t - b.blockSince > (pass ? 2.1 : 2.7) &&
        leverage > 0.8 &&
        pair.push < 0.05
      ) {
        target.escapedBlocker = b.id;
        target.escapeUntil = t + 0.85;
        b.recoverUntil = t + 0.45;
        engaged.delete(target.id);
        event("shed", target.id + " sheds " + b.id);
      }
      if (pair.push < -0.28) {
        target.x += (target.x > b.x ? 1 : -1) * DT * 2.1;
        if (Math.abs(target.x - b.x) > 1.2) engaged.delete(target.id);
      }
    }
    for (const p of os) {
      if (loose) {
        move(p, loose, 1);
        continue;
      }
      if (flight?.type === "pitch" && p.id === flight.target) {
        move(p, flight.to, 0.95);
        continue;
      }
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
            thrown = true;
            passer = qb.athleteId;
            finish("incomplete");
            break;
          }
          if (
            ["run", "option", "triple", "rpo", "qb"].includes(play.kind) &&
            !handed &&
            t > meshAt &&
            (play.kind === "qb" ||
              play.exchange === "toss" ||
              dist(byId(play.runner) || byId("RB"), qb) < 1.5)
          ) {
            const runner = byId(play.runner) || byId("RB"),
              edge =
                ds
                  .filter((p) => p.pos === play.readDefender)
                  .sort((a, b) =>
                    play.readSide === "left" ? a.x - b.x : b.x - a.x,
                  )[0] || ds[3];
            const logic = evaluateLogic(play, { os, ds, qb, t, handed });
            let keep =
              play.kind === "qb" ||
              (["option", "triple"].includes(play.kind) &&
                Math.abs(edge.x) < 5 &&
                edge.vy < -0.5 &&
                edge.y < 2 &&
                qb.ratings.decision + random() * 35 > 70);
            if (logic.some((r) => r.action === "keep")) keep = true;
            if (logic.some((r) => r.action === "handoff")) keep = false;
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
                  (play.kind === "qb"
                    ? play.slots[10].path
                    : (byId("QB").path?.length ? byId("QB").path : null) ||
                      play.keepPath) || [
                    [8, 0],
                    [15, 20],
                  ],
                );
                qb.node = 0;
                qb.vy *= 0.25;
                if (play.kind !== "qb")
                  edge.keyedRunner = {
                    id: runner.id,
                    until: t + 0.18 + (100 - edge.ratings.awareness) * 0.004,
                  };
                event(
                  "read",
                  play.kind === "qb"
                    ? "Designed quarterback run"
                    : "Read defender crashes; QB keeps",
                );
              } else {
                if (play.exchange === "toss") {
                  const duration = clamp(dist(qb, runner) / 12, 0.25, 0.8);
                  flight = {
                    from: { x: qb.x, y: qb.y },
                    to: {
                      x: runner.x + runner.vx * duration * 0.65,
                      y: Math.min(
                        qb.y - 0.2,
                        runner.y + runner.vy * duration * 0.65,
                      ),
                    },
                    start: t,
                    duration,
                    type: "pitch",
                    target: runner.id,
                  };
                  carrier = null;
                  pitched = true;
                  event("pitch", "QB tosses to #" + runner.number);
                } else carrier = runner;
                // The mesh transfers possession only when the players actually meet.

                runner.node = 0;
                if (play.exchange !== "toss")
                  event("handoff", `Mesh to #${runner.number}`);
              }
            }
          }
          if (carrier === qb) {
            if ((handed && play.kind !== "pass") || escaping) {
              run(qb);
              if (
                play.kind === "triple" &&
                !pitched &&
                t > meshAt + 0.2 &&
                ds.some((p) => !engaged.has(p.id) && dist(p, qb) < 3)
              ) {
                const rb = byId("RB");
                if (dist(rb, qb) < 8) {
                  pitched = true;
                  const duration = clamp(dist(rb, qb) / 12, 0.25, 0.65);
                  flight = {
                    from: { x: qb.x, y: qb.y },
                    to: {
                      x: rb.x + rb.vx * duration * 0.6,
                      y: Math.min(qb.y - 0.25, rb.y + rb.vy * duration * 0.6),
                    },
                    start: t,
                    duration,
                    type: "pitch",
                    target: rb.id,
                  };
                  carrier = null;
                  event("pitch", "QB pitches behind him to the trailing back");
                }
              }
            } else {
              const pressure = ds.some(
                (p) => !engaged.has(p.id) && dist(p, qb) < 2.8,
              );
              move(
                qb,
                {
                  x:
                    pressure && play.scramble && play.kind === "pass"
                      ? qb.x + (qb.x > 0 ? 3 : -3)
                      : 0,
                  y: -Math.max(
                    ["run", "option", "triple", "rpo", "qb"].includes(play.kind)
                      ? play.kind === "triple"
                        ? 1
                        : 2.5
                      : 1,
                    play.drop || 5,
                  ),
                },
                0.7,
              );
              if (play.kind === "pass" && t >= nextRead && !thrown && t > 0.5) {
                let reads = [...(play.reads || ["X", "Y", "Z", "H", "RB"])];
                for (const rule of evaluateLogic(play, {
                  os,
                  ds,
                  qb,
                  t,
                  handed,
                }).reverse()) {
                  if (!logicSeen.has(rule.id)) {
                    event(
                      "logic",
                      rule.when +
                        " → " +
                        rule.action +
                        " " +
                        (rule.target || ""),
                    );
                    logicSeen.add(rule.id);
                  }
                  if (["prioritize", "hot"].includes(rule.action))
                    reads = [
                      rule.target,
                      ...reads.filter((id) => id !== rule.target),
                    ];
                  if (rule.action === "scramble" && play.scramble) {
                    escaping = true;
                    handed = true;
                    qb.path = [
                      [qb.x > 0 ? 8 : -8, 0],
                      [qb.x > 0 ? 12 : -12, 20],
                    ];
                    qb.node = 0;
                  }
                  if (rule.action === "route") {
                    const q = byId(rule.target);
                    if (q && !q.routeDecision)
                      q.option = rule.option || "break-away";
                  }
                }
                if (
                  play.condition === "hot-blitz" &&
                  ds.filter((p) => p.vy < -0.5 && p.y < 2).length > 4 &&
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
                  escaping = true;
                  handed = true;
                  qb.path = [
                    [qb.x > 0 ? 8 : -8, 0],
                    [qb.x > 0 ? 12 : -12, 20],
                  ];
                  qb.node = 0;
                  event("scramble", "Protection exhausted; QB escapes");
                } else if (!thrown && t > 7) {
                  if (Math.abs(qb.x) > 3) {
                    const end = {
                      x: Math.sign(qb.x) * 29,
                      y: Math.max(1, qb.y + 10),
                    };
                    flight = {
                      from: { x: qb.x, y: qb.y },
                      to: end,
                      start: t,
                      duration: Math.max(0.5, dist(qb, end) / 26),
                      type: "pass",
                      target: null,
                    };
                    carrier = null;
                    thrown = true;
                    passer = qb.athleteId;
                    qb.pose = "throw";
                    qb.poseUntil = t + 0.35;
                    qb.state = "throw";
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
        } else if (qb.poseUntil <= t || qb.state !== "throw")
          move(qb, { x: qb.x, y: qb.y }, 0.2);
        continue;
      }
      if (
        !handed &&
        ["run", "option", "triple", "rpo"].includes(play.kind) &&
        p.id === (play.runner || "RB") &&
        play.exchange !== "toss"
      )
        move(p, { x: qb.x + 1, y: qb.y + 0.1 }, 0.95);
      else if (
        play.kind === "triple" &&
        handed &&
        carrier === qb &&
        p.id === "RB"
      )
        move(p, { x: qb.x + 4.5, y: qb.y - 2 }, 0.94);
      else if (["route", "run"].includes(p.assignment)) route(p);
    }
    for (const p of ds) {
      if (engaged.has(p.id)) continue;
      const runKnown =
        (carrier && carrier !== qb && t > 0.8) ||
        (carrier === qb && handed) ||
        complete ||
        intercepted;
      if (flight?.type === "pitch" || loose) {
        move(p, loose || football, 1);
        continue;
      }
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
      if (
        play.fake &&
        !thrown &&
        t > 0.35 &&
        t < 1.2 &&
        p.pos === "LB" &&
        p.ratings.awareness < 76
      ) {
        move(p, { x: byId("RB").x, y: 1 }, 0.85);
        continue;
      }
      if (p.keyedRunner?.until > t) {
        const meshRunner = byId(p.keyedRunner.id);
        move(p, meshRunner || qb, 0.95);
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
        move(p, pursuitPoint(p, carrier), 1);
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
        const reaction = Math.round(
          clamp(
            (200 - p.ratings.coverage - p.ratings.awareness) * 0.002,
            0.07,
            0.4,
          ) / DT,
        );
        const seen =
          observation[Math.max(0, observation.length - 1 - reaction)].find(
            (v) => v.id === receiver.id,
          ) || receiver;
        move(
          p,
          { x: seen.x + seen.vx * 0.12, y: seen.y + 1.3 + seen.vy * 0.12 },
          0.98,
        );
      } else {
        const landmark = coverageTarget(p, os, ds, qb);
        if (p.assignment === "deep")
          landmark.y = Math.min(goal + 2, landmark.y);
        move(p, landmark, 0.96);
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
      if (flight.type === "pitch" && u >= 1) {
        const back = byId(flight.target);
        if (
          back &&
          dist(back, football) < 1.8 &&
          random() < clamp(0.72 + back.ratings.catching * 0.003, 0, 0.99)
        ) {
          carrier = back;
          back.node = 0;
          event("handoff", "Pitch secured by #" + back.number);
        } else {
          loose = { x: football.x, y: football.y };
          carrier = qb;
          event("fumble", "Pitch hits the ground");
        }
        flight = null;
      }
      if (flight) flight.attempted ||= new Set();
      for (const defender of ds) {
        if (Math.abs(defender.x) >= 26.67 || defender.y > goal + 10) continue;
        if (
          !flight ||
          flight.type === "pitch" ||
          u <= 0.1 ||
          u >= 1 ||
          flight.attempted.has(defender.id)
        )
          continue;
        const reach = (defender.height || 72) / 36 + 0.55;
        if (football.z > reach || dist(defender, football) > 0.9) continue;
        flight.attempted.add(defender.id);
        if (
          random() <
          clamp(
            (defender.ratings.coverage + defender.ratings.awareness) / 500,
            0.1,
            0.4,
          )
        ) {
          if (u > 0.65 && random() < defender.ratings.catching / 160) {
            carrier = defender;
            receiver = defender.athleteId;
            intercepted = true;
            inReturnEndzone = defender.y >= goal;
            defender.pose = "catch";
            defender.poseUntil = t + 0.3;
            credit(defender, "defInts");
            event(
              "interception",
              "#" + defender.number + " undercuts the ball in flight",
            );
            flight = null;
            break;
          } else {
            credit(defender, "deflections");
            event(
              "deflection",
              "#" + defender.number + " gets a hand on the pass",
            );
            flight = null;
            finish("incomplete");
            break;
          }
        }
      }
      if (flight && u >= 1 && flight.type !== "pitch") {
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
        if (
          caught &&
          (Math.abs(caught.x) >= 26.67 ||
            caught.y > goal + 10 ||
            caught.y < -ball - 10)
        ) {
          flight = null;
          finish("incomplete");
        } else if (caught) {
          carrier = caught;
          caught.pose = "catch";
          caught.poseUntil = t + 0.28;
          receiver = caught.athleteId;
          if (caught.side) {
            intercepted = true;
            inReturnEndzone = caught.y >= goal;
            event("interception", `#${caught.number} intercepts`);
            credit(caught, "defInts");
          } else {
            complete = true;
            catchY = caught.y;
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
          credit(recover, "recoveries");
          loose = null;
          finish("fumble");
          result.turnover = intercepted;
        }
      }
      if (carrier && !loose && !dead) {
        const opponents = carrier.side ? os : ds;
        for (const defender of opponents) {
          if (
            dist(carrier, defender) > (engaged.has(defender.id) ? 0.6 : 1.1) ||
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
            credit(defender, "tackles");
            if (carrier === qb && !handed) credit(defender, "sacks");
            if (
              random() <
              clamp((100 - carrier.ratings.security) * 0.0008, 0, 0.06)
            ) {
              loose = {
                x: carrier.x + (random() - 0.5) * 2,
                y: carrier.y + (random() - 0.5) * 2,
              };
              event("fumble", "Ball knocked loose");
              credit(defender, "forcedFumbles");
            } else finish(carrier === qb && !handed ? "sack" : "tackle");
            break;
          } else {
            event("break", "Tackle broken");
            defender.state = "stumble";
            defender.pose = "stumble";
            defender.poseUntil = t + 0.4;
            credit(carrier, "brokenTackles");
            defender.vx *= 0.2;
            defender.vy *= 0.2;
          }
        }
        if (inReturnEndzone && carrier.side === 1 && carrier.y < goal)
          inReturnEndzone = false;
        if (!dead && !loose) {
          if (Math.abs(carrier.x) > 26.67) finish("out");
          else if (
            (carrier.side === 0 && carrier.y >= goal) ||
            (carrier.side === 1 && carrier.y <= -ball)
          )
            finish("touchdown");
          else if (
            (carrier.side === 0 && carrier.y <= -ball - 10) ||
            (carrier.side === 1 && carrier.y >= goal + 10 && !inReturnEndzone)
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
    if (result) {
      result.production = production;
      result.liveEnd = result.duration;
    }
    if (frames.length && result?.duration > 0) {
      const last = frames.at(-1);
      for (let n = 1; n <= 14; n++) {
        const tail = clone(last),
          dt = n * 0.1;
        tail.t = round(last.t + dt);
        if (result.reason === "incomplete")
          tail.ball[2] = Math.max(0, last.ball[2] - dt * 3);
        tail.players.forEach((v, i) => {
          v[2] = v[3] = 0;
          if (v[4] === "down" || v[4] === "tackle") {
            v[4] = dt < 0.4 ? "fall" : dt < 0.8 ? "ground" : "rise";
            v[5] = dt < 0.4 ? dt / 0.4 : dt < 0.8 ? 1 : (dt - 0.8) / 0.6;
          } else if (v[4] !== "celebrate") v[4] = "idle";
        });
        frames.push(tail);
      }
    }
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
