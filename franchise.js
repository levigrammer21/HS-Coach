import { TEAMS, clone, rng, hash, ATTR, clamp, makeRoster } from "./data.js";
import { newGame, autoGame } from "./rules.js";
export function schedule() {
  const circle = [0, 1, 2, 3, 4, 5, 6, 7],
    weeks = [];
  for (let w = 0; w < 7; w++) {
    weeks.push(
      Array.from({ length: 4 }, (_, i) => ({
        home: circle[i],
        away: circle[7 - i],
        score: null,
      })),
    );
    circle.splice(1, 0, circle.pop());
  }
  return [
    ...weeks,
    ...clone(weeks.slice(0, 3)).map((w) =>
      w.map((m) => ({ ...m, home: m.away, away: m.home })),
    ),
  ];
}
export function createFranchise(team = 1, name, colors) {
  const teams = clone(TEAMS);
  if (name) teams[team].school = name;
  if (colors) {
    teams[team].primary = colors[0];
    teams[team].secondary = colors[1];
  }
  return {
    year: 2026,
    team,
    teams,
    week: 0,
    schedule: schedule(),
    records: [],
    archive: [],
    playoffs: null,
    champion: null,
    training: "balanced",
    rules: { quarter: 720, otStart: 90, otTwoFrom: 3 },
  };
}
export function standings(f) {
  const rows = f.teams.map((t, i) => ({
    id: i,
    school: t.school,
    w: 0,
    l: 0,
    pf: 0,
    pa: 0,
  }));
  for (const week of f.schedule)
    for (const m of week)
      if (m.score) {
        const a = rows[m.home],
          b = rows[m.away];
        a.pf += m.score[0];
        a.pa += m.score[1];
        b.pf += m.score[1];
        b.pa += m.score[0];
        (m.score[0] > m.score[1] ? a : b).w++;
        (m.score[0] > m.score[1] ? b : a).l++;
      }
  return rows.sort(
    (a, b) => b.w - a.w || b.pf - b.pa - (a.pf - a.pa) || a.id - b.id,
  );
}
export function matchup(f) {
  if (f.week < 10)
    return f.schedule[f.week].find(
      (m) => m.home === f.team || m.away === f.team,
    );
  if (!f.playoffs) return null;
  return (
    f.playoffs.rounds[f.week - 10]?.find(
      (m) => m.home === f.team || m.away === f.team,
    ) || null
  );
}
export function franchiseGame(f, m = matchup(f)) {
  if (!m) return null;
  const g = newGame(
    m.home,
    m.away,
    hash(`${f.year}-${f.week}-${m.home}`),
    f.rules,
  );
  g.teams = [clone(f.teams[m.home]), clone(f.teams[m.away])];
  return g;
}
export function finishWeek(franchise, played) {
  const f = clone(franchise),
    matches = f.week < 10 ? f.schedule[f.week] : f.playoffs.rounds[f.week - 10];
  for (const m of matches) {
    if (played && (m.home === f.team || m.away === f.team)) {
      m.score = played.score;
      f.records.push({
        year: f.year,
        week: f.week,
        opponent: m.home === f.team ? m.away : m.home,
        score: played.score,
        home: m.home,
        stats: played.stats,
      });
    } else {
      const g = autoGame(franchiseGame(f, m));
      m.score = g.score;
    }
  }
  f.week++;
  if (f.week === 10) {
    const s = standings(f).slice(0, 4);
    f.playoffs = {
      rounds: [
        [
          { home: s[0].id, away: s[3].id, score: null },
          { home: s[1].id, away: s[2].id, score: null },
        ],
      ],
    };
  } else if (f.week === 11) {
    const winners = matches.map((m) =>
      m.score[0] > m.score[1] ? m.home : m.away,
    );
    f.playoffs.rounds.push([
      { home: winners[0], away: winners[1], score: null },
    ]);
  } else if (f.week === 12) {
    const m = matches[0];
    f.champion = m.score[0] > m.score[1] ? m.home : m.away;
  }
  return f;
}
export function nextYear(franchise) {
  const f = clone(franchise);
  if (f.champion === null) throw Error("Finish the championship first");
  f.archive.push({
    year: f.year,
    champion: f.teams[f.champion].school,
    standings: standings(f),
  });
  f.year++;
  const r = rng(hash(f.year));
  for (const team of f.teams) {
    const grads = team.roster.filter((p) => p.grade === 12),
      incoming = makeRoster(team.id, f.year)
        .slice(0, grads.length)
        .map((p) => ({ ...p, grade: 9 }));
    team.roster = team.roster
      .filter((p) => p.grade < 12)
      .map((p) => {
        p.grade++;
        for (const a of ATTR) {
          const emphasis =
            f.training === "speed"
              ? ["speed", "acceleration", "agility"]
              : f.training === "strength"
                ? ["strength", "runBlock", "passBlock", "tackle"]
                : f.training === "skills"
                  ? ["accuracy", "decision", "catching", "coverage", "route"]
                  : ATTR;
          const gain = Math.floor(r() * 3) + (emphasis.includes(a) ? 1 : 0);
          p.ratings[a] = clamp(
            p.ratings[a] + (p.ratings[a] < p.potential ? gain : 0),
            20,
            99,
          );
        }
        return p;
      });
    const used = new Set(team.roster.map((p) => p.number));
    for (const p of incoming) {
      while (used.has(p.number)) p.number = (p.number + 1) % 100;
      used.add(p.number);
    }
    team.roster.push(...incoming);
  }
  f.week = 0;
  f.schedule = schedule();
  f.playoffs = null;
  f.champion = null;
  return f;
}
export function reschedule(franchise, week, opponent, home = true) {
  const f = clone(franchise);
  if (week < f.week || week >= 10 || opponent === f.team)
    throw Error("Choose an unplayed week and another school");
  const games = f.schedule[week],
    own = games.find((m) => m.home === f.team || m.away === f.team),
    old = own.home === f.team ? own.away : own.home;
  if (old !== opponent) {
    const other = games.find(
      (m) => m !== own && (m.home === opponent || m.away === opponent),
    );
    if (!other) throw Error("Opponent unavailable");
    if (other.home === opponent) other.home = old;
    else other.away = old;
  }
  own.home = home ? f.team : opponent;
  own.away = home ? opponent : f.team;
  return f;
}
