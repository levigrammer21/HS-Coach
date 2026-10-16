import { defaults, defenseDefaults, hash, clone, VERSION } from "./data.js";
const original = {
  o0: 3847881893,
  o1: 3524364739,
  o2: 3832718203,
  o3: 1536524238,
  o4: 2023769873,
  o5: 1149766558,
  o6: 220854061,
  o7: 676117134,
  o8: 3631805618,
  o9: 3331522790,
  o10: 4008886849,
  o11: 244015058,
  o12: 4065395110,
  o13: 4145516535,
  o14: 4231722997,
  o15: 3328934285,
  o16: 3951127304,
  o17: 2757995139,
  o18: 4053419981,
  o19: 1686362325,
  kneel: 2291207965,
  spike: 1471848573,
};
const previous = {
  o0: 3847881893,
  o1: 1452205693,
  o2: 3832718203,
  o3: 2596391401,
  o4: 2806568264,
  o5: 1149766558,
  o6: 2000264017,
  o7: 676117134,
  o8: 3631805618,
  o9: 78456728,
  o10: 1729304812,
  o11: 185260173,
  o12: 1608191440,
  o13: 4145516535,
  o14: 4231722997,
  o15: 3328934285,
  o16: 3951127304,
  o17: 2757995139,
  o18: 4053419981,
  o19: 1408182061,
  kneel: 2291207965,
  spike: 1471848573,
};
const previousDefense = {
  d0: 1274382479,
  d1: 2729001494,
  d2: 2938890628,
  d3: 3628429030,
};
export function migrateProfile(data) {
  if (data.libraryRevision >= 3) return data;
  const fresh = defaults();
  const migrate = (p) => {
    const normalized = clone(p);
    delete normalized.tempo;
    if (
      original[p.id] !== undefined &&
      [original[p.id], previous[p.id]].includes(
        hash(JSON.stringify(normalized)),
      )
    )
      return {
        ...clone(fresh.find((q) => q.id === p.id)),
        tempo: p.tempo || "normal",
      };
    return p;
  };
  data.book = data.book.map(migrate);
  for (const b of data.books || []) b.plays = b.plays.map(migrate);
  const defenses = defenseDefaults();
  if (data.defense)
    data.defense = data.defense.map((d) => {
      const normalized = clone(d);
      delete normalized.weight;
      return previousDefense[d.id] === hash(JSON.stringify(normalized))
        ? { ...clone(defenses.find((q) => q.id === d.id)), weight: d.weight }
        : d;
    });
  data.libraryRevision = 3;
  data.version = VERSION;
  return data;
}
