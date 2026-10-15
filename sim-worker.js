import { runSnap } from "./rules.js";
import { finishWeek } from "./franchise.js";
self.onmessage = ({ data }) => {
  try {
    if (data.type === "week")
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
