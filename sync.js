import { VERSION, clone, separateAwayRoster } from "./data.js";
export function turnPlan(match, uid, expectedSeq, nextGame) {
  if (match.version !== VERSION) throw Error("Simulation version mismatch");
  if (match.seq !== expectedSeq)
    throw Error("Game changed. Refresh before calling a play.");
  if (match.turn !== uid || match.status !== "active")
    throw Error("It is not your offensive turn");
  if (nextGame.seq !== expectedSeq + 1) throw Error("Invalid turn sequence");
  if (
    JSON.stringify(nextGame.teams) !== JSON.stringify(match.game.teams) ||
    JSON.stringify(nextGame.defenses) !== JSON.stringify(match.game.defenses)
  )
    throw Error("Match roster and defense are locked");
  return {
    game: clone(nextGame),
    seq: expectedSeq + 1,
    turn: match.members[nextGame.possession],
    status: nextGame.final ? "complete" : "active",
    updated: Date.now(),
  };
}
export function joinPlan(match, uid, team, book, defense, name) {
  const m = clone(match);
  if (m.version !== VERSION)
    throw Error("This game uses a different engine version");
  if (m.members.includes(uid)) return m;
  if (m.status !== "waiting" || m.members.length !== 1)
    throw Error("This game already has two coaches");
  m.members.push(uid);
  m.names.push(name);
  m.game.teams[1] =
    team.id === m.game.teams[0].id ? separateAwayRoster(team) : clone(team);
  m.game.defenses[1] = clone(defense);
  m.books.push(clone(book));
  m.status = "active";
  m.turn = m.members[m.game.possession];
  m.updated = Date.now();
  return m;
}
