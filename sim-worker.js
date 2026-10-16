import { runSnap } from "./rules.js";
import { finishWeek } from "./franchise.js";
self.onmessage = ({ data }) => {
  try {
    if (data.type === "lab") {
      const runs = [];
      for (let i = 0; i < data.count; i++) {
        const f = runSnap(data.game, data.play, (data.seed + i * 7919) >>> 0);
        runs.push({
          result: f.result,
          events: f.events.filter((e) =>
            ["throw", "read", "logic", "sack", "flag"].includes(e.type),
          ),
        });
      }
      self.postMessage({ id: data.id, value: runs });
    } else if (data.type === "week")
      self.postMessage({
        id: data.id,
        value: finishWeek(data.franchise, data.played),
      });
    else
      self.postMessage({
        id: data.id,
        film: runSnap(data.game, data.play, data.seed),
      });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
