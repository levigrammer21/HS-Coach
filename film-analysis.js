export function analyzeFilm(film) {
  if (!film?.result) return [];
  const r = film.result,
    events = film.events || [],
    notes = [];
  const released = events.find((e) => e.type === "throw");
  const reads = events.filter((e) => e.type === "read");
  const shed = events.filter((e) => e.type === "shed");
  if (r.penalty)
    notes.push({
      title: r.penalty.name,
      detail:
        "The accepted foul controls this result. Review the flagged alignment or contact before changing the concept.",
    });
  if (released)
    notes.push({
      title: "Quarterback decision",
      detail: `Released at ${released.t.toFixed(2)} seconds after ${reads.length} recorded read${reads.length === 1 ? "" : "s"}. ${released.text}.`,
    });
  else if (r.reason === "sack")
    notes.push({
      title: "Protection broke first",
      detail: `The quarterback was reached at ${r.duration.toFixed(2)} seconds. ${shed.length ? shed.map((e) => e.text).join("; ") + "." : "Check the front against your protection targets and release timing."}`,
    });
  const mesh = events.find((e) => e.type === "handoff" || e.type === "pitch");
  if (mesh)
    notes.push({
      title: "Exchange and run lane",
      detail: `${mesh.text} at ${mesh.t.toFixed(2)} seconds. ${events.some((e) => e.type === "read" && e.text.includes("keeps")) ? "The quarterback kept on the observed edge response." : "Follow the lead blocker and the first unblocked defender on replay."}`,
    });
  const catchEvent = events.find((e) => e.type === "catch");
  if (catchEvent)
    notes.push({
      title: "After the catch",
      detail: `Caught at ${Math.round(r.catchY ?? 0)} yards beyond the line; ${Math.max(0, Math.round(r.yards - (r.catchY ?? r.yards)))} yards after the catch.`,
    });
  if (events.some((e) => e.type === "deflection" || e.type === "interception"))
    notes.push({
      title: "A defender reached the ball",
      detail:
        "The coverage player intersected the flight or catch point. Inspect the coverage overlay and the throw event to compare the window with your next progression.",
    });
  const tackle = events.find((e) => e.type === "tackle");
  if (tackle)
    notes.push({
      title: "Finish",
      detail:
        tackle.text +
        `. ${events.filter((e) => e.type === "break").length} broken tackle attempts before the whistle.`,
    });
  const combos = events.filter((e) => e.type === "climb");
  if (combos.length)
    notes.push({
      title: "Second-level blocking",
      detail: combos.map((e) => e.text).join("; ") + ".",
    });
  if (r.blocked)
    notes.push({
      title: "Kick pressure",
      detail:
        "A free rusher reached the ball before it cleared the protection.",
    });
  if (r.fairCatch)
    notes.push({
      title: "Fair catch",
      detail:
        "The returner saw coverage arriving and protected possession rather than attempting a return.",
    });
  return notes.length
    ? notes
    : [
        {
          title: "Assignment review",
          detail:
            "Use the route and coverage overlays, pause at the snap, and tap an athlete to isolate their responsibility.",
        },
      ];
}
