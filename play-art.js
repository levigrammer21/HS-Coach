import { BLOCK_TYPES, snapSlot } from "./football.js";
export const ART_COLORS = {
  route: "#f4cf75",
  run: "#f28b70",
  block: "#a1ddd3",
  motion: "#b6a0f2",
  shift: "#90bff0",
  zone: "#84c9f4",
  read: "#fff2c9",
};
export function playArt(play, call, { defense = false, selected = null } = {}) {
  const lines = [],
    zones = [],
    reads = [];
  for (const raw of play?.slots || []) {
    const s = snapSlot(raw),
      id = s.id;
    if (id === "QB" && !s.path?.length && play.keepPath?.length)
      s.path = play.keepPath;
    if (selected && selected !== id) continue;
    for (const k of ["shift", "motion"])
      if (raw[k]?.length)
        lines.push({
          id,
          kind: k,
          points: [[raw.x, raw.y], ...raw[k]],
          end: "arrow",
          dashed: true,
        });
    if (BLOCK_TYPES.includes(s.assignment)) {
      let pts = [[s.x, s.y], ...(s.path || [])];
      if (pts.length < 2) {
        const d = call?.slots?.find((d) => d.id === s.target);
        pts.push(
          d
            ? [d.x, d.y]
            : [
                s.x +
                  (s.assignment === "slide"
                    ? play.slide === "left"
                      ? -2
                      : 2
                    : 0),
                s.y + (s.assignment === "pass" ? -0.8 : 2),
              ],
        );
      }
      lines.push({ id, kind: "block", points: pts, end: "bar" });
    } else if (s.path?.length)
      lines.push({
        id,
        kind:
          s.assignment === "run" || (id === play.runner && play.kind !== "pass")
            ? "run"
            : "route",
        points: [[s.x, s.y], ...s.path],
        end: "arrow",
        dashed: !!s.delay,
      });
  }
  for (const [id, i] of (play?.reads || []).map((id, i) => [id, i])) {
    if (selected && selected !== id) continue;
    const s = play.slots.find((s) => s.id === id);
    if (s?.path?.length)
      reads.push({
        id,
        n: i + 1,
        point: s.path[Math.min(0, s.path.length - 1)],
      });
  }
  if (defense)
    for (const s of call?.slots || []) {
      if (s.zone && ["zone", "deep"].includes(s.assignment))
        zones.push({ id: s.id, point: s.zone, deep: s.assignment === "deep" });
      if (s.assignment === "man") {
        const q = play.slots.find((p) => p.id === s.target);
        if (q)
          lines.push({
            id: s.id,
            kind: "zone",
            points: [
              [s.x, s.y],
              [q.x, q.y],
            ],
            end: "arrow",
            dashed: true,
          });
      } else if (["rush", "stunt", "contain"].includes(s.assignment))
        lines.push({
          id: s.id,
          kind: "zone",
          points: [
            [s.x, s.y],
            [s.x + (s.stunt || 0), s.y - 5],
          ],
          end: "arrow",
          dashed: true,
        });
    }
  return { lines, zones, reads };
}
export function drawPlayArt(ctx, project, play, call, options = {}) {
  const art = playArt(play, call, options);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const z of art.zones) {
    const p = project(...z.point);
    ctx.beginPath();
    ctx.ellipse(
      p[0],
      p[1],
      options.width * 0.065,
      options.width * (z.deep ? 0.045 : 0.035),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "#84c9f421";
    ctx.fill();
    ctx.strokeStyle = "#84c9f477";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  for (const l of art.lines) {
    const pts = l.points.map((p) => project(...p));
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.strokeStyle = "#071e2199";
    ctx.lineWidth = 5;
    ctx.setLineDash(l.dashed ? [6, 5] : []);
    ctx.stroke();
    ctx.strokeStyle = ART_COLORS[l.kind];
    ctx.lineWidth = l.kind === "run" ? 2.8 : 1.8;
    ctx.stroke();
    ctx.setLineDash([]);
    const a = pts.at(-2),
      b = pts.at(-1);
    if (a && b) {
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]),
        size = 6;
      ctx.beginPath();
      if (l.end === "bar") {
        ctx.moveTo(
          b[0] + Math.sin(angle) * size,
          b[1] - Math.cos(angle) * size,
        );
        ctx.lineTo(
          b[0] - Math.sin(angle) * size,
          b[1] + Math.cos(angle) * size,
        );
      } else {
        ctx.moveTo(
          b[0] - Math.cos(angle - 0.5) * size,
          b[1] - Math.sin(angle - 0.5) * size,
        );
        ctx.lineTo(...b);
        ctx.lineTo(
          b[0] - Math.cos(angle + 0.5) * size,
          b[1] - Math.sin(angle + 0.5) * size,
        );
      }
      ctx.stroke();
    }
  }
  if (options.reads !== false)
    for (const r of art.reads) {
      const p = project(...r.point);
      ctx.beginPath();
      ctx.arc(p[0] + 9, p[1] - 8, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#fff2c9";
      ctx.fill();
      ctx.fillStyle = "#18332b";
      ctx.font = "bold 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(r.n), p[0] + 9, p[1] - 5);
    }
  ctx.restore();
  return art;
}
