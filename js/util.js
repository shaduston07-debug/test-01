// Small DOM / math / color helpers shared across the app.
import { isNative, nativeSave, webShare, pickerAccept } from './platform.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

let _uid = Date.now() % 1e9;
export const uid = () => (++_uid).toString(36) + Math.random().toString(36).slice(2, 6);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (typeof v !== 'string' && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function makeCanvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(hgt));
  return c;
}
export const ctx2d = (c, opts) => c.getContext('2d', opts);

export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ── rects ──
export const emptyRect = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export function growRect(r, x, y, pad = 0) {
  if (x - pad < r.x0) r.x0 = x - pad;
  if (y - pad < r.y0) r.y0 = y - pad;
  if (x + pad > r.x1) r.x1 = x + pad;
  if (y + pad > r.y1) r.y1 = y + pad;
}
export function clampRect(r, w, hgt) {
  const x = clamp(Math.floor(r.x0), 0, w), y = clamp(Math.floor(r.y0), 0, hgt);
  const x2 = clamp(Math.ceil(r.x1), 0, w), y2 = clamp(Math.ceil(r.y1), 0, hgt);
  return { x, y, w: x2 - x, h: y2 - y };
}

// ── color ──
export function hsvToRgb(hh, s, v) {
  const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return [hh, mx ? d / mx : 0, mx];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
export function hexToRgb(hex) {
  let s = String(hex).replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── UI feedback ──
let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

export function dialog({ title, body, actions = [{ label: 'OK', primary: true }], wide = false, onClose }) {
  const root = $('#modal-root');
  const foot = h('div', { class: 'modal-foot' });
  const box = h('div', { class: 'modal' + (wide ? ' wide' : '') }, title ? h('h2', {}, title) : null, h('div', { class: 'modal-body' }, body), foot);
  const bg = h('div', { class: 'modal-bg' }, box);
  let closed = false;
  const close = (val) => {
    if (closed) return; closed = true;
    bg.remove(); onClose && onClose(val);
  };
  for (const a of actions) {
    foot.append(h('button', {
      class: 'pill' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
      onclick: async () => {
        if (a.onClick) { const keep = await a.onClick(); if (keep === false) return; }
        close(a.value ?? a.label);
      },
    }, a.label));
  }
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(null); });
  root.append(bg);
  return { close, el: box };
}

export function confirmDialog(msg, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    dialog({
      title: msg, body: '',
      actions: [{ label: 'Cancel', value: false }, { label: okLabel, primary: !danger, danger, value: true }],
      onClose: (v) => res(v === true),
    });
  });
}

export function promptDialog(title, value = '', multiline = false) {
  return new Promise((res) => {
    const input = multiline
      ? h('textarea', { class: 'text-in' }, value)
      : h('input', { class: 'text-in', value });
    let out = null;
    dialog({
      title, body: input,
      actions: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { out = input.value; } }],
      onClose: () => res(out),
    });
    setTimeout(() => { input.focus(); input.select && input.select(); }, 50);
  });
}

export async function download(blob, filename) {
  if (isNative) {
    try { await nativeSave(blob, filename); toast('Saved to Files › Inkwell Studio › Exports'); return; }
    catch (e) { console.warn('native save failed', e); }
  }
  if (await webShare(blob, filename)) return;
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept: pickerAccept(accept) || null, multiple });
    inp.style.display = 'none';
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

const scripts = {};
export function loadScript(src) {
  return (scripts[src] ||= new Promise((res, rej) => {
    const s = h('script', { src });
    s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('Failed to load ' + src)); };
    document.head.append(s);
  }));
}

export const canvasToBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
export const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
export async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
export async function blobToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = makeCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

// Range slider row used throughout panels
export function field(label, { min = 0, max = 1, step = 0.01, value = 0, fmt = (v) => v, onInput }) {
  const out = h('output', {}, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value: String(value) });
  inp.addEventListener('input', () => { const v = parseFloat(inp.value); out.textContent = fmt(v); onInput && onInput(v); });
  const el = h('div', { class: 'field' }, h('label', {}, label), out, inp);
  el.set = (v) => { inp.value = v; out.textContent = fmt(v); };
  return el;
}
export function switchRow(label, on, onChange) {
  const sw = h('button', { class: 'switch' + (on ? ' on' : '') });
  sw.addEventListener('click', () => { sw.classList.toggle('on'); onChange(sw.classList.contains('on')); });
  return h('div', { class: 'toggle-row' }, h('span', {}, label), sw);
}
export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  for (const [v, label] of options) {
    const b = h('button', { class: v === value ? 'on' : '' }, label);
    b.addEventListener('click', () => { for (const x of el.children) x.classList.remove('on'); b.classList.add('on'); onChange(v); });
    el.append(b);
  }
  return el;
}
export const pct = (v) => Math.round(v * 100) + '%';
