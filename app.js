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
import { newGame, advance, aiPlay, timeout } from "./rules.js";
import {
  createFranchise,
  standings,
  matchup,
  franchiseGame,
  nextYear,
  reschedule,
} from "./franchise.js";
import { load, save, download } from "./storage.js";
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
let data = await load("profile", {
  version: VERSION,
  team: 1,
  book: defaults(),
  defense: defenseDefaults(),
  formations: [],
  filmIds: [],
  franchise: null,
  game: null,
  settings: { overlays: false, skipDefense: false, speed: 1 },
});
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
    await save("profile", data);
    dirty = false;
    document
      .querySelectorAll(".save-state")
      .forEach((e) => (e.textContent = "Saved on this device"));
  } catch (e) {
    toast("Save failed: " + e.message);
  }
}
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 200);
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
    `<div class="shell"><aside class="sidebar"><div class="brand">HS<span>FOOTBALL</span><small>THE COACH'S BOX</small></div><nav class="side-nav" aria-label="Main navigation">${nav.map(([id, icon, text]) => btn(`<span class="symbol">${icon}</span>${text}`, `nav:${id}`, page === id ? "active" : "")).join("")}</nav><div class="sidebar-footer"><div class="dot" style="display:inline-block"></div> FRIDAY NIGHT, EVERY NIGHT<br><span class="save-state">${dirty ? "Saving…" : "Saved on this device"}</span><br>Engine ${VERSION}</div></aside><main class="main"><header class="topbar"><div class="mobile-brand brand">HS<span>FOOTBALL</span></div><div class="breadcrumb">The Coach's Box / ${nav.find((n) => n[0] === page)?.[2]}</div><div class="status"><i class="dot"></i>${esc(user ? "Signed in • " + (user.displayName || user.email?.split("@")[0]) : cloudStatus)}</div></header>${content}</main></div>`;
}
function render() {
  if (page === "home") home();
  else if (page === "game") gamePage();
  else if (page === "playbook") edit ? designer() : playbook();
  else if (page === "defense") edit && editDef ? designer() : defensePage();
  else if (page === "franchise") franchisePage();
  else if (page === "friends") friendsPage();
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
function playbook() {
  shell(
    `${head("The install", "Offensive playbook", `${data.book.length} plays • Tap a play to edit every assignment.`, btn("Team fit", "fit", "ghost") + btn("+ New play", "new-play", "primary"))}<div class="tabs">${["all", "pass", "run", "option", "rpo", "qb"].map((k) => btn(k === "all" ? "All concepts" : k.toUpperCase(), `filter:${k}`, filter === k ? "active small" : "small")).join("")}${btn("Import / export", "book-transfer", "small ghost")}</div><div class="grid cols3">${data.book
      .filter(
        (p) =>
          filter === "all" ||
          (filter === "option"
            ? ["option", "triple"].includes(p.kind)
            : p.kind === filter),
      )
      .map(
        (p) =>
          `<section class="panel"><div class="row">${mini(p)}<div><div class="kicker">${esc(p.formation)} / ${p.kind}</div><h3>${esc(p.name)}</h3></div></div><p class="muted" style="font-size:11px">${esc(p.concept)}${p.tags?.length ? " • " + esc(p.tags.join(", ")) : ""}</p><div class="row">${btn("Edit board", `edit:${p.id}`, "small")}${btn("Duplicate", `duplicate:${p.id}`, "small ghost")}${btn("✕", `delete:${p.id}`, "small danger", 'aria-label="Delete play"')}</div></section>`,
      )
      .join("")}</div>`,
  );
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
    `${head(editDef ? "Defensive install" : "Offensive install", esc(edit.name), "Drag alignments. Draw assignments. Tap an athlete to inspect.", btn("Back", "editor-back", "ghost") + btn("Save install", "save-play", "primary"))}<div class="designer-layout"><div><div class="designer-field"><div class="designer-tools">${(editDef ? ["align", "zone"] : ["align", "route", "motion", "shift"]).map((t) => btn(t[0].toUpperCase() + t.slice(1), `tool:${t}`, tool === t ? "active" : "")).join("")}${btn("Undo", "editor-undo", "ghost")}${btn("Clear path", "clear-path", "ghost")}</div><canvas id="board" aria-label="Touch football play designer"></canvas></div><div class="slot-pills">${edit.slots.map((s) => btn(s.id, `slot:${s.id}`, s.id === slotId ? "active" : "")).join("")}</div><div class="note" id="legality">${editDef ? "Defenders: align the front, assign coverage and pass rush, then set zone landmarks." : issues.length ? `<span class="warning">${issues.map(esc).join("<br>")}</span>` : '<span class="good">✓ Legal base alignment and receiver eligibility</span> • Every shift must be set for one second. Motion must remain lateral or backward.'}</div><div class="row section-gap">${!editDef ? btn("Save formation", "save-formation", "small") + btn("Load formation", "load-formation", "small") + btn("Test in practice", "test-play", "small primary") : ""}</div></div><aside class="panel inspector">${label("Play name", input("edit-name", edit.name), "wide")}${!editDef ? label("Concept / category", input("edit-concept", edit.concept), "wide") : label("Situational eligibility", select("edit-situation", ["any", "long", "short", "redzone"], edit.situation), "wide")}<div class="panel-heading wide"><h3>${s.id} · ${s.pos}</h3><span class="badge">Assignment</span></div>${label("Position", select("slot-pos", editDef ? ["DE", "DT", "LB", "CB", "S"] : ["T", "G", "C", "TE", "WR", "RB", "QB"], s.pos))}${label("Responsibility", select("slot-assignment", editDef ? ["rush", "stunt", "man", "zone", "deep", "contain"] : ["route", "run", "quarterback", ...BLOCKS], s.assignment))}${label("Personnel", select("slot-athlete", [["", "Auto • best fit"], ...TEAMS[data.team].roster.map((p) => [p.id, `#${p.number} ${p.name} · ${p.pos}`])], s.athlete || ""), "wide")}${label("Lateral (yards)", input("slot-x", s.x, "number", 'step="0.5" min="-26" max="26"'))}${label("Depth (yards)", input("slot-y", s.y, "number", 'step="0.5" min="-13" max="30"'))}${label(editDef ? "Man target" : "Block target", select("slot-target", editDef ? SLOT.filter((x) => !["LT", "LG", "C", "RG", "RT", "QB"].includes(x)) : ["nearest", ...Array.from({ length: 11 }, (_, i) => `D${i}`)], s.target))}${!editDef ? label("Release delay (sec)", input("slot-delay", s.delay || 0, "number", 'min="0" max="6" step="0.1"')) : label("Stunt width", input("slot-stunt", s.stunt || 0, "number", 'min="-8" max="8"'))}${
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
    }${!editDef ? label("Route adjustment", select("slot-option", ["none", "sit-zone", "break-away", "motion-read"], s.option), "wide") + label("Route library", select("route-template", ["Custom", ...Object.keys(ROUTES)], "Custom"), "wide") : ""}${!editDef ? `<div class="wide"><h3>Quarterback room</h3></div>${label("Play type", select("edit-kind", ["pass", "run", "qb", "option", "triple", "rpo", "kneel", "spike"], edit.kind))}${label("Ball carrier", select("edit-runner", ["RB", "QB", "H", "Y", "Z", "X"], edit.runner))}${label("Drop depth", input("edit-drop", edit.drop, "number", 'min="1" max="9" step="0.5"'))}${label("Read begins (sec)", input("edit-release", edit.release, "number", 'min="0.5" max="5" step="0.1"'))}${label("Read progression (comma separated)", input("edit-reads", edit.reads.join(",")), "wide")}${label("Conditional read", select("edit-condition", ["none", "hot-blitz", "overload", "leverage"], edit.condition), "wide")}${label("Hot receiver", select("edit-hot", ["X", "Y", "Z", "H", "RB"], edit.hot))}${label("Read defender position", select("edit-readDefender", ["DE", "DT", "LB", "CB", "S"], edit.readDefender))}${label("Allow quarterback escape", `<input id="edit-scramble" type="checkbox" ${edit.scramble ? "checked" : ""}>`, "inline wide")}${label("Situational tags (comma separated)", input("edit-tags", (edit.tags || []).join(",")), "wide")}` : ""}</aside></div>`,
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
}
let undo = [];
function checkpoint() {
  undo.push(clone(edit));
  if (undo.length > 60) undo.shift();
}
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
    "scramble",
    "situation",
    "tags",
    "reads",
  ]) {
    const e = $("#edit-" + key);
    if (e)
      e.onchange = () => {
        checkpoint();
        edit[key] = ["drop", "release"].includes(key)
          ? +e.value
          : key === "scramble"
            ? e.checked
            : key === "reads" || key === "tags"
              ? e.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : e.value;
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
      };
  }
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
      if (tool === "route" && s.id !== "QB") s.assignment = "route";
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
  persist();
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
  const p = currentPlay();
  if (!p) return null;
  const def = selectDefense(
      game.defenses[1 - game.possession],
      { receivers: p.slots.filter((s) => s.pos === "WR").length },
      game,
      hash(`${game.seed}-${game.seq}`) ^ 1847,
    ),
    off = game.teams[game.possession],
    opp = game.teams[1 - game.possession],
    os = lineup(off, p.slots, game.fatigue),
    ds = lineup(opp, def.slots, game.fatigue),
    slots = [...p.slots, ...def.slots],
    players = [...os, ...ds].map((q, i) => ({
      ...q,
      athleteId: q.id,
      id: slots[i].id,
      side: i < 11 ? 0 : 1,
    })),
    qb = p.slots.find((s) => s.id === "QB");
  return {
    players,
    frames: [
      {
        t: 0,
        players: slots.map((s) => [s.x, s.y, 0, 0, "ready"]),
        ball: [qb.x, qb.y, 1],
        carrier: 10,
      },
    ],
    play: p,
    call: def,
    ball: game.ball,
    offense: off,
    defense: opp,
    events: [],
  };
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
      onEnd?.();
    },
    onTime: (t) => {
      filmTime = t;
      const e = $("#scrub");
      if (e && !e.matches(":active")) e.value = t;
      const time = $("#film-time");
      if (time) time.textContent = t.toFixed(1) + "s";
    },
  });
  stadium.overlay = data.settings.overlays;
  stadium.speed = data.settings.speed || 1;
  stadium.distance = game?.distance;
  stadium.setFilm(film || (page === "game" ? formationFilm() : null), autoplay);
  stadium.seek(start);
}
function filmToolbar() {
  return `<div class="film-toolbar">${btn("↺", "replay", "", 'aria-label="Replay from start"')}${btn("Ⅱ / ▶", "pause", "", 'aria-label="Pause or play"')}<input id="scrub" aria-label="Replay timeline" type="range" min="0" step="0.02" max="${film?.frames.at(-1)?.t || 1}" value="${filmTime}">${btn((data.settings.speed || 1) + "×", "speed")}${btn(data.settings.overlays ? "Hide routes" : "Routes", "overlay")}${btn("Box score", "box-score")}</div>`;
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
  const own = ownTurn(),
    p = currentPlay(),
    book = availableBook(),
    opponent = game.teams[1 - human];
  shell(
    `${head(mode === "practice" ? "Practice field" : mode === "multiplayer" ? "Friend game" : mode === "franchise" ? "Friday night / Franchise" : "Friday night / Exhibition", mode === "practice" ? "The proving ground" : `${esc(game.teams[0].school)} vs ${esc(game.teams[1].school)}`, "", btn("New game", "exhibition", "ghost small") + (mode === "multiplayer" ? btn("Friend lobby", "nav:friends", "ghost small") : ""))}<div class="game-layout"><div>${scoreHTML(game)}<div class="stadium-wrap"><canvas id="stadium" aria-label="Football field and animated replay"></canvas></div><div class="situation"><strong>${game.phase === "kickoff" ? "KICKOFF" : game.phase === "try" ? "POINT AFTER" : game.final ? "GAME COMPLETE" : `${["", "1ST", "2ND", "3RD", "4TH"][game.down]} & ${game.line === 100 ? "GOAL" : game.distance}`}</strong><small>Ball ${Math.round(game.ball)} • TO ${game.timeouts.join(" / ")} • Play clock ${game.playClock}s</small></div>${filmToolbar()}<div class="event-strip section-gap">${esc(game.last || "Pick the call. Trust your athletes.")}</div>${game.final ? `<div class="panel section-gap"><h3>${game.score[human] > game.score[1 - human] ? "A Friday night to remember." : "Back to the drawing board."}</h3><p class="muted">${esc(game.teams[game.score[0] > game.score[1] ? 0 : 1].school)} wins ${Math.max(...game.score)}–${Math.min(...game.score)}.</p>${mode === "franchise" ? btn("Complete week & advance program", "finish-week", "primary") : btn("View box score", "box-score", "primary")}</div>` : ""}</div><aside class="call-side"><div class="panel"><div class="panel-heading"><h3>${own ? "The call sheet" : "Opponent possession"}</h3><span class="badge">${mode === "practice" ? "Practice" : own ? "Your turn" : "Auto defense"}</span></div>${
      game.phase === "kickoff"
        ? '<p class="muted">Special teams takes the field. Kick coverage and return pursuit are simulated.</p>'
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
    }<div class="spacer"></div>${btn(snapText(), "snap", "primary snap", busy || viewing || game.final || (mode === "multiplayer" && !own) ? "disabled" : "")}<div class="game-note" style="margin-top:10px">${mode === "multiplayer" ? "Your turn is committed before playback. Closing the app will not lose it." : "No athlete controls after the snap. Coach through your call sheet."}</div></div>${
      own && !game.final && game.phase !== "kickoff"
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
          )}<div class="row">${btn("Timeout", "timeout", "small")}${btn("Punt", "punt", "small")}${btn(game.phase === "try" ? "Kick PAT" : "Field goal", game.phase === "try" ? "extra_point" : "field_goal", "small")}</div>${btn("Pre-snap adjustments", "adjust", "small ghost")}<small>${game.phase === "try" && game.overtime?.round >= game.rules.otTwoFrom ? "Two-point attempt required by overtime settings." : ""}</small></div>`
        : ""
    }${mode === "practice" ? `<div class="note">Practice uses the selected install against a seeded defensive call. Each snap resets the ball and down.</div>` : ""}</aside></div>`,
  );
  mountStadium("stadium");
  if ($("#scrub"))
    $("#scrub").oninput = (e) => {
      stadium.playing = false;
      viewing = false;
      stadium.seek(+e.target.value);
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
  film = null;
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
  const id = `film-${Date.now()}-${uid()}`;
  await save(id, f);
  filmIndex.unshift({
    id,
    title: f.play.name,
    school: f.offense.school,
    result: f.result.reason,
    yards: f.result.yards,
    date: Date.now(),
  });
  filmIndex = filmIndex.slice(0, 100);
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
    film = f;
    filmTime = 0;
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
for (const s of ["punt", "field_goal", "extra_point"]) act(s, () => snap(s));
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
act("replay", () => {
  if (stadium && film) {
    stadium.seek(0);
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
  if ($("#adjust-mirror").checked)
    for (const s of p.slots) {
      s.x = -s.x;
      for (const k of ["path", "motion", "shift"])
        s[k] = (s[k] || []).map(([x, y]) => [-x, y]);
    }
  const slide = $("#adjust-slide").value;
  if (slide !== "none")
    for (const s of p.slots.slice(0, 5)) {
      s.assignment = "slide";
      s.target = "nearest";
      s.x += slide === "left" ? -0.2 : 0.2;
    }
  adjusted = p;
  $("#modal").close();
  toast("Adjustment ready for the next snap");
});
act("box-score", () => {
  if (!game) return;
  modal(
    "Friday night box score",
    `${scoreHTML(game)}<div class="table-scroll section-gap"><table><thead><tr><th>Team</th>${game.teams.map((t) => `<th>${esc(t.school)}</th>`).join("")}</tr></thead><tbody>${[
      ["Plays", "plays"],
      ["Total yards", "yards"],
      ["Passing", "passing"],
      ["Rushing", "rushing"],
      ["Completions", "completions"],
      ["Attempts", "attempts"],
      ["First downs", "firstDowns"],
      ["Turnovers", "turnovers"],
    ]
      .map(
        ([name, k]) =>
          `<tr><td>${name}</td><td>${game.stats[0][k]}</td><td>${game.stats[1][k]}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><h3 class="section-gap">Athlete production</h3><div class="table-scroll"><table><thead><tr><th>Athlete</th><th>Touches</th><th>Yards</th><th>TD</th></tr></thead><tbody>${game.stats.flatMap((s, i) => Object.entries(s.players).map(([id, v]) => `<tr><td>${esc(game.teams[i].roster.find((p) => p.id === id)?.name || id)}</td><td>${v.passAttempts ? `${v.passCompletions}/${v.passAttempts} pass` : v.touches}</td><td>${v.passAttempts ? v.passYards : v.yards}</td><td>${v.td}</td></tr>`)).join("")}</tbody></table></div><h3 class="section-gap">Drive log</h3><div class="film-events">${game.history
      .slice()
      .reverse()
      .map(
        (h) =>
          `<div class="film-event"><time>Q${h.quarter}</time><div><strong>${esc(h.play)}</strong><br><small>${esc(h.text)}</small></div></div>`,
      )
      .join("")}</div>`,
  );
});
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
          `<div class="list-row"><small>${r.year} / Week ${r.week + 1}<br>${esc(f.teams[r.opponent].school)}</small><strong>${r.score.join(" – ")}</strong></div>`,
      )
      .join("")}</section></div>`,
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
    `<p class="muted">${p.pos} • Grade ${p.grade} • ${p.height} in / ${p.weight} lb</p>${rosterProgram ? `${label("Athlete name", input("ath-name", p.name))}<div class="form-row section-gap">${label("Jersey number", input("ath-number", p.number, "number", 'min="0" max="99"'))}${label("Position", select("ath-pos", ["QB", "RB", "WR", "TE", "C", "G", "T", "DE", "DT", "LB", "CB", "S", "K", "P"], p.pos))}</div>` : ""}<div class="grid cols2 section-gap">${ATTR.map((a) => (rosterProgram ? label(a.replace(/([A-Z])/g, " $1"), input("rating-" + a, p.ratings[a], "number", 'min="20" max="99"')) : `<div class="list-row"><small>${a.replace(/([A-Z])/g, " $1")}</small><strong>${p.ratings[a]}</strong></div>`)).join("")}</div>${rosterProgram ? `<div class="spacer"></div>${btn("Save athlete", "save-athlete", "primary")}` : '<p class="note section-gap">Official competitive ratings are fixed. Franchise ratings can be edited freely.</p>'}`,
    () => {
      if (rosterProgram)
        actions["save-athlete"] = async () => {
          p.name = $("#ath-name").value.trim() || p.name;
          p.number = clamp(+$("#ath-number").value, 0, 99);
          p.pos = $("#ath-pos").value;
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
    `${head("Study the details", "Film room", "A good coach watches the result. A great coach studies the read.")}<div class="game-layout"><div><div class="stadium-wrap" style="border-radius:12px 12px 0 0;border-top:1px solid var(--line)"><canvas id="film-canvas" aria-label="Football replay"></canvas></div>${filmToolbar()}<section class="panel section-gap"><div class="panel-heading"><h3>${esc(film?.play.name || "Your film library")}</h3><span class="badge" id="film-time">${filmTime.toFixed(1)}s</span></div>${film ? `<p class="muted">${esc(film.offense.school)} vs ${esc(film.defense.school)} • ${esc(film.call.name)} • Seed ${film.seed}</p><div class="film-events">${film.events.map((e, i) => `<div class="film-event" data-act="event:${i}" tabindex="0" role="button"><time>${e.t.toFixed(1)}s</time><span>${esc(e.text)}</span></div>`).join("")}</div>` : '<div class="empty">Run a play on gameday or in practice to start your film library.</div>'}</section></div><aside class="panel"><h3>Saved snaps</h3><div class="film-events section-gap">${filmIndex.map((f, i) => `<button class="play-card ${i === filmPick ? "active" : ""}" style="width:100%;margin-bottom:8px;text-align:left" data-act="film:${i}"><div><h4>${esc(f.title)}</h4><small>${esc(f.school)} • ${esc(f.result)} • ${Math.round(f.yards)} yd</small></div></button>`).join("") || '<p class="muted">No saved film yet.</p>'}</div></aside></div>`,
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
          )}${label("Coach display name", input("coach-name", user.displayName || user.email?.split("@")[0] || "Coach"))}<div class="row">${btn("Create friend game", "create-match", "primary")}${btn("Join with code", "join-dialog", "ghost")}</div><p class="note">Your current offensive and defensive playbooks are copied into the match. Defensive calls stay locked for that game.</p><div class="row">${btn("Cloud backup", "cloud-save", "small")}${btn("Restore cloud backup", "cloud-load", "small")}${btn("Sign out", "logout", "small ghost")}</div></div></section>`
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
  } catch (e) {
    matchesError = e.message;
    if (page === "friends") friendsPage();
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
      TEAMS[+$("#join-team").value],
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
    await cloud.cloudSave(data);
    toast("Cloud backup saved");
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
    `${head("Make it yours", "Settings & saves", "Your playbooks and franchise save on this device. Keep a backup for switching phones or browsers.")}<div class="grid cols2"><section class="panel form-stack"><h3>Save management</h3><p class="muted">An installed app and another browser can have separate device storage. Use the same signed-in account and cloud backup to move your program between them.</p><div class="row">${btn("Export full backup", "export-save", "primary")}<label>Restore backup<input id="import-save" type="file" accept=".json,application/json"></label></div><div class="row">${user ? btn("Cloud backup", "cloud-save") + btn("Restore cloud", "cloud-load") : btn("Sign in for cloud saves", "nav:friends")}</div><span class="save-state">Saved on this device</span><h3 class="section-gap">Playback</h3>${label("Assignment overlays", `<input id="setting-overlay" type="checkbox" ${data.settings.overlays ? "checked" : ""}>`, "inline")}<p class="note">Live friend turns require a connection. If a submission disconnects, reopen the app and sign in; the pending transaction is retried with the same sequence.</p></section><section class="panel"><h3>Coach’s field guide</h3><div class="list-row"><strong>Play designer</strong><small>Align → assign → route → reads → save</small></div><div class="list-row"><strong>Motion & shifts</strong><small>Draw pre-snap paths in the board tools</small></div><div class="list-row"><strong>Film</strong><small>Pause, scrub, and tap a decision event</small></div><div class="list-row"><strong>Franchise</strong><small>Ten weeks, semifinals, championship</small></div><p class="note">NFHS-style default: 12-minute quarters, 40/25 play clock, tries at the 3, kickoffs at the 40, paired overtime possessions at the opponent’s 10. This engine is an approximation; see IMPLEMENTATION.md for the implemented rules and remaining limitations.</p><p><a href="README.md" target="_blank" rel="noopener">Deployment guide ↗</a> · <a href="IMPLEMENTATION.md" target="_blank" rel="noopener">Implementation details ↗</a></p><small>Fresh source • ${VERSION}</small></section></div>`,
  );
  $("#setting-overlay").onchange = (e) => {
    data.settings.overlays = e.target.checked;
    autoSave();
  };
  $("#import-save").onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (
        d.version !== VERSION ||
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
  if (user) cloud.recover().catch(error);
});
window.addEventListener("offline", () => {
  cloudStatus = "Offline • local modes ready";
  toast("Offline. Friend turns will wait for a connection.");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persist();
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
  navigator.serviceWorker.register("./sw.js").catch(() => {});
