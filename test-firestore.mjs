import { fromWire } from "./wire.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import * as fs from "firebase/firestore";
import "fake-indexeddb/auto";
import * as cloud from "./cloud.js";
import { newGame, runSnap, advance } from "./rules.js";
import { TEAMS, VERSION, defaults, defenseDefaults, clone } from "./data.js";
const env = await initializeTestEnvironment({
  projectId: "demo-hs-football",
  firestore: {
    host: "127.0.0.1",
    port: 8089,
    rules: await readFile("firestore.rules", "utf8"),
  },
});
await env.clearFirestore();
const alice = env.authenticatedContext("alice").firestore(),
  bob = env.authenticatedContext("bob").firestore(),
  eve = env.authenticatedContext("eve").firestore(),
  anon = env.unauthenticatedContext().firestore();
const clients = { alice, bob, eve };
function as(uid) {
  cloud.useTransportForTests({
    sdk: fs,
    auth: { currentUser: { uid, email: uid + "@example.test" } },
    db: clients[uid],
  });
}
fs.setLogLevel("silent");
let checks = 0;
try {
  as("alice");
  const g = newGame(1, 0, 100, { quarter: 12 }),
    code = await cloud.createMatch(g, defaults(), "Alice");
  checks++;
  let doc = await fs.getDoc(fs.doc(alice, "hsFootballV1/app/games/" + code));
  assert.equal(doc.data().status, "waiting");
  await assertFails(fs.getDoc(fs.doc(anon, "hsFootballV1/app/games/" + code)));
  checks++;
  as("bob");
  await cloud.joinMatch(code, TEAMS[0], defaults(), defenseDefaults(), "Bob");
  doc = await fs.getDoc(fs.doc(bob, "hsFootballV1/app/games/" + code));
  assert.deepEqual(doc.data().members, ["alice", "bob"]);
  checks++;
  as("eve");
  await assert.rejects(() =>
    cloud.joinMatch(code, TEAMS[2], defaults(), defenseDefaults(), "Eve"),
  );
  checks++;
  await assertFails(
    fs.updateDoc(fs.doc(eve, "hsFootballV1/app/games/" + code), { seq: 99 }),
  );
  checks++;
  as("bob");
  let state = fromWire(doc.data()).game;
  const film = runSnap(state, "kickoff", 22),
    next = advance(state, film);
  const [a, b] = await Promise.all([
    cloud.submit(code, 0, next, film),
    cloud.submit(code, 0, next, film),
  ]);
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 1);
  checks++;
  const snaps = await fs.getDocs(
    fs.collection(bob, `hsFootballV1/app/games/${code}/snaps`),
  );
  assert.equal(snaps.size, 1);
  checks++;
  const shared = await cloud.cloudFilm(code, 1);
  assert.deepEqual(shared.frames, film.frames);
  checks++;
  const old = clone(next);
  old.seq++;
  as("bob");
  await assert.rejects(() => cloud.submit(code, 1, old, film));
  checks++;
  as("alice");
  const book = defaults(),
    profile = { version: VERSION, book, franchise: null };
  const revision = await cloud.cloudSave(profile, 0);
  assert.equal(revision, 1);
  const restored = await cloud.cloudLoad();
  assert.deepEqual(restored, profile);
  checks++;
  await assert.rejects(() => cloud.cloudSave(profile, 0));
  checks++;
  await assertFails(
    fs.getDoc(fs.doc(bob, "hsFootballV1/app/coaches/alice/saves/main")),
  );
  checks++;
  as("alice");
  assert.equal((await cloud.listMatches()).length, 1);
  checks++;
  as("eve");
  assert.equal((await cloud.listMatches()).length, 0);
  checks++;
  await assertFails(
    fs.setDoc(fs.doc(alice, `hsFootballV1/app/games/${code}/snaps/00001`), {
      actor: "alice",
      payload: "{}",
    }),
  );
  checks++;
  // Test an entire tiny game through the same cloud transaction code and persisted replay reads.
  as("alice");
  const c2 = await cloud.createMatch(
    newGame(1, 0, 97, { quarter: 720 }),
    book,
    "Alice",
  );
  as("bob");
  await cloud.joinMatch(c2, TEAMS[0], book, defenseDefaults(), "Bob");
  let m = fromWire(
    (await fs.getDoc(fs.doc(bob, "hsFootballV1/app/games/" + c2))).data(),
  );
  let n = 0;
  const { aiPlay } = await import("./rules.js");
  while (!m.game.final && n++ < 600) {
    as(m.turn);
    const p = aiPlay(m.game),
      f = runSnap(m.game, p, 1000 + n),
      ng = advance(m.game, f);
    m = await cloud.submit(c2, m.seq, ng, f);
    if (n % 50 === 0) console.log("Committed regulation turn", n);
  }
  assert.equal(m.status, "complete");
  console.log(
    `Full regulation cloud game: ${n} turns, ${JSON.stringify(m).length} bytes, score ${m.game.score.join("–")}`,
  );
  checks++;
  as("alice");
  const rankings = await cloud.leaderboard();
  assert.equal(
    rankings.reduce((s, r) => s + r.wins, 0),
    1,
  );
  assert.equal(
    rankings.reduce((s, r) => s + r.losses, 0),
    1,
  );
  checks++;
  // A disconnected offensive transaction remains pending and recovers after reconnect.
  as("alice");
  const c3 = await cloud.createMatch(
    newGame(1, 0, 456, { quarter: 12 }),
    book,
    "Alice",
  );
  as("bob");
  await cloud.joinMatch(c3, TEAMS[1], book, defenseDefaults(), "Bob");
  let disconnected = fromWire(
    (await fs.getDoc(fs.doc(bob, "hsFootballV1/app/games/" + c3))).data(),
  );
  assert.equal(
    new Set(disconnected.game.teams.flatMap((t) => t.roster.map((p) => p.id)))
      .size,
    88,
  );
  checks++;
  const df = runSnap(disconnected.game, "kickoff", 92),
    dn = advance(disconnected.game, df);
  cloud.useTransportForTests({
    sdk: {
      ...fs,
      runTransaction: async () => {
        throw Error("Simulated connection loss before commit");
      },
    },
    auth: { currentUser: { uid: "bob", email: "bob@example.test" } },
    db: bob,
  });
  await assert.rejects(() => cloud.submit(c3, 0, dn, df));
  assert.ok(await cloud.pendingTurn());
  as("bob");
  await cloud.recover();
  assert.equal(await cloud.pendingTurn(), null);
  const recovered = fromWire(
    (await fs.getDoc(fs.doc(bob, "hsFootballV1/app/games/" + c3))).data(),
  );
  assert.equal(recovered.seq, 1);
  checks++;
  console.log(
    `Regulation multiplayer game completed in ${n} committed turns; serialized match ${JSON.stringify(m).length} bytes.`,
  );
  console.log(
    `PASS: ${checks} Firebase emulator integration checks (rules, two users, duplicate transactions, replay, locked data, profiles, completion and standings).`,
  );
} finally {
  await env.cleanup();
}
