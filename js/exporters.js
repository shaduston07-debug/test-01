// File writers for the Share menu: layered PSD, PDF, TIFF, animated PNG, and helpers that
// turn layers (or animation frames) into frame sequences for GIF / APNG / MP4 / HEVC.
import { makeCanvas, canvasToBlob } from './util.js';
import { encodePNG } from './pool.js';
import { alphaBounds } from './tools.js';

// ───────── byte writer ─────────
class W {
  constructor() { this.parts = []; this.len = 0; }
  bytes(u8) { this.parts.push(u8); this.len += u8.length; return this; }
  u8(v) { return this.bytes(Uint8Array.of(v & 255)); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.bytes(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v); return this.bytes(b); }
  str(s) { return this.bytes(new TextEncoder().encode(s)); }
  latin(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return this.bytes(b); }
  out() { const o = new Uint8Array(this.len); let p = 0; for (const x of this.parts) { o.set(x, p); p += x.length; } return o; }
}

// ───────── PSD ─────────
// PackBits run-length encoding of one row
function packBits(row) {
  const out = []; let i = 0;
  while (i < row.length) {
    let j = i;
    while (j + 1 < row.length && row[j + 1] === row[i] && j - i < 127) j++;
    if (j > i) { out.push(-(j - i) & 255, row[i]); i = j + 1; continue; }
    j = i;
    while (j + 1 < row.length && j - i < 127 && !(j + 2 < row.length && row[j + 1] === row[j + 2])) j++;
    out.push(j - i); for (let k = i; k <= j; k++) out.push(row[k]);
    i = j + 1;
  }
  return Uint8Array.from(out);
}
// one channel (RLE): returns [byteCounts(u16 per row) + rows]
function rleChannel(rgba, w, h, ch) {
  const counts = new W(), rows = [], row = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = rgba[(y * w + x) * 4 + ch];
    const p = packBits(row); rows.push(p); counts.u16(p.length);
  }
  const wr = new W().bytes(counts.out()); for (const r of rows) wr.bytes(r);
  return wr.out();
}
const PSD_BLEND = { 'source-over': 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite', 'color-dodge': 'div ', 'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff', exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ', lighter: 'lddg' };

// layers: [{ name, canvas (doc size), opacity, blend, visible, clip, alphaLock }] bottom → top
export function writePSD(width, height, layers, merged) {
  const recs = new W(), data = new W();
  for (const L of layers) {
    const b = alphaBounds(L.canvas) || { x: 0, y: 0, w: 0, h: 0 };
    const rgba = b.w ? L.canvas.getContext('2d', { willReadFrequently: true }).getImageData(b.x, b.y, b.w, b.h).data : new Uint8ClampedArray(0);
    const chans = [[-1, 3], [0, 0], [1, 1], [2, 2]].map(([id, c]) => [id, b.w ? rleChannel(rgba, b.w, b.h, c) : new Uint8Array(0)]);
    recs.i32(b.y).i32(b.x).i32(b.y + b.h).i32(b.x + b.w).u16(4);
    for (const [id, d] of chans) recs.i16(id).u32(2 + d.length);
    recs.latin('8BIM').latin(PSD_BLEND[L.blend] || 'norm');
    recs.u8(Math.round(L.opacity * 255)).u8(L.clip ? 1 : 0).u8((L.alphaLock ? 1 : 0) | (L.visible ? 0 : 2)).u8(0);
    // legacy Pascal name (ASCII) + 'luni' block with the full Unicode name (emoji, accents, Japanese…)
    const ascii = L.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255);
    const nameLen = 1 + ascii.length, pad = (4 - (nameLen % 4)) % 4;
    const u16 = [...L.name].flatMap((ch) => { const c = ch.codePointAt(0); return c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c]; });
    const luni = new W().u32(u16.length); for (const c of u16) luni.u16(c);
    if (luni.len % 4) luni.bytes(new Uint8Array(4 - (luni.len % 4)));
    const lu = luni.out();
    const extra = new W().u32(0).u32(0).u8(ascii.length).latin(ascii).bytes(new Uint8Array(pad)).latin('8BIMluni').u32(lu.length).bytes(lu).out();
    recs.u32(extra.length).bytes(extra);
    for (const [, d] of chans) { data.u16(b.w ? 1 : 0); data.bytes(d); }
  }
  let info = new W().i16(layers.length).bytes(recs.out()).bytes(data.out()).out();
  if (info.length % 2) info = new W().bytes(info).u8(0).out();
  const lmi = new W().u32(info.length).bytes(info).u32(0).out();
  const m = merged.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const merge = new W().u16(1);
  const chs = [0, 1, 2, 3].map((c) => rleChannel(m, width, height, c));
  for (const c of chs) merge.bytes(c.subarray(0, height * 2));
  for (const c of chs) merge.bytes(c.subarray(height * 2));
  const out = new W().latin('8BPS').u16(1).bytes(new Uint8Array(6)).u16(4).u32(height).u32(width).u16(8).u16(3)
    .u32(0).u32(0).u32(lmi.length).bytes(lmi).bytes(merge.out());
  return new Blob([out.out()], { type: 'image/vnd.adobe.photoshop' });
}

// ───────── PDF (one JPEG per page) ─────────
export async function writePDF(pages /* canvases */) {
  const enc = new TextEncoder(), objs = [];
  const add = (parts) => { objs.push(parts); return objs.length; };
  const catalog = add(null), pagesObj = add(null), kids = [];
  for (const c of pages) {
    const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
    const k = Math.min(1, 14400 / Math.max(c.width, c.height)), W2 = +(c.width * k).toFixed(2), H2 = +(c.height * k).toFixed(2);
    const img = add([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, enc.encode('\nendstream')]);
    const content = `q ${W2} 0 0 ${H2} 0 0 cm /Im0 Do Q`;
    const cs = add([enc.encode(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)]);
    kids.push(add([enc.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W2} ${H2}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${cs} 0 R >>`)]));
  }
  objs[catalog - 1] = [enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`)];
  objs[pagesObj - 1] = [enc.encode(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`)];
  const w = new W().latin('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'), offs = [];
  objs.forEach((parts, i) => { offs.push(w.len); w.str(`${i + 1} 0 obj\n`); for (const p of parts) w.bytes(p); w.str('\nendobj\n'); });
  const xref = w.len;
  w.str(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  w.str(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob([w.out()], { type: 'application/pdf' });
}

// ───────── TIFF (uncompressed RGBA) ─────────
export function writeTIFF(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const entries = 12, ifdSize = 2 + entries * 12 + 4;
  const bpsOff = 8 + ifdSize, resOff = bpsOff + 8, dataOff = resOff + 16;
  const b = new ArrayBuffer(dataOff + px.length), dv = new DataView(b), u8 = new Uint8Array(b);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  let p = 8; dv.setUint16(p, entries, true); p += 2;
  const tag = (t, type, count, val) => { dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true); if (type === 3 && count === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true); p += 12; };
  tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 4, bpsOff); tag(259, 3, 1, 1); tag(262, 3, 1, 2);
  tag(273, 4, 1, dataOff); tag(277, 3, 1, 4); tag(278, 4, 1, h); tag(279, 4, 1, px.length);
  tag(282, 5, 1, resOff); tag(283, 5, 1, resOff + 8); tag(338, 3, 1, 2);
  dv.setUint32(p, 0, true);
  for (let i = 0; i < 4; i++) dv.setUint16(bpsOff + i * 2, 8, true);
  dv.setUint32(resOff, 72, true); dv.setUint32(resOff + 4, 1, true); dv.setUint32(resOff + 8, 72, true); dv.setUint32(resOff + 12, 1, true);
  u8.set(px, dataOff);
  return new Blob([b], { type: 'image/tiff' });
}

// ───────── animated PNG ─────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const td = new Uint8Array(4 + data.length); for (let i = 0; i < 4; i++) td[i] = type.charCodeAt(i); td.set(data, 4);
  return new W().u32(data.length).bytes(td).u32(crc32(td)).out();
}
function pngChunks(u8) {
  const out = []; let p = 8; const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  while (p < u8.length) { const len = dv.getUint32(p), type = String.fromCharCode(...u8.subarray(p + 4, p + 8)); out.push([type, u8.subarray(p + 8, p + 8 + len)]); p += 12 + len; }
  return out;
}
export async function writeAPNG(frames /* canvases, same size */, fps) {
  // PNG-encode every frame in parallel on the worker pool
  const pngs = await Promise.all(frames.map(async (c) => new Uint8Array(await (await encodePNG(c)).arrayBuffer())));
  const w = new W().bytes(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
  const first = pngChunks(pngs[0]);
  w.bytes(chunk('IHDR', first.find((c) => c[0] === 'IHDR')[1]));
  w.bytes(chunk('acTL', new W().u32(frames.length).u32(0).out()));
  let seq = 0;
  const delay = Math.max(1, Math.round(1000 / fps));
  pngs.forEach((png, i) => {
    w.bytes(chunk('fcTL', new W().u32(seq++).u32(frames[i].width).u32(frames[i].height).u32(0).u32(0).u16(delay).u16(1000).u8(0).u8(0).out()));
    for (const [type, data] of pngChunks(png)) {
      if (type !== 'IDAT') continue;
      w.bytes(i === 0 ? chunk('IDAT', data) : chunk('fdAT', new W().u32(seq++).bytes(data).out()));
    }
  });
  w.bytes(chunk('IEND', new Uint8Array(0)));
  return new Blob([w.out()], { type: 'image/apng' });
}

// ───────── doc helpers ─────────
// Every layer with pixels, rendered on its own (text / panels / 3D included), bottom → top.
export function layerCanvases(doc) {
  const out = [];
  doc.items.forEach((it, i) => {
    if (it.type === 'group' || it.type === 'track') return;
    let c = it.type === 'raster' ? it.canvas : null;
    if (!c) {
      c = makeCanvas(doc.width, doc.height);
      const op = it.opacity; it.opacity = 1;
      doc.composite(c.getContext('2d'), { from: i, to: i + 1, bg: false });
      it.opacity = op;
    }
    const grp = it.groupId && doc.layers.find((g) => g.id === it.groupId);
    out.push({ name: (grp ? grp.name + ' / ' : '') + it.name, canvas: c, opacity: it.opacity * (grp ? grp.opacity : 1), blend: it.blend || 'source-over', visible: it.visible && (!grp || grp.visible), clip: !!it.clip, alphaLock: !!it.alphaLock, item: it });
  });
  return out;
}

// Frames for "Share Layers" animations: each visible layer over the background (Illustrate /
// Webtoon), or the timeline frames (Animate).
export function frameSource(app, maxSide = 1920) {
  const d = app.doc, k = Math.min(1, maxSide / Math.max(d.width, d.height));
  const w = Math.max(2, Math.round(d.width * k)), h = Math.max(2, Math.round(d.height * k));
  if (d.mode === 'animate') return { w, h, count: d.anim.length, fps: d.anim.fps, render: (i) => app.timeline.renderFrame(i, w, h) };
  const layers = layerCanvases(d).filter((l) => l.visible);
  return {
    w, h, count: layers.length, fps: 4,
    render: (i) => {
      const c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = d.bgVisible ? d.bg : '#ffffff'; x.fillRect(0, 0, w, h);
      x.drawImage(layers[i].canvas, 0, 0, w, h);
      return c;
    },
  };
}
