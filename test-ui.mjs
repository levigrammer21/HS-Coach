import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { runSnap } from "./rules.js";
import { finishWeek } from "./franchise.js";
const w = new Window({ url: "http://test.local/" });
w.document.body.innerHTML =
  '<div id="app"></div><div id="toast"></div><dialog id="modal"></dialog>';
const store = new Map();
const db = {
  createObjectStore() {},
  transaction() {
    const t = {
      objectStore() {
        return {
          get(k) {
            const r = {};
            queueMicrotask(() => {
              r.result = store.get(k);
              r.onsuccess?.();
            });
            return r;
          },
          put(v, k) {
            store.set(k, structuredClone(v));
          },
        };
      },
    };
    setTimeout(() => t.oncomplete?.(), 0);
    return t;
  },
};
const indexedDB = {
  open() {
    const r = { result: db };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  },
};
const context = new Proxy(
  {
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 20 }),
  },
  {
    get(t, p) {
      return t[p] || (() => {});
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  },
);
w.HTMLCanvasElement.prototype.getContext = () => context;
w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
w.HTMLElement.prototype.getBoundingClientRect = () => ({
  width: 500,
  height: 400,
  left: 0,
  top: 0,
  right: 500,
  bottom: 400,
});
w.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
w.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
Object.defineProperty(w.navigator, "onLine", { value: false });
const globals = {
  window: w,
  document: w.document,
  navigator: w.navigator,
  indexedDB,
  ResizeObserver: class {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {
      this.cb();
    }
    disconnect() {}
  },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  devicePixelRatio: 1,
  Worker: class {
    postMessage(data) {
      setTimeout(() => {
        try {
          this.onmessage({
            data: {
              id: data.id,
              ...(data.type === "week"
                ? { value: finishWeek(data.franchise, data.played) }
                : { film: runSnap(data.game, data.play, data.seed) }),
            },
          });
        } catch (e) {
          this.onerror(e);
        }
      }, 0);
    }
  },
};
for (const [k, v] of Object.entries(globals))
  Object.defineProperty(globalThis, k, {
    value: v,
    configurable: true,
    writable: true,
  });
w.scrollTo = () => {};
const errors = [];
console.error = (e) => errors.push(e?.message || String(e));
await import("./app.js");
const wait = () => new Promise((r) => setTimeout(r, 25));
const $ = (s) => document.querySelector(s);
let transitionCount=0;
async function click(act) {
  transitionCount++;
  const el = $(`[data-act="${act}"]`);
  assert.ok(el, "Missing action " + act);
  assert.equal(el.disabled, false, "Disabled action " + act);
  el.click();
  await wait();
  assert.equal(errors.length, 0, errors.join("\n"));
}
function change(id, value) {
  const e = $("#" + id);
  assert.ok(e, id);
  e.value = value;
  e.dispatchEvent(new w.Event("change"));
}
await click("nav:playbook");
assert.ok(document.body.textContent.includes("Offensive playbook"));
await click("new-play");
change("edit-name", "UI Integration Install");
change("edit-reads", "H,Y,X");
await click("tool:route");
let board = $("#board");
board.dispatchEvent(
  new w.PointerEvent("pointerdown", {
    clientX: 69,
    clientY: 272,
    pointerId: 1,
    bubbles: true,
  }),
);
board.dispatchEvent(
  new w.PointerEvent("pointermove", {
    clientX: 90,
    clientY: 195,
    pointerId: 1,
    bubbles: true,
  }),
);
board.dispatchEvent(
  new w.PointerEvent("pointermove", {
    clientX: 150,
    clientY: 140,
    pointerId: 1,
    bubbles: true,
  }),
);
board.dispatchEvent(
  new w.PointerEvent("pointerup", {
    clientX: 150,
    clientY: 140,
    pointerId: 1,
    bubbles: true,
  }),
);
change("slot-delay", "0.3");
await click("save-play");
assert.ok(document.body.textContent.includes("UI Integration Install"));
assert.ok(
  store.get("profile").book.at(-1).slots[5].path.length >= 2,
  "Touch route was saved",
);
await click("fit");
await click("close");
await click("nav:defense");
await click("new-defense");
change("edit-name", "UI Defense");
change("slot-assignment", "stunt");
change("slot-stunt", "3");
await click("save-play");
assert.ok(document.body.textContent.includes("UI Defense"));
await click("nav:franchise");
await click("new-franchise");
change("franchise-name", "UI Test High");
await click("create-franchise");
assert.ok(document.body.textContent.includes("UI Test High"));
await click("customize-program");
await click("edit-program-roster");
const scout = $('[data-act^="athlete:"]');
assert.ok(scout);
scout.click();
await wait();
change("rating-speed", "97");
await click("save-athlete");
await click("nav:franchise");
await click("play-franchise");
assert.ok($("#stadium"));
await click("snap");
assert.ok(document.body.textContent.includes("Watching the play"));
await click("nav:film");
assert.ok($("#film-canvas"));
assert.ok(document.body.textContent.includes("Saved snaps"));
await click("nav:settings");
assert.ok(document.body.textContent.includes("Save management"));
await click("nav:friends");
assert.ok(document.body.textContent.includes("Sign in to the locker room"));
await click("nav:home");
assert.equal(errors.length, 0, errors.join("\n"));
assert.ok(store.has("profile"));
assert.equal(store.get("profile").franchise.teams[1].school, "UI Test High");
console.log(
  "PASS: UI transitions, play and defense editing, franchise creation, rating edits, worker snap, film, persistence.",
);
