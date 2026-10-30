// Undo / redo. Commands are plain objects with undo()/redo() and an approximate byte cost.
import { makeCanvas, clamp } from './util.js';

export class History {
  constructor(onChange) {
    this.u = []; this.r = []; this.bytes = 0;
    this.maxSteps = 80; this.maxBytes = 300e6;
    this.onChange = onChange || (() => {});
  }
  push(cmd) {
    cmd.bytes ||= 0;
    for (const c of this.r) this.bytes -= c.bytes;
    this.r = [];
    this.u.push(cmd); this.bytes += cmd.bytes;
    while ((this.u.length > this.maxSteps || this.bytes > this.maxBytes) && this.u.length > 1) {
      this.bytes -= this.u.shift().bytes;
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
  clear() { this.u = []; this.r = []; this.bytes = 0; this.onChange(); }
  get canUndo() { return this.u.length > 0; }
  get canRedo() { return this.r.length > 0; }
}

// One shared "before" buffer. Callers snapshot() right before mutating a canvas,
// then pixelCmd() right after to capture the changed rectangle both ways.
let backup = null;
export function snapshot(canvas) {
  if (!backup || backup.width !== canvas.width || backup.height !== canvas.height) {
    backup = makeCanvas(canvas.width, canvas.height);
  }
  const b = backup.getContext('2d');
  b.clearRect(0, 0, backup.width, backup.height);
  b.drawImage(canvas, 0, 0);
  return backup;
}
export function getBackup() { return backup; }

export function pixelCmd(canvas, rect, label, after) {
  const W = canvas.width, H = canvas.height;
  const r = rect || { x: 0, y: 0, w: W, h: H };
  const x = clamp(r.x | 0, 0, W), y = clamp(r.y | 0, 0, H);
  const w = clamp(Math.ceil(r.w), 0, W - x), hh = clamp(Math.ceil(r.h), 0, H - y);
  if (w <= 0 || hh <= 0) return null;
  const before = backup.getContext('2d').getImageData(x, y, w, hh);
  const ctx = canvas.getContext('2d');
  const now = ctx.getImageData(x, y, w, hh);
  return {
    label, bytes: before.data.length * 2,
    undo() { ctx.putImageData(before, x, y); after && after(); },
    redo() { ctx.putImageData(now, x, y); after && after(); },
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
