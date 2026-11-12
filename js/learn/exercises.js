// Guided exercises for Inkwell Learning challenges. Each challenge has 4 exercises that draw
// their help straight into the canvas, on a locked "Guide" layer, with less help each time:
//   1 Trace it   – every line is there, go over it
//   2 Half help  – only the key lines; finish the rest
//   3 Start only – just the starting marks
//   4 On your own – no guide (perspective guides keep snapping off for the real test)
import { walkPose } from './demos.js';
import { ART } from './art.js';

export const LEVELS = ['Trace it', 'Half help', 'Start only', 'On your own'];
const BLUE = '#2f7dff', RED = '#ff5a5f', GREEN = '#2fbf71', ORANGE = '#ff9f1a';

// ───────── drawing helpers ─────────
function pen(x, W, { color = BLUE, w = 1, dash = true, alpha = 0.75 } = {}) {
  const u = W / 900;
  x.strokeStyle = color; x.fillStyle = color; x.globalAlpha = alpha; x.lineWidth = Math.max(1.5, 2.6 * u * w);
  x.setLineDash(dash ? [10 * u, 7 * u] : []); x.lineCap = 'round'; x.lineJoin = 'round';
  return u;
}
const line = (x, a, b) => { x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); };
const poly = (x, pts, close = true) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); if (close) x.closePath(); x.stroke(); };
function label(x, W, text, px, py, { color = BLUE, size = 1, align = 'left' } = {}) {
  const u = W / 900;
  x.save(); x.setLineDash([]); x.globalAlpha = 0.95; x.font = `600 ${Math.round(17 * u * size)}px -apple-system, Helvetica, sans-serif`; x.textAlign = align;
  x.lineWidth = 5 * u; x.strokeStyle = 'rgba(255,255,255,0.9)'; x.strokeText(text, px, py); x.fillStyle = color; x.fillText(text, px, py); x.restore();
}
function dot(x, W, p, color = BLUE, r = 1) { const u = W / 900; x.save(); x.setLineDash([]); x.globalAlpha = 0.9; x.fillStyle = color; x.beginPath(); x.arc(p.x, p.y, 6 * u * r, 0, 7); x.fill(); x.restore(); }
const P = (x, y) => ({ x, y });
const lerp = (a, b, t) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
function inter(a, b, c, d) { // intersection of lines ab and cd
  const d1x = b.x - a.x, d1y = b.y - a.y, d2x = d.x - c.x, d2y = d.y - c.y, den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return lerp(a, b, 0.5);
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / den;
  return P(a.x + d1x * t, a.y + d1y * t);
}
const svgImage = (svg) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
// draw an SVG recoloured to one guide colour
async function drawSVG(x, svg, dx, dy, dw, dh, color = BLUE, alpha = 0.6) {
  const im = await svgImage(svg); if (!im) return;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(dw)); c.height = Math.max(1, Math.round(dh));
  const t = c.getContext('2d'); t.drawImage(im, 0, 0, c.width, c.height);
  t.globalCompositeOperation = 'source-in'; t.fillStyle = color; t.fillRect(0, 0, c.width, c.height);
  x.save(); x.setLineDash([]); x.globalAlpha = alpha; x.drawImage(c, dx, dy, dw, dh); x.restore();
}
const vps = (d) => (d.persp ? d.persp.vps.map((v) => P(v.x, v.y)) : [P(-d.width * 0.3, d.height * 0.45), P(d.width * 1.3, d.height * 0.45)]);

// a box in perspective from its nearest vertical edge (B bottom, T top); a = depth toward VP1, b = toward VP2
function boxPts(d, B, T, a, b) {
  const [v1, v2, v3] = vps(d);
  const up = (p) => (v3 ? v3 : P(p.x, p.y - 1000)); // verticals: to VP3 in 3-point, else straight
  const BL = lerp(B, v1, a), BR = lerp(B, v2, b);
  const TL = inter(T, v1, BL, up(BL)), TR = inter(T, v2, BR, up(BR));
  const F = inter(TL, v2, TR, v1), FB = inter(BL, v2, BR, v1);
  return { B, T, BL, BR, TL, TR, F, FB, v1, v2 };
}
function drawBox(x, W, q, level, i) {
  if (level === 0) {
    pen(x, W, { alpha: 0.18, w: 0.6 }); line(x, q.T, q.v1); line(x, q.T, q.v2); line(x, q.B, q.v1); line(x, q.B, q.v2);
    pen(x, W);
    line(x, q.B, q.T); line(x, q.BL, q.TL); line(x, q.BR, q.TR);
    line(x, q.T, q.TL); line(x, q.T, q.TR); line(x, q.TL, q.F); line(x, q.TR, q.F);
    line(x, q.B, q.BL); line(x, q.B, q.BR);
    pen(x, W, { alpha: 0.25 }); line(x, q.BL, q.FB); line(x, q.BR, q.FB);
  } else if (level === 1) {
    pen(x, W); line(x, q.B, q.T); line(x, q.B, lerp(q.B, q.BL, 0.55)); line(x, q.B, lerp(q.B, q.BR, 0.55)); line(x, q.T, lerp(q.T, q.TL, 0.55)); line(x, q.T, lerp(q.T, q.TR, 0.55));
  } else if (level === 2) {
    pen(x, W, { dash: false, w: 1.4 }); line(x, q.B, q.T);
  }
  if (level < 3) label(x, W, String(i + 1), q.B.x, q.B.y + 26 * W / 900, { align: 'center' });
}

// ───────── real drawings (public domain / CC BY), used like an academy copy course ─────────
const imgCache = new Map();
function loadArt(id) {
  const a = ART[id]; if (!a) return Promise.resolve(null);
  if (!imgCache.has(id)) imgCache.set(id, new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = a.src; }));
  return imgCache.get(id);
}
// the drawing as ink on transparent paper (white / paper tone → transparent), so it sits under your layer like tracing paper
function inked(im) {
  const c = document.createElement('canvas'), k = Math.min(1, 1600 / Math.max(im.width, im.height));
  c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]; p[i + 3] = Math.max(0, Math.min(255, (238 - l) * 1.5)); }
  x.putImageData(d, 0, 0); return c;
}
function fit(iw, ih, bx, by, bw, bh) { const k = Math.min(bw / iw, bh / ih); return [bx + (bw - iw * k) / 2, by + (bh - ih * k) / 2, iw * k, ih * k]; }
// level 0 trace · 1 finish the other half · 2 look & copy beside it · 3 from memory
async function realDrawings(x, d, level, ids) {
  if (level === 3) return;
  // "id@a-b" = only that horizontal slice of the picture (e.g. one view of a model sheet)
  const W = d.width, H = d.height;
  const list = (await Promise.all(ids.map(async (spec) => {
    const [id, cut] = spec.split('@'), im = await loadArt(id); if (!im) return null;
    if (!cut) return [spec, im];
    const [a, b] = cut.split('-').map(Number), c = document.createElement('canvas');
    c.width = Math.round(im.width * (b - a)); c.height = im.height; c.getContext('2d').drawImage(im, -im.width * a, 0);
    return [spec, c];
  }))).filter(Boolean);
  if (!list.length) return;
  const n = list.length, cols = n === 1 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), cw = W / cols, ch = H / rows, u = W / 900;
  for (let i = 0; i < n; i++) {
    const [, im] = list[i], ink = inked(im), bx = (i % cols) * cw + cw * 0.04, by = Math.floor(i / cols) * ch + ch * 0.06, bw = cw * 0.92, bh = ch * 0.86;
    if (level < 2) {
      const [dx, dy, dw, dh] = fit(ink.width, ink.height, bx, by, bw, bh);
      x.save(); x.globalAlpha = 0.5;
      if (level === 1) { x.beginPath(); x.rect(dx, dy, dw / 2, dh); x.clip(); }
      x.drawImage(ink, dx, dy, dw, dh); x.restore();
      if (level === 1) { pen(x, W, { color: RED, alpha: 0.6 }); line(x, P(dx + dw / 2, dy), P(dx + dw / 2, dy + dh)); label(x, W, 'finish this half →', dx + dw * 0.52, dy + 20 * u, { color: RED, size: 0.8 }); }
    } else {
      // reference on the left at full strength, an empty frame of the same shape on the right to copy into
      const half = bw * 0.46, [dx, dy, dw, dh] = fit(ink.width, ink.height, bx, by, half, bh);
      x.save(); x.globalAlpha = 1; x.drawImage(ink, dx, dy, dw, dh); x.restore();
      pen(x, W, { alpha: 0.5 }); x.strokeRect(bx + bw * 0.52, dy, dw, dh);
      label(x, W, 'copy it here', bx + bw * 0.52 + dw / 2, dy - 8 * u, { align: 'center', size: 0.8 });
    }
  }
}
const REAL_LEVELS = ['Trace it', 'Finish the half', 'Look & copy', 'From memory'];

// ───────── the guide kinds ─────────
const KINDS = {
  // Perspective · boxes in 2-point (also used for streets)
  boxes2: {
    tips: ['Trace every dashed edge. Start each line in its direction: Snap keeps it straight and aims it at the right point.', 'The first edges of each box are drawn. Finish each box: side verticals first, then the back edges.', 'Only the front corner of each box is given. Build the whole box from it.', 'Draw 6 boxes of your own: above, below and across the orange horizon. For a real test, turn Snap off in the Perspective tool.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, hy = vps(d)[0].y;
      const spots = [[0.2, hy + H * 0.12, H * 0.18], [0.5, hy + H * 0.22, H * 0.2], [0.8, hy + H * 0.1, H * 0.14], [0.3, hy - H * 0.28, H * 0.13], [0.7, hy - H * 0.3, H * 0.15], [0.5, hy + H * 0.08, H * 0.22]];
      spots.slice(0, 5).forEach(([fx, by, hh], i) => { const B = P(W * fx, by + hh * 0.5), T = P(W * fx, by - hh * 0.5); drawBox(x, W, boxPts(d, B, T, 0.16, 0.18), level, i); });
    },
  },
  // Perspective · three eye levels side by side
  eyelevels: {
    tips: ['Trace the three little scenes. Each has a different eye level (orange): notice whether you see the top or the bottom of the box.', 'Only the horizons and the box fronts are there. Finish the boxes, the doors and the people.', 'Only the three horizons. Draw the same box, door and person under each one.', 'On your own: three frames, three eye levels: worm\'s-eye, standing, bird\'s-eye.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, fw = W / 3;
      [0.82, 0.45, 0.12].forEach((hf, k) => {
        const ox = fw * k, hy = H * hf;
        if (level < 3) { pen(x, W, { dash: false, alpha: 0.5, w: 0.8 }); x.strokeRect(ox + fw * 0.04, H * 0.04, fw * 0.92, H * 0.92); }
        if (level < 3) { pen(x, W, { color: ORANGE, dash: false, w: 1.2 }); line(x, P(ox + fw * 0.04, hy), P(ox + fw * 0.96, hy)); label(x, W, ['Worm\'s-eye', 'Standing', 'Bird\'s-eye'][k], ox + fw * 0.08, hy - 10, { color: ORANGE, size: 0.8 }); }
        if (level > 1) return;
        const v1 = P(ox - fw * 0.6, hy), v2 = P(ox + fw * 1.6, hy);
        const fake = { width: W, height: H, persp: { vps: [v1, v2] } };
        const B = P(ox + fw * 0.45, H * 0.72), T = P(ox + fw * 0.45, H * 0.52);
        const q = boxPts(fake, B, T, 0.12, 0.14);
        if (level === 0) drawBox(x, W, q, 0, k); else { pen(x, W); line(x, q.B, q.T); line(x, q.B, q.BL); line(x, q.B, q.BR); }
        if (level === 0) { // a person: same height as the box, standing on the same ground
          pen(x, W); const fx = ox + fw * 0.8, fb = H * 0.8, fh = H * 0.24;
          x.beginPath(); x.arc(fx, fb - fh + fh * 0.08, fh * 0.08, 0, 7); x.stroke(); line(x, P(fx, fb - fh * 0.84), P(fx, fb - fh * 0.45)); line(x, P(fx, fb - fh * 0.45), P(fx - fh * 0.08, fb)); line(x, P(fx, fb - fh * 0.45), P(fx + fh * 0.08, fb));
        }
      });
    },
  },
  // Perspective · 1-point room
  room1: {
    tips: ['Trace the room: back wall, the four corner lines to the vanishing point, the door, the window and the bed.', 'The back wall and corners are drawn. Add the door, the window, the bed and a shelf.', 'Only the back wall is given. Pull the corner lines to the vanishing point yourself, then furnish the room.', 'On your own: your own room, from an empty page.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, v = vps(d)[0];
      const bw = W * 0.36, bh = H * 0.36, L = v.x - bw / 2, R = v.x + bw / 2, T = v.y - bh * 0.62, Bt = v.y + bh * 0.38;
      const back = [P(L, T), P(R, T), P(R, Bt), P(L, Bt)];
      if (level === 3) return;
      pen(x, W, { dash: level === 2 ? false : true }); poly(x, back);
      if (level === 2) { dot(x, W, v, RED); label(x, W, 'Pull each corner away from the red point', L, T - 14); return; }
      pen(x, W); for (const c of back) line(x, c, lerp(v, c, 6));
      if (level === 1) return;
      // door on the left wall, window on the back wall, bed box on the floor
      const k = (p, t) => lerp(v, p, t);
      const dl = [k(P(L, Bt), 1.6), k(P(L, Bt), 2.2)], dt = [k(P(L, T + bh * 0.25), 1.6), k(P(L, T + bh * 0.25), 2.2)];
      poly(x, [dl[0], dt[0], dt[1], dl[1]], false);
      poly(x, [P(v.x - bw * 0.15, T + bh * 0.2), P(v.x + bw * 0.25, T + bh * 0.2), P(v.x + bw * 0.25, T + bh * 0.5), P(v.x - bw * 0.15, T + bh * 0.5)]);
      const f0 = P(v.x + bw * 0.1, Bt), f1 = P(R - bw * 0.02, Bt), n0 = k(f0, 1.7), n1 = k(f1, 1.7), hgt = bh * 0.14;
      poly(x, [f0, f1, n1, n0]); poly(x, [P(f0.x, f0.y - hgt), P(f1.x, f1.y - hgt), P(n1.x, n1.y - hgt * 1.7), P(n0.x, n0.y - hgt * 1.7)]);
      line(x, n0, P(n0.x, n0.y - hgt * 1.7)); line(x, n1, P(n1.x, n1.y - hgt * 1.7));
    },
  },
  // Perspective · 3-point towers
  tower3: {
    tips: ['Trace the towers. Their verticals all lean toward the blue point far below.', 'The front edges are there. Finish each tower, then add the street far below and a character on the roof.', 'Only the front edges. Build the towers yourself.', 'On your own: a rooftop scene seen from above.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, [, , v3] = vps(d);
      [[0.3, 0.25, 0.75], [0.62, 0.18, 0.8], [0.85, 0.35, 0.7]].forEach(([fx, ty, by], i) => {
        const T = P(W * fx, H * ty), B = lerp(T, v3, (H * by - T.y) / (v3.y - T.y));
        drawBox(x, W, boxPts(d, B, T, 0.06, 0.07), level, i);
      });
    },
  },
  // Perspective · cylinders and ellipses on a table
  ellipses: {
    tips: ['Trace the perspective squares and the ellipses inside them. Ellipses touch the middle of each side.', 'Only the squares are drawn. Fit an ellipse into each one, then turn them into a mug, a bowl, a bottle and a plate.', 'Only the centres are marked. Draw the square, then the ellipse.', 'On your own: a still life of round things.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, [v1, v2] = vps(d);
      [[0.22, 0.66, 0.1], [0.48, 0.74, 0.12], [0.74, 0.64, 0.09], [0.45, 0.9, 0.1]].forEach(([fx, fy, s], i) => {
        const N = P(W * fx, H * fy), A = lerp(N, v1, s), Bq = lerp(N, v2, s), Fq = inter(A, v2, Bq, v1);
        const c = inter(N, Fq, A, Bq);
        if (level === 3) return;
        if (level === 2) { dot(x, W, c); label(x, W, String(i + 1), c.x, c.y + 30 * W / 900, { align: 'center' }); return; }
        pen(x, W); poly(x, [N, A, Fq, Bq]);
        if (level === 0) {
          // the ellipse touches each side at its perspective middle (found through the centre)
          const m = [inter(c, v2, N, A), inter(c, v1, A, Fq), inter(c, v2, Fq, Bq), inter(c, v1, Bq, N)];
          pen(x, W, { color: RED }); ellipseThrough(x, m, c);
        }
      });
    },
  },
  // Perspective · people at the right size
  crowd: {
    tips: ['Trace the people. Every head is cut by the orange horizon at the eyes, near or far.', 'Only the feet and the head lines are marked. Draw each person between them.', 'Only the feet are marked. Use the horizon trick to find each person\'s height.', 'On your own: a market street with 8 people.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, hy = vps(d)[0].y, eye = 0.93; // horizon at 93% of a person's height
      const ppl = [[0.18, 0.95], [0.4, 0.78], [0.62, 0.68], [0.8, 0.62], [0.5, 0.58], [0.28, 0.56]];
      if (level < 3) { pen(x, W, { color: ORANGE, dash: false }); line(x, P(0, hy), P(W, hy)); label(x, W, 'Eye level', W * 0.02, hy - 10, { color: ORANGE }); }
      ppl.forEach(([fx, fy], i) => {
        const feet = P(W * fx, H * fy), hgt = (feet.y - hy) / eye, top = feet.y - hgt;
        if (level === 3) return;
        dot(x, W, feet);
        if (level === 2) return;
        pen(x, W, { alpha: 0.5 }); line(x, P(feet.x - hgt * 0.25, top), P(feet.x + hgt * 0.25, top));
        if (level === 1) return;
        pen(x, W);
        x.beginPath(); x.ellipse(feet.x, top + hgt * 0.065, hgt * 0.055, hgt * 0.065, 0, 0, 7); x.stroke();
        poly(x, [P(feet.x - hgt * 0.12, top + hgt * 0.17), P(feet.x + hgt * 0.12, top + hgt * 0.17), P(feet.x + hgt * 0.09, top + hgt * 0.52), P(feet.x - hgt * 0.09, top + hgt * 0.52)]);
        line(x, P(feet.x - hgt * 0.05, top + hgt * 0.52), P(feet.x - hgt * 0.06, feet.y)); line(x, P(feet.x + hgt * 0.05, top + hgt * 0.52), P(feet.x + hgt * 0.06, feet.y));
      });
    },
  },
  // Backgrounds · thumbnails
  thumbs: {
    tips: ['Trace the thumbnail frames, the thirds and the suggested big shapes (horizon, focal point). Fill them in 3 greys.', 'Frames and thirds only. Place a horizon and a focal point in each, all different.', 'Only the frames. Plan each composition yourself.', 'On your own: 8 thumbnails, under a minute each.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, cols = 4, rows = 2, fw = W / cols, fh = H / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (level === 3) return;
        const ox = c * fw + fw * 0.08, oy = r * fh + fh * 0.12, w = fw * 0.84, hh = Math.min(fh * 0.7, w * 0.62);
        pen(x, W, { dash: false, alpha: 0.6 }); x.strokeRect(ox, oy, w, hh);
        if (level === 2) continue;
        pen(x, W, { alpha: 0.3, w: 0.6 }); for (const t of [1 / 3, 2 / 3]) { line(x, P(ox + w * t, oy), P(ox + w * t, oy + hh)); line(x, P(ox, oy + hh * t), P(ox + w, oy + hh * t)); }
        if (level === 1) continue;
        const i = r * cols + c, hz = [0.66, 0.33, 0.75, 0.5, 0.3, 0.8, 0.6, 0.4][i], fx = [1, 2, 1, 2, 2, 1, 2, 1][i] / 3;
        pen(x, W, { color: ORANGE, dash: false }); line(x, P(ox, oy + hh * hz), P(ox + w, oy + hh * hz));
        dot(x, W, P(ox + w * fx, oy + hh * (hz - 0.05)), RED);
      }
    },
  },
  // Backgrounds · three planes
  planes: {
    tips: ['Trace the three ridges and fill each plane with its own single grey (darkest in front, lightest at the back).', 'Only the ridges. Fill each plane, then add the haze.', 'Only the horizon is marked. Invent your three planes.', 'On your own: a landscape on three layers.'],
    draw(x, d, level) {
      const W = d.width, H = d.height;
      if (level === 3) return;
      if (level === 2) { pen(x, W, { color: ORANGE, dash: false }); line(x, P(0, H * 0.45), P(W, H * 0.45)); return; }
      const ridge = (base, amp, seed) => { const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(P(t * W, H * (base - amp * (0.5 + 0.5 * Math.sin(t * 7 + seed) * Math.cos(t * 3 + seed * 2))))); } return pts; };
      [[0.48, 0.16, 1, 'Background (lightest)'], [0.64, 0.14, 2.5, 'Middle ground'], [0.84, 0.12, 4, 'Foreground (darkest)']].forEach(([b, a, s, name]) => {
        const pts = ridge(b, a, s); pen(x, W); poly(x, pts, false);
        if (level === 0) label(x, W, name, W * 0.03, Math.min(...pts.map((p) => p.y)) + H * 0.08);
      });
    },
  },
  // Backgrounds · notan (2-value) frames
  notan: {
    tips: ['Trace the big shapes in the four frames and fill them pure black or white.', 'The frames and thirds only. Design four black-and-white compositions.', 'Only the frames.', 'On your own.'],
    draw(x, d, level) {
      const W = d.width, H = d.height;
      for (let k = 0; k < 4; k++) {
        if (level === 3) return;
        const ox = (k % 2) * W / 2 + W * 0.05, oy = Math.floor(k / 2) * H / 2 + H * 0.06, w = W * 0.4, hh = H * 0.38;
        pen(x, W, { dash: false, alpha: 0.6 }); x.strokeRect(ox, oy, w, hh);
        if (level === 2) continue;
        if (level === 1) { pen(x, W, { alpha: 0.3, w: 0.6 }); for (const t of [1 / 3, 2 / 3]) { line(x, P(ox + w * t, oy), P(ox + w * t, oy + hh)); line(x, P(ox, oy + hh * t), P(ox + w, oy + hh * t)); } continue; }
        pen(x, W); const hz = oy + hh * [0.6, 0.4, 0.7, 0.5][k];
        x.beginPath(); x.moveTo(ox, hz); x.bezierCurveTo(ox + w * 0.3, hz - hh * 0.2, ox + w * 0.6, hz + hh * 0.1, ox + w, hz - hh * 0.05); x.stroke();
        x.beginPath(); x.arc(ox + w * [0.66, 0.33, 0.33, 0.66][k], hz - hh * 0.12, hh * 0.08, 0, 7); x.stroke();
      }
    },
  },
  // Faces · head construction from real drawings: Pepper's official model sheet (with its proportion lines) and Dürer
  headsReal: {
    levels: REAL_LEVELS,
    tips: ['Trace the heads from the real model sheet: first the big shapes (skull, jaw, hair mass), then the eyes on the eye line, then details. Notice the horizontal lines: every feature sits on the same line in every view.', 'Only the left half of each head is shown. Finish the right half yourself, keeping the eyes, nose and mouth on the same lines.', 'Look & copy: the drawing is on the left; copy it into the empty frame beside it without tracing. Measure: how many eyes wide is the head?', 'From memory: draw the same character from front, ¾ and side, with the help hidden. Then compare with the model sheet.'],
    draw: (x, d, level) => realDrawings(x, d, level, ['pc-head-construction@0-0.34', 'pc-head-construction@0.34-0.63', 'pc-head-construction@0.63-1', 'durer-head-front'].filter((id) => ART[id.split('@')[0]])),
  },
  // Faces · Le Brun's expression heads (CC0, The Met)
  lebrun: {
    levels: REAL_LEVELS,
    tips: ['Trace Charles Le Brun\'s six expression heads. Go slowly over the brows, the eyelids and the mouth corners: they carry the emotion.', 'Half of each face is there. Finish the other half so the expression matches.', 'Look & copy each head into the frame beside it, without tracing.', 'From memory: draw the six emotions on your own character.'],
    draw: (x, d, level) => realDrawings(x, d, level, ['lebrun-sadness', 'lebrun-laughter', 'lebrun-fright', 'lebrun-hatred', 'lebrun-pain', 'lebrun-desire']),
  },
  // Faces · expressions in comic style (Saffron's line art from Pepper&Carrot)
  pcExpr: {
    levels: REAL_LEVELS,
    tips: ['Trace David Revoy\'s expression drawings of Saffron (Pepper&Carrot). Watch how few lines it takes: brows, eye shape and mouth.', 'Half of each drawing is shown. Finish it.', 'Look & copy the drawings into the frames beside them.', 'From memory: draw the same expressions on your own character.'],
    draw: (x, d, level) => realDrawings(x, d, level, ['pc-saffron-lineart']),
  },
  // Faces · a real model sheet
  sheetReal: {
    levels: REAL_LEVELS,
    tips: ['Trace Pepper\'s official model sheet: front, side and back at the same height, on the same lines.', 'Finish the other half of each view.', 'Look & copy the model sheet beside it.', 'From memory: make a model sheet of your own character.'],
    draw: (x, d, level) => realDrawings(x, d, level, ['pc-model-full']),
  },
  // Colour · colour real line art (Saffron, from Pepper&Carrot), given above your paint layer
  colorReal: {
    over: true,
    levels: ['Colour it', 'Colour it, own palette', 'Ink the sketch, then colour', 'On your own'],
    tips: ['David Revoy\'s line art is given, locked above your layer and marked as a Reference, with his coloured model sheet beside it as a colour example. Fill the flats (Fill reads the line art), then add one Multiply shadow layer.', 'Same line art, no example: pick your own harmony (60-30-10), then flats and shadows.', 'Only his blue construction sketch is given. Ink it on your layer first, then colour it.', 'On your own: draw and colour your own character.'],
    async draw(x, d, level) {
      if (level === 3) return;
      const W = d.width, H = d.height;
      if (level === 2) { const im = await loadArt('pc-saffron-sketch'); if (im) { const [dx, dy, dw, dh] = fit(im.width, im.height, W * 0.1, H * 0.04, W * 0.8, H * 0.92); x.save(); x.globalAlpha = 0.55; x.drawImage(inked(im), dx, dy, dw, dh); x.restore(); } return; }
      const im = await loadArt('pc-saffron-ink');
      if (im) { const [dx, dy, dw, dh] = fit(im.width, im.height, W * (level === 0 ? 0.3 : 0.1), H * 0.04, W * (level === 0 ? 0.68 : 0.8), H * 0.92); x.save(); x.globalAlpha = 1; x.drawImage(inked(im), dx, dy, dw, dh); x.restore(); }
      if (level === 0) { const ref = await loadArt('pc-model-full'); if (ref) { const [dx, dy, dw, dh] = fit(ref.width, ref.height, W * 0.02, H * 0.04, W * 0.26, H * 0.6); x.drawImage(ref, dx, dy, dw, dh); label(x, W, 'colour example', dx + dw / 2, dy + dh + 22 * W / 900, { align: 'center', size: 0.8 }); } }
    },
  },
  // Grading · a real painting to grade (Pepper&Carrot artwork), on your exercise layer
  gradeReal: {
    paint: true,
    levels: ['Follow a recipe', 'Hit a mood', 'Your own mood', 'Your own picture'],
    tips: ['Grade David Revoy\'s landscape with this recipe: Adjustments › Color Balance (shadows towards blue, highlights towards orange), then Levels / Contrast for punch, then a soft dark vignette on a Multiply layer.', 'Make this painting feel like a cold night: darker, cooler, less saturated, with one warm light that stays.', 'Pick your own mood for this portrait, write it in one word, and grade the painting to match.', 'On your own: grade one of your own finished pictures three ways.'],
    async draw(x, d, level) {
      if (level === 3) return;
      const im = await loadArt(['pc-landscape', 'pc-environment', 'pc-portrait-light'][level]); if (!im) return;
      const W = d.width, H = d.height, k = Math.max(W / im.width, H / im.height);
      x.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k);
    },
  },
  // Colour · light study shapes
  spheres: {
    tips: ['Trace the shapes. The red dashed line is where light turns into shadow (the terminator); shade everything on the far side of it.', 'Only the shapes and the light direction. Find the terminators yourself.', 'Only the light direction and where each shape sits.', 'On your own: same light, your own shapes.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, R = Math.min(W, H) * 0.14, cy = H * 0.5, L = P(W * 0.08, H * 0.12);
      if (level < 3) { pen(x, W, { color: ORANGE, dash: false, w: 1.4 }); line(x, L, P(W * 0.2, H * 0.28)); dot(x, W, L, ORANGE, 2); label(x, W, 'Light', L.x + 20, L.y, { color: ORANGE }); }
      [W * 0.25, W * 0.55, W * 0.82].forEach((cx, i) => {
        if (level === 3) return;
        if (level === 2) { dot(x, W, P(cx, cy)); return; }
        pen(x, W);
        if (i === 0) { x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke(); }
        if (i === 1) { const s = R * 0.85; poly(x, [P(cx - s, cy - s * 0.4), P(cx, cy - s * 0.85), P(cx + s, cy - s * 0.4), P(cx, cy + 0.05 * s)]); poly(x, [P(cx - s, cy - s * 0.4), P(cx - s, cy + s * 0.75), P(cx, cy + s * 1.2), P(cx + s, cy + s * 0.75), P(cx + s, cy - s * 0.4)], false); line(x, P(cx, cy + 0.05 * s), P(cx, cy + s * 1.2)); }
        if (i === 2) { x.beginPath(); x.ellipse(cx, cy - R * 0.1, R * 0.75, R * 0.95, 0, 0, 7); x.stroke(); }
        // cast shadow ellipse on the ground
        x.beginPath(); x.ellipse(cx + R * 0.5, cy + R * 1.15, R * 0.95, R * 0.22, 0, 0, 7); x.stroke();
        if (level === 0) { pen(x, W, { color: RED }); x.beginPath(); x.ellipse(cx + R * 0.15, cy + R * 0.1, R * 0.35, R * 0.95, -0.5, -Math.PI / 2, Math.PI / 2); x.stroke(); }
      });
    },
  },
  // Animation · bouncing ball path (all frames shown at once on the guide track)
  bounce: {
    tips: ['Each numbered circle is where the ball is on that frame. Go to frame 1, draw the ball over circle 1, add a frame, draw over circle 2… Turn Onion skin on.', 'Only the path, the contacts (squash!) and the tops are marked. Inbetween the rest yourself.', 'Only the ground and the starting position.', 'On your own: three balls, three materials.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, gy = H * 0.85, top = H * 0.15, r = H * 0.045, n = 12, fr = Math.min(48, d.anim.length || 48);
      if (level < 3) { pen(x, W, { color: '#888', dash: false }); line(x, P(0, gy + r), P(W, gy + r)); }
      let hgt = 1, f = 0;
      const pts = [];
      for (let b = 0; b < 5 && f < fr; b++) { const nb = Math.max(4, Math.round(n * Math.pow(0.8, b))); for (let k = 0; k < nb && f < fr; k++, f++) { const u = k / nb; pts.push({ f, x: W * 0.06 + (W * 0.88) * f / fr, y: gy - hgt * 4 * u * (1 - u) * (gy - top), contact: k === 0, top: k === Math.round(nb / 2) }); } hgt *= 0.62; }
      if (level === 3) return;
      if (level === 2) { pen(x, W); x.beginPath(); x.arc(pts[0].x, pts[0].y, r, 0, 7); x.stroke(); label(x, W, 'Frame 1', pts[0].x, pts[0].y - r - 10, { align: 'center' }); return; }
      pen(x, W, { alpha: 0.35 }); poly(x, pts.map((p) => P(p.x, p.y)), false);
      for (const p of pts) {
        if (level === 1 && !p.contact && !p.top) continue;
        pen(x, W, { color: p.contact ? RED : BLUE, alpha: 0.7 });
        x.beginPath(); if (p.contact && p.f) x.ellipse(p.x, gy + r * 0.3, r * 1.35, r * 0.65, 0, 0, 7); else x.arc(p.x, p.y, r, 0, 7); x.stroke();
        label(x, W, String(p.f + 1), p.x, (p.contact ? gy : p.y) - r - 8, { align: 'center', size: 0.8, color: p.contact ? RED : BLUE });
      }
    },
  },
  // Animation · a ball sliding with ease in / out
  slide: {
    tips: ['12 drawings, eased in and out: trace one circle per frame (frame number above it). Notice they bunch up at both ends.', 'Only the two keys and the timing chart are given. Place the inbetweens by the chart.', 'Only the two keys. Make your own chart.', 'On your own: three slides with even, ease-out and ease-in-out spacing.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, y = H * 0.55, r = H * 0.05, x0 = W * 0.1, x1 = W * 0.9, n = 12;
      const k = Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return x0 + (x1 - x0) * t * t * (3 - 2 * t); });
      if (level === 3) return;
      pen(x, W, { color: RED, dash: false }); for (const px of [k[0], k[n - 1]]) { x.beginPath(); x.arc(px, y, r, 0, 7); x.stroke(); }
      label(x, W, 'KEY · frame 1', k[0], y - r - 12, { color: RED, align: 'center' }); label(x, W, 'KEY · frame ' + n, k[n - 1], y - r - 12, { color: RED, align: 'center' });
      if (level === 2) return;
      pen(x, W, { dash: false }); line(x, P(x0, H * 0.25), P(x1, H * 0.25)); for (const px of k) line(x, P(px, H * 0.23), P(px, H * 0.27)); label(x, W, 'Timing chart', x0, H * 0.21);
      if (level === 1) return;
      pen(x, W); k.slice(1, -1).forEach((px, i) => { x.beginPath(); x.arc(px, y, r, 0, 7); x.stroke(); label(x, W, String(i + 2), px, y + r + 24 * W / 900, { align: 'center', size: 0.8 }); });
    },
  },
  // Animation · arc swing
  arc: {
    tips: ['Trace the swing: one position per frame, all on the arc (numbers = frames). Ease in and out at both ends.', 'Only the pivot, the arc and the two end keys. Inbetween on the arc.', 'Only the pivot and the arc.', 'On your own: a head turn with a dip in the middle.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, pv = P(W / 2, H * 0.12), L = H * 0.68, a0 = -0.9, a1 = 0.9, n = 11;
      if (level === 3) return;
      dot(x, W, pv, RED, 1.5);
      pen(x, W, { alpha: 0.4 }); x.beginPath(); x.arc(pv.x, pv.y, L, Math.PI / 2 - a1, Math.PI / 2 - a0); x.stroke();
      if (level === 2) return;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), e = 0.5 - 0.5 * Math.cos(t * Math.PI), a = a0 + (a1 - a0) * e;
        if (level === 1 && i && i < n - 1) continue;
        const p = P(pv.x + Math.sin(a) * L, pv.y + Math.cos(a) * L);
        pen(x, W, { alpha: 0.6 }); line(x, pv, p); x.beginPath(); x.arc(p.x, p.y, H * 0.04, 0, 7); x.stroke();
        label(x, W, String(i + 1), p.x, p.y + H * 0.08, { align: 'center', size: 0.8 });
      }
    },
  },
  // Animation · flour-sack jump keys
  jump: {
    tips: ['The key poses are drawn with their frame numbers: stand (1), crouch (6), take-off (10), top (16), land (22), settle (28). Draw each one on its frame, then the inbetweens.', 'Only the path of the jump and the ground. Design the key poses yourself.', 'Only the ground and the starting spot.', 'On your own: a jump onto a box.'],
    draw(x, d, level) {
      const W = d.width, H = d.height, gy = H * 0.85, s = H * 0.2;
      if (level < 3) { pen(x, W, { color: '#888', dash: false }); line(x, P(0, gy), P(W, gy)); }
      const keys = [[0.15, 0, 1, 0, 1], [0.17, 0, 0.7, 1.3, 6], [0.25, 0.05, 1.25, 0.8, 10], [0.5, 0.55, 1.05, 0.95, 16], [0.75, 0, 0.65, 1.35, 22], [0.78, 0, 1, 1, 28]];
      if (level === 3) return;
      if (level === 2) { dot(x, W, P(W * 0.15, gy)); label(x, W, 'start', W * 0.15, gy + 26 * W / 900, { align: 'center' }); return; }
      pen(x, W, { alpha: 0.35 }); x.beginPath(); x.moveTo(W * 0.2, gy - s * 0.4); x.quadraticCurveTo(W * 0.48, gy - H * 0.95, W * 0.75, gy - s * 0.3); x.stroke();
      if (level === 1) return;
      for (const [fx, lift, sy, sx, f] of keys) {
        const cx = W * fx, by = gy - lift * H, hh = s * sy, ww = s * 0.75 * sx;
        pen(x, W); x.beginPath(); x.moveTo(cx - ww / 2, by); x.bezierCurveTo(cx - ww * 0.62, by - hh * 0.5, cx - ww * 0.45, by - hh * 0.9, cx - ww * 0.2, by - hh); x.lineTo(cx + ww * 0.2, by - hh); x.bezierCurveTo(cx + ww * 0.45, by - hh * 0.9, cx + ww * 0.62, by - hh * 0.5, cx + ww / 2, by); x.closePath(); x.stroke();
        label(x, W, 'frame ' + f, cx, by + 26 * W / 900, { align: 'center', size: 0.8 });
      }
    },
  },
  // Animation · walk cycle key poses
  walk: {
    tips: ['The 8 key poses of a walk are drawn along the top as a guide (frame numbers below each), and the hip-height line shows up-and-down. Draw your character in place in the middle, one key per frame.', 'Only the two contact poses and the passing poses are shown. Work out down and up yourself.', 'Only the ground line and the high/low hip marks.', 'On your own: a walk with personality (happy, sad, sneaky…).'],
    draw(x, d, level) {
      const W = d.width, H = d.height, gy = H * 0.9, th = H * 0.17, sh = H * 0.16;
      if (level < 3) { pen(x, W, { color: '#888', dash: false }); line(x, P(0, gy), P(W, gy)); }
      if (level === 3) return;
      const hipY = gy - th - sh;
      pen(x, W, { color: ORANGE, alpha: 0.6 }); line(x, P(W * 0.35, hipY - H * 0.015), P(W * 0.65, hipY - H * 0.015)); line(x, P(W * 0.35, hipY + H * 0.02), P(W * 0.65, hipY + H * 0.02));
      label(x, W, 'hip: highest on UP', W * 0.66, hipY - H * 0.015, { color: ORANGE, size: 0.8 }); label(x, W, 'lowest on DOWN', W * 0.66, hipY + H * 0.035, { color: ORANGE, size: 0.8 });
      if (level === 2) return;
      const names = ['CONTACT', 'DOWN', 'PASSING', 'UP', 'CONTACT', 'DOWN', 'PASSING', 'UP'];
      for (let i = 0; i < 8; i++) {
        if (level === 1 && ![0, 2, 4, 6].includes(i)) continue;
        const p = walkPose(i / 8), cx = W * (0.07 + i * 0.123), sc = 0.42, hy = H * 0.32 - p.hip * H * 0.002, t2 = th * sc, s2 = sh * sc;
        const leg = (ang, knee, col) => { const a = ang * Math.PI / 180, k = P(cx + Math.sin(a) * t2, hy + Math.cos(a) * t2), b = (ang - knee) * Math.PI / 180, f = P(k.x + Math.sin(b) * s2, k.y + Math.cos(b) * s2); pen(x, W, { color: col, dash: false }); poly(x, [P(cx, hy), k, f, P(f.x + s2 * 0.25, f.y)], false); };
        leg(p.R[0], p.R[1], '#8aa2d8'); leg(p.L[0], p.L[1], BLUE);
        pen(x, W, { dash: false }); line(x, P(cx, hy), P(cx + 2, hy - t2 * 1.1)); x.beginPath(); x.arc(cx + 3, hy - t2 * 1.45, t2 * 0.25, 0, 7); x.stroke();
        label(x, W, names[i], cx, hy + t2 + s2 + 26 * W / 900, { align: 'center', size: 0.7 }); label(x, W, 'f ' + (i * 3 + 1), cx, hy + t2 + s2 + 46 * W / 900, { align: 'center', size: 0.7 });
      }
    },
  },
  // Webtoon · panel layout down the strip
  panels: {
    tips: ['Trace the panels. Each one has its story beat written in it, and the gutter sizes are marked: a long gutter = a pause before the big moment.', 'Only the panel boxes. Decide what happens in each one, and leave room for balloons.', 'Only the gutter marks on the left. Draw your own panels.', 'On your own: thumbnail a whole episode.'],
    draw(x, d, level) {
      const W = d.width, H = d.height;
      const beats = [[0.9, 'Wide: where are we?'], [0.6, 'Medium: who is here?'], [0.5, 'Close-up: a reaction'], [0.55, 'Medium: they talk'], [0.45, 'Close-up: something is wrong'], [1.6, 'BIG reveal (tall panel)'], [0.6, 'Reaction'], [0.7, 'Hook: end on a question']];
      const gut = [120, 90, 70, 110, 420, 120, 160];
      let y = 80;
      for (let i = 0; i < beats.length && y < H - 200; i++) {
        const hh = Math.min(beats[i][0] * W, H - y - 60), m = i === 2 || i === 4 ? W * 0.14 : W * 0.05;
        if (level === 2) { pen(x, W, { dash: false }); line(x, P(8, y), P(28, y)); line(x, P(8, y + hh), P(28, y + hh)); }
        else if (level < 2) {
          pen(x, W, { dash: level === 0, w: 1.3 }); x.strokeRect(m, y, W - 2 * m, hh);
          if (level === 0) { label(x, W, `${i + 1}. ${beats[i][1]}`, m + 16, y + 34 * W / 900); pen(x, W, { alpha: 0.4 }); x.beginPath(); x.ellipse(W - m - W * 0.18, y + hh * 0.25, W * 0.12, Math.min(hh * 0.12, W * 0.05), 0, 0, 7); x.stroke(); }
        }
        y += hh;
        if (i < gut.length && level < 3) { if (level === 0) label(x, W, `gutter ${gut[i]} px${gut[i] > 300 ? ' — pause!' : ''}`, W / 2, y + gut[i] / 2 + 6, { align: 'center', size: 0.8, color: '#888' }); }
        y += gut[i] || 100;
      }
    },
  },
  // Webtoon · balloons in a two-person conversation
  balloons: {
    tips: ['Trace the panels, the two speakers (A speaks first, so A is on the LEFT) and the numbered balloons in reading order. Then letter them with the Balloon tool.', 'Panels and speakers only. Place the balloons yourself: top to bottom, left to right, tails never crossing.', 'Only the panels. Block the speakers so the first one is on the left.', 'On your own: a 6-panel conversation.'],
    draw(x, d, level) {
      const W = d.width, H = d.height;
      let y = 60;
      for (let i = 0; i < 6 && y < H - 300; i++) {
        const hh = W * 0.62;
        if (level === 3) return;
        pen(x, W, { dash: level === 0, w: 1.3 }); x.strokeRect(W * 0.05, y, W * 0.9, hh);
        if (level < 2) {
          for (const [fx, who] of [[0.28, 'A'], [0.72, 'B']]) { pen(x, W); x.beginPath(); x.arc(W * fx, y + hh * 0.62, W * 0.07, 0, 7); x.stroke(); x.strokeRect(W * (fx - 0.09), y + hh * 0.75, W * 0.18, hh * 0.24); label(x, W, who, W * fx, y + hh * 0.64, { align: 'center' }); }
        }
        if (level === 0) {
          [[0.3, 0.18, 'A', 1], [0.68, 0.33, 'B', 2]].forEach(([fx, fy, who, n]) => {
            pen(x, W, { color: ORANGE }); x.beginPath(); x.ellipse(W * fx, y + hh * fy, W * 0.19, hh * 0.09, 0, 0, 7); x.stroke();
            line(x, P(W * fx, y + hh * (fy + 0.09)), P(W * (who === 'A' ? 0.28 : 0.72), y + hh * 0.5));
            label(x, W, `${i * 2 + n}`, W * fx, y + hh * fy + 6, { color: ORANGE, align: 'center' });
          });
        }
        y += hh + 110;
      }
    },
  },
};

// which guide each lesson's challenge uses
export const GUIDE_FOR = {
  'perspective/horizon': 'eyelevels', 'perspective/tool': 'boxes2', 'perspective/one-point': 'room1', 'perspective/two-point': 'boxes2', 'perspective/three-point': 'tower3', 'perspective/ellipses': 'ellipses', 'perspective/scale': 'crowd',
  'backgrounds/composition': 'thumbs', 'backgrounds/depth': 'planes', 'backgrounds/atmosphere': 'planes', 'backgrounds/references': 'boxes2', 'backgrounds/values': 'notan',
  'faces/loomis': 'headsReal', 'faces/universal': 'lebrun', 'faces/reading': 'pcExpr', 'faces/push': 'pcExpr', 'faces/sheet': 'sheetReal',
  'color/value': 'colorReal', 'color/harmony': 'colorReal', 'color/light': 'spheres', 'color/workflow': 'colorReal', 'color/mood': 'spheres',
  'grading/what': 'gradeReal', 'grading/tools': 'gradeReal', 'grading/eye': 'gradeReal', 'grading/webtoon-grade': 'panels',
  'anim1/frames': 'arc', 'anim1/timing': 'slide', 'anim1/ball': 'bounce', 'anim1/squash': 'jump', 'anim1/arcs': 'arc',
  'anim2/antic': 'jump', 'anim2/keys': 'jump', 'anim2/overlap': 'arc', 'anim2/walk': 'walk', 'anim2/color-anim': 'walk',
  'toon1/format': 'panels', 'toon1/size': 'panels', 'toon1/panels': 'panels', 'toon1/flow': 'panels',
  'toon2/order': 'balloons', 'toon2/types': 'balloons', 'toon2/sfx': 'panels',
  'toon3/pipeline': 'panels', 'toon3/colorkey': 'colorReal', 'toon3/bg-fx': 'panels', 'toon3/final': 'panels',
};
export const kindInfo = (k) => KINDS[k];
export const levelsOf = (k) => (KINDS[k] && KINDS[k].levels) || LEVELS;

// Draw exercise `level` (0–3) of guide `kind` onto a canvas the size of the document.
export async function drawGuideInto(canvas, d, kind, level) {
  const K = KINDS[kind], x = canvas.getContext('2d');
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, canvas.width, canvas.height); x.restore();
  if (!K) return;
  x.save();
  try { await K.draw(x, d, level); } finally { x.restore(); }
}

function ellipseThrough(x, mids, c) {
  // ellipse through the 4 side midpoints of a perspective square (approximated by a smooth closed curve)
  x.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = mids[i], b = mids[(i + 1) % 4], corner = P(a.x + b.x - c.x, a.y + b.y - c.y), k = 0.55;
    if (!i) x.moveTo(a.x, a.y);
    x.bezierCurveTo(a.x + (corner.x - a.x) * k, a.y + (corner.y - a.y) * k, b.x + (corner.x - b.x) * k, b.y + (corner.y - b.y) * k, b.x, b.y);
  }
  x.closePath(); x.stroke();
}
