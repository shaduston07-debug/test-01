// Undo / redo. Commands are plain objects with undo()/redo() and an approximate byte cost.
// Pixel commands keep GPU canvas copies of the changed rectangle (no getImageData readbacks,
// which stall the GPU and can push canvases onto the slow CPU path).
import { makeCanvas, clamp } from './util.js';

export class History {
  constructor(onChange) {
    this.u = []; this.r = []; this.bytes = 0;
    this.maxSteps = 60; this.maxBytes = 260e6;
    this.onChange = onChange || (() => {});
  }
  push(cmd) {
    cmd.bytes ||= 0;
    for (const c of this.r) { this.bytes -= c.bytes; c.dispose && c.dispose(); }
    this.r = [];
    this.u.push(cmd); this.bytes += cmd.bytes;
    while ((this.u.length > this.maxSteps || this.bytes > this.maxBytes) && this.u.length > 1) {
      const old = this.u.shift();
      this.bytes -= old.bytes; old.dispose && old.dispose();
    }
    this.onChange();
  }
  undo() {
    const c = this.u.pop(); if (!c) return null;
    c.undo(); this.r.push(c); this.onChange(); return c;
  }
  redo() {
    const c = this.r.pop(); if (!c) return null;
    c.redo(); this.u.push(c); this.onChange(); return c;
  }
  clear() {
    for (const c of [...this.u, ...this.r]) c.dispose && c.dispose();
    this.u = []; this.r = []; this.bytes = 0; this.onChange();
  }
  get canUndo() { return this.u.length > 0; }
  get canRedo() { return this.r.length > 0; }
}

// Content version per canvas: lets autosave skip re-encoding unchanged layers.
export const touch = (canvas) => { canvas._ver = (canvas._ver || 0) + 1; };

// One shared "before" buffer. Callers snapshot() right before mutating a canvas,
// then pixelCmd() right after to capture the changed rectangle.
let backup = null;
export function snapshot(canvas) {
  if (!backup || backup.width !== canvas.width || backup.height !== canvas.height) {
    backup = makeCanvas(canvas.width, canvas.height);
  }
  const b = backup.getContext('2d');
  b.globalCompositeOperation = 'copy';
  b.drawImage(canvas, 0, 0);
  b.globalCompositeOperation = 'source-over';
  return backup;
}
export function getBackup() { return backup; }

function copyRect(src, x, y, w, h) {
  const c = makeCanvas(w, h);
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}
function putRect(dst, img, x, y) {
  const ctx = dst.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.beginPath(); ctx.rect(x, y, img.width, img.height); ctx.clip();
  ctx.drawImage(img, x, y);
  ctx.restore();
  touch(dst);
}

// `beforeImg` (optional): a rect-sized copy taken before the change; otherwise the
// shared snapshot() backup is used.
export function pixelCmd(canvas, rect, label, after, beforeImg) {
  const W = canvas.width, H = canvas.height;
  const r = rect || { x: 0, y: 0, w: W, h: H };
  const x = clamp(r.x | 0, 0, W), y = clamp(r.y | 0, 0, H);
  const w = clamp(Math.ceil(r.w), 0, W - x), hh = clamp(Math.ceil(r.h), 0, H - y);
  touch(canvas);
  if (w <= 0 || hh <= 0) return null;
  const before = beforeImg && beforeImg.width === w && beforeImg.height === hh ? beforeImg : copyRect(backup, x, y, w, hh);
  let redoImg = null;
  return {
    label, bytes: w * hh * 8,
    undo() { redoImg = copyRect(canvas, x, y, w, hh); putRect(canvas, before, x, y); after && after(); },
    redo() { if (redoImg) putRect(canvas, redoImg, x, y); after && after(); },
    dispose() { before.width = before.height = 0; if (redoImg) redoImg.width = redoImg.height = 0; },
  };
}

// Convenience: run a mutation on a canvas and record it.
export function withUndo(history, canvas, label, fn, after, rect) {
  snapshot(canvas);
  fn(canvas.getContext('2d'));
  const cmd = pixelCmd(canvas, rect, label, after);
  if (cmd) history.push(cmd);
  after && after();
}
