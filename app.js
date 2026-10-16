import { analyzeFilm } from "./film-analysis.js";
import { migrateProfile } from "./migration.js";
import { scout, leaders } from "./statistics.js";
import { FORMATIONS, applyFormation, defensiveTemplate } from "./formations.js";
import { previewFilm, CONDITIONS, LOGIC_ACTIONS } from "./football.js";
import {
  TEAMS,
  VERSION,
  ATTR,
  BLOCKS,
  ROUTES,
  SLOT,
  lineup,
  selectDefense,
  clone,
  clamp,
  hash,
  defaults,
  baseSlots,
  defenseDefaults,
  validateFormation,
  teamFit,
} from "./data.js";
import { newGame, advance, aiPlay, timeout, simulateKick } from "./rules.js";
import {
  createFranchise,
  standings,
  matchup,
  franchiseGame,
  nextYear,
  reschedule,
} from "./franchise.js";
import { load, save, download, remove } from "./storage.js";
import { Stadium } from "./render.js";
import * as cloud from "./cloud.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const btn = (text, act, cls = "", extra = "") =>
  `<button class="${cls}" data-act="${act}" ${extra}>${text}</button>`;
const option = (v, label, selected) =>
  `<option value="${esc(v)}" ${v == selected ? "selected" : ""}>${esc(label)}</option>`;
const select = (id, values, value) =>
  `<select id="${id}">${values.map((v) => option(Array.isArray(v) ? v[0] : v, Array.isArray(v) ? v[1] : v, value)).join("")}</select>`;
const label = (text, body, cls = "") =>
  `<label class="${cls}">${text}${body}</label>`;
const input = (id, value, type = "text", extra = "") =>
  `<input id="${id}" type="${type}" value="${esc(value)}" ${extra}>`;
const crest = (t) =>
  `<div class="team-crest" style="--team:${t.primary};--accent:${t.secondary}">${t.school
    .split(" ")
    .map((s) => s[0])
    .join("")}</div>`;
const head = (k, h, p = "", actions = "") =>
  `<div class="page-head"><div><div class="kicker">${k}</div><h2>${h}</h2>${p ? `<p>${p}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
const uid = () => crypto.randomUUID();
const localProfileExists = !!(await load("profile"));
let designerDraft = await load("designerDraft"),
  draftTimer;
let data = await load("profile", {
  version: VERSION,
  team: 1,
  book: defaults(),
  defense: defenseDefaults(),
  formations: [],
  filmIds: [],
  franchise: null,
  game: null,
  settings: {
    overlays: true,
    skipDefense: false,
    speed: 1,
    defenseArt: false,
    autoCloud: true,
  },
});
data = migrateProfile(data);
if (!data.settings)
  data.settings = { overlays: false, skipDefense: false, speed: 1 };
let page = "home",
  stadium = null,
  selected = data.book[0]?.id,
  filter = "all",
  game = data.game,
  mode = "exhibition",
  human = 0,
  film = null,
  busy = false,
  toastTimer,
  edit = null,
  editDef = false,
  slotId = "X",
  tool = "align",
  dirty = false,
  saveTimer,
  user = null,
  cloudStatus = "Local saves ready",
  matches = [],
  live = null,
  unwatch = null,
  matchesError = "",
  filmIndex = data.filmIds || [],
  filmPick = 0;
let lastFilm = null,
  showCall = true,
  watchState = null;
data.books ||= [
  { id: "varsity", name: "Varsity playbook", plays: clone(data.book) },
];
data.activeBook ||= "varsity";
data.depthCharts ||= {};
data.settings.autoCloud ??= true;
data.version = VERSION;
if (data.game) data.game.version = VERSION;
let cloudRevision = null,
  cloudReady = false,
  cloudSaveTimer = null,
  cloudSaving = false,
  cloudSaveState = "Local save ready";
const nav = [
  ["home", "⌂", "Home"],
  ["game", "◈", "Gameday"],
  ["playbook", "⌁", "Playbook"],
  ["defense", "⊞", "Defense"],
  ["franchise", "⚑", "Program"],
  ["friends", "⇄", "Friends"],
  ["film", "▷", "Film"],
  ["roster", "▥", "Roster"],
  ["settings", "⚙", "Settings"],
];
let fieldExpanded = false;
const actions = {};
function act(name, fn) {
  actions[name] = fn;
}
function toast(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
async function persist() {
  dirty = true;
  try {
    if (mode !== "multiplayer") {
      data.game = game;
      data.mode = mode;
      data.human = human;
    }
    data.filmIds = filmIndex;
    const active = data.books?.find((b) => b.id === data.activeBook);
    if (active) active.plays = clone(data.book);
    data.updatedAt = Date.now();
    await save("profile", data);
    dirty = false;
    queueCloudSave();
    document
      .querySelectorAll(".save-state")
      .forEach((e) => (e.textContent = "Saved on this device"));
  } catch (e) {
    document
      .querySelectorAll(".save-state")
      .forEach((e) => (e.textContent = "Unsaved changes — export a backup"));
    throw Error("Save failed: " + e.message);
  }
}
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist().catch(error), 200);
}
function error(e) {
  console.error(e);
  toast(e.message || String(e));
}
function modal(title, html, setup) {
  const d = $("#modal");
  d.innerHTML = `<div class="modal-head"><h3>${title}</h3>${btn("✕", "close", "ghost small", 'aria-label="Close dialog"')}</div>${html}`;
  if (!d.open) d.showModal();
  setup?.(d);
}
act("close", () => $("#modal").close());
function shell(content) {
  stadium?.destroy();
  stadium = null;
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><div class="brand">HS<span>FOOTBALL</span><small>THE COACH'S BOX</small></div><nav class="side-nav" aria-label="Main navigation">${nav.map(([id, icon, text]) => btn(`<span class="symbol">${icon}</span>${text}${id === "friends" && user && matches.some((m) => m.status === "active" && m.turn === user.uid) ? `<span class="nav-dot">${matches.filter((m) => m.status === "active" && m.turn === user.uid).length}</span>` : ""}`, `nav:${id}`, page === id ? "active" : "")).join("")}</nav><div class="sidebar-footer"><div class="dot" style="display:inline-block"></div> FRIDAY NIGHT, EVERY NIGHT<br><span class="save-state">${dirty ? "Saving…" : "Saved on this device"}</span><br>Engine ${VERSION}</div></aside><main class="main"><header class="topbar"><div class="mobile-brand brand">HS<span>FOOTBALL</span></div><div class="breadcrumb">The Coach's Box / ${nav.find((n) => n[0] === page)?.[2]}</div><div class="status"><i class="dot"></i>${esc(user ? "Signed in • " + (user.displayName || user.email?.split("@")[0]) : cloudStatus)}</div></header>${content}</main></div>`;
}
function render() {
  if (page === "home") home();
  else if (page === "game") gamePage();
  else if (page === "playbook") edit ? designer() : playbook();
  else if (page === "defense") edit && editDef ? designer() : defensePage();
  else if (page === "franchise") franchisePage();
  else if (page === "friends") friendsPage();
  else if (page === "home") home();
  else if (page === "film") filmPage();
  else if (page === "roster") rosterPage();
  else settingsPage();
}
function navigate(p) {
  if (busy) {
    toast("Finishing the current operation");
    return;
  }
  page = p;
  edit = null;
  render();
  window.scrollTo(0, 0);
}
function home() {
  const t = TEAMS[data.team],
    f = data.franchise;
  shell(
    `${head("Offensive coordinator", "Your program. Your playbook.")}<section class="hero"><div class="hero-copy"><div class="kicker">Welcome to the coach's box</div><h1>OWN<br>FRIDAY NIGHT.</h1><p>Draw it on the board. Put it on the field. Let your football do the talking.</p><div class="row">${btn(game && !game.final ? "Resume game →" : "Take the field →", game && !game.final ? "resume" : "exhibition", "primary")}${btn("Open playbook", "nav:playbook", "ghost")}</div></div><div class="hero-art" aria-hidden="true"></div></section><div class="grid cols3 section-gap"><section class="panel feature-card"><div class="kicker">01 / Install</div><h3>Build your identity</h3><p>${data.book.length} offensive plays. Custom routes, blocking, motion, and quarterback progressions.</p>${btn("Design a play ↗", "new-play", "small ghost")}</section><section class="panel feature-card"><div class="kicker">02 / Develop</div><h3>${f ? esc(f.teams[f.team].school) : "Build a program"}</h3><p>${f ? `${f.year} • Week ${Math.min(f.week + 1, 12)} • ${f.teams[f.team].roster.length} athletes` : "Ten regular-season games. Four playoff teams. One championship. Every class leaves a legacy."}</p>${btn("Enter franchise ↗", "nav:franchise", "small ghost")}</section><section class="panel feature-card"><div class="kicker">03 / Compete</div><h3>Friends under lights</h3><p>Call your offense on your time. Your defensive coordinator handles the other side.</p>${btn("Open friend games ↗", "nav:friends", "small ghost")}</section></div><div class="grid cols2 section-gap"><section class="panel"><div class="panel-heading"><h3>Your current school</h3>${btn("Change", "choose-team", "small ghost")}</div><div class="team-card">${crest(t)}<div><h3>${esc(t.school)} ${t.mascot}</h3><small>${t.scheme}</small></div></div><p class="muted">${t.description}</p></section><section class="panel"><div class="panel-heading"><h3>The film never lies</h3><span class="badge">${filmIndex.length} saved snaps</span></div><p class="muted">Scrub the pocket. Follow the read. Review the catch. Every saved snap includes its decision trail.</p>${btn("Enter the film room", "nav:film", "ghost small")}</section></div>`,
  );
}
act("choose-team", () =>
  modal(
    "Choose your school",
    `<div class="grid cols2">${TEAMS.map((t) => `<button data-act="team:${t.id}" class="panel team-card ${data.team === t.id ? "selected" : ""}">${crest(t)}<div><h3>${t.school}</h3><small>${t.scheme}</small></div></button>`).join("")}</div>`,
  ),
);
function mini(p) {
  const path = p.slots
    .filter((s) => s.path?.length)
    .slice(0, 5)
    .map(
      (s) =>
        `<polyline points="${[[s.x, s.y], ...s.path].map(([x, y]) => `${32 + x},${40 - y}`).join(" ")}" fill="none" stroke="#d7bd79" stroke-width="1"/>`,
    )
    .join("");
  return `<svg viewBox="0 0 64 50" aria-hidden="true">${path}${p.slots.map((s) => `<circle cx="${32 + s.x}" cy="${40 - s.y}" r="1.6" fill="#b5d4c6"/>`).join("")}</svg>`;
}
let bookSearch = "";
function playbook() {
  shell(
    `${head("The install", "Offensive playbook", `${data.book.length} plays • Tap a play to edit every assignment.`, btn("Team fit", "fit", "ghost") + btn("+ New play", "new-play", "primary") + (designerDraft ? btn("Resume board draft", "resume-draft", "ghost") : ""))}<div class="tabs">${["all", "pass", "run", "option", "rpo", "qb"].map((k) => btn(k === "all" ? "All concepts" : k.toUpperCase(), `filter:${k}`, filter === k ? "active small" : "small")).join("")}${btn("Import / export", "book-transfer", "small ghost")}</div><div class="grid cols3">${data.book
      .filter(
        (p) =>
          filter === "all" ||
          (filter === "option"
            ? ["option", "triple"].includes(p.kind)
            : p.kind === filter),
      )
      .map(
        (p) =>
          `<section class="panel" data-play-search="${esc([p.name, p.formation, p.concept, ...(p.tags || [])].join(" ").toLowerCase())}"><div class="row">${mini(p)}<div><div class="kicker">${esc(p.formation)} / ${p.kind}</div><h3>${esc(p.name)}</h3></div></div><p class="muted" style="font-size:11px">${esc(p.concept)}${p.tags?.length ? " • " + esc(p.tags.join(", ")) : ""}</p><div class="row">${btn("Edit board", `edit:${p.id}`, "small")}${btn("Duplicate", `duplicate:${p.id}`, "small ghost")}${btn("✕", `delete:${p.id}`, "small danger", 'aria-label="Delete play"')}</div></section>`,
      )
      .join("")}</div>`,
  );
  $(".page-head").insertAdjacentHTML(
    "afterend",
    `<div class="book-bar row between"><div class="row">${label(
      "Active playbook",
      select(
        "active-book",
        data.books.map((b) => [b.id, b.name]),
        data.activeBook,
      ),
    )}${btn("+ Book", "new-book", "small")}${btn("Rename", "rename-book", "small ghost")}</div>${label("Search formation, concept or tag", input("play-search", bookSearch))}</div>`,
  );
  $("#active-book").onchange = async (e) => {
    const old = data.books.find((b) => b.id === data.activeBook);
    old.plays = clone(data.book);
    data.activeBook = e.target.value;
    data.book = clone(data.books.find((b) => b.id === data.activeBook).plays);
    selected = data.book[0]?.id;
    await persist();
    playbook();
  };
  $("#play-search").oninput = (e) => {
    bookSearch = e.target.value;
    document
      .querySelectorAll("[data-play-search]")
      .forEach((el) =>
        el.classList.toggle(
          "hidden",
          !el.dataset.playSearch.includes(bookSearch.toLowerCase()),
        ),
      );
  };
}
act("new-play", () => {
  edit = clone(defaults()[0]);
  edit.id = uid();
  edit.name = "New Install";
  editDef = false;
  slotId = "X";
  tool = "align";
  page = "playbook";
  designer();
});
act("fit", () => {
  const fits = TEAMS.map((t) => ({ ...teamFit(t, data.book), t })).sort(
    (a, b) => b.score - a.score,
  );
  modal(
    "Playbook → Team Fit",
    `<p class="muted">Roster compatibility only. These estimates never modify a simulation rating.</p>${fits.map(({ t, score, pass, run, option }) => `<div class="panel section-gap"><div class="row between"><div class="row">${crest(t)}<h3>${t.school}</h3></div><div class="big-num">${score}<small style="font-size:12px"> / 100</small></div></div><div class="fitbar"><i style="width:${score}%"></i></div><small>Pass ${pass} • Run ${run} • Option ${option}</small><p class="muted">${t.description}</p>${btn("Choose this school", `team:${t.id}`, "small ghost")}</div>`).join("")}`,
  );
});
act("book-transfer", () =>
  modal(
    "Take your playbook anywhere",
    `<p>Export a backup or import a shared playbook. Imports add plays to your current book.</p><div class="row">${btn("Export JSON", "export-book", "primary")}<label>Import JSON<input id="import-book" type="file" accept=".json,application/json"></label></div>`,
    () => {
      $("#import-book").onchange = async (e) => {
        try {
          const a = JSON.parse(await e.target.files[0].text());
          if (
            !Array.isArray(a) ||
            a.length > 500 ||
            a.some(
              (p) =>
                !Array.isArray(p.slots) || p.slots.length !== 11 || !p.reads,
            )
          )
            throw Error("Not a valid offensive playbook");
          data.book.push(...a.map((p) => ({ ...p, id: uid() })));
          await persist();
          $("#modal").close();
          playbook();
          toast("Playbook imported");
        } catch (e) {
          error(e);
        }
      };
    },
  ),
);
act("export-book", () => download("HS-Football-Playbook.json", data.book));
function defensePage() {
  const sum = data.defense.reduce((s, d) => s + Math.max(0, +d.weight || 0), 0);
  shell(
    `${head("The other side", "Defensive coordinator", "Set the plan before kickoff. Your coordinator calls it from visible formation and game situation.", btn("+ Add defense", "new-defense", "primary"))}<div class="grid cols2"><section class="panel"><div class="panel-heading"><h3>Call tendencies</h3><span class="badge">Automatic</span></div>${data.defense.map((d) => `<div class="weight-row"><strong>${esc(d.name)}</strong><b id="pct-${d.id}">${sum ? Math.round((d.weight / sum) * 100) : 0}%</b><input aria-label="${esc(d.name)} weight" type="range" min="0" max="100" value="${d.weight}" data-weight="${d.id}"><div class="row">${btn("Edit assignments", `edit-defense:${d.id}`, "small ghost")}${btn("Remove", `delete-defense:${d.id}`, "small danger")}</div><small>Weight ${d.weight}</small></div>`).join("")}<div class="note">Weights are normalized across eligible calls. Zero excludes a call. If every situationally eligible call has zero weight, the coordinator uses a safe Cover 3 fallback.</div></section><section class="panel"><div class="kicker">See the field. Call the defense.</div><h3>Preparation wins possessions</h3><p class="muted">The coordinator sees personnel, alignment, field position, down, and distance. It never receives the selected offensive play.</p><div class="list-row"><span>Long yardage</span><small>Extra deep-coverage preference</small></div><div class="list-row"><span>Short yardage / goal line</span><small>Front pressure preference</small></div><div class="list-row"><span>Four wide receivers</span><small>Coverage personnel awareness</small></div><p class="note">Your saved defense is copied at the creation or joining of a friend game and locked for that match.</p></section></div>`,
  );
  document.querySelectorAll("[data-weight]").forEach(
    (e) =>
      (e.oninput = () => {
        const d = data.defense.find((d) => d.id === e.dataset.weight);
        d.weight = +e.value;
        const sum = data.defense.reduce((s, d) => s + d.weight, 0);
        for (const p of data.defense) {
          $(`[id="pct-${p.id}"]`).textContent =
            (sum ? Math.round((p.weight / sum) * 100) : 0) + "%";
        }
        autoSave();
      }),
  );
}
act("new-defense", () => {
  edit = clone(defenseDefaults()[0]);
  edit.id = uid();
  edit.name = "New Defensive Install";
  editDef = true;
  slotId = "D0";
  tool = "align";
  designer();
});
let editorCanvas,
  editorCtx,
  editorW,
  editorH,
  pointer = null;
const editorPoint = (x, y) => [
  editorW / 2 + (x * editorW) / 58,
  editorH * 0.68 - (y * editorH) / 48,
];
const editorWorld = (x, y) => [
  clamp(((x - editorW / 2) * 58) / editorW, -26, 26),
  clamp(((editorH * 0.68 - y) * 48) / editorH, -13, 31),
];
function designer() {
  const s = edit.slots.find((s) => s.id === slotId) || edit.slots[0];
  slotId = s.id;
  const issues = editDef ? [] : validateFormation(edit);
  shell(
    `${head(editDef ? "Defensive install" : "Offensive install", esc(edit.name), "Drag alignments. Draw assignments. Tap an athlete to inspect.", btn("Back", "editor-back", "ghost") + btn("Save install", "save-play", "primary"))}<div class="designer-layout"><div><div class="designer-field"><div class="designer-tools">${(editDef ? ["align", "zone"] : ["align", "route", "motion", "shift"]).map((t) => btn(t[0].toUpperCase() + t.slice(1), `tool:${t}`, tool === t ? "active" : "")).join("")}${btn("Undo", "editor-undo", "ghost")}${btn("Redo", "editor-redo", "ghost")}${!editDef ? btn("Path points", "path-points", "ghost") : ""}${btn("Clear path", "clear-path", "ghost")}</div><canvas id="board" aria-label="Touch football play designer"></canvas></div><div class="slot-pills">${edit.slots.map((s) => btn(s.id, `slot:${s.id}`, s.id === slotId ? "active" : "")).join("")}</div><div class="note" id="legality">${editDef ? "Defenders: align the front, assign coverage and pass rush, then set zone landmarks." : issues.length ? `<span class="warning">${issues.map(esc).join("<br>")}</span>` : '<span class="good">✓ Legal base alignment and receiver eligibility</span> • Every shift must be set for one second. Motion must remain lateral or backward.'}</div><div class="row section-gap">${!editDef ? btn("Save formation", "save-formation", "small") + btn("Load formation", "load-formation", "small") + btn("Test in practice", "test-play", "small primary") : ""}</div></div><aside class="panel inspector">${label("Play name", input("edit-name", edit.name), "wide")}${!editDef ? btn("Conditional logic", "logic-editor", "small ghost wide") + btn("Formation library", "formation-library", "small ghost wide") : btn("Front / coverage templates", "defense-templates", "small ghost wide")}${!editDef ? label("Concept / category", input("edit-concept", edit.concept), "wide") : label("Situational eligibility", select("edit-situation", ["any", "long", "short", "redzone"], edit.situation), "wide")}<div class="panel-heading wide"><h3>${s.id} · ${s.pos}</h3><span class="badge">Assignment</span></div>${label("Position", select("slot-pos", editDef ? ["DE", "DT", "LB", "CB", "S"] : ["T", "G", "C", "TE", "WR", "RB", "QB"], s.pos))}${label("Responsibility", select("slot-assignment", editDef ? ["rush", "stunt", "man", "zone", "deep", "contain"] : ["route", "run", "quarterback", ...BLOCKS], s.assignment))}${label("Personnel", select("slot-athlete", [["", "Auto • best fit"], ...(mode === "franchise" && data.franchise ? data.franchise.teams[data.franchise.team] : TEAMS[data.team]).roster.map((p) => [p.id, `#${p.number} ${p.name} · ${p.pos}`])], s.athlete || ""), "wide")}${label("Lateral (yards)", input("slot-x", s.x, "number", 'step="0.5" min="-26" max="26"'))}${label("Depth (yards)", input("slot-y", s.y, "number", 'step="0.5" min="-13" max="30"'))}${label(editDef ? "Man target" : "Block target", select("slot-target", editDef ? SLOT.filter((x) => !["LT", "LG", "C", "RG", "RT", "QB"].includes(x)) : ["nearest", ...Array.from({ length: 11 }, (_, i) => `D${i}`)], s.target))}${!editDef ? label("Release delay (sec)", input("slot-delay", s.delay || 0, "number", 'min="0" max="6" step="0.1"')) : label("Stunt width", input("slot-stunt", s.stunt || 0, "number", 'min="-8" max="8"'))}${
      !editDef
        ? label(
            "Route starts after",
            select(
              "slot-startAfter",
              [
                ["snap", "Snap / delay"],
                ["handoff", "Handoff or option mesh"],
                ["throw", "Pass released"],
                ["los", "Runner crosses line"],
              ],
              s.startAfter || "snap",
            ),
            "wide",
          )
        : label(
            "Run fit",
            select(
              "slot-fit",
              ["auto", "leftA", "rightA", "leftB", "rightB", "leftC", "rightC"],
              s.fit || "auto",
            ),
            "wide",
          )
    }${!editDef ? label("Rounded route transitions", `<input id="slot-curved" type="checkbox" ${s.curved ? "checked" : ""}>`, "inline wide") : ""}${!editDef ? label("Route adjustment", select("slot-option", ["none", "sit-zone", "break-away", "motion-read"], s.option), "wide") + label("Route library", select("route-template", ["Custom", ...Object.keys(ROUTES)], "Custom"), "wide") : ""}${
      !editDef
        ? `<div class="wide"><h3>Quarterback room</h3></div>${label("Play-action mesh fake", `<input id="edit-fake" type="checkbox" ${edit.fake ? "checked" : ""}>`, "inline wide")}${label("Play type", select("edit-kind", ["pass", "run", "qb", "option", "triple", "rpo", "kneel", "spike"], edit.kind))}${label("Ball carrier", select("edit-runner", ["RB", "QB", "H", "Y", "Z", "X"], edit.runner))}${label(
            "Exchange",
            select(
              "edit-exchange",
              [
                ["handoff", "Handoff / read mesh"],
                ["toss", "Backward toss"],
              ],
              edit.exchange || "handoff",
            ),
          )}${label("Mesh timing (sec)", input("edit-mesh", edit.mesh ?? 0.75, "number", 'min="0.3" max="3" step="0.05"'))}<small class="wide">Draw the QB’s path to set his option keep lane. Triple option uses the selected runner as the dive back and RB as the trailing pitch back.</small>${label("Drop depth", input("edit-drop", edit.drop, "number", 'min="1" max="9" step="0.5"'))}${label("Read begins (sec)", input("edit-release", edit.release, "number", 'min="0.5" max="5" step="0.1"'))}${label("Read progression (comma separated)", input("edit-reads", edit.reads.join(",")), "wide")}${label("Conditional read", select("edit-condition", ["none", "hot-blitz", "overload", "leverage"], edit.condition), "wide")}${label("Hot receiver", select("edit-hot", ["X", "Y", "Z", "H", "RB"], edit.hot))}${label("Read defender position", select("edit-readDefender", ["DE", "DT", "LB", "CB", "S"], edit.readDefender))}${label("Option read side", select("edit-readSide", ["right", "left"], edit.readSide || "right"))}${label("Allow quarterback escape", `<input id="edit-scramble" type="checkbox" ${edit.scramble ? "checked" : ""}>`, "inline wide")}${label("Situational tags (comma separated)", input("edit-tags", (edit.tags || []).join(",")), "wide")}`
        : ""
    }</aside></div>`,
  );
  editorCanvas = $("#board");
  editorCtx = editorCanvas.getContext("2d");
  const r = editorCanvas.getBoundingClientRect();
  editorW = r.width;
  editorH = r.height;
  const d = Math.min(devicePixelRatio, 2);
  editorCanvas.width = editorW * d;
  editorCanvas.height = editorH * d;
  editorCtx.scale(d, d);
  drawBoard();
  bindEditor();
  queueDraft();
}
let undo = [],
  redo = [];
function checkpoint() {
  redo = [];
  undo.push(clone(edit));
  if (undo.length > 60) undo.shift();
  queueDraft();
}
function queueDraft() {
  if (!edit) return;
  clearTimeout(draftTimer);
  designerDraft = { play: clone(edit), defense: editDef, slot: slotId };
  draftTimer = setTimeout(() => {
    if (edit)
      designerDraft = { play: clone(edit), defense: editDef, slot: slotId };
    save("designerDraft", designerDraft).catch(error);
  }, 300);
}
act("resume-draft", () => {
  if (!designerDraft) return;
  edit = clone(designerDraft.play);
  editDef = designerDraft.defense;
  slotId = designerDraft.slot || edit.slots[0].id;
  undo = [];
  redo = [];
  tool = "align";
  designer();
});
function drawBoard() {
  const c = editorCtx,
    w = editorW,
    h = editorH;
  c.clearRect(0, 0, w, h);
  c.fillStyle = "#245b46";
  c.fillRect(0, 0, w, h);
  for (let y = -15; y <= 35; y += 5) {
    const py = editorPoint(0, y)[1];
    c.fillStyle = y % 10 === 0 ? "#ffffff06" : "#00000008";
    c.fillRect(0, py - (h / 48) * 5, w, (h / 48) * 5);
    c.strokeStyle = "#e4e8cd50";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, py);
    c.lineTo(w, py);
    c.stroke();
    c.fillStyle = "#e4e8cd60";
    c.font = "10px system-ui";
    c.fillText(y + " yd", 5, py - 5);
  }
  const py = editorPoint(0, 0)[1];
  c.strokeStyle = "#7dc6ff";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, py);
  c.lineTo(w, py);
  c.stroke();
  for (const s of edit.slots) {
    const selected = s.id === slotId;
    for (const [field, color] of [
      ["path", "#e7bf6c"],
      ["motion", "#ab9bef"],
      ["shift", "#82cfba"],
    ]) {
      let a = [s.x, s.y];
      c.beginPath();
      c.moveTo(...editorPoint(...a));
      for (const b of s[field] || []) c.lineTo(...editorPoint(...b));
      c.strokeStyle = color;
      c.lineWidth = selected ? 2.5 : 1.3;
      c.setLineDash(field === "path" ? [] : [5, 4]);
      c.stroke();
      c.setLineDash([]);
      if (selected)
        for (const b of s[field] || []) {
          c.fillStyle = color;
          c.beginPath();
          c.arc(...editorPoint(...b), 3, 0, Math.PI * 2);
          c.fill();
        }
    }
    if (editDef && s.zone && ["zone", "deep"].includes(s.assignment)) {
      const p = editorPoint(...s.zone);
      c.fillStyle = "#8bcbff22";
      c.beginPath();
      c.ellipse(...p, w * 0.08, h * 0.08, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#8bcbff";
      c.stroke();
      c.beginPath();
      c.moveTo(...editorPoint(s.x, s.y));
      c.lineTo(...p);
      c.stroke();
    }
    const [x, y] = editorPoint(s.x, s.y);
    c.fillStyle = selected ? "#edcd7b" : editDef ? "#dfe9e1" : "#0d2732";
    c.strokeStyle = selected ? "#fff3cd" : "#a4c9b9";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, selected ? 13 : 11, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = selected || editDef ? "#183125" : "#eef3df";
    c.font = "bold 9px system-ui";
    c.textAlign = "center";
    c.fillText(s.id, x, y + 3);
    c.textAlign = "left";
  }
}
function bindEditor() {
  for (const key of [
    "name",
    "concept",
    "kind",
    "runner",
    "drop",
    "release",
    "condition",
    "hot",
    "readDefender",
    "readSide",
    "scramble",
    "fake",
    "exchange",
    "mesh",
    "situation",
    "tags",
    "reads",
  ]) {
    const e = $("#edit-" + key);
    if (e)
      e.onchange = () => {
        checkpoint();
        edit[key] = ["drop", "release", "mesh"].includes(key)
          ? +e.value
          : ["scramble", "fake"].includes(key)
            ? e.checked
            : key === "reads" || key === "tags"
              ? e.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : e.value;
        queueDraft();
      };
  }
  for (const key of [
    "pos",
    "assignment",
    "x",
    "y",
    "target",
    "delay",
    "option",
    "stunt",
    "athlete",
    "startAfter",
    "fit",
  ]) {
    const e = $("#slot-" + key);
    if (e)
      e.onchange = () => {
        checkpoint();
        const s = edit.slots.find((s) => s.id === slotId);
        s[key] = ["x", "y", "delay", "stunt"].includes(key)
          ? +e.value
          : e.value;
        drawBoard();
        queueDraft();
      };
  }
  if ($("#slot-curved"))
    $("#slot-curved").onchange = (e) => {
      checkpoint();
      edit.slots.find((s) => s.id === slotId).curved = e.target.checked;
    };
  if ($("#route-template"))
    $("#route-template").onchange = (e) => {
      if (e.target.value === "Custom") return;
      checkpoint();
      const s = edit.slots.find((s) => s.id === slotId);
      s.assignment = "route";
      s.path = ROUTES[e.target.value].map(([x, y]) => [
        clamp(s.x + x * (s.x < 0 ? -1 : 1), -26, 26),
        s.y + y,
      ]);
      designer();
    };
  editorCanvas.onpointerdown = (e) => {
    e.preventDefault();
    const r = editorCanvas.getBoundingClientRect(),
      x = e.clientX - r.left,
      y = e.clientY - r.top,
      world = editorWorld(x, y),
      nearest = edit.slots
        .map((s) => ({
          s,
          d: Math.hypot(
            editorPoint(s.x, s.y)[0] - x,
            editorPoint(s.x, s.y)[1] - y,
          ),
        }))
        .sort((a, b) => a.d - b.d)[0];
    if (nearest.d < 22 && nearest.s.id !== slotId) {
      slotId = nearest.s.id;
      designer();
      return;
    }
    checkpoint();
    const s = edit.slots.find((s) => s.id === slotId);
    pointer = { id: e.pointerId, start: world, last: world };
    editorCanvas.setPointerCapture(e.pointerId);
    if (tool === "align") {
      s.x = Math.round(world[0] * 2) / 2;
      s.y = Math.round(world[1] * 2) / 2;
    } else if (tool === "zone") s.zone = world;
    else {
      s[tool === "route" ? "path" : tool] = [world];
      if (
        tool === "route" &&
        s.id !== "QB" &&
        !BLOCKS.includes(s.assignment) &&
        s.assignment !== "run"
      )
        s.assignment = "route";
    }
    drawBoard();
  };
  editorCanvas.onpointermove = (e) => {
    if (!pointer) return;
    e.preventDefault();
    const r = editorCanvas.getBoundingClientRect(),
      p = editorWorld(e.clientX - r.left, e.clientY - r.top),
      s = edit.slots.find((s) => s.id === slotId);
    if (tool === "align") {
      s.x = Math.round(p[0] * 2) / 2;
      s.y = Math.round(p[1] * 2) / 2;
    } else if (tool === "zone") s.zone = p;
    else if (Math.hypot(p[0] - pointer.last[0], p[1] - pointer.last[1]) > 0.9) {
      s[tool === "route" ? "path" : tool].push(
        p.map((x) => Math.round(x * 2) / 2),
      );
      pointer.last = p;
    }
    drawBoard();
  };
  editorCanvas.onpointerup = () => {
    if (pointer) {
      pointer = null;
      designer();
    }
  };
  editorCanvas.onpointercancel = () => {
    pointer = null;
    designer();
  };
}
act("editor-back", () => {
  edit = null;
  undo = [];
  render();
});
act("editor-undo", () => {
  if (undo.length) {
    redo.push(clone(edit));
    edit = undo.pop();
    designer();
  }
});
act("clear-path", () => {
  checkpoint();
  const s = edit.slots.find((s) => s.id === slotId);
  s[tool === "route" || tool === "align" ? "path" : tool] =
    tool === "zone" ? [s.x, 12] : [];
  designer();
});
act("save-play", async () => {
  if (!edit.name.trim()) return toast("Give the play a name");
  if (
    !editDef &&
    (!edit.reads.length ||
      edit.reads.some((id) => !edit.slots.some((s) => s.id === id)))
  )
    return toast("Use valid receiver IDs for your progression");
  const a = editDef ? data.defense : data.book,
    i = a.findIndex((p) => p.id === edit.id);
  if (i >= 0) a[i] = clone(edit);
  else a.push(clone(edit));
  await persist();
  clearTimeout(draftTimer);
  designerDraft = null;
  await save("designerDraft", null);
  toast("Install saved");
  edit = null;
  undo = [];
  render();
});
act("save-formation", () =>
  modal(
    "Save formation",
    `${label("Formation name", input("formation-name", edit.formation || "Custom"))}<div class="spacer"></div>${btn("Save formation", "confirm-formation", "primary")}`,
  ),
);
act("confirm-formation", async () => {
  const name = $("#formation-name").value.trim();
  if (!name) return;
  data.formations.push({
    id: uid(),
    name,
    slots: edit.slots.map(({ id, x, y, pos, motion, shift }) => ({
      id,
      x,
      y,
      pos,
      motion,
      shift,
    })),
  });
  edit.formation = name;
  await persist();
  $("#modal").close();
  toast("Formation saved");
});
act("load-formation", () =>
  modal(
    "Saved formations",
    `<div class="form-stack">${data.formations.length ? data.formations.map((f) => btn(esc(f.name), `formation:${f.id}`)).join("") : "<p>No custom formations saved yet.</p>"}</div>`,
  ),
);
act("test-play", () => {
  const p = clone(edit);
  game = newGame(data.team, (data.team + 1) % 8, Date.now());
  game.phase = "scrimmage";
  game.possession = 0;
  game.ball = 35;
  game.line = 45;
  mode = "practice";
  human = 0;
  game.practicePlay = p;
  selected = p.id;
  edit = null;
  page = "game";
  persist().catch(error);
  gamePage();
});
let viewing = false,
  filmTime = 0,
  filmAuto = false,
  callCategory = "all",
  simId = 0;
const pendingTasks = new Map();
const worker = new Worker("./sim-worker.js", { type: "module" });
worker.onmessage = ({ data: r }) => {
  const t = pendingTasks.get(r.id);
  if (t) {
    pendingTasks.delete(r.id);
    r.error ? t.reject(Error(r.error)) : t.resolve(r.film ?? r.value);
  }
};
worker.onerror = (e) => {
  for (const t of pendingTasks.values())
    t.reject(Error(e.message || "Simulation worker failed"));
  pendingTasks.clear();
};
function compute(payload) {
  return new Promise((resolve, reject) => {
    const id = ++simId;
    pendingTasks.set(id, { resolve, reject });
    worker.postMessage({ ...payload, id });
  });
}
function ownTurn() {
  return mode === "multiplayer"
    ? live?.turn === user?.uid
    : mode === "practice" || game?.possession === human;
}
function availableBook() {
  return mode === "multiplayer" && live
    ? live.books[game.possession] || data.book
    : data.book;
}
function currentPlay() {
  return (
    game?.practicePlay ||
    availableBook().find((p) => p.id === selected) ||
    availableBook()[0]
  );
}
function clockText(g) {
  return `${Math.floor(g.clock / 60)}:${String(Math.floor(g.clock % 60)).padStart(2, "0")}`;
}
function scoreHTML(g) {
  return `<div class="scoreboard">${scoreTeam(g, 0)}<div class="clock">${g.final ? "FINAL" : g.overtime ? "OT " + g.overtime.round : clockText(g)}<small>${g.final ? "GAME COMPLETE" : g.overtime ? "UNTIMED" : `QUARTER ${g.quarter}`}</small></div>${scoreTeam(g, 1)}</div>`;
}
function scoreTeam(g, i) {
  const t = g.teams[i];
  return `<div class="score-team ${i ? "away" : ""}" style="--team:${t.primary}">${crest(t)}<div><div class="school">${esc(t.school)}</div><small>${g.possession === i && !g.final ? "● ON OFFENSE" : esc(t.mascot || "FOOTBALL")}</small></div><div class="score">${g.score[i]}</div></div>`;
}
function formationFilm() {
  if (!game) return null;
  if (game.phase === "kickoff") {
    const f = simulateKick(game, "kickoff", hash(`${game.seed}-${game.seq}`));
    f.frames = [{ ...f.frames[0], t: 0 }];
    return f;
  }
  let p = adjusted || currentPlay();
  if (!ownTurn() && mode !== "multiplayer") {
    const ai = aiPlay(game);
    if (typeof ai !== "string") p = ai;
  }
  if (!p) return null;
  const call = selectDefense(
    game.defenses[1 - game.possession],
    { receivers: p.slots.filter((s) => s.pos === "WR").length },
    game,
    hash(`${game.seed}-${game.seq}`) ^ 1847,
  );
  return previewFilm(
    game.teams[game.possession],
    game.teams[1 - game.possession],
    p,
    call,
    game.ball,
    game.fatigue,
  );
}
function mountStadium(canvasId, autoplay = filmAuto, start = filmTime, onEnd) {
  stadium = new Stadium($("#" + canvasId), {
    onEnd: () => {
      viewing = false;
      filmTime = film?.frames.at(-1)?.t || 0;
      filmAuto = false;
      if (page === "game") {
        const b = $('[data-act="snap"]');
        if (b) {
          b.disabled = (mode === "multiplayer" && !ownTurn()) || game.final;
          b.textContent = snapText();
        }
      }
      watchState = null;
      if (page === "game") gamePage();
      onEnd?.();
    },
    onTime: (t) => {
      filmTime = t;
      const e = $("#scrub");
      if (e && !e.matches(":active")) e.value = t;
      const time = $("#film-time");
      if (time) time.textContent = t.toFixed(1) + "s";
      const ticker = $("#live-event");
      if (ticker && stadium?.film && viewing) {
        const event = stadium.film.events?.filter((e) => e.t <= t).at(-1);
        const text =
          t < 0
            ? "Pre-snap • Read the formation and assignments"
            : event?.text || "Athletes executing their assignments";
        if (ticker.textContent !== text) ticker.textContent = text;
      }
    },
  });
  stadium.overlay = data.settings.overlays;
  stadium.defenseArt = !!data.settings.defenseArt;
  stadium.speed = data.settings.speed || 1;
  stadium.distance =
    page === "film"
      ? film?.situation?.distance
      : viewing && watchState
        ? watchState.distance
        : game?.distance;
  const displayed =
    page === "game" && showCall && !viewing ? formationFilm() : film;
  stadium.setFilm(displayed, displayed?.preview ? true : autoplay);
  stadium.loopPreview = !!displayed?.preview;
  stadium.seek(
    displayed?.preview
      ? displayed.frames[0].t
      : showCall && page === "game"
        ? 0
        : start,
  );
}
function filmToolbar() {
  return `<div class="film-toolbar">${btn("↺", "replay", "", 'aria-label="Replay from start"')}${btn("Ⅱ / ▶", "pause", "", 'aria-label="Pause or play"')}<input id="scrub" aria-label="Replay timeline" type="range" min="${film?.frames?.[0]?.t || 0}" step="0.02" max="${film?.frames.at(-1)?.t || 1}" value="${filmTime}">${btn((data.settings.speed || 1) + "×", "speed")}${btn(data.settings.overlays ? "Hide routes" : "Routes", "overlay")}${btn("Coverage", "defense-art")}${btn("Next call", "next-call")}${btn("Export film", "export-film")}${btn("Box score", "box-score")}${btn("Coach notes", "coach-notes")}${btn(fieldExpanded ? "Exit field view" : "Field view", "field-view")}<span class="art-legend"><i style="background:#f4cf75"></i>Route <i style="background:#f28b70"></i>Run <i style="background:#a1ddd3"></i>Block <i style="background:#b6a0f2"></i>Motion</span></div>`;
}
function snapText() {
  if (busy) return "Simulating…";
  if (viewing) return "Watching the play…";
  if (game.final) return "Final whistle";
  if (mode === "multiplayer" && !ownTurn()) return "Waiting for your friend";
  if (game.phase === "kickoff") return "KICK OFF →";
  if (!ownTurn()) return "WATCH OPPONENT SNAP →";
  if (game.phase === "try") return "RUN CONVERSION →";
  return "SNAP THE BALL →";
}
function gamePage() {
  if (!game) {
    shell(
      `${head("Friday under lights", "Take the field", "Choose a school and start a full exhibition game.")}<div class="panel">${label(
        "Your school",
        select(
          "quick-team",
          TEAMS.map((t) => [t.id, t.school]),
          data.team,
        ),
      )}<div class="spacer"></div>${btn("Set up a game", "exhibition", "primary")}</div>`,
    );
    return;
  }
  const shown = viewing && watchState ? watchState : game;
  const own =
      viewing && watchState ? watchState.possession === human : ownTurn(),
    p = currentPlay(),
    book = availableBook(),
    opponent = game.teams[1 - human];
  shell(
    `${head(mode === "practice" ? "Practice field" : mode === "multiplayer" ? "Friend game" : mode === "franchise" ? "Friday night / Franchise" : "Friday night / Exhibition", mode === "practice" ? "The proving ground" : `${esc(game.teams[0].school)} vs ${esc(game.teams[1].school)}`, "", btn("New game", "exhibition", "ghost small") + (mode === "multiplayer" ? btn("Friend lobby", "nav:friends", "ghost small") : ""))}<div class="game-layout ${fieldExpanded ? "field-expanded" : ""}"><div>${scoreHTML(viewing && watchState ? watchState : game)}<div class="stadium-wrap"><canvas id="stadium" aria-label="Football field and animated replay"></canvas></div><div class="situation"><strong>${shown.phase === "kickoff" ? "KICKOFF" : shown.phase === "try" ? "POINT AFTER" : shown.final ? "GAME COMPLETE" : `${["", "1ST", "2ND", "3RD", "4TH"][shown.down]} & ${shown.line === 100 ? "GOAL" : shown.distance}`}</strong><small>Ball ${Math.round(shown.ball)} • TO ${shown.timeouts.join(" / ")} • Play clock ${shown.playClock}s</small></div>${filmToolbar()}<div id="live-event" aria-live="polite" class="event-strip section-gap">${esc(viewing ? "Executing " + (film?.play.name || "the play") + "…" : game.last || "Pick the call. Trust your athletes.")}</div>${shown.final ? `<div class="panel section-gap"><h3>${shown.score[human] > game.score[1 - human] ? "A Friday night to remember." : "Back to the drawing board."}</h3><p class="muted">${esc(game.teams[game.score[0] > game.score[1] ? 0 : 1].school)} wins ${Math.max(...game.score)}–${Math.min(...game.score)}.</p>${mode === "franchise" ? btn("Complete week & advance program", "finish-week", "primary") : btn("View box score", "box-score", "primary")}</div>` : ""}</div><aside class="call-side"><div class="panel"><div class="panel-heading"><h3>${own ? "The call sheet" : "Opponent possession"}</h3><span class="badge">${mode === "practice" ? "Practice" : own ? "Your turn" : "Auto defense"}</span></div>${
      viewing
        ? `<p class="muted">Watch ${esc(film?.play.name || "the play")} develop. The next decision opens after the whistle.</p>`
        : shown.phase === "kickoff"
          ? `<p class="muted">Special teams takes the field. Choose a deep kickoff or a grounded onside attempt.</p>${own ? btn("Onside kick", "onside", "ghost", busy ? "disabled" : "") : ""}`
          : game.final
            ? '<p class="muted">Review the film and box score.</p>'
            : !own
              ? `<p class="muted">${esc(game.teams[game.possession].school)} calls its offense. Your defensive coordinator handles every assignment.</p>`
              : `<div class="tabs">${["all", "pass", "run", "option"].map((k) => btn(k === "all" ? "All" : k, `call-category:${k}`, callCategory === k ? "active small" : "small")).join("")}</div><div class="call-list">${book
                  .filter(
                    (p) =>
                      callCategory === "all" ||
                      p.kind === callCategory ||
                      (callCategory === "option" &&
                        ["triple", "rpo", "qb"].includes(p.kind)),
                  )
                  .map(
                    (q) =>
                      `<button class="play-card ${q.id === p?.id ? "active" : ""}" data-act="call:${q.id}">${mini(q)}<div><h4>${esc(q.name)}</h4><small>${esc(q.formation)} · ${q.kind}</small></div></button>`,
                  )
                  .join("")}</div>`
    }<div class="spacer"></div>${btn(snapText(), "snap", "primary snap", busy || viewing || shown.final || (mode === "multiplayer" && !own) ? "disabled" : "")}<div class="game-note" style="margin-top:10px">${mode === "multiplayer" ? "Your turn is committed before playback. Closing the app will not lose it." : "No athlete controls after the snap. Coach through your call sheet."}</div></div>${
      own && !viewing && !game.final && game.phase !== "kickoff"
        ? `<div class="drawer form-stack">${label(
            "Tempo",
            select(
              "tempo",
              [
                ["hurry", "Hurry • 4 sec"],
                ["normal", "Normal • 22 sec"],
                ["chew", "Chew • 38 sec"],
              ],
              p?.tempo || "normal",
            ),
          )}<div class="row">${btn("Timeout", "timeout", "small")}${shown.phase !== "try" ? btn("Punt", "punt", "small") + btn("Punt left", "punt_left", "small ghost") + btn("Punt right", "punt_right", "small ghost") : ""}${btn(shown.phase === "try" ? "Kick PAT" : "Field goal", shown.phase === "try" ? "extra_point" : "field_goal", "small")}</div>${btn("Pre-snap adjustments", "adjust", "small ghost") + btn("Opponent scouting", "scout-game", "small ghost")}<small>${shown.phase === "try" && game.overtime?.round >= game.rules.otTwoFrom ? "Two-point attempt required by overtime settings." : ""}</small></div>`
        : ""
    }${mode === "practice" ? `<div class="note">Practice resets the ball and down after each snap.<div class="row section-gap">${btn("Practice setup", "practice-setup", "small")}${btn("Run 20-snap study", "practice-study", "small ghost")}</div></div>` : ""}</aside></div>`,
  );
  mountStadium("stadium");
  if ($("#scrub"))
    $("#scrub").oninput = (e) => {
      stadium.playing = false;
      viewing = false;
      watchState = null;
      stadium.seek(+e.target.value);
      const snapButton = $('[data-act="snap"]');
      if (snapButton) {
        snapButton.disabled =
          shown.final || (mode === "multiplayer" && !ownTurn());
        snapButton.textContent = snapText();
      }
    };
  if ($("#tempo"))
    $("#tempo").onchange = (e) => {
      const p = currentPlay();
      p.tempo = e.target.value;
      autoSave();
    };
}
act("exhibition", () =>
  modal(
    "Set the stage",
    `<div class="form-stack">${label(
      "Your school",
      select(
        "new-home",
        TEAMS.map((t) => [t.id, t.school + " " + t.mascot]),
        data.team,
      ),
    )}${label(
      "Opponent",
      select(
        "new-away",
        TEAMS.map((t) => [t.id, t.school + " " + t.mascot]),
        (data.team + 7) % 8,
      ),
    )}${label(
      "Quarter length",
      select(
        "new-quarter",
        [
          [720, "12 minutes • regulation"],
          [300, "5 minutes • quick game"],
          [120, "2 minutes • testing"],
        ],
        720,
      ),
    )}${btn("Under the lights →", "start-exhibition", "primary")}</div>`,
  ),
);
act("start-exhibition", async () => {
  unwatch?.();
  live = null;
  mode = "exhibition";
  human = 0;
  game = newGame(+$("#new-home").value, +$("#new-away").value, Date.now(), {
    quarter: +$("#new-quarter").value,
  });
  game.defenses[0] = clone(data.defense);
  game.teams[0].depth = clone(data.depthCharts[game.teams[0].id] || {});
  film = null;
  showCall = true;
  lastFilm = null;
  filmTime = 0;
  filmAuto = false;
  viewing = false;
  $("#modal").close();
  page = "game";
  await persist();
  gamePage();
});
act("resume", () => {
  page = "game";
  gamePage();
});
async function storeFilm(f) {
  const fingerprint = [
    f.version,
    f.seed,
    f.play.id || f.play.name,
    f.offense.school,
    f.defense.school,
    f.ball,
  ].join(":");
  if (filmIndex.some((x) => x.fingerprint === fingerprint)) {
    await persist();
    return;
  }
  const id = `film-${Date.now()}-${uid()}`;
  await save(id, f);
  filmIndex.unshift({
    id,
    title: f.play.name,
    fingerprint,
    school: f.offense.school,
    result: f.result.reason,
    yards: f.result.yards,
    date: Date.now(),
  });
  const dropped = filmIndex.slice(1000);
  filmIndex = filmIndex.slice(0, 1000);
  for (const old of dropped) await remove(old.id);
  await persist();
}
async function snap(special) {
  if (busy || viewing || !game || game.final) return;
  if (mode === "multiplayer" && !ownTurn())
    return toast("Your friend is on offense");
  if (mode === "multiplayer" && live.version !== VERSION)
    return toast("Engine version mismatch");
  if (
    game.phase === "try" &&
    game.overtime?.round >= game.rules.otTwoFrom &&
    special === "extra_point"
  )
    return toast("This overtime round requires a two-point attempt");
  busy = true;
  const state = clone(game),
    seq = live?.seq;
  let p =
    special || (!ownTurn() ? aiPlay(game) : clone(adjusted || currentPlay()));
  adjusted = null;
  if (!p && game.phase !== "kickoff") {
    busy = false;
    return toast("Select a play");
  }
  try {
    gamePage();
    const f = await compute({
      game: state,
      play: p,
      seed: hash(`${state.seed}-${state.seq}`),
    });
    let next = advance(state, f, p.tempo || "normal");
    if (mode === "practice") {
      next = clone(state);
      next.seq = state.seq + 1;
      next.last = `${f.result.reason.replaceAll("_", " ")} • ${Math.round(f.result.yards)} yards`;
    }
    if (mode === "multiplayer") {
      const committed = await cloud.submit(live.code, seq, next, f);
      live = committed;
      game = clone(committed.game);
    } else game = next;
    lastFilm = f;
    film = f;
    showCall = false;
    watchState = state;
    filmTime = f.frames[0]?.t || 0;
    filmAuto = true;
    viewing = true;
    await storeFilm(f);
    busy = false;
    gamePage();
    if (!f.frames.length) {
      viewing = false;
      gamePage();
    }
  } catch (e) {
    busy = false;
    viewing = false;
    error(e);
    gamePage();
  }
}
act("snap", () => snap());
for (const s of [
  "punt",
  "punt_left",
  "punt_right",
  "onside",
  "field_goal",
  "extra_point",
])
  act(s, () => snap(s));
act("timeout", async () => {
  if (busy || viewing || game.final) return;
  if (mode === "multiplayer") {
    toast(
      "Use the pre-snap timeout adjustment; it is committed with your next snap.",
    );
    game = timeout(game, game.possession);
    gamePage();
  } else {
    game = timeout(game, human);
    await persist();
    gamePage();
  }
});
act("next-call", () => {
  showCall = true;
  filmAuto = false;
  viewing = false;
  gamePage();
});
act("defense-art", () => {
  data.settings.defenseArt = !data.settings.defenseArt;
  if (stadium) stadium.defenseArt = data.settings.defenseArt;
  autoSave();
});
act("replay", () => {
  if (page === "game" && lastFilm && showCall) {
    film = lastFilm;
    showCall = false;
    filmTime = film.frames[0]?.t || 0;
    filmAuto = true;
    gamePage();
    return;
  }
  if (stadium && film) {
    stadium.seek(film.frames[0]?.t || 0);
    stadium.playing = true;
  }
});
act("pause", () => {
  if (stadium) stadium.playing = !stadium.playing;
});
act("speed", () => {
  const speeds = [0.5, 1, 2, 4],
    i = speeds.indexOf(data.settings.speed || 1);
  data.settings.speed = speeds[(i + 1) % 4];
  if (stadium) stadium.speed = data.settings.speed;
  document
    .querySelectorAll('[data-act="speed"]')
    .forEach((e) => (e.textContent = data.settings.speed + "×"));
  autoSave();
});
act("overlay", () => {
  data.settings.overlays = !data.settings.overlays;
  if (stadium) stadium.overlay = data.settings.overlays;
  stadium.defenseArt = !!data.settings.defenseArt;
  document
    .querySelectorAll('[data-act="overlay"]')
    .forEach(
      (e) =>
        (e.textContent = data.settings.overlays ? "Hide routes" : "Routes"),
    );
  autoSave();
});
act("adjust", () => {
  const p = currentPlay();
  modal(
    "Pre-snap adjustments",
    `<div class="form-stack"><p class="muted">Adjustments apply to the next call. The saved playbook remains available in the install room.</p>${label(
      "Protection slide",
      select(
        "adjust-slide",
        [
          ["none", "As designed"],
          ["left", "Slide left"],
          ["right", "Slide right"],
        ],
        "none",
      ),
    )}${label("Hot receiver", select("adjust-hot", ["X", "Y", "Z", "H", "RB"], p.hot))}${label("Read progression", input("adjust-reads", p.reads.join(",")))}${label("Mirror the entire play", `<input id="adjust-mirror" type="checkbox">`, "inline")}${btn("Apply adjustments", "apply-adjust", "primary")}</div>`,
  );
});
let adjusted = null;
act("apply-adjust", () => {
  const p = clone(currentPlay());
  const reads = $("#adjust-reads")
    .value.split(",")
    .map((x) => x.trim());
  if (reads.some((x) => !p.slots.some((s) => s.id === x)))
    return toast("Use receiver IDs from this formation");
  p.reads = reads;
  p.hot = $("#adjust-hot").value;
  if ($("#adjust-mirror").checked) {
    p.readSide = p.readSide === "left" ? "right" : "left";
    p.keepPath = p.keepPath?.map(([x, y]) => [-x, y]);
    for (const r of p.rules || [])
      if (r.side) r.side = r.side === "left" ? "right" : "left";
    const mirrored = {
      D0: "D3",
      D3: "D0",
      D1: "D2",
      D2: "D1",
      D4: "D6",
      D6: "D4",
      D7: "D8",
      D8: "D7",
      D9: "D10",
      D10: "D9",
    };
    for (const s of p.slots) {
      s.x = -s.x;
      for (const k of ["path", "motion", "shift"])
        s[k] = (s[k] || []).map(([x, y]) => [-x, y]);
      if (mirrored[s.target]) s.target = mirrored[s.target];
    }
  }
  const slide = $("#adjust-slide").value;
  p.slide = slide;
  if (slide !== "none")
    for (const s of p.slots.slice(0, 5)) {
      s.assignment = "slide";
      s.target = "nearest";
      s.x += slide === "left" ? -0.2 : 0.2;
    }
  adjusted = p;
  showCall = true;
  $("#modal").close();
  gamePage();
  toast("Adjustment ready for the next snap");
});
function boxScore(g) {
  if (!g) return;
  const stats = g.stats,
    rows = stats.flatMap((s, i) =>
      Object.entries(s.players).map(([id, v]) => ({
        name: g.teams[i].roster.find((p) => p.id === id)?.name || id,
        school: g.teams[i].school,
        ...v,
      })),
    );
  const table = (title, columns, filter) =>
    `<h3 class="section-gap">${title}</h3><div class="table-scroll"><table><thead><tr><th>Athlete</th><th>School</th>${columns.map(([label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${
      rows
        .filter(filter)
        .map(
          (p) =>
            `<tr><td>${esc(p.name)}</td><td>${esc(p.school)}</td>${columns.map(([, key]) => `<td>${typeof key === "function" ? key(p) : p[key] || 0}</td>`).join("")}</tr>`,
        )
        .join("") || '<tr><td colspan="12">No recorded production.</td></tr>'
    }</tbody></table></div>`;
  modal(
    "Friday night box score",
    `${scoreHTML(g)}<div class="table-scroll section-gap"><table><thead><tr><th>School</th><th>1</th><th>2</th><th>3</th><th>4</th><th>OT</th><th>Final</th></tr></thead><tbody>${g.teams.map((t, i) => `<tr><td>${esc(t.school)}</td>${(g.scoreLine?.[i] || [0, 0, 0, 0, 0]).map((n) => `<td>${n}</td>`).join("")}<td><strong>${g.score[i]}</strong></td></tr>`).join("")}</tbody></table></div><div class="table-scroll section-gap"><table><thead><tr><th>Team</th>${g.teams.map((t) => `<th>${esc(t.school)}</th>`).join("")}</tr></thead><tbody>${[
      ["Plays", "plays"],
      ["Total yards", "yards"],
      ["Passing", "passing"],
      ["Rushing", "rushing"],
      ["Completions", "completions"],
      ["Attempts", "attempts"],
      ["First downs", "firstDowns"],
      ["Turnovers", "turnovers"],
      ["Third down made", "thirdMade"],
      ["Third down attempts", "thirdAttempts"],
      ["Penalties", "penalties"],
      ["Penalty yards", "penaltyYards"],
    ]
      .map(
        ([name, k]) =>
          `<tr><td>${name}</td><td>${stats[0][k] || 0}</td><td>${stats[1][k] || 0}</td></tr>`,
      )
      .join("")}</tbody></table></div>${table(
      "Passing",
      [
        ["C/A", (p) => `${p.passCompletions || 0}/${p.passAttempts || 0}`],
        ["YDS", "passYards"],
        ["TD", "passTD"],
        ["INT", "interceptions"],
      ],
      (p) => p.passAttempts,
    )}${table(
      "Rushing",
      [
        ["CAR", "carries"],
        ["YDS", "rushYards"],
        ["TD", "td"],
        ["LONG", "longest"],
      ],
      (p) => p.carries,
    )}${table(
      "Receiving",
      [
        ["REC", "receptions"],
        ["YDS", "receivingYards"],
        ["YAC", "yac"],
        ["TD", "td"],
      ],
      (p) => p.receptions,
    )}${table(
      "Defense & trenches",
      [
        ["TKL", "tackles"],
        ["SACK", "sacks"],
        ["INT", "defInts"],
        ["FF", "forcedFumbles"],
        ["BLK", "blocks"],
      ],
      (p) => p.tackles || p.sacks || p.defInts || p.blocks,
    )}${table(
      "Special teams",
      [
        ["FG", (p) => `${p.fieldGoals || 0}/${p.fgAttempts || 0}`],
        ["PAT", (p) => `${p.pats || 0}/${p.patAttempts || 0}`],
        ["PUNTS", "punts"],
      ],
      (p) => p.fgAttempts || p.patAttempts || p.punts,
    )}<h3 class="section-gap">Possession summaries</h3><div class="film-events">${(g.drives || []).map((d) => `<div class="list-row"><div><strong>${esc(g.teams[d.team].school)}</strong><br><small>${d.plays} plays · ${d.yards} yards · From own ${Math.round(d.from)}</small></div><small>${esc(d.result || "Drive in progress")}</small></div>`).join("") || '<p class="muted">No offensive possession yet.</p>'}</div><h3 class="section-gap">Play log</h3><div class="film-events">${(
      g.history || []
    )
      .slice()
      .reverse()
      .map(
        (h) =>
          `<div class="film-event"><time>Q${h.quarter}</time><div><strong>${esc(h.play)}</strong><br><small>${esc(h.text)}</small></div></div>`,
      )
      .join("")}</div>`,
  );
}
act("box-score", () => boxScore(game));
function franchisePage() {
  const f = data.franchise;
  if (!f) {
    shell(
      `${head("Build something that lasts", "The program", "Develop athletes, survive graduation, and build a school worth remembering.")}<div class="hero"><div class="hero-copy"><div class="kicker">Your legacy starts with a freshman class</div><h1>BUILD THE<br>STANDARD.</h1><p>A ten-game regular season. A four-school playoff. Athlete development and a new class every fall.</p>${btn("Create your program", "new-franchise", "primary")}</div><div class="hero-art"></div></div>`,
    );
    return;
  }
  const t = f.teams[f.team],
    s = standings(f),
    record = s.find((r) => r.id === f.team),
    m = matchup(f);
  shell(
    `${head(`${f.year} / ${f.week < 10 ? "Regular season" : f.week < 12 ? "Playoffs" : "Season complete"}`, esc(t.school) + " " + esc(t.mascot), "", btn("Customize program", "customize-program", "ghost small"))}<div class="grid cols2"><section class="panel"><div class="row between"><div class="row">${crest(t)}<div><h3>${t.scheme}</h3><small>${t.roster.length} athletes • ${t.roster.filter((p) => p.grade === 12).length} seniors</small></div></div><div class="big-num">${record.w}–${record.l}</div></div><div class="stat-grid section-gap"><div><div class="big-num">${Math.min(f.week + 1, 12)}</div><small>Week</small></div><div><div class="big-num">${record.pf}</div><small>Points scored</small></div><div><div class="big-num">${record.pa}</div><small>Points allowed</small></div><div><div class="big-num">${f.archive.filter((a) => a.champion === t.school).length}</div><small>Championships</small></div></div><div class="spacer"></div>${label(
      "Development emphasis",
      select(
        "training",
        [
          ["balanced", "Balanced program"],
          ["speed", "Speed & agility"],
          ["strength", "Strength & trenches"],
          ["skills", "Football skills"],
        ],
        f.training,
      ),
    )}<div class="spacer"></div>${f.champion !== null ? `<h3>${esc(f.teams[f.champion].school)} wins the championship</h3><p class="muted">Graduate your senior class and welcome the next generation.</p>${btn("Begin next season", "next-year", "primary")}` : m ? `<div class="kicker">Next opponent</div><h3>${esc(f.teams[m.home === f.team ? m.away : m.home].school)}</h3><p class="muted">Week ${f.week + 1} • ${f.week >= 10 ? "Playoffs" : m.home === f.team ? "Home under the lights" : "On the road"}</p><div class="row">${btn("Play this week", "play-franchise", "primary")}${btn("Simulate week", "simulate-week", "ghost")}</div>` : `<p class="muted">Your season is complete. Watch the remaining playoff games settle the title.</p>${btn("Simulate playoff week", "simulate-week", "primary")}`}</section><section class="panel"><div class="panel-heading"><h3>District standings</h3><span class="badge">Top 4 qualify</span></div><div class="table-scroll"><table><thead><tr><th>School</th><th>W</th><th>L</th><th>PF</th><th>PA</th></tr></thead><tbody>${s.map((r, i) => `<tr ${r.id === f.team ? 'style="color:var(--gold)"' : ""}><td>${i + 1}. ${esc(r.school)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.pf}</td><td>${r.pa}</td></tr>`).join("")}</tbody></table></div></section></div><div class="grid cols2 section-gap"><section class="panel"><div class="panel-heading"><h3>Schedule</h3>${btn("Manage", "manage-schedule", "small ghost")}</div>${f.schedule
      .map((w, i) => {
        const m = w.find((m) => m.home === f.team || m.away === f.team),
          opp = f.teams[m.home === f.team ? m.away : m.home];
        return `<div class="list-row"><div><small>WEEK ${i + 1} ${m.home === f.team ? " / HOME" : " / AWAY"}</small><div>${esc(opp.school)}</div></div><strong>${m.score ? m.score.join(" – ") : i === f.week ? "UP NEXT" : "—"}</strong></div>`;
      })
      .join(
        "",
      )}${f.playoffs ? `<h3 class="section-gap">Playoff bracket</h3>${f.playoffs.rounds.flatMap((r, i) => r.map((m) => `<div class="list-row"><small>${i ? "FINAL" : "SEMI"} · ${esc(f.teams[m.home].school)} / ${esc(f.teams[m.away].school)}</small><strong>${m.score?.join(" – ") || "—"}</strong></div>`)).join("")}` : ""}</section><section class="panel"><h3>Program history</h3>${
      f.archive.length
        ? f.archive
            .slice()
            .reverse()
            .map(
              (a) =>
                `<div class="list-row"><strong>${a.year}</strong><div>${esc(a.champion)}<br><small>District champion</small></div></div>`,
            )
            .join("")
        : '<p class="muted">Your first chapter is still being written.</p>'
    }<h3 class="section-gap">Recent game records</h3>${f.records
      .slice(-8)
      .reverse()
      .map(
        (r) =>
          `<div class="list-row" role="button" tabindex="0" data-act="record:${f.records.indexOf(r)}"><small>${r.year} / Week ${r.week + 1}<br>${esc(f.teams[r.opponent].school)}</small><strong>${r.score.join(" – ")}</strong></div>`,
      )
      .join("")}</section></div>`,
  );
  $(".main").insertAdjacentHTML(
    "beforeend",
    `<div class="panel section-gap"><div class="panel-heading"><h3>The program desk</h3><span class="badge">Season & career</span></div><div class="row">${btn("District leaders", "season-leaders", "small")}${btn("Career records", "career-records", "small")}${btn("Depth chart", "program-depth", "small")}${m ? btn("Scout next opponent", "scout-next", "small ghost") : ""}${btn("Alumni", "alumni", "small ghost")}</div></div>`,
  );
  $("#training").onchange = (e) => {
    f.training = e.target.value;
    autoSave();
  };
}
act("manage-schedule", () => {
  const f = data.franchise;
  modal(
    "Manage remaining schedule",
    `<div class="form-stack">${f.schedule
      .map((w, i) => {
        if (i < f.week) return "";
        const m = w.find((m) => m.home === f.team || m.away === f.team),
          opponent = m.home === f.team ? m.away : m.home;
        return `<div class="form-row">${label(
          "Week " + (i + 1),
          select(
            "schedule-" + i,
            f.teams.filter((t) => t.id !== f.team).map((t) => [t.id, t.school]),
            opponent,
          ),
        )}${label(
          "Venue",
          select(
            "venue-" + i,
            [
              [1, "Home"],
              [0, "Away"],
            ],
            m.home === f.team ? 1 : 0,
          ),
        )}</div>`;
      })
      .join("")}${btn("Save schedule", "save-schedule", "primary")}</div>`,
  );
});
act("save-schedule", async () => {
  let f = data.franchise;
  for (let i = f.week; i < 10; i++)
    f = reschedule(f, i, +$("#schedule-" + i).value, !!+$("#venue-" + i).value);
  data.franchise = f;
  await persist();
  $("#modal").close();
  franchisePage();
});
act("new-franchise", () =>
  modal(
    "Start a program",
    `<div class="form-stack">${label(
      "Base roster",
      select(
        "franchise-team",
        TEAMS.map((t) => [t.id, t.school]),
        data.team,
      ),
    )}${label("School name (optional)", input("franchise-name", ""))}<div class="form-row">${label("Primary color", input("franchise-primary", TEAMS[data.team].primary, "color"))}${label("Secondary color", input("franchise-secondary", TEAMS[data.team].secondary, "color"))}</div>${btn("Build the program", "create-franchise", "primary")}</div>`,
  ),
);
act("create-franchise", async () => {
  data.franchise = createFranchise(
    +$("#franchise-team").value,
    $("#franchise-name").value.trim(),
    [$("#franchise-primary").value, $("#franchise-secondary").value],
  );
  await persist();
  $("#modal").close();
  page = "franchise";
  franchisePage();
});
act("play-franchise", async () => {
  unwatch?.();
  live = null;
  mode = "franchise";
  const f = data.franchise,
    m = matchup(f);
  if (!m) return;
  human = m.home === f.team ? 0 : 1;
  game = franchiseGame(f, m);
  game.franchiseYear = f.year;
  game.franchiseWeek = f.week;
  game.defenses[human] = clone(data.defense);
  film = null;
  showCall = true;
  lastFilm = null;
  filmTime = 0;
  filmAuto = false;
  viewing = false;
  page = "game";
  await persist();
  gamePage();
});
async function progressWeek(played) {
  if (busy) return;
  const f = data.franchise;
  if (!f || f.champion !== null) return;
  if (
    played &&
    (played.franchiseYear !== f.year || played.franchiseWeek !== f.week)
  )
    return toast("This game belongs to a different season week");
  busy = true;
  toast("Simulating the district’s games…");
  try {
    data.franchise = await compute({ type: "week", franchise: f, played });
    busy = false;
    mode = "exhibition";
    game = null;
    await persist();
    page = "franchise";
    franchisePage();
    toast("Week complete");
  } catch (e) {
    busy = false;
    error(e);
  }
}
act("finish-week", () => progressWeek(game));
act("simulate-week", () => progressWeek(null));
act("next-year", async () => {
  data.franchise = nextYear(data.franchise);
  await persist();
  franchisePage();
  toast("New class has arrived. Welcome to " + data.franchise.year);
});
act("customize-program", () => {
  const f = data.franchise,
    t = f.teams[f.team];
  modal(
    "Program settings",
    `<div class="form-stack">${label("School name", input("custom-name", t.school))}${label("Mascot", input("custom-mascot", t.mascot))}<div class="form-row">${label("Primary", input("custom-primary", t.primary, "color"))}${label("Secondary", input("custom-secondary", t.secondary, "color"))}</div>${label(
      "Quarter length",
      select(
        "custom-quarter",
        [
          [720, "12 minutes"],
          [300, "5 minutes"],
          [120, "2 minutes"],
        ],
        f.rules.quarter,
      ),
    )}${label(
      "Overtime starts at opponent",
      select(
        "custom-ot",
        [
          [90, "10-yard line"],
          [80, "20-yard line"],
          [75, "25-yard line"],
        ],
        f.rules.otStart,
      ),
    )}${label("Two-point attempts required from OT round", input("custom-two", f.rules.otTwoFrom, "number", 'min="1" max="10"'))}${btn("Save program", "save-program", "primary")}${btn("Open editable roster", "edit-program-roster", "ghost")}</div>`,
  );
});
act("save-program", async () => {
  const f = data.franchise,
    t = f.teams[f.team];
  t.school = $("#custom-name").value.trim() || t.school;
  t.mascot = $("#custom-mascot").value.trim() || t.mascot;
  t.primary = $("#custom-primary").value;
  t.secondary = $("#custom-secondary").value;
  f.rules.quarter = +$("#custom-quarter").value;
  f.rules.otStart = +$("#custom-ot").value;
  f.rules.otTwoFrom = clamp(+$("#custom-two").value, 1, 10);
  await persist();
  $("#modal").close();
  franchisePage();
});
let rosterTeam = data.team,
  rosterProgram = false;
act("edit-program-roster", () => {
  rosterProgram = true;
  $("#modal").close();
  page = "roster";
  rosterPage();
});
function rosterPage() {
  const t =
    rosterProgram && data.franchise
      ? data.franchise.teams[data.franchise.team]
      : TEAMS[rosterTeam];
  shell(
    `${head(rosterProgram ? "Program personnel" : "Official fixed roster", esc(t.school) + " " + t.mascot, "Tap an athlete for the full scouting report. Two-way selections and fatigue-based backups are automatic.", btn(rosterProgram ? "Official teams" : "Your franchise", "toggle-roster", "ghost small"))}<div class="row between section-gap"><div class="team-card">${crest(t)}<div><h3>${t.scheme}</h3><small>${t.description}</small></div></div>${
      !rosterProgram
        ? select(
            "roster-team",
            TEAMS.map((t) => [t.id, t.school]),
            rosterTeam,
          )
        : ""
    }</div><div class="panel section-gap"><div class="table-scroll"><table><thead><tr><th>#</th><th>Athlete</th><th>Pos</th><th>Class</th><th>HT / WT</th><th>SPD</th><th>STR</th><th>AWR</th><th>Scout</th></tr></thead><tbody>${t.roster.map((p) => `<tr><td>${p.number}</td><td><strong>${esc(p.name)}</strong></td><td>${p.pos}</td><td>${["", "", "", "", "", "", "", "", "", "FR", "SO", "JR", "SR"][p.grade] || p.grade}</td><td>${Math.floor(p.height / 12)}′${p.height % 12}″ / ${p.weight}</td><td>${p.ratings.speed}</td><td>${p.ratings.strength}</td><td>${p.ratings.awareness}</td><td>${btn("View", `athlete:${p.id}`, "small ghost")}</td></tr>`).join("")}</tbody></table></div></div>`,
  );
  $(".page-head .actions").insertAdjacentHTML(
    "beforeend",
    btn("Depth chart", "roster-depth", "ghost small"),
  );
  if ($("#roster-team"))
    $("#roster-team").onchange = (e) => {
      rosterTeam = +e.target.value;
      rosterPage();
    };
}
act("toggle-roster", () => {
  if (!rosterProgram && !data.franchise)
    return toast("Create a franchise first");
  rosterProgram = !rosterProgram;
  rosterPage();
});
function athlete(id) {
  const t = rosterProgram
      ? data.franchise.teams[data.franchise.team]
      : TEAMS[rosterTeam],
    p = t.roster.find((p) => p.id === id);
  modal(
    `#${p.number} ${esc(p.name)}`,
    `<p class="muted">${p.pos} • Grade ${p.grade} • ${p.height} in / ${p.weight} lb</p>${rosterProgram ? `${label("Athlete name", input("ath-name", p.name))}<div class="form-row section-gap">${label("Jersey number", input("ath-number", p.number, "number", 'min="0" max="99"'))}${label("Position", select("ath-pos", ["QB", "RB", "WR", "TE", "C", "G", "T", "DE", "DT", "LB", "CB", "S", "K", "P"], p.pos))}</div>` : ""}<div class="grid cols2 section-gap">${ATTR.map((a) => (rosterProgram ? label(a.replace(/([A-Z])/g, " $1"), input("rating-" + a, p.ratings[a], "number", 'min="20" max="99"')) : `<div class="list-row"><small>${a.replace(/([A-Z])/g, " $1")}</small><strong>${p.ratings[a]}</strong></div>`)).join("")}</div>${rosterProgram ? `${label("Individual development", select("ath-training", ["balanced", "speed", "strength", "skills"], data.franchise.trainingPlans?.[p.id] || "balanced"))}<div class="spacer"></div>${btn("Save athlete", "save-athlete", "primary")}` : '<p class="note section-gap">Official competitive ratings are fixed. Franchise ratings can be edited freely.</p>'}`,
    () => {
      if (rosterProgram)
        actions["save-athlete"] = async () => {
          p.name = $("#ath-name").value.trim() || p.name;
          p.number = clamp(+$("#ath-number").value, 0, 99);
          p.pos = $("#ath-pos").value;
          data.franchise.trainingPlans ||= {};
          data.franchise.trainingPlans[p.id] = $("#ath-training").value;
          for (const a of ATTR)
            p.ratings[a] = clamp(+$("#rating-" + a).value, 20, 99);
          await persist();
          $("#modal").close();
          rosterPage();
        };
    },
  );
}
function filmPage() {
  shell(
    `${head("Study the details", "Film room", "A good coach watches the result. A great coach studies the read.")}<div class="game-layout ${fieldExpanded ? "field-expanded" : ""}"><div><div class="stadium-wrap" style="border-radius:12px 12px 0 0;border-top:1px solid var(--line)"><canvas id="film-canvas" aria-label="Football replay"></canvas></div>${filmToolbar()}<section class="panel section-gap"><div class="panel-heading"><h3>${esc(film?.play.name || "Your film library")}</h3><span class="badge" id="film-time">${filmTime.toFixed(1)}s</span></div>${film ? `<p class="muted">${esc(film.offense.school)} vs ${esc(film.defense.school)} • ${esc(film.call.name)} • Seed ${film.seed}</p><div class="film-events">${film.events.map((e, i) => `<div class="film-event" data-act="event:${i}" tabindex="0" role="button"><time>${e.t.toFixed(1)}s</time><span>${esc(e.text)}</span></div>`).join("")}</div>` : '<div class="empty">Run a play on gameday or in practice to start your film library.</div>'}</section></div><aside class="panel"><h3>Saved snaps</h3><div class="film-events section-gap">${filmIndex.map((f, i) => `<button class="play-card ${i === filmPick ? "active" : ""}" style="width:100%;margin-bottom:8px;text-align:left" data-act="film:${i}"><div><h4>${esc(f.title)}</h4><small>${esc(f.school)} • ${esc(f.result)} • ${Math.round(f.yards)} yd</small></div></button>`).join("") || '<p class="muted">No saved film yet.</p>'}</div></aside></div>`,
  );
  mountStadium("film-canvas", false, filmTime);
  $("#scrub").oninput = (e) => {
    stadium.playing = false;
    stadium.seek(+e.target.value);
  };
}
let connecting = false;
function friendsPage() {
  shell(
    `${head("Private competition", "Friends under lights", "One coach on offense. One automatic defense. No need to be online together.", user ? btn("Refresh games", "refresh-matches", "ghost small") : "")}<div class="grid cols2">${
      !user
        ? `<section class="panel"><div class="kicker">Existing Firebase project</div><h3>Sign in to the locker room</h3><p class="muted">Franchise and practice work on this device without an account. Sign in for friend games and cloud backups.</p><div class="form-stack">${label("Email", input("auth-email", "", "email", 'autocomplete="email"'))}${label("Password", input("auth-password", "", "password", 'autocomplete="current-password" minlength="6"'))}<div class="row">${btn(connecting ? "Connecting…" : "Sign in", "login", "primary", connecting ? "disabled" : "")}${btn("Create account", "register", "ghost", connecting ? "disabled" : "")}</div>${btn("Continue with Google", "google", "ghost")}${btn("Reset password", "reset-password", "small ghost")}</div><div class="note section-gap">${esc(matchesError || "Email/password and Google must be enabled in Firebase Authentication. Add your GitHub Pages domain to authorized domains.")}</div></section>`
        : `<section class="panel"><div class="kicker">${esc(user.email || "Coach account")}</div><h3>Make the matchup</h3><div class="form-stack section-gap">${label(
            "Your official team",
            select(
              "friend-team",
              TEAMS.map((t) => [t.id, t.school]),
              data.team,
            ),
          )}${label("Coach display name", input("coach-name", user.displayName || user.email?.split("@")[0] || "Coach"))}<div class="row">${btn("Create friend game", "create-match", "primary")}${btn("Join with code", "join-dialog", "ghost")}</div><p class="note">Your current offensive and defensive playbooks are copied into the match. Defensive calls stay locked for that game.</p><div class="row">${btn("Cloud backup", "cloud-save", "small")}${btn("Restore cloud backup", "cloud-load", "small")}${btn("Sign out", "logout", "small ghost")}${btn("Pending turn", "pending-turn", "small ghost")}</div></div></section>`
    }<section class="panel"><h3>Your games</h3>${matchesError ? `<p class="error">${esc(matchesError)}</p>` : ""}${!user ? '<p class="muted">Sign in to see your friend games.</p>' : matches.length ? matches.map((m) => `<div class="list-row"><div><strong>${esc(m.game.teams[0].school)} / ${esc(m.game.teams[1].school)}</strong><br><small>${m.status === "waiting" ? "Invite code: " + m.code : m.status === "complete" ? "FINAL " + m.game.score.join(" – ") : m.turn === user.uid ? "● YOUR OFFENSIVE TURN" : "Friend on offense"}</small></div>${btn(m.status === "waiting" ? "Open lobby" : "Open", `match:${m.code}`, "small")}</div>`).join("") : '<p class="muted">No games yet. Create a matchup and share its join code.</p>'}${user ? btn("Private league leaderboard", "leaderboard", "ghost small") : ""}</section></div>`,
  );
}
async function ensureCloud() {
  if (user) return;
  connecting = true;
  await cloud.connect((u) => {
    user = u;
    connecting = false;
    cloudStatus = u ? "Cloud connected" : "Local saves ready";
    if (u) {
      cloud.recover().catch(error);
      initializeCloudProfile().catch(error);
      refreshMatches().catch(error);
    }
    if (page === "friends" || page === "settings") render();
  });
}
async function authenticate(register = false, google = false) {
  const email = $("#auth-email")?.value,
    password = $("#auth-password")?.value;
  try {
    if (!user) {
      connecting = true;
      await ensureCloud();
    }
    if (google) await cloud.googleLogin();
    else await cloud.login(email, password, register);
  } catch (e) {
    connecting = false;
    matchesError = e.message;
    error(e);
    friendsPage();
  }
}
act("login", () => authenticate());
act("register", () => authenticate(true));
act("google", () => authenticate(false, true));
act("reset-password", async () => {
  const email = $("#auth-email").value;
  if (!email) return toast("Enter your email first");
  try {
    await ensureCloud();
    await cloud.resetPassword(email);
    toast("Password reset email requested");
  } catch (e) {
    error(e);
  }
});
act("logout", async () => {
  clearTimeout(cloudSaveTimer);
  cloudReady = false;
  await cloud.logout();
  matches = [];
  live = null;
  unwatch?.();
  friendsPage();
});
async function refreshMatches() {
  if (!user) return;
  try {
    matches = await cloud.listMatches();
    matchesError = "";
    if (page === "friends") friendsPage();
    else if (page === "home") home();
  } catch (e) {
    matchesError = e.message;
    if (page === "friends") friendsPage();
    else if (page === "home") home();
  }
}
act("refresh-matches", refreshMatches);
act("create-match", async () => {
  if (busy) return;
  busy = true;
  const team = +$("#friend-team").value,
    name = $("#coach-name").value;
  try {
    const g = newGame(
      team,
      (team + 1) % 8,
      crypto.getRandomValues(new Uint32Array(1))[0],
    );
    g.defenses[0] = clone(data.defense);
    g.teams[0].depth = clone(data.depthCharts[team] || {});
    const code = await cloud.createMatch(g, data.book, name);
    busy = false;
    await openMatch(code);
  } catch (e) {
    busy = false;
    error(e);
  }
});
act("join-dialog", () => {
  const team = +$("#friend-team").value,
    name = $("#coach-name").value;
  modal(
    "Join a friend game",
    `<div class="form-stack">${label("Join code", input("join-code", "", "text", 'autocapitalize="characters" spellcheck="false"'))}${label(
      "Your official team",
      select(
        "join-team",
        TEAMS.map((t) => [t.id, t.school]),
        team,
      ),
    )}${label("Coach name", input("join-name", name))}${btn("Join game", "confirm-join", "primary")}</div>`,
  );
});
act("confirm-join", async () => {
  if (busy) return;
  busy = true;
  try {
    const code = await cloud.joinMatch(
      $("#join-code").value,
      {
        ...clone(TEAMS[+$("#join-team").value]),
        depth: clone(data.depthCharts[+$("#join-team").value] || {}),
      },
      data.book,
      data.defense,
      $("#join-name").value,
    );
    busy = false;
    $("#modal").close();
    await openMatch(code);
  } catch (e) {
    busy = false;
    error(e);
  }
});
async function openMatch(code) {
  unwatch?.();
  mode = "multiplayer";
  film = null;
  showCall = true;
  lastFilm = null;
  filmTime = 0;
  filmAuto = false;
  viewing = false;
  page = "friends";
  shell('<div class="loading">Opening the locker room…</div>');
  unwatch = cloud.watchMatch(
    code,
    async (m) => {
      const previous = live?.seq;
      live = m;
      game = clone(m.game);
      human = m.members.indexOf(user.uid);
      if (human < 0) {
        unwatch?.();
        return toast("You are not a coach in this game");
      }
      if (m.status === "waiting") {
        page = "friends";
        shell(
          `${head("Friend game / Lobby", "Waiting for your opponent")}<div class="panel"><div class="kicker">Share this join code</div><h3 style="font-size:30px;letter-spacing:.12em;overflow-wrap:anywhere">${esc(m.code)}</h3><p class="muted">Your friend signs in, chooses Join with code, and selects an official school.</p><div class="row">${btn("Copy code", "copy-code", "primary")}${btn("Back to games", "nav:friends", "ghost")}</div></div>`,
        );
      } else {
        if (!busy && !viewing) {
          if (m.seq && previous !== m.seq) {
            const f = await cloud.cloudFilm(code, m.seq);
            if (f) {
              film = f;
              filmTime = 0;
              filmAuto = false;
              await storeFilm(f);
            }
          }
          if (page === "friends" || page === "game") {
            page = "game";
            gamePage();
          }
        }
      }
    },
    (e) => {
      matchesError = e.message;
      error(e);
      friendsPage();
    },
  );
}
act("copy-code", async () => {
  try {
    await navigator.clipboard.writeText(live.code);
    toast("Join code copied");
  } catch {
    toast("Select and copy the code shown above");
  }
});
act("leaderboard", async () => {
  try {
    const rows = await cloud.leaderboard();
    modal(
      "Private league leaderboard",
      `<div class="table-scroll"><table><thead><tr><th>Coach</th><th>W</th><th>L</th><th>Win %</th><th>PF</th><th>PA</th><th>Yards</th><th>TO</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${Math.round((r.wins / (r.wins + r.losses)) * 100)}%</td><td>${r.pf}</td><td>${r.pa}</td><td>${r.yards}</td><td>${r.turnovers}</td></tr>`).join("") || '<tr><td colspan="8">Complete a friend game to establish your record.</td></tr>'}</tbody></table></div><p class="note">Records are derived from completed friend games. Franchise results never enter these standings.</p>`,
    );
  } catch (e) {
    error(e);
  }
});
act("cloud-save", async () => {
  try {
    await persist();
    cloudRevision = await cloud.cloudSave(data);
    cloudReady = true;
    data.cloudOwner = user.uid;
    data.cloudRevision = cloudRevision;
    await save("profile", data);
    toast("Cloud profile saved");
  } catch (e) {
    error(e);
  }
});
act("cloud-load", async () => {
  try {
    const d = await cloud.cloudLoad();
    if (!d) return toast("No cloud backup yet");
    modal(
      "Restore cloud backup?",
      `<p>This replaces your local playbooks, franchise, and saved game with your account’s cloud backup. Film remains stored on its original device.</p>${btn("Restore backup", "confirm-cloud-load", "primary")}`,
      () => {
        actions["confirm-cloud-load"] = async () => {
          data = { ...d, filmIds: filmIndex };
          data.books ||= [
            {
              id: "varsity",
              name: "Varsity playbook",
              plays: clone(data.book),
            },
          ];
          data.activeBook ||= "varsity";
          data.depthCharts ||= {};
          data.settings.autoCloud ??= true;
          data.cloudOwner = user.uid;
          const env = await cloud.cloudEnvelope();
          cloudRevision = env?.revision || 0;
          data.cloudRevision = cloudRevision;
          cloudReady = true;
          game = data.game;
          mode = data.mode || "exhibition";
          human = data.human || 0;
          await persist();
          $("#modal").close();
          render();
          toast("Cloud backup restored");
        };
      },
    );
  } catch (e) {
    error(e);
  }
});
function settingsPage() {
  shell(
    `${head("Make it yours", "Settings & saves", "Your playbooks and franchise save on this device. Keep a backup for switching phones or browsers.")}<div class="grid cols2"><section class="panel form-stack"><h3>Save management</h3>${label("Automatically save my signed-in profile", `<input id="auto-cloud" type="checkbox" ${data.settings.autoCloud ? "checked" : ""}>`, "inline")}<small id="cloud-save-state">${esc(cloudSaveState)}</small><p class="muted">An installed app and another browser can have separate device storage. Use the same signed-in account and cloud backup to move your program between them.</p><div class="row">${btn("Export full backup", "export-save", "primary")}<label>Restore backup<input id="import-save" type="file" accept=".json,application/json"></label></div><div class="row">${user ? btn("Cloud backup", "cloud-save") + btn("Restore cloud", "cloud-load") : btn("Sign in for cloud saves", "nav:friends")}</div><span class="save-state">Saved on this device</span><h3 class="section-gap">Playback</h3>${label("Assignment overlays", `<input id="setting-overlay" type="checkbox" ${data.settings.overlays ? "checked" : ""}>`, "inline")}<p class="note">Live friend turns require a connection. If a submission disconnects, reopen the app and sign in; the pending transaction is retried with the same sequence.</p></section><section class="panel"><h3>Coach’s field guide</h3><div class="list-row"><strong>Play designer</strong><small>Align → assign → route → reads → save</small></div><div class="list-row"><strong>Motion & shifts</strong><small>Draw pre-snap paths in the board tools</small></div><div class="list-row"><strong>Film</strong><small>Pause, scrub, and tap a decision event</small></div><div class="list-row"><strong>Franchise</strong><small>Ten weeks, semifinals, championship</small></div><p class="note">NFHS-style default: 12-minute quarters, 40/25 play clock, tries at the 3, kickoffs at the 40, paired overtime possessions at the opponent’s 10. This engine is an approximation; see IMPLEMENTATION.md for the implemented rules and remaining limitations.</p><p><a href="README.md" target="_blank" rel="noopener">Deployment guide ↗</a> · <a href="IMPLEMENTATION.md" target="_blank" rel="noopener">Implementation details ↗</a></p><small>Fresh source • ${VERSION}</small></section></div>`,
  );
  $("#auto-cloud").onchange = (e) => {
    data.settings.autoCloud = e.target.checked;
    autoSave();
  };
  $("#setting-overlay").onchange = (e) => {
    data.settings.overlays = e.target.checked;
    autoSave();
  };
  $("#import-save").onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (
        ![VERSION, "hsf-1.0.0"].includes(d.version) ||
        !Array.isArray(d.book) ||
        !Array.isArray(d.defense) ||
        d.book.some((p) => p.slots?.length !== 11)
      )
        throw Error("Not a compatible HS Football backup");
      data = d;
      game = d.game;
      mode = d.mode || "exhibition";
      human = d.human || 0;
      data.filmIds = filmIndex;
      const active = data.books?.find((b) => b.id === data.activeBook);
      if (active) active.plays = clone(data.book);
      data.updatedAt = Date.now();
      await persist();
      render();
      toast("Backup restored");
    } catch (e) {
      error(e);
    }
  };
}
act("export-save", async () => {
  await persist();
  download("HS-Football-Full-Backup.json", data);
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const key = b.dataset.act;
  try {
    if (actions[key]) return await actions[key]();
    const [type, ...parts] = key.split(":"),
      id = parts.join(":");
    if (type === "nav") return navigate(id);
    if (type === "team") {
      data.team = +id;
      rosterTeam = +id;
      await persist();
      $("#modal").close();
      render();
      toast(TEAMS[+id].school + " selected");
    } else if (type === "filter") {
      filter = id;
      playbook();
    } else if (type === "edit" || type === "edit-defense") {
      editDef = type === "edit-defense";
      edit = clone(
        (editDef ? data.defense : data.book).find((p) => p.id === id),
      );
      slotId = editDef ? "D0" : "X";
      tool = "align";
      undo = [];
      designer();
    } else if (type === "duplicate") {
      const p = clone(data.book.find((p) => p.id === id));
      p.id = uid();
      p.name += " Copy";
      data.book.push(p);
      await persist();
      playbook();
    } else if (type === "delete" || type === "delete-defense") {
      const a = type === "delete" ? data.book : data.defense;
      if (a.length <= 1) return toast("Keep at least one play");
      const i = a.findIndex((p) => p.id === id);
      a.splice(i, 1);
      await persist();
      render();
    } else if (type === "remove-point") {
      readPoints();
      edit.slots.find((s) => s.id === slotId).path.splice(+id, 1);
      pathPoints();
    } else if (type === "record") {
      const f = data.franchise,
        r = f.records[+id],
        away = r.home === f.team ? r.opponent : f.team;
      boxScore({
        teams: [
          {
            ...f.teams[r.home],
            roster: r.athletes?.[0] || f.teams[r.home].roster,
          },
          { ...f.teams[away], roster: r.athletes?.[1] || f.teams[away].roster },
        ],
        score: r.score,
        stats: r.stats,
        drives: r.drives,
        scoreLine: r.scoreLine?.length ? r.scoreLine : undefined,
        history: [],
        final: true,
        possession: 0,
      });
    } else if (type === "built-formation") {
      checkpoint();
      edit = applyFormation(edit, id);
      $("#modal").close();
      designer();
    } else if (type === "front") {
      checkpoint();
      edit = defensiveTemplate(edit, id);
      $("#modal").close();
      designer();
    } else if (type === "remove-rule") {
      readLogic();
      edit.rules.splice(+id, 1);
      logicEditor();
    } else if (type === "slot") {
      slotId = id;
      designer();
    } else if (type === "tool") {
      tool = id;
      designer();
    } else if (type === "formation") {
      const f = data.formations.find((f) => f.id === id);
      checkpoint();
      for (const s of edit.slots) {
        const q = f.slots.find((q) => q.id === s.id);
        if (q) Object.assign(s, clone(q));
      }
      edit.formation = f.name;
      $("#modal").close();
      designer();
    } else if (type === "call-category") {
      callCategory = id;
      gamePage();
    } else if (type === "call") {
      selected = id;
      adjusted = null;
      showCall = true;
      film = null;
      filmTime = 0;
      filmAuto = false;
      gamePage();
    } else if (type === "athlete") athlete(id);
    else if (type === "film") {
      filmPick = +id;
      film = await load(filmIndex[filmPick].id);
      filmTime = 0;
      filmAuto = false;
      filmPage();
    } else if (type === "event") {
      stadium.playing = false;
      stadium.seek(film.events[+id].t);
    } else if (type === "match") await openMatch(id);
  } catch (e) {
    error(e);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches('[role="button"][data-act]'))
    e.target.click();
});
window.addEventListener("online", () => {
  cloudStatus = "Connection restored";
  if (user) {
    cloud.recover().catch(error);
    initializeCloudProfile().then(queueCloudSave).catch(error);
  }
});
window.addEventListener("offline", () => {
  cloudStatus = "Offline • local modes ready";
  toast("Offline. Friend turns will wait for a connection.");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    persist().catch(error);
    if (edit) {
      clearTimeout(draftTimer);
      designerDraft = { play: clone(edit), defense: editDef, slot: slotId };
      save("designerDraft", designerDraft).catch(error);
    }
  }
});
// Restore local context independently of an active friend match.
mode = data.mode || "exhibition";
human = data.human || 0;
render();
if (navigator.onLine)
  ensureCloud().catch((e) => {
    connecting = false;
    cloudStatus = "Local saves ready";
    matchesError = e.message;
  });
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      const notice = () =>
        toast(
          "Update ready. Close all HS Football windows and reopen to install it.",
        );
      if (reg.waiting) notice();
      reg.addEventListener("updatefound", () =>
        reg.installing?.addEventListener("statechange", () => {
          if (reg.waiting && navigator.serviceWorker.controller) notice();
        }),
      );
    })
    .catch(() => {});
// Install tools preserve the approved field and expose the existing simulation settings.
act("formation-library", () =>
  modal(
    "Formation library",
    `<div class="grid cols2">${FORMATIONS.map((name) => btn(esc(name), `built-formation:${name}`, "ghost")).join("")}</div><p class="note section-gap">Routes move with each athlete. Check receiver eligibility after changing personnel or alignment.</p>`,
  ),
);
act("defense-templates", () =>
  modal(
    "Defensive front",
    `<div class="grid cols2">${["4–3", "3–4", "5–2", "4–4"].map((name) => btn(name, `front:${name}`, "ghost")).join("")}</div>`,
  ),
);
function logicEditor() {
  edit.rules ||= [];
  modal(
    "Quarterback conditional logic",
    `<p class="muted">Rules evaluate live defender positions, movement and receiver separation. Awareness and intelligence affect recognition. Earlier rules have priority.</p><div class="form-stack">${edit.rules
      .map(
        (r, i) =>
          `<div class="panel"><div class="row between"><h4>Rule ${i + 1}</h4>${btn("Remove", `remove-rule:${i}`, "small danger")}</div><div class="grid cols2 section-gap">${label("When", select(`logic-when-${i}`, Object.entries(CONDITIONS), r.when))}${label("Then", select(`logic-action-${i}`, Object.entries(LOGIC_ACTIONS), r.action))}${label("Receiver", select(`logic-target-${i}`, ["X", "Y", "Z", "H", "RB"], r.target))}${label(
            "Read defender",
            select(
              `logic-defender-${i}`,
              Array.from({ length: 11 }, (_, i) => `D${i}`),
              r.defender,
            ),
          )}${label("Threshold (yards / seconds / count)", input(`logic-threshold-${i}`, r.threshold, "number", 'min="0.5" max="10" step="0.5"'))}${label("Overload side", select(`logic-side-${i}`, ["left", "right"], r.side))}</div></div>`,
      )
      .join(
        "",
      )}<div class="row">${btn("+ Add rule", "add-rule", "ghost")}${btn("Apply logic", "apply-logic", "primary")}</div></div>`,
  );
}
function readLogic() {
  (edit.rules || []).forEach((r, i) => {
    for (const k of [
      "when",
      "action",
      "target",
      "defender",
      "threshold",
      "side",
    ]) {
      const el = $(`#logic-${k}-${i}`);
      if (el) r[k] = k === "threshold" ? +el.value : el.value;
    }
  });
}
act("logic-editor", () => {
  checkpoint();
  logicEditor();
});
act("add-rule", () => {
  readLogic();
  if (edit.rules.length >= 12)
    return toast("Twelve conditional rules per play");
  edit.rules.push({
    id: uid(),
    when: "blitz",
    action: "hot",
    target: "H",
    defender: "D3",
    threshold: 2,
    side: "right",
  });
  logicEditor();
});
act("apply-logic", () => {
  readLogic();
  $("#modal").close();
  toast("Conditional logic applied to this install");
});
act("new-book", () =>
  modal(
    "New playbook",
    `<div class="form-stack">${label("Book name", input("book-name", "New playbook"))}${label(
      "Starting point",
      select(
        "book-base",
        [
          ["current", "Copy active book"],
          ["defaults", "Default installs"],
        ],
        "current",
      ),
    )}${btn("Create book", "create-book", "primary")}</div>`,
  ),
);
act("create-book", async () => {
  const name = $("#book-name").value.trim();
  if (!name) return;
  const plays =
      $("#book-base").value === "current" ? clone(data.book) : defaults(),
    id = uid();
  data.books.push({ id, name, plays });
  data.activeBook = id;
  data.book = plays;
  await persist();
  $("#modal").close();
  playbook();
});
act("rename-book", () =>
  modal(
    "Rename playbook",
    `${label("Name", input("rename-book-name", data.books.find((b) => b.id === data.activeBook)?.name))}<div class="spacer"></div>${btn("Save name", "save-book-name", "primary")}`,
  ),
);
act("save-book-name", async () => {
  const b = data.books.find((b) => b.id === data.activeBook);
  b.name = $("#rename-book-name").value.trim() || b.name;
  await persist();
  $("#modal").close();
  playbook();
});
function scoutModal(t) {
  const report = scout(t);
  modal(
    t.school + " scouting report",
    `<div class="team-card">${crest(t)}<div><h3>${esc(t.scheme)}</h3><small>${esc(t.description)}</small></div></div><div class="stat-grid section-gap">${Object.entries(
      report.ratings,
    )
      .map(
        ([k, v]) =>
          `<div><div class="big-num">${v}</div><small>${k.toUpperCase()}</small></div>`,
      )
      .join(
        "",
      )}</div><div class="section-gap">${report.tips.map((t) => `<p class="note">${t}</p>`).join("")}</div>`,
  );
}
act("scout-game", () => scoutModal(game.teams[1 - game.possession]));
act("scout-next", () => {
  const f = data.franchise,
    m = matchup(f);
  if (m) scoutModal(f.teams[m.home === f.team ? m.away : m.home]);
});
function depthChart(program = false) {
  const t = program
      ? data.franchise.teams[data.franchise.team]
      : TEAMS[rosterTeam],
    chart = program ? (t.depth ||= {}) : (data.depthCharts[t.id] ||= {}),
    slots = [
      ...baseSlots().map((s) => ({ ...s, unit: "offense" })),
      ...defenseDefaults()[0].slots.map((s) => ({ ...s, unit: "defense" })),
    ];
  modal(
    t.school + " depth chart",
    `<p class="muted">Choose starters or leave Auto. Fatigued starters rotate to available reserves. The same athlete may start on both units.</p><div class="form-stack">${slots.map((s) => label(s.unit.toUpperCase() + " / " + s.id + " · " + s.pos, select("depth-" + s.id, [["", "Auto • best available"], ...t.roster.map((p) => [p.id, `#${p.number} ${p.name} (${p.pos})`])], chart[s.unit]?.[s.id] || ""))).join("")}${btn("Save depth chart", "save-depth", "primary")}</div>`,
    () => {
      actions["save-depth"] = async () => {
        const next = { offense: {}, defense: {} };
        for (const s of slots) next[s.unit][s.id] = $("#depth-" + s.id).value;
        for (const unit of ["offense", "defense"]) {
          const ids = Object.values(next[unit]).filter(Boolean);
          if (new Set(ids).size !== ids.length)
            return toast("Each athlete can fill one starting slot per unit");
        }
        if (program) t.depth = next;
        else data.depthCharts[t.id] = next;
        await persist();
        $("#modal").close();
        toast("Depth chart saved");
      };
    },
  );
}
act("program-depth", () => depthChart(true));
act("roster-depth", () => depthChart(rosterProgram));
function leadersModal(career = false) {
  const f = data.franchise,
    stats = career ? f.careerStats : f.seasonStats;
  const rows = leaders(f.teams, stats, leaderCategory);
  modal(
    career ? "Career records" : "District season leaders",
    `${select(
      "leader-category",
      [
        ["passYards", "Passing yards"],
        ["rushYards", "Rushing yards"],
        ["receivingYards", "Receiving yards"],
        ["td", "Touchdowns"],
        ["tackles", "Tackles"],
        ["sacks", "Sacks"],
        ["defInts", "Interceptions"],
        ["blocks", "Blocks"],
      ],
      leaderCategory,
    )}<div class="table-scroll section-gap"><table><thead><tr><th>Athlete</th><th>School</th><th>Total</th></tr></thead><tbody>${rows.map((p) => `<tr><td>#${p.number} ${esc(p.name)}</td><td>${esc(p.school)}</td><td>${p.total}</td></tr>`).join("") || '<tr><td colspan="3">No recorded production in this category yet.</td></tr>'}</tbody></table></div>`,
    () => {
      $("#leader-category").onchange = (e) => {
        leaderCategory = e.target.value;
        leadersModal(career);
      };
    },
  );
}
let leaderCategory = "passYards";
act("season-leaders", () => leadersModal());
act("career-records", () => leadersModal(true));
act("alumni", () => {
  const f = data.franchise;
  modal(
    "Program alumni",
    `<div class="table-scroll"><table><thead><tr><th>Class</th><th>Athlete</th><th>School</th><th>Career yards</th></tr></thead><tbody>${
      (f.graduation || [])
        .filter((p) => p.school === f.teams[f.team].school)
        .slice()
        .reverse()
        .map(
          (p) =>
            `<tr><td>${p.year}</td><td>${esc(p.name)}</td><td>${esc(p.school)}</td><td>${p.career?.yards || 0}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="4">Your first senior class has not graduated yet.</td></tr>'
    }</tbody></table></div>`,
  );
});

function queueCloudSave() {
  clearTimeout(cloudSaveTimer);
  if (!user || !cloudReady || !data.settings.autoCloud) return;
  cloudSaveState = "Cloud save queued";
  cloudSaveTimer = setTimeout(flushCloudProfile, 1800);
}
async function initializeCloudProfile() {
  if (!user) return;
  const env = await cloud.cloudEnvelope();
  if (!env) {
    cloudRevision = 0;
    cloudReady = true;
    data.cloudOwner = user.uid;
    queueCloudSave();
    return;
  }
  if (
    (!localProfileExists && !data.updatedAt) ||
    (data.cloudOwner === user.uid && data.cloudRevision === env.revision)
  ) {
    cloudRevision = env.revision;
    cloudReady = true;
    if (!localProfileExists && !data.updatedAt) {
      data = { ...env.data, filmIds: filmIndex };
      data.cloudOwner = user.uid;
      data.cloudRevision = env.revision;
      game = data.game;
      data.books ||= [
        { id: "varsity", name: "Varsity playbook", plays: clone(data.book) },
      ];
      data.activeBook ||= "varsity";
      data.depthCharts ||= {};
      await save("profile", data);
      if (page !== "game") render();
    }
    return;
  }
  cloudReady = false;
  cloudSaveState =
    "Cloud copy available — use Restore cloud backup before automatic syncing";
  if (page === "settings" || page === "friends") render();
}
async function flushCloudProfile() {
  if (cloudSaving || !cloudReady || !user || !navigator.onLine) return;
  cloudSaving = true;
  const owner = user.uid,
    snapshot = clone(data);
  try {
    const revision = await cloud.cloudSave(snapshot, cloudRevision);
    if (user?.uid === owner) {
      cloudRevision = revision;
      data.cloudRevision = revision;
      data.cloudOwner = owner;
      await save("profile", data);
      cloudSaveState = "Cloud saved";
      if (data.updatedAt !== snapshot.updatedAt) queueCloudSave();
    }
  } catch (e) {
    cloudSaveState = e.message;
    cloudReady = false;
    toast("Cloud profile not overwritten: " + e.message);
  } finally {
    cloudSaving = false;
    const el = $("#cloud-save-state");
    if (el) el.textContent = cloudSaveState;
  }
}
act("pending-turn", async () => {
  const p = await cloud.pendingTurn();
  modal(
    "Pending offensive turn",
    p
      ? `<p>A snap for game ${esc(p.code)} at sequence ${p.expectedSeq + 1} is waiting for confirmation. Retry uses the same turn, seed, and replay.</p><div class="row">${btn("Retry submission", "retry-pending", "primary")}${btn("Discard local attempt", "discard-pending", "danger")}</div>`
      : "<p>No unconfirmed offensive turn.</p>",
  );
});
act("retry-pending", async () => {
  await cloud.recover();
  $("#modal").close();
  await refreshMatches();
  toast("Turn recovered");
});
act("discard-pending", async () => {
  await cloud.discardPending();
  $("#modal").close();
  toast("Local attempt discarded. Saved server turns remain intact.");
});

act("practice-setup", () =>
  modal(
    "Practice situation",
    `<div class="form-stack">${label(
      "Opponent",
      select(
        "practice-opponent",
        TEAMS.map((t) => [t.id, t.school]),
        game.teams[1].id,
      ),
    )}${label("Defensive install", select("practice-defense", [["auto", "Automatic coordinator"], ...data.defense.map((d) => [d.id, d.name])], game.practiceCall?.id || "auto"))}<div class="form-row">${label("Ball (own yard line)", input("practice-ball", game.ball, "number", 'min="1" max="99"'))}${label("Down", select("practice-down", [1, 2, 3, 4], game.down))}${label("Yards to gain", input("practice-distance", game.distance, "number", 'min="1" max="30"'))}${label("Seed", input("practice-seed", game.seed, "number", 'min="1"'))}</div>${btn("Set situation", "save-practice", "primary")}</div>`,
  ),
);
act("save-practice", async () => {
  game.teams[1] = clone(TEAMS[+$("#practice-opponent").value]);
  game.practiceCall = data.defense.find(
    (d) => d.id === $("#practice-defense").value,
  )
    ? clone(data.defense.find((d) => d.id === $("#practice-defense").value))
    : null;
  game.ball = clamp(+$("#practice-ball").value, 1, 99);
  game.down = +$("#practice-down").value;
  game.distance = Math.min(
    clamp(+$("#practice-distance").value, 1, 30),
    100 - game.ball,
  );
  game.line = game.ball + game.distance;
  game.seed = +$("#practice-seed").value >>> 0;
  film = null;
  showCall = true;
  await persist();
  $("#modal").close();
  gamePage();
});
act("practice-study", async () => {
  if (busy) return;
  busy = true;
  toast("Running twenty independent snaps in the practice worker…");
  try {
    const runs = await compute({
      type: "lab",
      game,
      play: clone(adjusted || currentPlay()),
      count: 20,
      seed: hash(`${game.seed}-${game.seq}`),
    });
    const valid = runs.filter((r) => !r.result.penalty),
      avg =
        valid.reduce((s, r) => s + r.result.yards, 0) /
        Math.max(1, valid.length),
      comps = valid.filter((r) => r.result.complete).length,
      ints = valid.filter((r) => r.result.intercepted).length,
      sacks = valid.filter((r) => r.result.reason === "sack").length;
    modal(
      "Practice study · " + esc(currentPlay().name),
      `<p class="muted">Twenty independent simulated snaps from this exact situation. No team-fit multipliers. Results are observations, not guaranteed predictions.</p><div class="stat-grid"><div><div class="big-num">${avg.toFixed(1)}</div><small>Mean yards</small></div><div><div class="big-num">${comps}</div><small>Completions</small></div><div><div class="big-num">${ints}</div><small>Interceptions</small></div><div><div class="big-num">${sacks}</div><small>Sacks</small></div></div><div class="film-events section-gap">${runs.map((r, i) => `<div class="list-row"><small>SNAP ${i + 1}</small><span>${esc(r.result.penalty?.name || r.result.reason)} · ${Math.round(r.result.yards)} yd</span></div>`).join("")}</div>`,
    );
  } catch (e) {
    error(e);
  } finally {
    busy = false;
  }
});
act("editor-redo", () => {
  if (!redo.length) return;
  undo.push(clone(edit));
  edit = redo.pop();
  designer();
});
function pathPoints() {
  const s = edit.slots.find((s) => s.id === slotId);
  modal(
    s.id + " path points",
    `<p class="muted">Coordinates are field yards, measured from the ball. Positive depth goes toward the opponent’s end zone.</p><div class="form-stack">${(s.path || []).map(([x, y], i) => `<div class="row"><strong>${i + 1}</strong><div style="flex:1">${label("Lateral", input("path-x-" + i, x, "number", 'step="0.5" min="-26" max="26"'))}</div><div style="flex:1">${label("Depth", input("path-y-" + i, y, "number", 'step="0.5" min="-20" max="90"'))}</div>${btn("✕", `remove-point:${i}`, "small danger")}</div>`).join("")}<div class="row">${btn("+ Break point", "add-point", "ghost")}${btn("Apply path", "apply-points", "primary")}</div></div>`,
  );
}
function readPoints() {
  const s = edit.slots.find((s) => s.id === slotId);
  s.path = (s.path || []).map((p, i) => [
    clamp(+$("#path-x-" + i).value, -26, 26),
    clamp(+$("#path-y-" + i).value, -20, 90),
  ]);
}
act("path-points", () => {
  checkpoint();
  pathPoints();
});
act("add-point", () => {
  readPoints();
  const s = edit.slots.find((s) => s.id === slotId),
    last = s.path?.at(-1) || [s.x, s.y];
  s.path ||= [];
  s.path.push([last[0], last[1] + 5]);
  pathPoints();
});
act("apply-points", () => {
  readPoints();
  $("#modal").close();
  designer();
});

act("export-film", () => {
  if (!film) return toast("Select a completed snap first");
  download("HS-Football-Film-" + film.seed + ".json", film);
});

act("coach-notes", () => {
  if (!film?.result) return toast("Run a play to review its decisions");
  if (viewing) return toast("Coach notes open after the whistle");
  modal(
    "Coach’s film review",
    `<p class="muted">${esc(film.play.name)} • ${esc(film.call.name)}</p><div class="form-stack">${analyzeFilm(
      film,
    )
      .map(
        (n) =>
          `<section class="note"><strong>${esc(n.title)}</strong><p>${esc(n.detail)}</p></section>`,
      )
      .join("")}</div>`,
  );
});
act("field-view", () => {
  const wrap = document.querySelector(".game-layout");
  if (!wrap) return;
  const expanded = wrap.classList.toggle("field-expanded");
  fieldExpanded = expanded;
  const button = document.querySelector('[data-act="field-view"]');
  if (button) button.textContent = expanded ? "Exit field view" : "Field view";
  stadium?.resize();
});
