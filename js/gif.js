// Minimal animated GIF encoder: global median-cut palette + LZW.

function medianCut(samples, maxColors) {
  // samples: array of [r,g,b]
  let boxes = [samples];
  while (boxes.length < maxColors) {
    let bi = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
        if (mx - mn > bestRange) { bestRange = mx - mn; bi = i; bestCh = c; }
      }
    });
    if (bi < 0 || bestRange <= 0) break;
    const b = boxes[bi].sort((p, q) => p[bestCh] - q[bestCh]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  });
}

function lzw(indices, minCode, out) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, maxcode = (1 << codeSize) - 1, free = eoi + 1, clearFlag = false;
  const dict = new Map();
  let cur = 0, nbits = 0;
  const bytes = [];
  const output = (code) => {
    cur |= code << nbits; nbits += codeSize;
    while (nbits >= 8) { bytes.push(cur & 255); cur >>>= 8; nbits -= 8; }
    if (free > maxcode || clearFlag) {
      if (clearFlag) { codeSize = minCode + 1; maxcode = (1 << codeSize) - 1; clearFlag = false; }
      else { codeSize++; maxcode = codeSize === 12 ? 4096 : (1 << codeSize) - 1; }
    }
  };
  output(clear);
  let ent = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i], key = (c << 12) | ent;
    const hit = dict.get(key);
    if (hit !== undefined) { ent = hit; continue; }
    output(ent);
    ent = c;
    if (free < 4096) dict.set(key, free++);
    else { dict.clear(); free = clear + 2; clearFlag = true; output(clear); }
  }
  output(ent);
  output(eoi);
  if (nbits > 0) bytes.push(cur & 255);
  out.push(minCode);
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
}

// frames: ImageData[] (same size). delay in 1/100 s. Transparent pixels (a<128) use index 255.
export function encodeGif(frames, delayCs, loop = true) {
  const w = frames[0].width, h = frames[0].height;
  const samples = [];
  const step = Math.max(1, Math.floor((w * h * frames.length) / 60000));
  let hasTransparency = false, k = 0;
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { hasTransparency = true; continue; }
      if (k++ % step === 0) samples.push([d[i], d[i + 1], d[i + 2]]);
    }
  }
  const pal = medianCut(samples.length ? samples : [[0, 0, 0]], 255);
  while (pal.length < 256) pal.push([0, 0, 0]);
  const TR = 255;
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    let v = cache[key];
    if (v >= 0) return v;
    let best = 0, bd = Infinity;
    for (let i = 0; i < 255; i++) {
      const p = pal[i], dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
      const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < bd) { bd = d; best = i; }
    }
    cache[key] = best;
    return best;
  };

  const out = [];
  const str = (s) => { for (const ch of s) out.push(ch.charCodeAt(0)); };
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  str('GIF89a'); u16(w); u16(h);
  out.push(0xf7, 0, 0);
  for (const p of pal) out.push(p[0], p[1], p[2]);
  if (loop) { out.push(0x21, 0xff, 11); str('NETSCAPE2.0'); out.push(3, 1, 0, 0, 0); }
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, (2 << 2) | (hasTransparency ? 1 : 0)); u16(delayCs); out.push(TR, 0);
    out.push(0x2c); u16(0); u16(0); u16(w); u16(h); out.push(0);
    const d = f.data, idx = new Uint8Array(w * h);
    for (let i = 0, j = 0; j < idx.length; i += 4, j++) idx[j] = d[i + 3] < 128 ? TR : nearest(d[i], d[i + 1], d[i + 2]);
    lzw(idx, 8, out);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
