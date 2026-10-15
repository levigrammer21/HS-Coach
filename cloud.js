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
export async function cloudSave(data) {
  await sdk.setDoc(ref(`coaches/${user()}/saves/main`), {
    payload: JSON.stringify(data),
    updated: Date.now(),
    version: VERSION,
  });
}
export async function cloudLoad() {
  const s = await sdk.getDoc(ref(`coaches/${user()}/saves/main`));
  return s.exists() ? JSON.parse(s.data().payload) : null;
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
    t.set(ref("games/" + code), data);
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
      s.data(),
      uid,
      team,
      book,
      defense,
      displayName || auth.currentUser.email?.split("@")[0] || "Coach",
    );
    t.set(r, m);
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
    .map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => b.updated - a.updated);
}
export function watchMatch(code, callback, onError) {
  user();
  return sdk.onSnapshot(
    ref("games/" + code),
    (s) => {
      if (s.exists()) callback(s.data());
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
  const pending = { code, expectedSeq, nextGame, film };
  await save("pending-" + uid, pending);
  const committed = await sdk.runTransaction(db, async (t) => {
    const s = await t.get(r),
      existing = await t.get(snap);
    if (existing.exists()) {
      if (existing.data().actor !== uid)
        throw Error("A different turn was committed");
      return s.data();
    }
    const m = s.data(),
      patch = turnPlan(m, uid, expectedSeq, nextGame);
    t.set(snap, {
      actor: uid,
      seed: film.seed,
      version: VERSION,
      payload: JSON.stringify(film),
      created: Date.now(),
    });
    t.update(r, patch);
    return { ...m, ...patch };
  });
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
  return s.exists() ? JSON.parse(s.data().payload) : null;
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
    const m = d.data();
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
