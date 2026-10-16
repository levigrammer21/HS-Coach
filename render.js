import { drawPlayArt } from "./play-art.js";
import { clamp } from "./data.js";
const mix = (a, b, u) => a + (b - a) * u;
export class Stadium {
  constructor(canvas, { onEnd, onTime } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onEnd = onEnd;
    this.onTime = onTime;
    this.speed = 1;
    this.time = 0;
    this.playing = false;
    this.overlay = false;
    this.defenseArt = false;
    this.artSelected = null;
    this.loopPreview = false;
    this.zoom = 1;
    this.labels = true;
    this.focus = 4;
    this.last = performance.now();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.tap = (e) => {
      if (!this.film) return;
      const r = this.canvas.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top,
        frame = this.film.frames.reduce((a, b) =>
          Math.abs(a.t - this.time) < Math.abs(b.t - this.time) ? a : b,
        );
      let best = -1,
        dd = 25;
      frame.players.forEach((v, i) => {
        const p = this.project(v[0], v[1], 1.2),
          d = Math.hypot(x - p[0], y - p[1]);
        if (d < dd) {
          best = i;
          dd = d;
        }
      });
      this.selected = best >= 0 ? this.film.players[best] : null;
      this.artSelected = this.selected?.side === 0 ? this.selected.id : null;
    };
    this.canvas.addEventListener?.("click", this.tap);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
  resize() {
    const r = this.canvas.getBoundingClientRect(),
      d = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = r.width * d;
    this.canvas.height = r.height * d;
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  setFilm(f, autoplay = false) {
    this.selected = null;
    this.film = f;
    this.time = f?.frames?.[0]?.t || 0;
    this.focus = 4;
    this.playing = autoplay;
    this.ended = false;
  }
  seek(t) {
    this.time = clamp(
      t,
      this.film?.frames?.[0]?.t || 0,
      this.film?.frames.at(-1)?.t || 0,
    );
    this.ended = false;
    this.draw();
  }
  destroy() {
    this.destroyed = true;
    this.canvas.removeEventListener?.("click", this.tap);
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
  }
  tick(now) {
    if (this.destroyed) return;
    const dt = Math.min((now - this.last) / 1000, 0.06);
    this.last = now;
    if (this.playing && this.film) {
      this.time += dt * this.speed;
      const end = this.film.frames.at(-1)?.t || 0;
      if (this.film.preview && this.loopPreview && this.time >= end + 0.8) {
        this.time = this.film.frames[0].t;
      } else if (this.time >= end + 0.3) {
        this.time = end;
        this.playing = false;
        if (!this.ended) {
          this.ended = true;
          this.onEnd?.();
        }
      }
    }
    if (this.destroyed) return;
    this.draw();
    this.onTime?.(this.time);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
  project(x, y, z = 0) {
    const s = (this.w / 68) * this.zoom;
    return [
      this.w / 2 + x * s + (y - this.focus) * s * 0.17,
      this.h * 0.64 - (y - this.focus) * s * 0.57 - z * s * 0.7,
    ];
  }
  poly(points, color, stroke) {
    const c = this.ctx;
    c.beginPath();
    points.forEach((p, i) => {
      const v = this.project(...p);
      i ? c.lineTo(...v) : c.moveTo(...v);
    });
    c.closePath();
    if (color) {
      c.fillStyle = color;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.stroke();
    }
  }
  line(a, b, color, width = 1, dash = []) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(...this.project(...a));
    c.lineTo(...this.project(...b));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dash);
    c.stroke();
    c.setLineDash([]);
  }
  draw() {
    const c = this.ctx,
      w = this.w,
      h = this.h;
    if (!w || !h) return;
    const f = this.film,
      frames = f?.frames;
    let a = frames?.[0],
      b = a,
      u = 0;
    if (frames?.length) {
      let lo = 0,
        hi = frames.length - 1;
      while (lo < hi) {
        const m = Math.ceil((lo + hi) / 2);
        if (frames[m].t <= this.time) lo = m;
        else hi = m - 1;
      }
      a = frames[lo];
      b = frames[Math.min(lo + 1, frames.length - 1)];
      u = b.t > a.t ? clamp((this.time - a.t) / (b.t - a.t), 0, 1) : 0;
      const cy = a.ball[1];
      this.focus = mix(this.focus, clamp(cy, 4, 75), 0.045);
    }
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#081824");
    grad.addColorStop(0.45, "#142a30");
    grad.addColorStop(1, "#0b171b");
    c.fillStyle = grad;
    c.fillRect(0, 0, w, h);
    // Stadium tiers and floodlights are original procedural artwork.
    c.fillStyle = "#1b2b36";
    c.fillRect(0, h * 0.08, w, h * 0.25);
    for (let i = 0; i < 200; i++) {
      c.fillStyle = ["#506176", "#9a977a", "#6e8292", "#b8ad91"][i % 4];
      c.fillRect((i * 37) % w, h * 0.1 + ((i * 13) % (h * 0.21)), 2, 2);
    }
    for (const x of [w * 0.08, w * 0.92]) {
      c.fillStyle = "#77858b";
      c.fillRect(x, 0, 2, h * 0.2);
      c.shadowColor = "#d4f4ff";
      c.shadowBlur = 18;
      c.fillStyle = "#e7f7fc";
      c.fillRect(x - 12, h * 0.04, 26, 5);
      c.shadowBlur = 0;
    }
    const spot = f?.ball || 25;
    for (let y = -spot - 10; y < 111 - spot; y += 5) {
      this.poly(
        [
          [-27, y],
          [27, y],
          [27, y + 5],
          [-27, y + 5],
        ],
        Math.round((y + spot) / 5) % 2 === 0 ? "#235d48" : "#28674e",
      );
    }
    this.poly(
      [
        [-27, -spot - 10],
        [27, -spot - 10],
        [27, -spot],
        [-27, -spot],
      ],
      f?.offense?.primary || "#254968",
    );
    this.poly(
      [
        [-27, 100 - spot],
        [27, 100 - spot],
        [27, 110 - spot],
        [-27, 110 - spot],
      ],
      f?.defense?.primary || "#592b35",
    );
    for (let y = -spot; y <= 100 - spot; y += 5)
      this.line([-26.67, y], [26.67, y], "#ffffff66", 1);
    for (const x of [-26.67, 26.67])
      this.line([x, -spot - 10], [x, 110 - spot], "#dbe9e0", 2);
    for (let y = Math.ceil(-spot); y < 100 - spot; y++)
      for (const x of [-8.9, 8.9])
        this.line([x - 0.45, y], [x + 0.45, y], "#e9eee1aa", 1);
    for (let yard = 10; yard < 100; yard += 10) {
      for (const x of [-21, 21]) {
        const [px, py] = this.project(x, yard - spot);
        c.save();
        c.translate(px, py);
        c.scale(1, 0.6);
        c.fillStyle = "#ecf1dcba";
        c.font = `bold ${Math.max(12, w / 36)}px system-ui`;
        c.textAlign = "center";
        c.fillText(String(Math.min(yard, 100 - yard)), 0, 0);
        c.restore();
      }
    }
    this.line([-27, 0], [27, 0], "#68bfff", 2);
    if (this.distance)
      this.line([-27, this.distance], [27, this.distance], "#e8c65e", 2);
    if (!f || !a) {
      c.fillStyle = "#d4e6de";
      c.font = "700 16px system-ui";
      c.textAlign = "center";
      c.fillText("FRIDAY NIGHT STARTS HERE", w / 2, h * 0.54);
      return;
    }
    if (this.overlay || f.preview || this.time < 0)
      drawPlayArt(c, (...p) => this.project(...p), f.play, f.call, {
        width: w,
        defense: this.defenseArt,
        selected: this.artSelected,
        reads: true,
      });
    const order = f.players
      .map((p, i) => ({
        p,
        i,
        v: a.players[i].map((x, k) =>
          typeof x === "number" ? mix(x, b.players[i]?.[k] ?? x, u) : x,
        ),
      }))
      .sort((a, b) => b.v[1] - a.v[1]);
    for (const { p, i, v } of order) this.athlete(p, v, i === a.carrier, f);
    const bp = a.ball.map((v, k) => mix(v, b.ball[k], u)),
      [bx, by] = this.project(...bp),
      shadow = this.project(bp[0], bp[1], 0);
    c.fillStyle = "#0005";
    c.beginPath();
    c.ellipse(...shadow, 4, 2, 0, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(bx, by);
    c.rotate(this.time * 7);
    c.fillStyle = "#865135";
    c.strokeStyle = "#e9cba2";
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(0, 0, 4, 2.4, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.restore();
    if (this.selected) {
      c.fillStyle = "#07141ae6";
      c.fillRect(10, h - 39, w - 20, 29);
      c.fillStyle = "#f1dfab";
      c.textAlign = "left";
      c.font = "700 11px system-ui";
      c.fillText(
        "#" +
          this.selected.number +
          " " +
          this.selected.name +
          " · " +
          this.selected.pos,
        20,
        h - 20,
      );
    }
    if (f.preview) {
      c.fillStyle = "#07141ac9";
      c.fillRect(10, 10, Math.min(w - 20, 310), 33);
      c.fillStyle = "#f4cf75";
      c.font = "700 11px system-ui";
      c.textAlign = "left";
      c.fillText("PLAY ART  ·  " + f.play.name, 20, 31);
    }
    if (!f.preview && !this.playing && this.time > 0) {
      c.fillStyle = "#07141ac9";
      c.fillRect(w / 2 - 70, 12, 140, 26);
      c.fillStyle = "#c8d8d7";
      c.textAlign = "center";
      c.font = "700 10px system-ui";
      c.fillText("FILM  /  " + this.time.toFixed(1) + " s", w / 2, 29);
    }
  }
  athlete(p, v, carrier, f) {
    const c = this.ctx,
      [px, py] = this.project(v[0], v[1]),
      s = clamp(this.w / 650, 0.85, 1.5),
      state = v[4],
      speed = Math.hypot(v[2], v[3]),
      phase = this.time * (9 + speed),
      stride = ["run", "backpedal", "shuffle"].includes(state)
        ? Math.sin(phase) *
          (state === "shuffle" ? 1.5 : state === "backpedal" ? -2 : 3)
        : 0,
      team = p.side ? f.defense : f.offense,
      jersey = p.side ? "#e9ede7" : team.primary,
      helmet = team.secondary;
    c.save();
    c.translate(px, py);
    c.scale(s, s);
    // Shoulder lean follows momentum; the backpedal opens gradually into a chase.
    const lean = clamp(v[2] * 0.018, -0.16, 0.16);
    c.rotate(lean);
    c.fillStyle = "#07161166";
    c.beginPath();
    c.ellipse(0, 1, 8, 3, 0, 0, Math.PI * 2);
    c.fill();
    if (carrier) {
      c.strokeStyle = "#f5d474";
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(0, 1, 10, 4, 0, 0, Math.PI * 2);
      c.stroke();
    }
    if (["fall", "ground", "rise"].includes(state)) {
      const angle =
        state === "fall" ? v[5] || 0 : state === "ground" ? 1 : 1 - (v[5] || 0);
      c.rotate(-1.2 * angle);
      c.translate(0, angle * 3);
    }
    if (state === "down" || state === "tackle") {
      c.rotate(state === "down" ? -0.9 : 0.7);
      c.translate(0, 3);
    }
    if (state === "celebrate")
      c.translate(0, -Math.abs(Math.sin(this.time * 7)) * 5);
    c.strokeStyle = "#dce0d2";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-2, -5);
    c.lineTo(-3 - stride, 1);
    c.moveTo(2, -5);
    c.lineTo(state === "kick" ? 10 : 3 + stride, state === "kick" ? -7 : 1);
    c.stroke();
    c.strokeStyle = "#16232a";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-3 - stride, 1);
    c.lineTo(-5 - stride, 1);
    c.moveTo(3 + stride, 1);
    c.lineTo(5 + stride, 1);
    c.stroke();
    c.fillStyle = jersey;
    c.strokeStyle = team.primary;
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(-6, -15, 12, 11, 3);
    c.fill();
    c.stroke();
    c.strokeStyle = jersey;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(-5, -12);
    c.lineTo(
      -8,
      state === "catch" ? -24 : state === "block" ? -15 : -7 - stride,
    );
    c.moveTo(5, -12);
    c.lineTo(
      state === "throw" ? 11 : 8,
      state === "catch"
        ? -24
        : state === "throw"
          ? -21
          : state === "block"
            ? -15
            : -7 + stride,
    );
    c.stroke();
    c.fillStyle = p.side ? team.primary : "#fff";
    c.font = "bold 7px system-ui";
    c.textAlign = "center";
    c.fillText(String(p.number), 0, -7);
    c.fillStyle = helmet;
    c.beginPath();
    c.ellipse(0, -18, 4.5, 5, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#20303a";
    c.fillRect(-3, -18, 6, 2);
    c.fillStyle = team.primary;
    c.fillRect(-0.8, -23, 1.6, 8);
    if (
      this.labels &&
      (carrier ||
        this.selected?.id === p.id ||
        (this.overlay && !["C", "G", "T", "DT", "DE"].includes(p.pos)))
    ) {
      c.fillStyle = "#061116c9";
      c.fillRect(-15, -36, 30, 10);
      c.fillStyle = "#fff";
      c.font = "7px system-ui";
      c.fillText(p.id + " " + p.pos, 0, -29);
    }
    c.restore();
  }
}
