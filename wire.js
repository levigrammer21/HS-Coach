// Large read-only roster/book and accumulated statistic/history trees travel as
// JSON leaves. This avoids expanding thousands of rule-evaluation map nodes on
// every turn while leaving members, possession and sequence directly queryable.
// Firestore rejects arrays directly inside arrays. Keep field-addressable match state,
// but wrap nested array values without losing any route or replay precision.
const PACK_FIELDS = new Set(["teams", "defenses", "books", "history", "stats"]);
export function toWire(value, inArray = false) {
  if (Array.isArray(value)) {
    const items = value.map((v) => toWire(v, true));
    return inArray ? { __hsArray: items } : items;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value))
      if (v !== undefined)
        out[k] =
          PACK_FIELDS.has(k) && v && typeof v === "object"
            ? { __hsJson: JSON.stringify(v) }
            : toWire(v, false);
    return out;
  }
  return value;
}
export function fromWire(value) {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === "object") {
    if (Object.keys(value).length === 1 && typeof value.__hsJson === "string")
      return JSON.parse(value.__hsJson);
    if (Object.keys(value).length === 1 && Array.isArray(value.__hsArray))
      return value.__hsArray.map(fromWire);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fromWire(v);
    return out;
  }
  return value;
}
