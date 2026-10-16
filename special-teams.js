import { VERSION, rng, clamp } from "./data.js";
import { specialTeamsUnit, pursuitPoint, runningLane } from "./tactics.js";
const DT = 1 / 30,
  distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function kickSimulation(g, requested, seed) {
  const random = rng(seed),
    free = g.phase === "kickoff",
    onside = requested === "onside";
  const type = free
    ? "kickoff"
    : requested.startsWith("punt")
      ? "punt"
      : requested;
  const scoring = ["field_goal", "extra_point"].includes(type),
    start = g.ball;
  const team = g.teams[g.possession],
    opponent = g.teams[1 - g.possession];
  const athletes = [
    ...specialTeamsUnit(team, type, false, g.fatigue),
    ...specialTeamsUnit(opponent, type, true, g.fatigue),
  ];
  const kicker = athletes[0],
    rating = type === "punt" ? kicker.ratings.punting : kicker.ratings.kicking;
  const launch = free ? 0 : type === "punt" ? -12 : -7,
    release = free ? 0.5 : type === "punt" ? 1.25 : 1.05;
  const range = onside
    ? 11 + random() * 4
    : free
      ? 40 + rating * 0.22 + (random() - 0.5) * 10
      : type === "punt"
        ? 24 + rating * 0.22 + (random() - 0.5) * 10
        : 22 + rating * 0.45 + (random() - 0.5) * 9;
  const lateral = onside
    ? 14
    : requested === "punt_left"
      ? -22
      : requested === "punt_right"
        ? 22
        : scoring
          ? (random() - 0.5) * (100 - rating) * 0.48
          : (random() - 0.5) * 18;
  const hang = onside ? 1.25 : scoring ? 2.4 : type === "punt" ? 3.9 : 3.5;
  const target = { x: lateral, y: launch + range };
  const ps = athletes.map((p, i) => ({
    ...p,
    athleteId: p.id,
    id: "K" + i,
    side: i < 11 ? 0 : 1,
    energy: 1 - (g.fatigue[p.id] || 0) * 0.3,
    x:
      i === 0
        ? 0
        : i < 11
          ? (i - 5.5) * (free ? 4 : 1.35)
          : i === 21
            ? target.x
            : (i - 15.5) * (free ? 4 : 1.6),
    y:
      i === 0
        ? launch
        : free
          ? i < 11
            ? -1
            : onside
              ? 11 + (i % 2) * 2
              : i === 21
                ? Math.min(99 - start, target.y)
                : 15 + (i % 3) * 9
          : i < 11
            ? 0
            : i === 21
              ? target.y
              : 1.2 + (i % 3) * 1.4,
    vx: 0,
    vy: 0,
    state: "ready",
  }));
  const events = [],
    frames = [],
    production = {};
  let t = 0,
    ball = { x: 0, y: launch, z: 1 },
    carrier = -1,
    dead = false,
    launched = false,
    blocked = false,
    good = false,
    touchback = false,
    retained = false,
    fair = false,
    landed = false,
    returnStart = null,
    liveStart = null;
  const event = (type, text) => events.push({ t: +t.toFixed(2), type, text });
  const move = (p, target, m = 1) => {
    const l = distance(p, target),
      speed = (3.3 + p.ratings.speed * 0.058) * p.energy * m,
      acc = 7 + p.ratings.acceleration * 0.1;
    p.vx += clamp(
      (l > 0.15 ? ((target.x - p.x) / l) * speed : 0) - p.vx,
      -acc * DT,
      acc * DT,
    );
    p.vy += clamp(
      (l > 0.15 ? ((target.y - p.y) / l) * speed : 0) - p.vy,
      -acc * DT,
      acc * DT,
    );
    p.x += p.vx * DT;
    p.y += p.vy * DT;
    p.state = "run";
  };
  const snap = () =>
    frames.push({
      t: +t.toFixed(2),
      players: ps.map((p) =>
        [p.x, p.y, p.vx, p.vy, p.state].map((v) =>
          typeof v === "number" ? Math.round(v * 100) / 100 || 0 : v,
        ),
      ),
      ball: [ball.x, ball.y, ball.z].map((v) => Math.round(v * 100) / 100 || 0),
      carrier,
    });
  event(
    "snap",
    free
      ? onside
        ? "Grounded onside kick"
        : "Kickoff"
      : type === "punt"
        ? "Punt protection"
        : "Place-kick protection",
  );
  snap();
  for (let n = 1; n <= 30 * 22 && !dead; n++) {
    t = n * DT;
    const engaged = new Set();
    // Protection before release; legal return blocks after the catch.
    const blockers =
      carrier >= 11
        ? ps.slice(11, 21)
        : !free && t < release + 0.25
          ? ps.slice(1, 11)
          : [];
    const threats = carrier >= 11 ? ps.slice(0, 11) : ps.slice(11, 21);
    for (const b of blockers) {
      const d = threats
        .filter((p) => !engaged.has(p.id))
        .sort((a, c) => distance(b, a) - distance(b, c))[0];
      if (!d) continue;
      if (distance(b, d) < 1.3) {
        const skill =
          (carrier >= 11 ? b.ratings.runBlock : b.ratings.passBlock) * 0.65 +
          b.ratings.strength * 0.35;
        const resistance = d.ratings.shed * 0.65 + d.ratings.strength * 0.35;
        b.state = "block";
        d.state = "shed";
        b.vx = b.vy = d.vx = d.vy = 0;
        const push = clamp((skill - resistance) / 40, -0.6, 0.6) * DT;
        b.y += push;
        d.y += push;
        engaged.add(d.id);
        engaged.add(b.id);
        // Broken engagements permit a pressure lane to develop.
        if (t < release && resistance > skill + 8) {
          d.x += Math.sign(d.x || 1) * DT * 2;
          engaged.delete(d.id);
        }
      } else move(b, d, 0.85);
    }
    for (let i = 0; i < 22; i++) {
      const p = ps[i];
      if (engaged.has(p.id)) continue;
      if (i === 0 && t < release + 0.25) {
        p.state = t > release - 0.18 ? "kick" : "ready";
        continue;
      }
      if (i === carrier) {
        const enemies = ps.slice(p.side ? 0 : 11, p.side ? 11 : 22);
        const aim = runningLane(
          p,
          { x: p.x, y: p.y + (p.side ? -10 : 10) },
          enemies,
          engaged,
        );
        move(p, aim);
        continue;
      }
      if (carrier >= 0) {
        if (p.side !== ps[carrier].side) move(p, pursuitPoint(p, ps[carrier]));
        else if (!blockers.includes(p))
          move(
            p,
            { x: ps[carrier].x, y: ps[carrier].y + (p.side ? -3 : 3) },
            0.9,
          );
      } else if (free) {
        if (onside) move(p, launched ? ball : { x: 14, y: p.side ? 12 : 0 });
        else if (i < 11) move(p, target, 0.97);
        else if (i === 21) move(p, target, 0.9);
        else move(p, { x: p.x, y: p.y - 3 }, 0.6);
      } else if (i >= 11 && i !== 21) move(p, { x: 0, y: launch }, 0.95);
      else if (type === "punt" && launched) move(p, target, 0.95);
    }
    if (free && !launched)
      for (const p of ps.slice(0, 11)) if (p.y > 0) p.y = 0;
    if (t >= release && !launched) {
      launched = true;
      event(
        "kick",
        onside ? "Low rolling onside kick" : requested.replaceAll("_", " "),
      );
    }
    if (launched && carrier < 0) {
      const u = clamp((t - release) / hang, 0, 1);
      if (!landed)
        ball = {
          x: lateral * u,
          y: launch + range * u,
          z: onside
            ? 0.12 + Math.abs(Math.sin(u * Math.PI * 5)) * 0.35
            : 1 + Math.sin(Math.PI * u) * (scoring ? 8 : 15) - u,
        };
      if (!free && !blocked && u < 0.17) {
        const rusher = ps
          .slice(11, 21)
          .find(
            (p) => distance(p, ball) < 1 && ball.z < 2.7 && !engaged.has(p.id),
          );
        if (rusher) {
          blocked = true;
          event("block", "#" + rusher.number + " blocks the kick");
          target.x = rusher.x;
          target.y = rusher.y + 1;
          ball = { ...target, z: 0.2 };
          landed = true;
        }
      }
      const plane = 110 - start;
      if (scoring && !blocked && ball.y >= plane) {
        good = ball.z >= 10 / 3 && Math.abs(ball.x) <= 35 / 9;
        dead = true;
        event("whistle", good ? "Kick is good" : "Kick misses the uprights");
      } else if (!scoring && start + ball.y >= 100) {
        touchback = true;
        dead = true;
        event("whistle", "Touchback — kick crosses the goal line");
      } else if ((u >= 1 || landed) && !dead) {
        landed = true;
        if (scoring && !blocked) {
          dead = true;
          touchback = true;
          event("whistle", "Kick falls short");
        } else if (onside || blocked) {
          const eligible = ps
            .filter(
              (p) =>
                (p.side === 1 || blocked || ball.y >= 10) &&
                distance(p, ball) < 1.1,
            )
            .sort((a, b) => distance(a, ball) - distance(b, ball));
          if (eligible.length) {
            carrier = ps.indexOf(eligible[0]);
            liveStart = t;
            event("recovery", "#" + ps[carrier].number + " recovers");
            if (onside && carrier < 11) {
              retained = true;
              dead = true;
            }
            if (blocked && carrier < 11) {
              retained = true;
              dead = true;
            }
            returnStart = ball.y;
          }
        } else {
          const r = ps[21],
            near = distance(r, ball) < 1.8;
          const cover = ps
            .slice(0, 11)
            .sort((a, b) => distance(a, r) - distance(b, r))[0];
          if (near) {
            carrier = 21;
            returnStart = r.y;
            liveStart = t;
            fair = type === "punt" && distance(cover, r) < 7;
            event(
              fair ? "fair_catch" : "return",
              fair
                ? "Returner signals fair catch"
                : "Returner secures the kick",
            );
            if (fair) dead = true;
          } else if (type === "punt" && distance(cover, ball) < 1.2) {
            dead = true;
            event("whistle", "Punt downed by the coverage unit");
          } else {
            // The grounded punt rolls; coverage can down it before it reaches the goal line.
            ball.y += DT * 1.7;
            move(r, ball, 1);
            if (type === "kickoff" && distance(cover, ball) < 1) {
              retained = true;
              dead = true;
              event(
                "recovery",
                "Kicking team recovers the untouched free kick",
              );
            }
          }
        }
      }
    }
    if (carrier >= 0 && !dead) {
      const r = ps[carrier];
      ball = { x: r.x, y: r.y, z: 1 };
      for (const d of ps.filter(
        (p) => p.side !== r.side && !engaged.has(p.id),
      )) {
        if (distance(d, r) < 1 && !(d.tackleAfter > t)) {
          d.tackleAfter = t + 0.7;
          if (
            random() <
            clamp(
              0.62 + (d.ratings.tackle - r.ratings.agility) * 0.008,
              0.2,
              0.94,
            )
          ) {
            r.state = "down";
            d.state = "tackle";
            dead = true;
            event("tackle", "#" + d.number + " stops the return");
            production[d.athleteId] = { tackles: 1 };
            break;
          }
          d.vx *= 0.2;
          d.vy *= 0.2;
          d.state = "stumble";
        }
      }
      if (start + r.y <= 0 || Math.abs(r.x) > 26.67) dead = true;
    }
    if (n % 3 === 0 || dead) snap();
  }
  if (!dead) event("whistle", "Forward progress stopped");
  const finalY = carrier >= 0 ? ps[carrier].y : ball.y;
  const reason = free
    ? "kickoff"
    : type === "punt"
      ? "punt"
      : type === "extra_point"
        ? "extra_point"
        : good
          ? "field_goal"
          : "missed_field_goal";
  const returnTD = carrier >= 11 && start + finalY <= 0;
  const touch = touchback || (scoring && !good && !blocked);
  const result = {
    reason,
    good,
    kickDistance: Math.round(
      blocked ? Math.max(0, target.y - launch) : scoring ? 117 - start : range,
    ),
    yards: 0,
    duration: free ? (liveStart === null ? 0 : Math.max(0, t - liveStart)) : t,
    nextBall: touch ? 20 : clamp(100 - start - finalY, 1, 99),
    returnTD,
    turnover: false,
    retained,
    retainedBall: clamp(start + finalY, 1, 99),
    blocked,
    onside,
    fairCatch: fair,
    touchback: touch,
    returnYards:
      carrier >= 11 ? Math.max(0, (returnStart ?? finalY) - finalY) : 0,
    returner: carrier >= 11 ? ps[carrier].athleteId : null,
    production,
    version: VERSION,
    seed,
    liveEnd: t,
  };
  const last = frames.at(-1);
  for (let n = 1; n <= 10; n++)
    frames.push({
      ...last,
      t: +(last.t + n * 0.1).toFixed(2),
      players: last.players.map((v) => [
        v[0],
        v[1],
        0,
        0,
        v[4] === "down" ? (n < 4 ? "fall" : n < 8 ? "ground" : "rise") : "idle",
        n / 10,
      ]),
    });
  return {
    version: VERSION,
    seed,
    ball: start,
    players: ps.map(({ id, athleteId, name, number, pos, side, ratings }) => ({
      id,
      athleteId,
      name,
      number,
      pos,
      side,
      ratings,
    })),
    frames,
    events,
    offense: team,
    defense: opponent,
    play: { name: requested.replaceAll("_", " "), slots: [] },
    call: { name: "Special teams", slots: [] },
    result,
  };
}
