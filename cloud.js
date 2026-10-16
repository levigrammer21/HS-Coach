import { toWire, fromWire } from "./wire.js";
import { encodePayload, decodePayload } from "./payload.js";
import { firebaseConfig } from "./firebase-config.js";
import { VERSION, clone } from "./data.js";
import { turnPlan, joinPlan } from "./sync.js";
import { save, load } from "./storage.js";
let sdk, auth, db;
const ROOT = "hsFootballV1/app/";
export async function connect(onUser) {
  if (!sdk) {
    const [app, a, f] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
      import(
        "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js"
      ),
    ]);
    sdk = { ...a, ...f };
    const instance = app.initializeApp(firebaseConfig);
    auth = a.getAuth(instance);
    await a.setPersistence(auth, a.browserLocalPersistence);
    db = f.getFirestore(instance);
  }
  return sdk.onAuthStateChanged(auth, onUser);
}
export const currentUser = () => auth?.currentUser;
export async function login(email, password, register = false) {
  if (!sdk) throw Error("Connect first");
  return register
    ? sdk.createUserWithEmailAndPassword(auth, email, password)
    : sdk.signInWithEmailAndPassword(auth, email, password);
}
export const googleLogin = () =>
  sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
export const logout = () => sdk.signOut(auth);
export const resetPassword = (email) => sdk.sendPasswordResetEmail(auth, email);
function user() {
  if (!auth?.currentUser) throw Error("Sign in first");
  return auth.currentUser.uid;
}
function ref(path) {
  return sdk.doc(db, ROOT + path);
}
export async function cloudEnvelope() {
  const s = await sdk.getDoc(ref(`coaches/${user()}/saves/main`));
  if (!s.exists()) return null;
  const d = s.data();
  return {
    data: await decodePayload(d),
    revision: d.revision || 0,
    updated: d.updated,
  };
}
export async function cloudLoad() {
  return (await cloudEnvelope())?.data || null;
}
export async function cloudSave(data, expectedRevision = null) {
  const payload = await encodePayload(data),
    r = ref(`coaches/${user()}/saves/main`);
  if (payload.payload.length > 900000)
    throw Error(
      "Cloud profile is too large; export a backup before continuing",
    );
  return sdk.runTransaction(db, async (t) => {
    const old = await t.get(r),
      revision = old.exists() ? old.data().revision || 0 : 0;
    if (expectedRevision !== null && revision !== expectedRevision)
      throw Error(
        "Cloud profile changed on another device. Restore the cloud copy or explicitly upload your local copy.",
      );
    const next = revision + 1;
    t.set(r, {
      ...payload,
      updated: Date.now(),
      version: VERSION,
      revision: next,
    });
    return next;
  });
}
export function useTransportForTests(transport) {
  sdk = transport.sdk;
  auth = transport.auth;
  db = transport.db;
}
export async function createMatch(game, book, displayName) {
  const uid = user(),
    bytes = crypto.getRandomValues(new Uint8Array(8)),
    code = Array.from(bytes, (x) => x.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  const data = {
    members: [uid],
    names: [displayName || auth.currentUser.email?.split("@")[0] || "Coach"],
    status: "waiting",
    version: VERSION,
    game,
    books: [clone(book)],
    created: Date.now(),
    updated: Date.now(),
    seq: 0,
    turn: uid,
    code,
  };
  await sdk.runTransaction(db, async (t) => {
    const s = await t.get(ref("games/" + code));
    if (s.exists()) throw Error("Join code collision; retry");
    t.set(ref("games/" + code), toWire(data));
  });
  return code;
}
export async function joinMatch(code, team, book, defense, displayName) {
  code = code.trim().toUpperCase();
  const uid = user();
  await sdk.runTransaction(db, async (t) => {
    const r = ref("games/" + code),
      s = await t.get(r);
    if (!s.exists()) throw Error("Join code not found");
    const m = joinPlan(
      fromWire(s.data()),
      uid,
      team,
      book,
      defense,
      displayName || auth.currentUser.email?.split("@")[0] || "Coach",
    );
    t.set(r, toWire(m));
  });
  return code;
}
export async function listMatches() {
  const q = sdk.query(
    sdk.collection(db, ROOT + "games"),
    sdk.where("members", "array-contains", user()),
  );
  const s = await sdk.getDocs(q);
  return s.docs
    .map((d) => ({ ...fromWire(d.data()), id: d.id }))
    .sort((a, b) => b.updated - a.updated);
}
export function watchMatch(code, callback, onError) {
  user();
  return sdk.onSnapshot(
    ref("games/" + code),
    (s) => {
      if (s.exists()) callback(fromWire(s.data()));
    },
    onError,
  );
}
export async function submit(code, expectedSeq, nextGame, film) {
  const uid = user(),
    r = ref("games/" + code),
    snap = ref(
      `games/${code}/snaps/${String(expectedSeq + 1).padStart(5, "0")}`,
    );
  const payload = await encodePayload(film);
  if (payload.payload.length > 840000)
    throw Error("Replay is too large for this turn");
  const pending = { code, expectedSeq, nextGame, film };
  await save("pending-" + uid, pending);
  let committed;
  try {
    committed = await sdk.runTransaction(db, async (t) => {
      const s = await t.get(r),
        existing = await t.get(snap);
      if (existing.exists()) {
        if (existing.data().actor !== uid)
          throw Error("A different turn was committed");
        return fromWire(s.data());
      }
      const m = fromWire(s.data()),
        patch = turnPlan(m, uid, expectedSeq, nextGame);
      t.set(snap, {
        actor: uid,
        seed: film.seed,
        version: VERSION,
        ...payload,
        created: Date.now(),
      });
      t.update(r, toWire(patch));
      return { ...m, ...patch };
    });
  } catch (error) {
    const [saved, current] = await Promise.all([
      sdk.getDoc(snap),
      sdk.getDoc(r),
    ]);
    if (
      saved.exists() &&
      saved.data().actor === uid &&
      saved.data().seed === film.seed &&
      current.exists() &&
      current.data().seq >= expectedSeq + 1
    )
      committed = fromWire(current.data());
    else throw error;
  }
  await save("pending-" + uid, null);
  return committed;
}
export async function recover() {
  const p = await load("pending-" + user());
  if (p) await submit(p.code, p.expectedSeq, p.nextGame, p.film);
  return !!p;
}
export async function cloudFilm(code, seq) {
  const s = await sdk.getDoc(
    ref(`games/${code}/snaps/${String(seq).padStart(5, "0")}`),
  );
  return s.exists() ? decodePayload(s.data()) : null;
}
export async function leaderboard() {
  user();
  const s = await sdk.getDocs(
      sdk.query(
        sdk.collection(db, ROOT + "games"),
        sdk.where("status", "==", "complete"),
      ),
    ),
    rows = {};
  for (const d of s.docs) {
    const m = fromWire(d.data());
    m.members.forEach((id, i) => {
      const r = rows[id] || {
        id,
        name: m.names[i],
        wins: 0,
        losses: 0,
        pf: 0,
        pa: 0,
        yards: 0,
        passing: 0,
        rushing: 0,
        turnovers: 0,
      };
      r[m.game.score[i] > m.game.score[1 - i] ? "wins" : "losses"]++;
      r.pf += m.game.score[i];
      r.pa += m.game.score[1 - i];
      const st = m.game.stats[i];
      r.yards += st.yards;
      r.passing += st.passing;
      r.rushing += st.rushing;
      r.turnovers += st.turnovers;
      rows[id] = r;
    });
  }
  return Object.values(rows).sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses,
  );
}

export async function pendingTurn() {
  return load("pending-" + user());
}
export async function discardPending() {
  return save("pending-" + user(), null);
}
