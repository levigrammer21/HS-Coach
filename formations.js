import { baseSlots, clone } from "./data.js";
const coordinates = {
  Spread: [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-21, 0],
    [5, 0],
    [21, -1.5],
    [-10, -1.5],
    [3, -5],
    [0, -5],
  ],
  Trips: [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-22, 0],
    [10, 0],
    [22, -1.5],
    [15, -1.5],
    [-3, -5],
    [0, -5],
  ],
  Empty: [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-22, 0],
    [22, 0],
    [12, -1.5],
    [-12, -1.5],
    [5, -1.5],
    [0, -5],
  ],
  "I Formation": [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-20, 0],
    [5, 0],
    [20, -1.5],
    [0, -4],
    [0, -7],
    [0, -1],
  ],
  "Wing T": [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-19, 0],
    [5, 0],
    [7, -1.5],
    [-4, -3],
    [0, -6],
    [0, -1],
  ],
  Flexbone: [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-20, 0],
    [20, 0],
    [5, -1.5],
    [-5, -1.5],
    [0, -4],
    [0, -1],
  ],
  "Double Tight": [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [3, 0],
    [-5, 0],
    [5, 0],
    [2, -4],
    [-2, -4],
    [0, -7],
    [0, -1],
  ],
  Unbalanced: [
    [-3, 0],
    [-1.5, 0],
    [0, 0],
    [1.5, 0],
    [4.5, 0],
    [-20, 0],
    [3, 0],
    [22, -1.5],
    [8, -2],
    [0, -5],
    [0, -1],
  ],
};
export const FORMATIONS = Object.keys(coordinates);
export function applyFormation(play, name) {
  const p = clone(play),
    coords = coordinates[name];
  if (!coords) throw Error("Unknown formation");
  p.formation = name;
  if (name === "Unbalanced") {
    const y = p.slots.find((s) => s.id === "Y");
    y.assignment = "down";
    y.path = [];
  }
  const base = baseSlots();
  p.slots.forEach((s, i) => {
    s.pos = base[i].pos;
    const dx = coords[i][0] - s.x,
      dy = coords[i][1] - s.y;
    s.x = coords[i][0];
    s.y = coords[i][1];
    for (const field of ["path", "shift", "motion"])
      s[field] = (s[field] || []).map(([x, y]) => [
        Math.max(-26, Math.min(26, x + dx)),
        y + dy,
      ]);
    if (name === "Empty" && s.id === "RB") s.pos = "WR";
    if (["I Formation", "Double Tight"].includes(name) && s.id === "H")
      s.pos = "RB";
    if (name === "Double Tight" && ["X", "Y"].includes(s.id)) s.pos = "TE";
  });
  return p;
}
export function defensiveTemplate(call, name) {
  const d = clone(call);
  d.front = name;
  const fronts = {
    "4–3": [-5, -1.7, 1.7, 5],
    "3–4": [-4, 0, 4, -7],
    "5–2": [-6, -3, 0, 3],
    "4–4": [-5, -1.7, 1.7, 5],
  };
  const xs = fronts[name] || fronts["4–3"];
  d.slots.slice(0, 4).forEach((s, i) => {
    s.x = xs[i];
    s.y = name === "3–4" && i === 3 ? 3 : 1;
    s.assignment = "rush";
    s.pos = name === "3–4" && i === 3 ? "LB" : i === 0 || i === 3 ? "DE" : "DT";
  });
  if (name === "5–2") {
    d.slots[4].x = 6;
    d.slots[4].y = 1;
    d.slots[4].assignment = "rush";
  }
  if (name === "4–4") {
    d.slots[9].x = -10;
    d.slots[9].y = 4;
    d.slots[9].assignment = "zone";
    d.slots[9].zone = [-12, 6];
  }
  return d;
}
